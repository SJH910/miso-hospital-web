from datetime import datetime
from .hash_chain import HashChain
from .retention import RetentionPolicy
from .crypto import AuditCrypto
from .masking import AuditMasking  # 새롭게 추가된 마스킹 모듈

class AuditEngine:
    def __init__(self, encryption_key: bytes, retention_days: int = 90):
        self.hash_chain = HashChain()
        self.retention = RetentionPolicy(default_days=retention_days)
        self.crypto = AuditCrypto(key=encryption_key)
        self.masking = AuditMasking()  # 마스킹 객체 초기화

    def process_event(self, event_id: str, action: str, payload: dict) -> dict:
        timestamp = datetime.utcnow().isoformat()
        
        print(f"\n🔍 --- [디버깅] 이벤트 ID: {event_id} 파이프라인 진입 ---")
        print(f"👉 [Step 0] 원본 페이로드: {payload}")
        # 1. PII 마스킹 처리 
        masked_payload = self.masking.mask_payload(payload)
        print(f"👉 [Step 1] 마스킹 완료: {masked_payload}")
       
        # 2. 마스킹이 완료된 안전한 데이터를 암호화
        encrypted_payload = self.crypto.encrypt_payload(masked_payload)
        print(f"👉 [Step 2] 암호화 완료: {encrypted_payload[:40]}... (생략)")
       
        # 3. 보존 만료일 산출
        expiry_date = self.retention.calculate_expiry(timestamp)
        print(f"👉 [Step 3] 만료일 산출: {expiry_date}")
       
        # 4. 통합 리포트 데이터 조립 (해시 생성 전)
        audit_record = {
            "event_id": event_id,
            "timestamp": timestamp,
            "action": action,
            "payload_encrypted": encrypted_payload,
            "expiry_date": expiry_date,
            "previous_hash": self.hash_chain.previous_hash
        }
        
        # 5. 해시 체인 생성 (데이터 무결성 검증)
        current_hash = self.hash_chain.generate_hash(audit_record)
        print(f"👉 [Step 4] 해시 생성 완료: {current_hash}")
        audit_record["hash"] = current_hash

        return audit_record