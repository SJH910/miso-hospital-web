"""
[TDD] 예약 흐름 옵션 A: 자유 텍스트 파싱 결과를 즉시 DB에 꽂지 않고 확인 단계를 거치게
하고, tools_db.book_appointment에 빠져있던 정원(MAX_RESERVATIONS_PER_SLOT) 체크를 이식한다.
(RESERVATION_FLOW_WORKFLOW.md 옵션 A 참고)

작성 시점에는 hospital_agent.tool_book_appointment가 여전히 즉시 예약을 하므로 아래
테스트들은 전부 Red 상태다.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

CHATBOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CHATBOT_DIR))

import hospital_agent  # noqa: E402
import tools_db  # noqa: E402


# --- hospital_agent.tool_book_appointment: 확인 단계로 전환 ---

def test_valid_request_returns_confirmation_without_booking():
    # is_within_business_hours()가 tools_db.is_holiday()로 실제 DB(holidays 테이블)를
    # 조회하므로, 순수 단위 테스트에서는 "공휴일 아님"으로 고정해 개발 DB 상태와 분리한다.
    with patch.object(tools_db, "book_appointment") as mock_book, \
         patch.object(tools_db, "is_holiday", return_value=False):
        message, pending = hospital_agent.tool_book_appointment(
            "9월 21일 오후 2시 내과 예약해줘", patient_id=1
        )

    mock_book.assert_not_called()  # 확인 전에는 절대 DB에 쓰지 않는다
    assert pending == {"department": "내과", "date_str": "2026-09-21 14:00:00"}
    assert "내과" in message
    assert "2026-09-21 14:00" in message


def test_missing_department_returns_no_pending():
    message, pending = hospital_agent.tool_book_appointment("9월 21일 오후 2시 예약해줘", patient_id=1)
    assert pending is None
    assert "진료과" in message


def test_unparsable_datetime_returns_no_pending():
    message, pending = hospital_agent.tool_book_appointment("내과 예약해줘", patient_id=1)
    assert pending is None


def test_outside_business_hours_returns_no_pending():
    # 일요일은 무조건 휴진
    message, pending = hospital_agent.tool_book_appointment("2026-09-20 14:00 내과 예약해줘", patient_id=1)
    assert pending is None
    assert "운영시간" in message


# --- hospital_agent.confirm_book_appointment: 확인 후 실제 예약 ---

def test_confirm_calls_tools_db_with_patients_own_id():
    with patch.object(tools_db, "book_appointment", return_value="예약 완료") as mock_book, \
         patch.object(tools_db, "is_holiday", return_value=False):
        result = hospital_agent.confirm_book_appointment("내과", "2026-09-21 14:00:00", patient_id=1)

    mock_book.assert_called_once_with(1, "2026-09-21 14:00:00", "내과")
    assert result == "예약 완료"


def test_confirm_revalidates_business_hours():
    # 확인 메시지를 보여준 뒤 시간이 지나 운영시간을 벗어난 경우를 흉내낸다 (일요일 날짜).
    with patch.object(tools_db, "book_appointment") as mock_book:
        result = hospital_agent.confirm_book_appointment("내과", "2026-09-20 14:00:00", patient_id=1)

    mock_book.assert_not_called()
    assert "운영시간" in result


def test_confirm_with_malformed_date_str_does_not_crash():
    result = hospital_agent.confirm_book_appointment("내과", "not-a-date", patient_id=1)
    assert isinstance(result, str)


# --- tools_db.book_appointment: 정원 체크 이식 ---

def _mock_connection(count_result):
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = {"count": count_result}
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    return mock_conn, mock_cursor


def test_book_appointment_rejects_when_slot_is_full():
    mock_conn, mock_cursor = _mock_connection(count_result=2)  # MAX_RESERVATIONS_PER_SLOT과 동일

    with patch.object(tools_db, "get_connection", return_value=mock_conn):
        result = tools_db.book_appointment(patient_id=1, date_str="2026-09-21 14:00:00", department="내과")

    insert_calls = [c for c in mock_cursor.execute.call_args_list if "INSERT" in c.args[0].upper()]
    assert len(insert_calls) == 0
    assert "마감" in result or "정원" in result


def test_book_appointment_proceeds_when_slot_has_room():
    mock_conn, mock_cursor = _mock_connection(count_result=1)

    with patch.object(tools_db, "get_connection", return_value=mock_conn):
        result = tools_db.book_appointment(patient_id=1, date_str="2026-09-21 14:00:00", department="내과")

    insert_calls = [c for c in mock_cursor.execute.call_args_list if "INSERT" in c.args[0].upper()]
    assert len(insert_calls) == 1


def test_book_appointment_capacity_check_excludes_cancelled():
    # reservations.js와 동일 규칙: status != 'cancelled' 조건이 COUNT 쿼리에 포함돼야 한다.
    mock_conn, mock_cursor = _mock_connection(count_result=0)

    with patch.object(tools_db, "get_connection", return_value=mock_conn):
        tools_db.book_appointment(patient_id=1, date_str="2026-09-21 14:00:00", department="내과")

    count_calls = [c for c in mock_cursor.execute.call_args_list if "COUNT" in c.args[0].upper()]
    assert len(count_calls) == 1
    assert "cancelled" in count_calls[0].args[0]
