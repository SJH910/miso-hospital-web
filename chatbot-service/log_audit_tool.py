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
from collections import Counter
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
                "SELECT id, actor_id, action, target_type, target_id, detail, risk_level, created_at "
                "FROM audit_log"
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
                    # was/risk-classification.js가 logAudit() 기록 시점에 이미 계산해서 저장해둔
                    # 값(low/medium/high). 이 리더는 그대로 읽기만 하고 재계산하지 않는다 —
                    # 아래 evaluate_severity()가 SECURITY_AUDIT_CRITERIA.md의 4단계로 옮겨 쓴다.
                    "risk_level": row["risk_level"],
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
                        # risk_level은 payload_encrypted 밖의 평문 필드라 복호화 실패와 무관하게 읽힘
                        # (engine.py가 의도적으로 이렇게 설계함 — 복호화 없이도 등급 스캔 가능하도록).
                        "risk_level": raw.get("risk_level"),
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
                    # chatbot-service/audit-agent/risk_classification.py가 process_event() 안에서
                    # 이미 계산해 raw(암호화 밖)에 남겨둔 값. 여기서 다시 판정하지 않는다.
                    "risk_level": raw.get("risk_level"),
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
                # 이 저장소는 risk_level을 기록하지 않음 — 스키마 일관성을 위해 None으로 채움.
                "risk_level": None,
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
                    # 이 저장소는 risk_level을 기록하지 않음 — 스키마 일관성을 위해 None으로 채움.
                    "risk_level": None,
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


# ── 4단계 — 감사 기준(SECURITY_AUDIT_CRITERIA.md) 적용 + CLI/CSV 리포트 ───────────
# 위험도 "판정"은 여기서 다시 하지 않는다 — was/risk-classification.js와
# chatbot-service/audit-agent/risk_classification.py가 로그를 기록하는 시점에 이미 계산해서
# audit_log.risk_level 컬럼(mysql_audit)/JSONL 최상위 평문 필드(audit_jsonl)에 저장해뒀으므로,
# 여기서는 그 값을 그대로 읽어 SECURITY_AUDIT_CRITERIA.md의 4단계(Critical/High/Medium/Low)로
# 옮겨 표시만 한다. 등급 기준을 이 파일에 따로 중복 관리하지 않으므로, risk-classification.js/
# risk_classification.py만 고치면 이 리포트에도 그대로 반영된다.
_RISK_LEVEL_TO_SEVERITY = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH"}

# risk_level="high"인 이벤트 중에서도 관리자 계정 침해 정황(반복실패/신규IP/신규지역 — 이미
# 로그인에 성공했거나 표적이 된 상태)은 한 단계 더 위인 CRITICAL로 승격한다. totp_verify_fail/
# totp_disabled/프롬프트 인젝션(risk_level="high")은 승격하지 않고 HIGH를 유지 — 침해 "정황"이지
# 이미 성공한 침해는 아니기 때문 (근거는 SECURITY_AUDIT_CRITERIA.md 참고).
ADMIN_ANOMALY_ACTIONS = {
    "login_anomaly_admin_repeated_failure",
    "login_anomaly_admin_new_ip",
    "login_anomaly_admin_new_location",
}

# 로그 이벤트로는 나타나지 않는 정적(코드/DB 스키마) 점검 결과. risk_level 흐름과는 완전히
# 별도로 관리한다 — 자동 스캔이 아니라 SECURITY_AUDIT_CRITERIA.md 갱신 시 사람이 함께 갱신.
STATIC_FINDINGS = [
    {
        "id": "totp_secret_plaintext",
        "severity": "CRITICAL",
        "category": "DB 평문 시크릿 저장",
        "location": "db/init.sql (patients.totp_secret)",
        "summary": "TOTP 비밀키(base32)가 평문으로 저장됨 — DB 유출 시 2차인증 전체가 무력화됨",
        "remediation": "totp_secret을 애플리케이션 레벨에서 암호화 후 저장하도록 개선 필요",
    },
]


def evaluate_severity(log_record):
    """공통 스키마 레코드 1개의 위험도를 SECURITY_AUDIT_CRITERIA.md의 4단계로 판정한다.

    risk_level(팀원 쪽 기록 로직이 이미 계산해 저장한 low/medium/high)을 그대로 읽어 옮기고,
    관리자 계정 침해 정황만 CRITICAL로 승격한다. PII 미마스킹/정적 이슈는 이 판정에 섞지 않고
    generate_audit_report()에서 별도 섹션으로 다룬다(SECURITY_AUDIT_CRITERIA.md §2-2 결정).
    """
    risk_level = log_record.get("risk_level")
    severity = _RISK_LEVEL_TO_SEVERITY.get(risk_level, "NONE")

    action = log_record.get("text_fields", {}).get("action")
    escalated = severity == "HIGH" and action in ADMIN_ANOMALY_ACTIONS
    if escalated:
        severity = "CRITICAL"

    return {
        "source": log_record.get("source"),
        "record_id": log_record.get("record_id"),
        "timestamp": log_record.get("timestamp"),
        "actor_id": log_record.get("actor_id"),
        "action": action,
        "risk_level": risk_level,
        "severity": severity,
        "escalated": escalated,
    }


def _write_audit_report_csv(evaluated, pii_findings, static_findings, output_path):
    fieldnames = [
        "section", "source", "record_id", "timestamp", "actor_id",
        "severity", "risk_level", "action_or_field", "detail", "known_exception",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in evaluated:
            if item["severity"] == "NONE":
                continue
            writer.writerow({
                "section": "risk_level",
                "source": item["source"],
                "record_id": item["record_id"],
                "timestamp": item["timestamp"],
                "actor_id": item["actor_id"],
                "severity": item["severity"],
                "risk_level": item["risk_level"],
                "action_or_field": item["action"],
                "detail": "관리자 계정 침해 정황으로 CRITICAL 승격" if item["escalated"] else "",
                "known_exception": "",
            })
        for finding in pii_findings:
            writer.writerow({
                "section": "pii_scan",
                "source": finding["source"],
                "record_id": finding["record_id"],
                "timestamp": finding["timestamp"],
                "actor_id": finding["actor_id"],
                "severity": "HIGH",
                "risk_level": "",
                "action_or_field": finding["field"],
                "detail": finding["masked_preview"],
                "known_exception": finding["known_exception"],
            })
        for sf in static_findings:
            writer.writerow({
                "section": "static",
                "source": "static",
                "record_id": sf["id"],
                "timestamp": "",
                "actor_id": "",
                "severity": sf["severity"],
                "risk_level": "",
                "action_or_field": sf["category"],
                "detail": f"{sf['summary']} ({sf['location']})",
                "known_exception": "",
            })


def generate_audit_report(parsed_logs, pii_findings=None, output_csv=None, max_inline_detail=20):
    """SECURITY_AUDIT_CRITERIA.md 기준 CLI 대시보드 + CSV 리포트.

    risk_level 기반 등급(①)과, 이 파일의 known_exception 인지 PII 스캔(②), STATIC_FINDINGS(③)를
    각각 별도 섹션으로 보여준다 — ②·③은 risk_level 체계에 없는 이 도구만의 발견이라 등급 합계에
    섞지 않는다(SECURITY_AUDIT_CRITERIA.md §2-2 결정 사항).
    """
    if pii_findings is None:
        pii_findings = scan_for_pii(parsed_logs)

    evaluated = [evaluate_severity(record) for record in parsed_logs]
    counts = Counter(item["severity"] for item in evaluated)

    print(f"\n==== ① risk_level 기반 감사 리포트 요약 (총 {len(evaluated)}건) ====")
    for level in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"):
        print(f"{level:<8} : {counts.get(level, 0)}건")

    notable = [item for item in evaluated if item["severity"] in ("CRITICAL", "HIGH")]
    print(f"\n---- CRITICAL / HIGH 상세 ({len(notable)}건) ----")
    records_by_id = {(r["source"], r["record_id"]): r for r in parsed_logs}
    for item in notable[:max_inline_detail]:
        tag = " [관리자 침해 정황으로 승격]" if item["escalated"] else ""
        print(f"[{item['severity']}] {item['source']}#{item['record_id']} "
              f"{item['timestamp']} actor_id={item['actor_id']} action={item['action']}{tag}")
        record = records_by_id.get((item["source"], item["record_id"]))
        if record:
            for field, value in record.get("text_fields", {}).items():
                if isinstance(value, str) and value:
                    print(f"  - preview[{field}]: {mask_pii(value)[:120]}")
    if len(notable) > max_inline_detail:
        print(f"  ... 나머지 {len(notable) - max_inline_detail}건은 CSV 참고")

    known_exception_count = sum(1 for f in pii_findings if f["known_exception"])
    real_pii_findings = [f for f in pii_findings if not f["known_exception"]]
    print(f"\n==== ② PII 미마스킹 스캔 (risk_level과 별도 트랙, 총 {len(pii_findings)}건) ====")
    print(f"그중 {known_exception_count}건은 known_exception=True — 실제 이슈 아님 (제외하고 표시)")
    for f in real_pii_findings[:max_inline_detail]:
        print(f"[HIGH] {f['source']}#{f['record_id']} field={f['field']} preview={f['masked_preview']}")
    if len(real_pii_findings) > max_inline_detail:
        print(f"  ... 나머지 {len(real_pii_findings) - max_inline_detail}건은 CSV 참고")

    print(f"\n==== ③ 정적 점검 항목 ({len(STATIC_FINDINGS)}건) ====")
    for sf in STATIC_FINDINGS:
        print(f"[{sf['severity']}] {sf['summary']} ({sf['location']})")

    csv_path = None
    if output_csv:
        _write_audit_report_csv(evaluated, pii_findings, STATIC_FINDINGS, output_csv)
        csv_path = output_csv
        print(f"\n종합 리포트 저장: {csv_path}")

    return {
        "summary": dict(counts),
        "evaluated": evaluated,
        "pii_findings": pii_findings,
        "static_findings": STATIC_FINDINGS,
        "csv_path": csv_path,
    }


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

    audit_csv_path = CHATBOT_SERVICE_DIR / f"security_audit_report_{datetime.now():%Y%m%d_%H%M%S}.csv"
    audit_report = generate_audit_report(all_records, pii_findings=findings, output_csv=audit_csv_path)

    return all_records, findings, audit_report


if __name__ == "__main__":
    main()
