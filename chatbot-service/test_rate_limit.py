"""
[TDD - Red] 1번 문제: rate limit이 환자 개인이 아니라 병원 전체(WAS IP 하나)에 공용으로
걸리던 문제. get_remote_address 대신 요청 헤더의 patient_id로 버킷을 나누는
get_rate_limit_key()가 아직 없어서, 이 테스트는 현재 ModuleNotFoundError로 실패한다(Red).

RATE_LIMIT_PROMPT_INJECTION_WORKFLOW.md 참고.
"""
import sys
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rate_limit_key import get_rate_limit_key  # noqa: E402  (아직 존재하지 않음 - Red)


def _make_request(headers: dict, remote_addr: str = "10.0.0.5"):
    request = Mock()
    request.headers = headers
    request.client = Mock(host=remote_addr)
    return request


def test_different_patients_get_different_keys():
    """서로 다른 환자는 서로 다른 rate limit 버킷을 가져야 한다."""
    req_a = _make_request({"X-Patient-Id": "1"})
    req_b = _make_request({"X-Patient-Id": "2"})
    assert get_rate_limit_key(req_a) != get_rate_limit_key(req_b)


def test_same_patient_gets_same_key_across_requests():
    """같은 환자의 여러 요청은 같은 버킷으로 모여야(=제한이 정상 적용돼야) 한다."""
    req_a1 = _make_request({"X-Patient-Id": "1"})
    req_a2 = _make_request({"X-Patient-Id": "1"})
    assert get_rate_limit_key(req_a1) == get_rate_limit_key(req_a2)


def test_two_different_patients_behind_same_was_ip_are_not_merged():
    """이번 버그의 핵심 재현: remote address(WAS IP)는 완전히 같아도,
    X-Patient-Id가 다르면 절대 같은 키가 되면 안 된다."""
    req_a = _make_request({"X-Patient-Id": "101"}, remote_addr="10.0.0.5")
    req_b = _make_request({"X-Patient-Id": "202"}, remote_addr="10.0.0.5")
    assert get_rate_limit_key(req_a) != get_rate_limit_key(req_b)


def test_missing_header_does_not_crash_and_falls_back_safely():
    """chat.js가 헤더를 못 보내는 예외적 상황이어도 key_func 자체가 죽으면 안 된다
    (그러면 챗봇 서비스 전체가 500이 됨) - remote address로 방어적 폴백."""
    req = _make_request({})
    key = get_rate_limit_key(req)
    assert isinstance(key, str) and key
