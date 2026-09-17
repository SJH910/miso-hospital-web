"""
[보안 수정] chatbot-service는 WAS를 거쳐서만 호출되므로(verify_internal_caller), slowapi의
기본 key_func인 get_remote_address를 쓰면 모든 요청의 소스 IP가 항상 WAS 서버 하나로 동일해
rate limit이 개별 환자가 아니라 병원 전체에 공용으로 걸린다(RATE_LIMIT_PROMPT_INJECTION_
WORKFLOW.md 1번 문제 참고).

WAS는 이미 세션에서 검증한 patient_id를 body에 실어 보내고 있으므로(chat.js, IDOR 방지 기존
설계), 같은 값을 헤더로도 실어 보내게 하고 여기서는 헤더만 읽어 환자별로 버킷을 나눈다.
app.py 본체(무거운 import: pii_masking/hospital_agent/audit_summary)와 분리된 별도 모듈로
둬서, 이 함수 하나만 가볍게 단위 테스트할 수 있게 한다(test_rate_limit.py 참고).
"""
from typing import Optional


def get_rate_limit_key(request) -> str:
    patient_id: Optional[str] = request.headers.get("X-Patient-Id")
    if patient_id:
        return f"patient:{patient_id}"

    # 방어적 폴백: 헤더가 없는 예외적 상황(예: was 쪽 배포 실수)에서도 key_func 자체가
    # 죽어서 서비스 전체가 500이 되는 것보다는, 예전 방식(remote address)으로 조용히
    # 돌아가는 편이 안전하다 - 다만 이 경우엔 다시 공용 버킷 문제가 재현될 수 있음을
    # 알아야 하므로 접두사로 구분해둔다.
    remote_addr = request.client.host if request.client else "unknown"
    return f"fallback-ip:{remote_addr}"
