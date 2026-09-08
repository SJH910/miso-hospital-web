from cryptography.fernet import Fernet
import json

class AuditCrypto:
    """
    Step 04: 사용자 개인정보 등 민감한 페이로드를 보호하기 위한 대칭키 암호화 클래스.
    FERNET을 사용하여 안전하게 암호화합니다.
    """
    def __init__(self, key: bytes):
        # configs 등에서 관리되는 강력한 암호화 키를 주입받아 암호화 객체를 초기화합니다.
        self.cipher = Fernet(key)

    def encrypt_payload(self, payload: dict) -> str:
        # 1. 원본 페이로드 딕셔너리를 바이트 문자열로 변환합니다.
        payload_bytes = json.dumps(payload).encode('utf-8')
        
        # 2. 데이터를 암호화한 후, JSON 등 텍스트 기반 시스템에 저장하기 위해 다시 문자열로 디코딩합니다.
        return self.cipher.encrypt(payload_bytes).decode('utf-8')

    def decrypt_payload(self, encrypted_payload: str) -> dict:
        # 1. 암호화된 문자열을 바이트로 변환 후 복호화
        decrypted_bytes = self.cipher.decrypt(encrypted_payload.encode('utf-8'))
        # 2. 딕셔너리로 변환하여 반환
        return json.loads(decrypted_bytes.decode('utf-8'))