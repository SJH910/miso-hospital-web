from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import hmac
import sqlite3
import os
from pathlib import Path
from cryptography.fernet import Fernet

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from pii_masking import mask_pii
from hospital_agent import run_agent
from audit_summary import build_audit_summary

app = FastAPI(title="Hospital Chatbot API")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# [보안 강화] 이 서비스는 Node(WAS)에서만 호출되므로 "*" 대신 WAS 오리진만 허용.
# (원본 app.py는 allow_origins=["*"]였는데, 이 프로젝트 전반의 CORS 하드닝 기준과 맞지 않아 수정)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("WAS_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)

# [보안 강화 2026-09-10] CORS는 브라우저의 cross-origin만 막지, curl 등으로 이 포트에 직접
# 요청을 보내는 건 못 막는다 - patient_id를 아무 검증 없이 신뢰하던 /chat이 실질적으로
# IDOR이었음(임의 patient_id로 다른 환자 정보 조회 가능). was와 공유하는 비밀키를 요구해서
# 이 값을 모르는 호출자는 아예 거부한다. .env에 없으면 여기서 바로 죽게 해서(AUDIT_ENCRYPTION_KEY와
# 같은 fail-fast 패턴) "키 설정을 깜빡한 채로 조용히 무방비 상태로 뜨는" 상황을 막는다.
INTERNAL_SERVICE_KEY = os.getenv("CHATBOT_SERVICE_KEY")
if not INTERNAL_SERVICE_KEY:
    raise RuntimeError("CHATBOT_SERVICE_KEY가 .env 파일에 설정되지 않았습니다.")


def verify_internal_caller(request: Request):
    provided = request.headers.get("x-internal-auth", "")
    # 타이밍 사이드채널 방지를 위해 단순 문자열 비교(==) 대신 상수 시간 비교 사용.
    if not hmac.compare_digest(provided, INTERNAL_SERVICE_KEY):
        raise HTTPException(status_code=401, detail="이 서비스는 내부 호출만 허용합니다.")

# --- 감사 로그 암호화 키 ---
# 실행 위치(cwd)에 상관없이 항상 프로젝트 루트의 같은 파일을 가리키도록 절대경로로 고정.
# (상대경로였을 때는 chatbot-service/ 안에서 직접 실행하면 새 키가 또 생성돼서
#  기존 로그를 영구히 복호화 못 하게 되는 문제가 있었음 — LogDB_plan.md 3-3 참고)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = str(PROJECT_ROOT / "secret.key")
if not os.path.exists(KEY_FILE):
    key = Fernet.generate_key()
    with open(KEY_FILE, "wb") as key_file:
        key_file.write(key)
else:
    with open(KEY_FILE, "rb") as key_file:
        key = key_file.read()

# [보안 수정 2026-09-10] 이 파일을 만들 때 권한을 안 좁혀서 기본 umask대로 0644(그룹/전체 읽기
# 가능)로 생성되고 있었음 - audit_decorator.py는 같은 문제를 이미 0600으로 고쳐뒀는데
# (SecureTimedRotatingFileHandler) 이쪽엔 그 조치가 빠져있었던 것. 이미 있던 파일이든 새로
# 만든 파일이든 매번 재적용해서 소유자 전용으로 확실히 좁힌다.
os.chmod(KEY_FILE, 0o600)

cipher = Fernet(key)

# --- 감사 로그 DB (SQLite) ---
# 이 로그는 "LLM에 원문 대신 마스킹된 텍스트가 전달됐는지"를 사후 감사하기 위한 것으로,
# 환자가 본인 채팅 이력을 다시 보는 기능(그건 WAS의 chat_messages/MySQL이 담당)과는 별개다.
DB_FILE = str(PROJECT_ROOT / "chatbot_logs.db")
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            patient_id INTEGER,
            original_encrypted BLOB,
            masked_text TEXT,
            response TEXT
        )
    ''')
    conn.commit()
    conn.close()
    # KEY_FILE과 같은 이유 - original_encrypted에 마스킹 전 원문이 들어있어서, 이 파일과
    # secret.key 둘 다 그룹/전체 읽기 가능이면 키+암호문을 같이 읽어 복호화당할 수 있었음.
    os.chmod(DB_FILE, 0o600)

init_db()

class ChatRequest(BaseModel):
    question: str
    patient_id: Optional[int] = None  # [통합] WAS가 세션에서 꺼내 넘겨줌 - 예약/기록 조회 도구에 필요

class ChatResponse(BaseModel):
    answer: str
    masked_question: str

@app.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
# [성능 수정 2026-09-11] 이 함수는 async def였지만 내부에 await가 단 하나도 없이 전부
# 동기 코드(pymysql, Gemini 호출, sqlite3)를 그대로 실행하고 있었음 - "async인 척하는 sync
# 함수"라 이벤트 루프를 그대로 막고 있던 것(BUG_REVIEW_2026-09-10.md 참고). FastAPI는 sync
# def 라우트를 자동으로 별도 스레드풀에서 돌려주므로, async를 떼는 것만으로 내부 코드를
# 하나도 안 고치고 이벤트 루프 블로킹을 없앨 수 있다.
def chat_endpoint(req: ChatRequest, request: Request):
    verify_internal_caller(request)

    original_question = req.question

    if not original_question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # 1. PII 마스킹 (LLM에게는 마스킹된 질문만 전달 - 원문이 외부 LLM API로 나가지 않게 함)
    # fail-closed: 마스킹 자체가 실패했는데 그냥 진행하면 원문이 그대로 LLM으로 나갈 수 있으므로,
    # 이 단계에서 예외가 나면 요청을 막는다 (아래 2/3단계처럼 "일단 진행"하지 않음).
    try:
        masked_question = mask_pii(original_question)
    except Exception as e:
        print(f"PII masking error: {e}")
        raise HTTPException(status_code=500, detail="요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.")

    # 2. 에이전트 실행. patient_id는 마스킹 대상이 아니라 "누구인지 식별하는 세션 값"이므로
    #    마스킹된 질문과 별도로 그대로 전달한다 (예약/기록 조회 도구가 사용).
    try:
        answer = run_agent(masked_question, patient_id=req.patient_id)
    except Exception as e:
        print(f"Agent error: {e}")
        answer = "죄송합니다. 현재 챗봇 서비스에 문제가 발생했습니다."

    # 3. 감사 로그 저장 (원문은 암호화, patient_id는 평문 - 감사 시 누구 대화인지 특정 가능해야 함)
    try:
        encrypted_question = cipher.encrypt(original_question.encode('utf-8'))
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute(
            "INSERT INTO logs (patient_id, original_encrypted, masked_text, response) VALUES (?, ?, ?, ?)",
            (req.patient_id, encrypted_question, masked_question, answer)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB Logging error: {e}")

    return ChatResponse(answer=answer, masked_question=masked_question)

# [체크리스트 7번 - 대시보드 1단계] WAS 관리자 화면이 감사로그를 보여주려면, WAS 자신의
# MySQL(mysql_audit)은 직접 조회할 수 있지만 챗봇 쪽 3개 저장소(audit_jsonl/chatbot_sqlite/
# mysql_chat)는 암호화 키(AUDIT_ENCRYPTION_KEY/secret.key)를 이 서비스만 갖고 있어 직접 못
# 읽는다. 그래서 그 부분만 이 엔드포인트로 내려주고, WAS가 자기 DB 조회 결과와 합쳐서
# 프론트에 응답한다 - /chat과 동일하게 내부 서비스 호출만 허용(브라우저 직접 접근 차단).
@app.get("/audit-summary")
@limiter.limit("10/minute")
async def audit_summary_endpoint(request: Request):
    verify_internal_caller(request)
    return build_audit_summary()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
