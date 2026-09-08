import os
import sys
import json
import uuid
from datetime import datetime, timedelta, timezone

# 상위 폴더의 모듈을 가져오기 위한 경로 설정
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

# 확인된 정확한 클래스 이름으로 모듈 불러오기
try:
    from lab10_step01_schema_generator import AuditDummyGenerator, AuditEvent, asdict
except ImportError as e:
    print(f"Error: 모듈을 불러오는 중 오류가 발생했습니다. ({e})")
    sys.exit(1)


def generate_vulnerable_logs():
    """
    파이프라인 검증(암호화, 보존 정책, 해시 체인)을 위한 
    취약점 포함 맞춤형 감사 로그 배열을 생성합니다.
    """
    validation_events = []
    now = datetime.now(timezone.utc)

    print("=== 파이프라인 검증용 취약성 로그 생성을 시작합니다 ===")

    # ---------------------------------------------------------
    # Case 1: PII 포함 + 정상 시간 로그 (암호화 및 해시 체인 검증용)
    # ---------------------------------------------------------
    # 확인된 AuditEvent 데이터 클래스를 활용하여 규격에 맞는 로그 생성
    event1_dict = {
        "event_id": f"EVT-TEST-{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "USER_UPDATE_PROFILE",
        "actor": "test_user_01",
        "resource": "profile_db",
        "status": "success",
        "payload": {
            "user_name": "홍길동",
            "ssn": "[RRN Omitted]", 
            "phone_number": "010-9999-8888",
            "email": "gildong.hong@example.com",
            "address": "Seoul Gangnam-gu"
        }
    }
    validation_events.append(event1_dict)
    print("- Case 1 생성 완료 (PII 포함 정상 시간 로그 - 가상 사용자)")

    # ---------------------------------------------------------
    # Case 2: PII 포함 + 과거 시간 로그 (보존 정책 만료 탐지용)
    # ---------------------------------------------------------
    past_date = now - timedelta(days=100) # 100일 전으로 조작
    
    event2_dict = {
        "event_id": f"EVT-TEST-{uuid.uuid4().hex[:8]}",
        "timestamp": past_date.isoformat(),
        "action": "EXPORT_SENSITIVE_DATA",
        "actor": "admin",
        "resource": "financial_records",
        "status": "warning",
        "payload": {
            "credit_card": "4502-9999-8888-1234",
            "account_balance": "$500,000",
            "export_reason": "annual_audit"
        }
    }
    validation_events.append(event2_dict)
    print("- Case 2 생성 완료 (보존 기한 초과 및 금융 PII 포함 로그)")

    # ---------------------------------------------------------
    # Case 3: 내부자 위협(접근 실패) + 대규모 데이터 조회
    # ---------------------------------------------------------
    event3_dict = {
        "event_id": f"EVT-TEST-{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "BULK_DATA_ACCESS",
        "actor": "guest_user",
        "resource": "employee_health_records",
        "status": "failed",
        "payload": {
            "attempted_records_count": 5000,
            "query_ip": "10.0.0.99",
            "alert_type": "high_risk_insider"
        }
    }
    validation_events.append(event3_dict)
    print("- Case 3 생성 완료 (접근 실패 및 이상 행위 로그)")

    # ---------------------------------------------------------
    # 3. 파일 저장 (src/audit_engine/validation_events.json)
    # ---------------------------------------------------------
    output_dir = os.path.dirname(os.path.abspath(__file__))
    output_file = os.path.join(output_dir, 'validation_events.json')

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(validation_events, f, indent=4, ensure_ascii=False)

    print(f"\n[성공] 검증용 로그 3건이 성공적으로 저장되었습니다: {output_file}")


if __name__ == "__main__":
    generate_vulnerable_logs()