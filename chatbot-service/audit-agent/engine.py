from datetime import datetime
from .hash_chain import HashChain
from .retention import RetentionPolicy
from .crypto import AuditCrypto
from .masking import AuditMasking  # 새롭게 추가된 마스킹 모듈
from .risk_classification import classify_risk

# [Discord 실시간 알림] audit_notify는 chatbot-service/ 바로 아래에 있는 모듈이라(이 파일이
# 속한 audit-agent 패키지 밖) 상대 import가 안 됨. uvicorn --app-dir로 뜰 때는 chatbot-service가
# 이미 sys.path에 있어 바로 import되지만, 이 패키지만 단독으로 로드되는 경우를 대비해
# log_audit_tool.py와 동일한 방식(파일 위치 기준 절대경로)으로 한 번 더 챙긴다.
try:
    from audit_notify import notify_discord
except ImportError:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from audit_notify import notify_discord


def _extract_actor(payload):
    # log_audit_tool.py의 read_audit_jsonl()과 동일한 규칙 - patient_id를 kwargs 또는
    # 숫자로만 이뤄진 첫 인자에서 찾는다(중복이지만 감사 로그 파싱 로직이 아니라 알림 라벨용
    # 부가 정보라, 저기 모듈을 끌어오기보다 이 정도 반복은 감수).
    input_data = payload.get("input", {}) if isinstance(payload, dict) else {}
    kwargs = input_data.get("kwargs", {}) if isinstance(input_data, dict) else {}
    args = input_data.get("args", []) if isinstance(input_data, dict) else []
    actor = kwargs.get("patient_id") if isinstance(kwargs, dict) else None
    if actor is None and args and str(args[0]).isdigit():
        actor = args[0]
    return actor


class AuditEngine:
    def __init__(self, encryption_key: bytes, retention_days: int = 90, log_file_path: str = None):
        self.hash_chain = HashChain(log_file_path)
        self.retention = RetentionPolicy(default_days=retention_days)
        self.crypto = AuditCrypto(key=encryption_key)
        self.masking = AuditMasking()  # 마스킹 객체 초기화

    def prepare_event(self, event_id: str, action: str, payload: dict) -> dict:
        """
        마스킹/위험도분류/암호화 등 해시체인과 무관한 부분만 처리한다. previous_hash를
        아직 읽지 않으므로 여러 스레드가 동시에 호출해도 안전하다 (finalize_event와 분리한 이유).
        """
        timestamp = datetime.utcnow().isoformat()

        print(f"\n🔍 --- [디버깅] 이벤트 ID: {event_id} 파이프라인 진입 ---")
        # [보안 수정 2026-09-09] 여기 있던 "Step 0: 원본 페이로드" print가 마스킹(아래) 이전 시점에
        # 원본을 그대로 stdout에 찍고 있었음. start.sh가 uvicorn을 `> .run/chatbot.log`로 띄우기 때문에
        # 이 출력이 평문으로 로그 파일에 영구 누적되는 유출 경로였음 - 완전히 제거함.
        # 마스킹된 값은 바로 아래 [Step 1] print로 이미 확인 가능하므로 디버깅 가시성은 유지됨.
        # 1. PII 마스킹 처리
        masked_payload = self.masking.mask_payload(payload)
        print(f"👉 [Step 1] 마스킹 완료: {masked_payload}")

        # 1-1. 위험도(상/중/하) 분류 - 마스킹 결과(악성 의도 플래그)까지 반영해 판단하므로 마스킹 다음에 수행.
        # payload_encrypted 안이 아니라 최상위 평문 필드로 남겨야, 복호화 없이도 등급으로 필터링/스캔 가능.
        risk_level = classify_risk(action, masked_payload)
        print(f"👉 [Step 1-1] 위험도 분류 완료: {risk_level}")

        # [Discord 실시간 알림] risk_level이 high면 관리자 웹 세션과 분리된 채널로 즉시 알림 -
        # 실패해도(웹훅 미설정, 네트워크 오류) 챗봇 응답 자체를 막으면 안 되므로 반드시 감싸서
        # 삼킨다(notify_discord 자체도 내부에서 한 번 더 삼킴 - 이중 방어).
        if risk_level == "high":
            try:
                notify_discord(action, actor=_extract_actor(payload), detail=f"event_id={event_id}")
            except Exception as e:
                print(f"[discord notify hook error] {type(e).__name__}: {e}")

        # 2. 마스킹이 완료된 안전한 데이터를 암호화
        encrypted_payload = self.crypto.encrypt_payload(masked_payload)
        print(f"👉 [Step 2] 암호화 완료: {encrypted_payload[:40]}... (생략)")

        # 3. 보존 만료일 산출
        expiry_date = self.retention.calculate_expiry(timestamp)
        print(f"👉 [Step 3] 만료일 산출: {expiry_date}")

        # 4. 통합 리포트 데이터 조립 (해시 생성 전)
        return {
            "event_id": event_id,
            "timestamp": timestamp,
            "action": action,
            "risk_level": risk_level,
            "payload_encrypted": encrypted_payload,
            "expiry_date": expiry_date,
        }

    def finalize_event(self, audit_record: dict) -> dict:
        """
        해시체인 이어붙이기. previous_hash를 읽고 갱신하는 부분이라, 호출 측(audit_decorator의
        _hash_chain_lock)에서 직렬화된 상태로만 호출해야 한다 - 그렇지 않으면 두 스레드가 같은
        previous_hash를 읽어 체인이 갈라질 수 있다.
        """
        audit_record["previous_hash"] = self.hash_chain.previous_hash

        # 5. 해시 체인 생성 (데이터 무결성 검증)
        current_hash = self.hash_chain.generate_hash(audit_record)
        print(f"👉 [Step 4] 해시 생성 완료: {current_hash}")
        audit_record["hash"] = current_hash

        return audit_record