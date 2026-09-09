import sys
from pathlib import Path

# [2026-09-XX 구조 변경 반영] audit-agent가 프로젝트 루트가 아니라 chatbot-service/ 안으로
# 이동했다. 즉 이 파일(chatbot-service/audit-agent/masking.py) 기준으로 pii_masking.py는
# 이제 한 단계만 올라가면 있다 (parent.parent가 곧 chatbot-service 디렉터리 자체).
# 예전 구조(프로젝트 루트/audit-agent, 프로젝트 루트/chatbot-service)에서 쓰던
# "parent.parent / chatbot-service" 계산은 새 구조에서는 chatbot-service/chatbot-service라는
# 존재하지 않는 경로를 만들어버리므로 반드시 함께 고쳐야 했다.
_chatbot_service_dir = Path(__file__).resolve().parent.parent
if str(_chatbot_service_dir) not in sys.path:
    sys.path.insert(0, str(_chatbot_service_dir))

from pii_masking import mask_pii


class AuditMasking:
    def __init__(self):
        # 악의적 쿼리(프롬프트 인젝션) 탐지용 키워드.
        # PII/시크릿 마스킹과는 별개의 관심사라 여기 그대로 남겨둔다.
        self.malicious_keywords = ["지시사항 무시", "프롬프트 출력", "시스템 프롬프트", "이전 지시 무시"]

    def _mask_string(self, text: str) -> tuple[str, bool]:
        """문자열에서 PII/내부 URL/API 키를 마스킹하고, 악의적 접근인지 확인하여 반환"""
        if not isinstance(text, str):
            return text, False

        is_malicious = any(kw in text for kw in self.malicious_keywords)

        # 주민번호/전화번호/이메일/이름/내부 URL/API 키 전부 - chatbot-service와 동일한 단일 구현.
        masked_text = mask_pii(text)

        return masked_text, is_malicious

    def _recursive_mask(self, data, malicious_flag_ref):
        if isinstance(data, dict):
            new_dict = {}
            for k, v in data.items():
                new_dict[k] = self._recursive_mask(v, malicious_flag_ref)
            return new_dict
        elif isinstance(data, list):
            return [self._recursive_mask(item, malicious_flag_ref) for item in data]
        elif isinstance(data, str):
            masked_text, is_malicious = self._mask_string(data)
            if is_malicious:
                malicious_flag_ref[0] = True
            return masked_text
        else:
            return data

    def mask_payload(self, payload: dict) -> dict:
        """딕셔너리 구조 전체를 탐색하며 문자열 내 PII를 마스킹"""
        malicious_flag = [False]
        masked_data = self._recursive_mask(payload, malicious_flag)
        
        # 악의적 의도가 발견되었으면 메타데이터에 플래그 추가
        if malicious_flag[0]:
            masked_data["MALICIOUS_INTENT_DETECTED"] = True
            
        return masked_data