import re

class AuditMasking:
    def __init__(self):
        # Regex 패턴 정의
        self.email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
        self.phone_pattern = re.compile(r'010-\d{4}-\d{4}')
        self.ssn_pattern = re.compile(r'\d{6}-\d{7}')
        
        # 악의적 쿼리 탐지용 키워드
        self.malicious_keywords = ["지시사항 무시", "프롬프트 출력", "시스템 프롬프트", "이전 지시 무시"]

    def _mask_string(self, text: str) -> tuple[str, bool]:
        """문자열에서 PII를 찾아 마스킹하고, 악의적 접근인지 확인하여 반환"""
        if not isinstance(text, str):
            return text, False
            
        original_text = text
        is_malicious = False

        # 악의적 의도 탐지
        for kw in self.malicious_keywords:
            if kw in text:
                is_malicious = True
                break

        # 1. 주민등록번호 마스킹 (뒷자리 강력 마스킹)
        def replace_ssn(match):
            ssn = match.group(0)
            parts = ssn.split('-')
            return f"{parts[0]}-*******"
        text = self.ssn_pattern.sub(replace_ssn, text)

        # 2. 전화번호 마스킹 (가운데 자리 마스킹)
        def replace_phone(match):
            phone = match.group(0)
            parts = phone.split('-')
            return f"{parts[0]}-****-{parts[2]}"
        text = self.phone_pattern.sub(replace_phone, text)

        # 3. 이메일 마스킹
        def replace_email(match):
            email = match.group(0)
            local, domain = email.split('@')
            if len(local) > 3:
                masked_local = local[:3] + '*' * (len(local) - 3)
            else:
                masked_local = local[0] + '*' * (len(local) - 1)
            return f"{masked_local}@{domain}"
        text = self.email_pattern.sub(replace_email, text)

        return text, is_malicious

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