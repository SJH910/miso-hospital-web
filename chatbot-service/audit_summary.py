"""챗봇 쪽 감사 데이터 요약 — WAS 대시보드가 호출할 API(`GET /audit-summary`)의 실제 로직.

log_audit_tool.py의 리더/판정 함수를 그대로 재사용한다(로직 중복 금지) — CLI 도구와
API가 서로 다른 계산을 하게 되는 걸 피하기 위해서다.

1) 위험도 트랙 (audit_jsonl) — risk_level이 실제로 존재하는 소스만. mysql_audit은
   WAS 자신의 DB에 이미 있으므로 이 API가 다루지 않는다(WAS가 직접 조회).
2) PII 스캔 (chatbot_sqlite + mysql_chat 통합, 2026-09-16 재설계) — 실제 대화 원문이 담긴
   두 저장소를 하나로 합쳐서 스캔한다. risk_level 개념 자체가 없는 소스라 등급을 억지로
   매기지 않고, 대신 "마스킹 실패"(masked_text처럼 저장 전에 이미 마스킹됐어야 할 필드에서
   발견 = 진짜 버그)와 "원문 저장 현황"(original/response/content처럼 애초에 마스킹 대상이
   아니고 암호화로만 보호되는 필드에서 발견 = 정상 상태)을 구분해서 보여준다. 두 저장소를
   별개 카드로 나눴을 때는 같은 대화(질문/응답)가 양쪽에 원문 그대로 중복 저장되는 구조라
   "발견 내역"이 사실상 같은 문장을 두 번 보여주는 것과 다름없었음 - 소스 구분은 각
   finding의 "source" 필드로 여전히 확인 가능하다.
"""

import threading
import time
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

# [성능 수정 2026-09-15] 매 호출마다 감사로그 전체(JSONL 전체 + SQLite 전체 + MySQL
# chat_messages 전체)를 복호화하고 mask_pii()/evaluate_severity()로 재스캔하는 구조라,
# 로그가 쌓일수록 요청 하나의 비용이 계속 커짐. 게다가 admin-audit-dashboard.js가 이
# 엔드포인트를 10초 자동 폴링 + 수동 새로고침으로 반복 호출해서, 캐시가 없으면 관리자가
# 대시보드를 켜두는 것만으로 이 전체 재스캔이 계속 반복 실행됨.
# 임시방편: 짧은 TTL로 결과를 캐싱해 반복 폴링 중 대부분은 재계산을 건너뛰게 한다 - 화면에
# 보이는 데이터/의미는 그대로 두고 "10초마다 똑같은 걸 또 계산하는" 낭비만 없앤다. 로그
# 자체가 계속 쌓이는 근본 문제(요청 비용이 전체 이력 크기에 비례)는 해결 안 됨 - 그건
# 리더 함수에 날짜 범위 필터를 추가하는 별도 작업이 필요하고, 그러면 KPI 통계가 "전체
# 이력"에서 "최근 N일"로 의미가 바뀌므로 별도 논의 후 진행하기로 함.
_CACHE_TTL_SECONDS = 20
_cache_lock = threading.Lock()
_cached_summary = None
_cached_at = 0.0


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


PII_SOURCES = [
    ("chatbot_sqlite", read_chatbot_logs_db),
    ("mysql_chat", read_mysql_chat_messages),
]


# [2026-09-16 재설계] 이전엔 chatbot_sqlite/mysql_chat을 별개 카드 2개로 나눠서 보여줬는데,
# 실제로는 두 저장소가 같은 대화(환자 질문/챗봇 응답)를 각자 원문 그대로 한 번씩 더 저장하는
# 구조라(app.py의 original/response, chat.js의 content) "발견 내역"이 사실상 같은 문장을 두
# 번 보여주는 것과 다름없었음 - 관리자가 화면에서 얻는 정보량은 그대로인데 스크롤만 두 배로
# 늘어남. 그래서 두 저장소를 하나로 합치고, 대신 scan_for_pii()가 이미 표시해주는
# is_masking_failure(마스킹됐어야 할 필드에서 발견 = 진짜 버그)와 그 외(원문/암호화 전용
# 필드에서 발견 = 항상 있을 수 있는 정상 상태)를 구분해서 보여준다 - 후자만으로 채워진
# "발견 건수"가 진짜 마스킹 버그를 가려버리는 문제를 해결하기 위함.
def _pii_scan_combined():
    all_records = []
    errors = {}
    for name, reader in PII_SOURCES:
        try:
            all_records.extend(reader())
        except Exception as e:
            errors[name] = f"{type(e).__name__}: {e}"

    findings = scan_for_pii(all_records)
    findings.sort(key=lambda f: f["timestamp"] or "", reverse=True)

    masking_failures = [f for f in findings if f["is_masking_failure"]]
    raw_storage_findings = [f for f in findings if not f["is_masking_failure"]]

    return {
        "scanned": len(all_records),
        "masking_failures": {
            "found": len(masking_failures),
            "findings": masking_failures[:MAX_FINDINGS_PER_SOURCE],
        },
        "raw_storage_findings": {
            "found": len(raw_storage_findings),
            "findings": raw_storage_findings[:MAX_FINDINGS_PER_SOURCE],
        },
        "errors": errors or None,
    }


def _compute_audit_summary():
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "risk_level_track": _risk_level_track(),
        "pii_scan": _pii_scan_combined(),
        # 로그 이벤트가 아니라 코드/스키마 자체의 구조적 결함 - log_audit_tool.py와 동일한
        # 목록을 그대로 노출한다(WAS 쪽에서 중복 정의하지 않기 위함).
        "static_findings": STATIC_FINDINGS,
    }


def build_audit_summary():
    global _cached_summary, _cached_at

    now = time.monotonic()
    with _cache_lock:
        if _cached_summary is not None and (now - _cached_at) < _CACHE_TTL_SECONDS:
            return _cached_summary

    # 락 밖에서 계산 - 전체 복호화·재스캔은 수백ms 이상 걸릴 수 있어 락을 오래 쥐면
    # 다른 요청들이 캐시 유효 여부 확인조차 못 하고 줄줄이 대기하게 됨. 캐시 만료 직후
    # 동시에 여러 요청이 들어오면 그중 몇 개는 중복 계산할 수 있지만(락을 안 쓰는
    # 대가), 계산 자체는 멱등이라 결과가 틀릴 위험은 없고 최신 결과로 캐시가 갱신될
    # 뿐이다.
    summary = _compute_audit_summary()

    with _cache_lock:
        _cached_summary = summary
        _cached_at = now

    return summary
