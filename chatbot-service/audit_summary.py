"""챗봇 쪽 감사 데이터 요약 — WAS 대시보드가 호출할 API(`GET /audit-summary`)의 실제 로직.

log_audit_tool.py의 리더/판정 함수를 그대로 재사용한다(로직 중복 금지) — CLI 도구와
API가 서로 다른 계산을 하게 되는 걸 피하기 위해서다.

두 트랙으로 나눠서 반환한다 (결정: 2026-09-11, "7번 대시보드" 논의 참고):
  1) 위험도 트랙 (audit_jsonl) — risk_level이 실제로 존재하는 소스만. mysql_audit은
     WAS 자신의 DB에 이미 있으므로 이 API가 다루지 않는다(WAS가 직접 조회).
  2) PII 스캔 트랙 (chatbot_sqlite, mysql_chat) — 실제 대화 원문이 담긴 두 저장소.
     risk_level 개념 자체가 없는 소스라 등급을 억지로 매기지 않고, "스캔 건수 / 발견 건수"만
     보여준다. mysql_audit과 달리 known_exception 대상도 아니다(KNOWN_EXCEPTION_SOURCES 참고).
"""

from collections import Counter
from datetime import datetime, timezone

from log_audit_tool import (
    read_audit_jsonl,
    read_chatbot_logs_db,
    read_mysql_chat_messages,
    scan_for_pii,
    evaluate_severity,
    STATIC_FINDINGS,
)

MAX_NOTABLE = 20
MAX_FINDINGS_PER_SOURCE = 20


def _risk_level_track():
    try:
        records = read_audit_jsonl()
        error = None
    except Exception as e:
        records, error = [], f"{type(e).__name__}: {e}"

    evaluated = [evaluate_severity(r) for r in records]
    summary = Counter(item["severity"] for item in evaluated)

    notable = [item for item in evaluated if item["severity"] in ("CRITICAL", "HIGH")]
    notable.sort(key=lambda item: item["timestamp"] or "", reverse=True)

    return {
        "source": "audit_jsonl",
        "total": len(records),
        "summary": {
            "critical": summary.get("CRITICAL", 0),
            "high": summary.get("HIGH", 0),
            "medium": summary.get("MEDIUM", 0),
            "low": summary.get("LOW", 0),
            "none": summary.get("NONE", 0),
        },
        "notable": notable[:MAX_NOTABLE],
        "error": error,
    }


def _pii_scan_for_source(name, reader):
    try:
        records = reader()
        error = None
    except Exception as e:
        records, error = [], f"{type(e).__name__}: {e}"

    findings = scan_for_pii(records)
    findings.sort(key=lambda f: f["timestamp"] or "", reverse=True)

    return {
        "source": name,
        "scanned": len(records),
        "found": len(findings),
        "findings": findings[:MAX_FINDINGS_PER_SOURCE],
        "error": error,
    }


def build_audit_summary():
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "risk_level_track": _risk_level_track(),
        "pii_scan_track": [
            _pii_scan_for_source("chatbot_sqlite", read_chatbot_logs_db),
            _pii_scan_for_source("mysql_chat", read_mysql_chat_messages),
        ],
        # 로그 이벤트가 아니라 코드/스키마 자체의 구조적 결함 - log_audit_tool.py와 동일한
        # 목록을 그대로 노출한다(WAS 쪽에서 중복 정의하지 않기 위함).
        "static_findings": STATIC_FINDINGS,
    }
