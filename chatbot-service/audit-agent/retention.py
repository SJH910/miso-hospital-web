from datetime import datetime, timedelta

class RetentionPolicy:
    """
    Step 03: 감사 로그의 보존 기한을 관리하는 클래스.
    규정된 기한이 지난 로그를 식별하여 안전하게 삭제하거나 보관 처리할 수 있도록 돕습니다.
    """
    def __init__(self, default_days: int = 90):
        # 기본 보존 기간을 설정합니다. 필요에 따라 configs 파일에서 값을 받아와 덮어쓸 수 있습니다.
        self.retention_days = default_days

    def calculate_expiry(self, timestamp_iso: str) -> str:
        # 1. ISO 포맷의 문자열 시간을 파이썬의 datetime 객체로 변환합니다.
        event_time = datetime.fromisoformat(timestamp_iso)
        
        # 2. 이벤트 발생 시간에 보존 기간(retention_days)을 더해 만료일을 계산합니다.
        expiry_time = event_time + timedelta(days=self.retention_days)
        
        # 3. 다시 ISO 문자열 포맷으로 변환하여 반환합니다.
        return expiry_time.isoformat()