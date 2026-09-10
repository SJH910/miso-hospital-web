"""
로그 데이터 파싱·정규화 + 탐지 결과 리포트 (LogDB_plan.md 6번 섹션 1·3단계).

4개 저장소(audit-logs/audit_log.jsonl, chatbot_logs.db, MySQL chat_messages, MySQL audit_log)를
각각 복호화해서 공통 스키마로 뽑아내고(1단계), pii_masking.mask_pii()로 마스킹 안 된 PII가
남아있는 필드를 찾아 리포트로 남긴다(3단계).

2단계(탐지 로직 자체)는 팀원이 이미 pii_masking.py/audit-agent/masking.py에 구현·통합해뒀으므로
여기서는 그 결과물(mask_pii)을 블랙박스로 호출만 한다 — 탐지 로직 자체를 재구현하지 않음.
"PII 종류(type)"까지는 분류하지 않기로 결정함(2026-09-10) — "발견 여부 + 위치 + 안전한 미리보기"만으로
원래 목적(사후 감사)은 충분하고, 종류 분류는 mask_pii()의 치환 토큰 문자열에 의존하게 돼서
pii_masking.py가 바뀔 때마다 같이 깨질 수 있는 약한 결합이라 지금은 뺌.

실행: 프로젝트 루트 또는 chatbot-service/ 어디서 실행해도 동작하도록 전부 __file__ 기준
절대경로/명시적 sys.path로 처리한다 (이 프로젝트에서 반복적으로 발견된 cwd 버그를 피하기 위함).
"""
import sys
import os
import csv
import json
import base64
import glob
from datetime import datetime
from pathlib import Path
from importlib import import_module

import pymysql
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv

CHATBOT_SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CHATBOT_SERVICE_DIR.parent

# audit-agent(chatbot-service/audit-agent/)와 pii_masking을 패키지로 import하기 위해
# chatbot-service 자체를 sys.path에 추가 — uvicorn --app-dir로 뜰 때와 달리 이 스크립트는
# 단독 실행되므로 직접 챙겨야 함. 아래 두 import보다 반드시 먼저 실행돼야 함.
if str(CHATBOT_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(CHATBOT_SERVICE_DIR))

audit_agent = import_module("audit-agent")
AuditCrypto = audit_agent.crypto.AuditCrypto

from pii_masking import mask_pii


def _connect_mysql():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        user=os.getenv("DB_USER", "vulnuser"),
        password=os.getenv("DB_PASS", os.getenv("DB_PASSWORD", "vulnpass")),
        database=os.getenv("DB_NAME", "vulnapp"),
        cursorclass=pymysql.cursors.DictCursor,
    )


# ── 1. MySQL audit_log 리더 — detail은 이미 평문 JSON이라 파싱만 하면 됨 ──────────────
def read_mysql_audit_log():
    records = []
    conn = _connect_mysql()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, actor_id, action, target_type, target_id, detail, created_at FROM audit_log"
            )
            for row in cur.fetchall():
                detail = row["detail"]
                if isinstance(detail, (bytes, bytearray)):
                    detail = detail.decode("utf-8")
                if isinstance(detail, str):
                    try:
                        detail = json.loads(detail)
                    except (TypeError, json.JSONDecodeError):
                        pass  # 파싱 안 되면 문자열 그대로 둠 (그래도 검사는 가능)
                records.append({
                    "source": "mysql_audit",
                    "record_id": row["id"],
                    "timestamp": str(row["created_at"]),
                    "actor_id": row["actor_id"],
                    "text_fields": {
                        "action": row["action"],
                        "detail": json.dumps(detail, ensure_ascii=False) if isinstance(detail, (dict, list)) else str(detail),
                    },
                })
    finally:
        conn.close()
    return records


# ── 2. audit-logs/audit_log.jsonl 리더 — AuditCrypto로 payload_encrypted 복호화 ─────
# 오늘자 파일뿐 아니라 자정 로테이션 백업(audit_log.jsonl.YYYY-MM-DD)도 전부 스캔 대상에 포함.
def read_audit_jsonl():
    load_dotenv(dotenv_path=CHATBOT_SERVICE_DIR / ".env")
    key = os.getenv("AUDIT_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("AUDIT_ENCRYPTION_KEY가 chatbot-service/.env에 없습니다.")
    crypto = AuditCrypto(key=key.encode("utf-8"))

    log_dir = PROJECT_ROOT / "audit-logs"
    files = sorted(glob.glob(str(log_dir / "audit_log.jsonl*")))

    records = []
    for file_path in files:
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                raw = json.loads(line)
                try:
                    payload = crypto.decrypt_payload(raw["payload_encrypted"])
                except Exception as e:
                    # 복호화 실패(키 불일치, 손상 등)는 건너뛰되 어디서 실패했는지는 남긴다.
                    records.append({
                        "source": "audit_jsonl",
                        "record_id": raw.get("event_id"),
                        "timestamp": raw.get("timestamp"),
                        "actor_id": None,
                        "text_fields": {"_decrypt_error": f"{type(e).__name__}: {e}"},
                    })
                    continue

                input_data = payload.get("input", {}) if isinstance(payload, dict) else {}
                kwargs = input_data.get("kwargs", {}) if isinstance(input_data, dict) else {}
                args = input_data.get("args", []) if isinstance(input_data, dict) else []
                # patient_id는 보통 kwargs로 오거나(check_medical_records 등), args의 첫 값으로 옴.
                # 단 tool_rag(question)처럼 patient_id를 아예 안 받는 도구는 args[0]이 질문
                # 텍스트라서, 숫자로만 이뤄진 경우만 patient_id로 간주한다(오분류 방지).
                actor_id = kwargs.get("patient_id") if isinstance(kwargs, dict) else None
                if actor_id is None and args and str(args[0]).isdigit():
                    actor_id = args[0]

                records.append({
                    "source": "audit_jsonl",
                    "record_id": raw.get("event_id"),
                    "timestamp": raw.get("timestamp"),
                    "actor_id": actor_id,
                    "text_fields": {
                        "action": raw.get("action"),
                        "input": json.dumps(input_data, ensure_ascii=False),
                        "output": str(payload.get("output")) if isinstance(payload, dict) else str(payload),
                    },
                })
    return records


# ── 3. chatbot_logs.db(SQLite) 리더 — secret.key 기반 Fernet으로 original_encrypted 복호화 ──
def read_chatbot_logs_db():
    import sqlite3

    key_file = PROJECT_ROOT / "secret.key"
    if not key_file.exists():
        raise RuntimeError(f"{key_file}가 없습니다.")
    cipher = Fernet(key_file.read_bytes())

    db_file = PROJECT_ROOT / "chatbot_logs.db"
    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row
    records = []
    try:
        cur = conn.execute(
            "SELECT id, timestamp, patient_id, original_encrypted, masked_text, response FROM logs"
        )
        for row in cur.fetchall():
            try:
                original = cipher.decrypt(row["original_encrypted"]).decode("utf-8")
            except Exception as e:
                original = f"[복호화 실패: {type(e).__name__}]"

            records.append({
                "source": "chatbot_sqlite",
                "record_id": row["id"],
                "timestamp": row["timestamp"],
                "actor_id": row["patient_id"],
                "text_fields": {
                    "original": original,
                    "masked_text": row["masked_text"],
                    "response": row["response"],
                },
            })
    finally:
        conn.close()
    return records


# ── 4. MySQL chat_messages 리더 — was/crypto-utils.js와 동일한 AES-256-GCM 재구현 ────
# 저장 포맷(crypto-utils.js encryptRrn): base64(iv[12] + authTag[16] + ciphertext)
def _decrypt_aes256gcm(stored_b64: str, key: bytes) -> str:
    raw = base64.b64decode(stored_b64)
    iv, tag, ciphertext = raw[:12], raw[12:28], raw[28:]
    plaintext = AESGCM(key).decrypt(iv, ciphertext + tag, None)
    return plaintext.decode("utf-8")


def read_mysql_chat_messages():
    load_dotenv(dotenv_path=PROJECT_ROOT / "was" / ".env")
    key_hex = os.getenv("RRN_ENCRYPTION_KEY")
    if not key_hex:
        raise RuntimeError(
            "RRN_ENCRYPTION_KEY가 was/.env에 없습니다 — 이 키가 없으면 서버도 매 재시작마다 "
            "새 랜덤 키를 쓰므로, 이 리더로도 기존 데이터를 복호화할 수 없습니다."
        )
    key = bytes.fromhex(key_hex)

    records = []
    conn = _connect_mysql()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, patient_id, sender, content, created_at FROM chat_messages")
            for row in cur.fetchall():
                try:
                    content = _decrypt_aes256gcm(row["content"], key)
                except Exception as e:
                    content = f"[복호화 실패: {type(e).__name__}]"

                records.append({
                    "source": "mysql_chat",
                    "record_id": row["id"],
                    "timestamp": str(row["created_at"]),
                    "actor_id": row["patient_id"],
                    "text_fields": {"sender": row["sender"], "content": content},
                })
    finally:
        conn.close()
    return records


# ── 3단계 — 탐지 결과 리포트 ─────────────────────────────────────────────────
# mask_pii()를 블랙박스로 호출해서 "원문과 마스킹 결과가 다르면 = 마스킹 안 된 PII가 있었다"로
# 판정한다. 종류(RRN/이메일 등) 분류는 하지 않음(모듈 docstring 참고) — 발견 여부·위치·안전한
# 미리보기(=마스킹된 값 자체)만 남긴다. 원문은 findings에도, 리포트에도 절대 담지 않는다.
# mysql_audit(WAS 감사로그)의 ip 필드는 SECURITY_THREAT_MODEL.md §6-4에 따라 침해 대응을 위해
# 의도적으로 마스킹하지 않는다 - mask_pii()는 이 예외를 모르고 사설 IP를 일반 규칙대로 잡아내므로
# 여기서 "발견은 하되 알려진 예외로 표시"만 한다. mask_pii()의 치환 토큰 문자열을 들여다보고
# PII 종류를 추론하는 건 아님(그건 위 docstring에서 이미 하지 않기로 한 결정) - source만으로
# 판단하므로 mask_pii()가 바뀌어도 이 판정 자체는 깨지지 않는다.
KNOWN_EXCEPTION_SOURCES = {"mysql_audit"}


def scan_for_pii(records):
    findings = []
    for record in records:
        for field, value in record.get("text_fields", {}).items():
            if not isinstance(value, str) or not value:
                continue
            masked = mask_pii(value)
            if masked != value:
                findings.append({
                    "source": record["source"],
                    "record_id": record["record_id"],
                    "timestamp": record["timestamp"],
                    "actor_id": record["actor_id"],
                    "field": field,
                    "masked_preview": masked,
                    "known_exception": record["source"] in KNOWN_EXCEPTION_SOURCES,
                })
    return findings


def write_report(findings, output_path):
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["source", "record_id", "timestamp", "actor_id", "field", "masked_preview", "known_exception"],
        )
        writer.writeheader()
        writer.writerows(findings)


def main():
    readers = [
        ("mysql_audit", read_mysql_audit_log),
        ("audit_jsonl", read_audit_jsonl),
        ("chatbot_sqlite", read_chatbot_logs_db),
        ("mysql_chat", read_mysql_chat_messages),
    ]
    all_records = []
    for name, reader in readers:
        try:
            records = reader()
            print(f"[{name}] {len(records)}건 읽음")
            all_records.extend(records)
        except Exception as e:
            print(f"[{name}] 실패: {type(e).__name__}: {e}", file=sys.stderr)

    print(f"\n총 {len(all_records)}건 (공통 스키마로 변환 완료)")

    findings = scan_for_pii(all_records)
    known_exception_count = sum(1 for f in findings if f["known_exception"])
    print(
        f"마스킹 안 된 PII 의심 항목 {len(findings)}건 발견 "
        f"(그중 {known_exception_count}건은 known_exception=True — mysql_audit의 ip 필드, "
        f"SECURITY_THREAT_MODEL.md §6-4 참고, 실제 이슈 아님)"
    )

    if findings:
        report_path = CHATBOT_SERVICE_DIR / f"log_audit_report_{datetime.now():%Y%m%d_%H%M%S}.csv"
        write_report(findings, report_path)
        print(f"리포트 저장: {report_path}")

    return all_records, findings


if __name__ == "__main__":
    main()
