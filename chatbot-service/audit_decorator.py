import sys
import os
import json
import functools
import uuid
import traceback
from pathlib import Path
import logging
from logging.handlers import TimedRotatingFileHandler
from concurrent.futures import ThreadPoolExecutor

# dotenv 설정
from dotenv import load_dotenv

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent

load_dotenv(dotenv_path=current_dir / ".env")
sys.path.insert(0, str(parent_dir))

import importlib
# 동적으로 audit-agent 로드
audit_agent = importlib.import_module("audit-agent")
AuditEngine = audit_agent.engine.AuditEngine

# 2. KMS (.env 연동)
# 고정 키를 사용하여 서버가 재시작되어도 과거 로그 복호화 가능
ENCRYPTION_KEY_STR = os.getenv("AUDIT_ENCRYPTION_KEY")
if not ENCRYPTION_KEY_STR:
    raise RuntimeError("AUDIT_ENCRYPTION_KEY가 .env 파일에 설정되지 않았습니다.")
ENCRYPTION_KEY = ENCRYPTION_KEY_STR.encode('utf-8')

# 3. Log Rotation 적용
LOG_DIR = parent_dir / "audit-logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
os.chmod(LOG_DIR, 0o700)  # 감사 로그 디렉토리는 이 컴퓨터의 다른 로컬 계정이 목록조차 못 보게 소유자 전용으로 제한
LOG_FILE = LOG_DIR / "audit_log.jsonl"

# 해시 체인이 서버 재시작 후에도 끊기지 않도록, 기존 로그 파일의 마지막 hash를 이어받게
# LOG_FILE 경로를 넘겨준다 (LOG_FILE을 AuditEngine보다 먼저 정의해야 하는 이유).
# retention_days=730(2년): report_merge_final.md "감사 로그 보존 정책" 결정(2026-09-10).
audit_engine_instance = AuditEngine(encryption_key=ENCRYPTION_KEY, retention_days=730, log_file_path=str(LOG_FILE))

# 매 자정마다(midnight) 파일을 분할하여 백업한다.
# [보안 수정 2026-09-10] backupCount=30이면 TimedRotatingFileHandler가 30일 지난 백업
# 파일을 자동으로 지워버린다 — "2년 보존" 정책과 무관하게 실제로는 한 달만 지나도 감사
# 로그가 조용히 사라지고 있었던 버그. backupCount=0으로 바꿔 자동 삭제를 끄고, 실제 삭제는
# log_retention_tool.py를 관리자가 직접 실행할 때만(dry-run 기본, --execute로만 삭제)
# 일어나도록 함 — 자동화된 삭제보다 사람이 확인 후 지우는 쪽을 택한 결정과 일치.
audit_logger = logging.getLogger("AuditLogger")
audit_logger.setLevel(logging.INFO)
# 기존 핸들러 제거 (중복 방지)
audit_logger.handlers = []

class SecureTimedRotatingFileHandler(TimedRotatingFileHandler):
    """
    감사 로그는 admin만 볼 수 있어야 하는데(MySQL audit_log는 이미 RBAC 적용됨),
    이 파일은 OS 파일 권한에만 의존하고 있었다. _open()은 최초 파일 생성 시뿐 아니라
    자정 로테이션으로 새 파일이 생길 때도 호출되는 지점이라, 여기서 매번 소유자 전용
    권한(0o600)으로 좁혀야 로테이션 이후에도 계속 유지된다.
    """
    def _open(self):
        stream = super()._open()
        os.chmod(self.baseFilename, 0o600)
        return stream

rotating_handler = SecureTimedRotatingFileHandler(
    filename=LOG_FILE,
    when="midnight",
    interval=1,
    backupCount=0,
    encoding="utf-8"
)
# JSONL 포맷이므로 메시지만 출력
rotating_handler.setFormatter(logging.Formatter('%(message)s'))
audit_logger.addHandler(rotating_handler)

# 5. 비동기 처리용 ThreadPool
executor = ThreadPoolExecutor(max_workers=2)

def _async_process_audit(event_id, action, audit_payload):
    """비동기로 감사 로그 파이프라인과 저장을 수행하는 워커 함수"""
    try:
        # 감사 파이프라인 (마스킹, 암호화, 해시체인 등)
        audit_record = audit_engine_instance.process_event(
            event_id=event_id,
            action=action,
            payload=audit_payload
        )
        
        # 4. 실시간 악성 위협 알림 (Console Alert)
        # 원본 페이로드의 입력값에 악성 키워드가 포함되었는지 확인
        malicious_keywords = ["지시사항 무시", "프롬프트 출력", "시스템 프롬프트", "이전 지시 무시"]
        input_args = str(audit_payload.get("input", {}).get("args", []))
        is_malicious = any(kw in input_args for kw in malicious_keywords)
        if is_malicious:
            print(f"\n\033[91m[🚨 실시간 보안 위협 경고] 악성 인젝션 시도가 탐지되었습니다! EventID: {event_id}\033[0m")

        # 로거를 통해 JSONL 파일 저장 (Rotation 적용)
        audit_logger.info(json.dumps(audit_record, ensure_ascii=False))
        
        print(f"✅ [Audit Async] 로그 저장 완료 (EventID={event_id})")
        
    except Exception as audit_err:
        print(f"❌ [Audit System Error] 백그라운드 감사 로그 기록 실패: {audit_err}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

def audit_log(action: str):
    """
    RAG 시스템 및 Agent 로직을 감시(Audit)하기 위한 데코레이터.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            event_id = str(uuid.uuid4())
            
            input_payload = {
                "func_name": func.__name__,
                "args": [str(a) for a in args],
                "kwargs": {k: str(v) for k, v in kwargs.items()}
            }
            
            result = None
            success = False
            output_payload = None
            
            try:
                result = func(*args, **kwargs)
                success = True
                if isinstance(result, dict):
                    output_payload = result
                else:
                    output_payload = str(result)
            except Exception as e:
                success = False
                output_payload = str(e)
                raise
            finally:
                audit_payload = {
                    "input": input_payload,
                    "output": output_payload,
                    "success": success
                }
                
                # 메인 스레드를 멈추지 않고 스레드 풀에 던져 비동기 처리
                executor.submit(_async_process_audit, event_id, action, audit_payload)
                
            return result
        return wrapper
    return decorator
