"""
[TDD] 실명 인증(모의 PASS) - human.csv에 등록된 name+rrn과 정확히 일치할 때만 True.
(IDENTITY_VERIFICATION_WORKFLOW.md 참고)

작성 시점에는 mock_pass.py 자체가 없으므로 전부 Red(ImportError) 상태다.
"""
import sys
from pathlib import Path

CHATBOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CHATBOT_DIR))

from mock_pass import verify_identity  # noqa: E402


def test_exact_match_returns_true():
    assert verify_identity("김환자", "990101-1234567") is True


def test_another_registered_person_returns_true():
    assert verify_identity("홍길동", "900101-1234567") is True


def test_name_matches_but_rrn_wrong_returns_false():
    assert verify_identity("김환자", "990101-9999999") is False


def test_rrn_matches_but_name_wrong_returns_false():
    # human.csv에 없는 가짜 이름 - rrn만 실제 등록된 값과 같아도 이름이 다르면 실패해야 함
    assert verify_identity("김치볶음밥", "990101-1234567") is False


def test_completely_fake_person_returns_false():
    assert verify_identity("김치볶음밥", "010101-1234567") is False


def test_empty_name_returns_false():
    assert verify_identity("", "990101-1234567") is False


def test_empty_rrn_returns_false():
    assert verify_identity("김환자", "") is False


def test_none_name_returns_false():
    assert verify_identity(None, "990101-1234567") is False


def test_none_rrn_returns_false():
    assert verify_identity("김환자", None) is False


def test_surrounding_whitespace_in_name_is_normalized():
    assert verify_identity(" 김환자 ", "990101-1234567") is True


def test_rrn_with_extra_spaces_around_hyphen_is_normalized():
    assert verify_identity("김환자", "990101 - 1234567") is True


def test_rrn_without_hyphen_at_all_is_normalized():
    assert verify_identity("김환자", "9901011234567") is True
