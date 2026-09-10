"""탐지된 감사 로그의 위험도(상/중/하)를 분류한다.

WAS 쪽(was/risk-classification.js)과 등급 판단 원칙을 동일하게 맞춘다:
- 상(high): 악의적 의도가 실제로 탐지된 경우 - action이 무엇이든 최우선으로 승격
- 중(medium): 상태를 변경하는 도구 호출 - 조회보다 오남용 시 영향이 큼
- 하(low): 단순 조회성 도구 호출 - 정상 흐름

자세한 분류 근거는 SECURITY_THREAT_MODEL.md 참고.
"""

RISK_LEVELS = {
    # 중(MEDIUM) - 예약 생성처럼 상태를 변경하는 도구 호출.
    "book_appointment": "medium",

    # 하(LOW) - 조회성 도구 호출. 정상 흐름.
    "check_scanned_documents": "low",
    "check_appointments": "low",
    "check_medical_records": "low",
    "rag": "low",
    "direct_answer": "low",
}

# 목록에 없는 action(향후 추가되는 도구)은 안전 측으로 "low"가 아니라 "medium"으로 분류해
# 신규 이벤트가 조용히 저위험 취급되는 것을 방지한다 (WAS 쪽과 동일한 기본값 정책).
DEFAULT_RISK_LEVEL = "medium"

# masking.py가 프롬프트 인젝션 등 악의적 의도를 탐지하면 이 플래그를 payload에 남긴다.
MALICIOUS_INTENT_FLAG = "MALICIOUS_INTENT_DETECTED"
MALICIOUS_OVERRIDE_LEVEL = "high"


def classify_risk(action: str, masked_payload: dict) -> str:
    """masking 결과에 악성 의도 플래그가 있으면 action과 무관하게 무조건 '상'으로 승격한다.
    예: 단순 조회(rag, direct_answer)라도 그 질문에 프롬프트 인젝션 시도가 섞여 있었다면
    '하' 등급이 아니라 '상' 등급으로 기록되어야 관리자가 놓치지 않는다."""
    if isinstance(masked_payload, dict) and masked_payload.get(MALICIOUS_INTENT_FLAG):
        return MALICIOUS_OVERRIDE_LEVEL
    return RISK_LEVELS.get(action, DEFAULT_RISK_LEVEL)
