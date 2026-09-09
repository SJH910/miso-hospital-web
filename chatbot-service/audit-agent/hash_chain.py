import hashlib
import json
from pathlib import Path

class HashChain:
    """
    Step 02: 이벤트 데이터의 무결성을 보장하기 위한 해시 체인 생성 클래스.
    이전 로그의 해시값을 현재 로그에 포함시킴으로써, 중간에 데이터가 위변조되는 것을 방지합니다.
    """
    def __init__(self, log_file_path: str = None):
        # 서버가 재시작돼도, 자정에 로그 파일이 로테이션돼도 체인이 끊기지 않도록
        # 기존 로그(오늘 파일 -> 없으면 가장 최근 로테이션 백업)의 마지막 레코드에서
        # hash를 이어받는다. 아무 로그도 없을 때(최초 실행)만 None으로 시작 — 이때만
        # 새 체인(제네시스 블록)이 시작된다.
        self.previous_hash = self._load_last_hash(log_file_path) if log_file_path else None

    def _load_last_hash(self, log_file_path: str) -> str | None:
        last_hash = self._read_last_hash(log_file_path)
        if last_hash is not None:
            return last_hash
        # 오늘 파일이 비어있거나 아직 없으면(자정 로테이션 직후 등), 가장 최근
        # 로테이션 백업 파일의 마지막 hash를 대신 이어받아 날짜 경계에서도 체인이 유지되게 한다.
        return self._read_last_hash_from_latest_backup(log_file_path)

    def _read_last_hash(self, file_path: str) -> str | None:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                last_line = None
                for line in f:
                    line = line.strip()
                    if line:
                        last_line = line
            if last_line is None:
                return None
            return json.loads(last_line).get("hash")
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def _read_last_hash_from_latest_backup(self, log_file_path: str) -> str | None:
        path = Path(log_file_path)
        # TimedRotatingFileHandler가 만드는 백업 파일명 형식: "audit_log.jsonl.2026-09-08"
        # 날짜가 ISO 형식이라 문자열 정렬 = 시간순 정렬이 그대로 성립함.
        backups = sorted(path.parent.glob(f"{path.name}.*"))
        if not backups:
            return None
        return self._read_last_hash(str(backups[-1]))

    def generate_hash(self, record_data: dict) -> str:
        # 1. 딕셔너리 형태의 데이터를 문자열로 변환합니다. 
        #    이때 sort_keys=True를 주어 키 순서가 달라져 해시값이 변경되는 오류를 방지합니다.
        data_string = json.dumps(record_data, sort_keys=True)
        
        # 2. SHA-256 알고리즘을 사용하여 해시값을 생성합니다.
        current_hash = hashlib.sha256(data_string.encode('utf-8')).hexdigest()
        
        # 3. 다음 이벤트에서 참조할 수 있도록 현재 해시를 previous_hash에 저장해 둡니다.
        self.previous_hash = current_hash
        
        return current_hash