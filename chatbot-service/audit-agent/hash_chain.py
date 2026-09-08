import hashlib
import json

class HashChain:
    """
    Step 02: 이벤트 데이터의 무결성을 보장하기 위한 해시 체인 생성 클래스.
    이전 로그의 해시값을 현재 로그에 포함시킴으로써, 중간에 데이터가 위변조되는 것을 방지합니다.
    """
    def __init__(self):
        # 초기 상태에서는 이전 해시가 없으므로 None으로 설정합니다. (제네시스 블록 역할)
        self.previous_hash = None

    def generate_hash(self, record_data: dict) -> str:
        # 1. 딕셔너리 형태의 데이터를 문자열로 변환합니다. 
        #    이때 sort_keys=True를 주어 키 순서가 달라져 해시값이 변경되는 오류를 방지합니다.
        data_string = json.dumps(record_data, sort_keys=True)
        
        # 2. SHA-256 알고리즘을 사용하여 해시값을 생성합니다.
        current_hash = hashlib.sha256(data_string.encode('utf-8')).hexdigest()
        
        # 3. 다음 이벤트에서 참조할 수 있도록 현재 해시를 previous_hash에 저장해 둡니다.
        self.previous_hash = current_hash
        
        return current_hash