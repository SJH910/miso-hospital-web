from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sqlite3
import os
from cryptography.fernet import Fernet

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from pii_masking import mask_pii
from hospital_agent import run_agent

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

# --- 감사 로그 암호화 키 ---
KEY_FILE = "secret.key"
if not os.path.exists(KEY_FILE):
    key = Fernet.generate_key()
    with open(KEY_FILE, "wb") as key_file:
        key_file.write(key)
else:
    with open(KEY_FILE, "rb") as key_file:
        key = key_file.read()

cipher = Fernet(key)

# --- 감사 로그 DB (SQLite) ---
# 이 로그는 "LLM에 원문 대신 마스킹된 텍스트가 전달됐는지"를 사후 감사하기 위한 것으로,
# 환자가 본인 채팅 이력을 다시 보는 기능(그건 WAS의 chat_messages/MySQL이 담당)과는 별개다.
DB_FILE = "chatbot_logs.db"
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

init_db()

class ChatRequest(BaseModel):
    question: str
    patient_id: Optional[int] = None  # [통합] WAS가 세션에서 꺼내 넘겨줌 - 예약/기록 조회 도구에 필요

class ChatResponse(BaseModel):
    answer: str
    masked_question: str

@app.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
async def chat_endpoint(req: ChatRequest, request: Request):
    original_question = req.question

    if not original_question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # 1. PII 마스킹 (LLM에게는 마스킹된 질문만 전달 - 원문이 외부 LLM API로 나가지 않게 함)
    masked_question = mask_pii(original_question)

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
