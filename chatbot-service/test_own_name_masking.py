"""
[TDD] 실명 인증(IDENTITY_VERIFICATION_WORKFLOW.md) 6단계 - '본인 등록 이름 우선 마스킹'.

tools_db.get_patient_name(patient_id)로 조회한 등록 이름을 mask_pii(text, own_name=...)에
넘기면, 트리거 단어("저는" 등) 없이도 그 이름이 텍스트에 그대로 나올 때마다 우선 마스킹된다.
기존 성씨 화이트리스트/조사 제외/spaCy NER 로직은 절대 건드리지 않고, own_name이 없거나
텍스트에 없으면 그대로 기존 로직으로 폴백되어야 한다.

작성 시점에는 get_patient_name이 mock 대상 함수로만 존재(구현은 이미 있음, Green)하고,
mask_pii가 own_name 인자를 받지 않으므로 own_name 관련 테스트는 전부 Red(TypeError)다.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

CHATBOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CHATBOT_DIR))

import tools_db  # noqa: E402
from pii_masking import mask_pii  # noqa: E402


# --- tools_db.get_patient_name ---

def test_get_patient_name_returns_name_when_found():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = {"name": "김환자"}
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch.object(tools_db, "get_connection", return_value=mock_conn):
        result = tools_db.get_patient_name(1)

    assert result == "김환자"


def test_get_patient_name_returns_none_when_not_found():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = None
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch.object(tools_db, "get_connection", return_value=mock_conn):
        result = tools_db.get_patient_name(999)

    assert result is None


def test_get_patient_name_returns_none_without_hitting_db_for_falsy_id():
    with patch.object(tools_db, "get_connection") as mock_get_conn:
        result = tools_db.get_patient_name(None)

    assert result is None
    mock_get_conn.assert_not_called()


# --- pii_masking.mask_pii(text, own_name=...) ---

def test_own_name_masked_without_trigger_word():
    result = mask_pii("김환자님 최근 진료기록 좀 보여주세요", own_name="김환자")
    assert result == "김*자님 최근 진료기록 좀 보여주세요"


def test_own_name_masks_every_occurrence():
    result = mask_pii("김환자님 안녕하세요, 김환자 본인 맞으신가요?", own_name="김환자")
    assert "김환자" not in result
    assert result.count("김*자") == 2


def test_own_name_not_present_in_text_falls_back_to_existing_behavior():
    # own_name이 주어졌지만 텍스트엔 없음 - 기존 오탐 방지 로직이 그대로 동작해야 함
    result = mask_pii("저는 아파요", own_name="김환자")
    assert result == "저는 아파요"


def test_own_name_none_behaves_exactly_like_before():
    # 기본값(own_name=None) - 기존 24개 회귀 테스트와 동일한 동작 보장용 대표 케이스
    assert mask_pii("제 이름은 홍길동입니다.") == "제 이름은 홍*동입니다."


def test_third_party_name_is_not_affected_by_own_name_param():
    # own_name은 '내 이름'만 우선 마스킹하며, 대화에 등장하는 제3자 이름 처리는
    # 기존 트리거 기반 로직/NER에 그대로 맡긴다(이 케이스는 트리거가 없어 기존 로직도
    # 마스킹하지 않는 게 정상 - own_name 도입 전과 동일해야 함).
    without_own_name = mask_pii("이몽룡씨가 대신 접수해주셨어요")
    with_own_name = mask_pii("이몽룡씨가 대신 접수해주셨어요", own_name="김환자")
    assert with_own_name == without_own_name
