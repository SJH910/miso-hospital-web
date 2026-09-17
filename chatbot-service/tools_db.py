"""
챗봇 에이전트가 사용하는 DB 직접 조회/기록 도구.

[스키마 정합성 안내 - 통합 시 수정한 부분]
원래 이 파일은 `appointments` 테이블(컬럼: appointment_date, status: scheduled/completed/cancelled)을
가정하고 작성되어 있었으나, 실제 WAS(Node) 쪽 스키마(db/init.sql, was/routes/reservations.js)는
`reservations` 테이블(컬럼: reserved_at, status: requested/confirmed/cancelled)을 사용한다.
이 파일은 실제 스키마 기준으로 다시 작성되었다.
"""
import pymysql
import os
from datetime import datetime

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_USER = os.getenv("DB_USER", "vulnuser")
DB_PASS = os.getenv("DB_PASS", os.getenv("DB_PASSWORD", "vulnpass"))
DB_NAME = os.getenv("DB_NAME", "vulnapp")

# reservations.js의 VALID_STATUSES와 반드시 일치해야 함
STATUS_LABELS = {"requested": "예약 요청됨", "confirmed": "예약 확정", "cancelled": "예약 취소"}

# [보안 수정 2026-09-16] was/routes/reservations.js:65의 MAX_RESERVATIONS_PER_SLOT과
# 반드시 같은 값으로 유지할 것 - 이 값이 없어서 챗봇 경로로는 이미 마감된 시간대에도
# 예약이 들어가는 버그가 실제로 재현됐다(RESERVATION_FLOW_WORKFLOW.md 참고).
MAX_RESERVATIONS_PER_SLOT = 2


def get_connection():
    return pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        cursorclass=pymysql.cursors.DictCursor,
    )


def is_holiday(date_str: str) -> bool:
    """date_str: 'YYYY-MM-DD'. holidays 테이블(공휴일+병원 자체 휴진일)에 등록되어 있는지 확인.
    was/routes/holidays.js와 같은 테이블을 참조하므로, 관리자가 등록/삭제하면 양쪽 다 즉시 반영된다."""
    # [버그 수정 2026-09-15] 원래 conn.close()가 마지막 줄에만 있어서, cursor.execute()/
    # fetchone()에서 예외가 나면(DB 락 타임아웃 등) 연결이 안 닫힌 채 새고 있었음
    # (BUG_REVIEW_2026-09-10.md 참고). finally로 옮겨서 예외 발생 여부와 무관하게 항상
    # 닫히게 함 - close() 자체가 또 실패할 수 있어(연결이 이미 끊긴 경우) 그 실패는
    # 무시하고 원래 예외/반환값을 그대로 보존한다.
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 FROM holidays WHERE holiday_date = %s", (date_str,))
            row = cursor.fetchone()
        return row is not None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def book_appointment(patient_id: int, date_str: str, department: str) -> str:
    """환자의 진료를 예약합니다. date_str은 'YYYY-MM-DD HH:MM:SS' 형식이어야 합니다.
    reservations 테이블에 저장하며, status는 테이블 기본값(requested)을 그대로 사용한다
    (WAS의 POST /api/reservations와 동일한 초기 상태 - 확정은 별도 관리자 승인 절차를 거침)."""
    if not patient_id:
        return "환자 식별 정보를 확인할 수 없어 예약할 수 없습니다. 다시 로그인해 주세요."

    try:
        reserved_at = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return "예약 일시 형식을 이해하지 못했습니다. 'YYYY-MM-DD HH:MM:SS' 형식으로 다시 말씀해주세요."

    # [버그 수정 2026-09-15] conn.close()가 성공 경로 끝에만 있어서 쿼리/commit 실패 시
    # 연결이 새던 문제 - conn을 try 밖에서 None으로 초기화해두고 finally에서 닫아서,
    # get_connection() 자체가 실패한 경우(conn이 아직 없음)와 쿼리 도중 실패한 경우 모두
    # 안전하게 처리한다.
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            # reservations.js:83과 동일한 조건(취소된 예약은 정원에서 제외) - 조건이 어긋나면
            # 같은 시간대인데 한쪽은 되고 한쪽은 안 되는 불일치가 생긴다.
            cursor.execute(
                "SELECT COUNT(*) AS count FROM reservations WHERE reserved_at = %s AND status != 'cancelled'",
                (reserved_at,),
            )
            row = cursor.fetchone()
            current_count = row["count"] if row else 0

            if current_count >= MAX_RESERVATIONS_PER_SLOT:
                conn.close()
                return f"죄송합니다, {date_str} 시간대는 이미 예약 정원이 마감되었습니다. 다른 시간을 선택해주세요."

            cursor.execute(
                "INSERT INTO reservations (patient_id, department, reserved_at) VALUES (%s, %s, %s)",
                (patient_id, department, reserved_at),
            )
        conn.commit()
        return f"{date_str}에 {department} 진료 예약을 요청했습니다. 병원 확인 후 확정됩니다."
    except Exception as e:
        return f"진료 예약 중 오류가 발생했습니다: {str(e)}"
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def get_patient_name(patient_id: int) -> "str | None":
    """[실명 인증 연계] pii_masking.py가 '본인 등록 이름'을 우선 마스킹하기 위해 조회한다
    (IDENTITY_VERIFICATION_WORKFLOW.md 참고). patient_id가 없거나 조회 실패 시 None -
    호출부(app.py)가 own_name=None으로 mask_pii를 호출하면 기존 로직(화이트리스트+NER)으로
    그대로 폴백되므로 안전하다."""
    if not patient_id:
        return None

    # [버그 수정 2026-09-17] 이 파일의 다른 함수들과 동일한 이유로 conn.close()를 finally로
    # 옮김 - cursor.execute()/fetchone()에서 예외가 나면(DB 재시작, 인증 실패 등) 연결이
    # 안 닫힌 채 새고 있었음. get_patient_name()은 예약 관련 메시지뿐 아니라 모든 챗봇
    # 메시지마다 호출되므로(app.py), DB 장애가 지속되는 동안 요청마다 연결이 하나씩 새서
    # MySQL max_connections에 다가갈 수 있었다(WAS도 같은 MySQL 인스턴스를 공유).
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT name FROM patients WHERE id = %s", (patient_id,))
            row = cursor.fetchone()
        return row["name"] if row else None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def check_appointments(patient_id: int) -> str:
    """환자의 최근 예약(최대 3건)을 조회합니다."""
    if not patient_id:
        return "환자 식별 정보를 확인할 수 없어 예약 내역을 조회할 수 없습니다."

    # [버그 수정 2026-09-15] 아래 세 함수(check_appointments/check_medical_records/
    # check_scanned_documents) 전부 book_appointment와 동일한 패턴 - conn.close()가
    # 성공 경로에만 있던 걸 finally로 옮겨 예외 시 연결이 새던 문제 수정.
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT reserved_at, department, status FROM reservations "
                "WHERE patient_id = %s ORDER BY reserved_at DESC LIMIT 3",
                (patient_id,),
            )
            rows = cursor.fetchall()

        if not rows:
            return "최근 예약 내역이 없습니다."

        lines = ["최근 예약 내역(최대 3건)입니다:"]
        for row in rows:
            status_kr = STATUS_LABELS.get(row["status"], row["status"])
            lines.append(f"- {row['reserved_at']} | {row['department']} ({status_kr})")
        return "\n".join(lines)
    except Exception as e:
        return f"예약 조회 중 오류가 발생했습니다: {str(e)}"
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def check_medical_records(patient_id: int) -> str:
    """환자의 진료 기록 존재 여부를 확인합니다.
    실제 상세 내용(진단/처방)은 이 도구가 직접 읽어 답하지 않고, 홈페이지의 진료기록
    페이지로 안내한다 - 민감한 진단 내용을 챗봇 대화(LLM 프롬프트/응답)에 노출시키지 않기 위함."""
    if not patient_id:
        return "환자 식별 정보를 확인할 수 없어 진료 기록을 조회할 수 없습니다."

    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM medical_records WHERE patient_id = %s LIMIT 1", (patient_id,))
            row = cursor.fetchone()

        if not row:
            return "조회된 진료 기록이 없습니다."

        return "진료 기록이 존재합니다. 자세한 내역은 다음 링크에서 확인하실 수 있습니다.\n[진료 기록 바로가기](/records.html)"
    except Exception as e:
        return f"진료 기록 조회 중 오류가 발생했습니다: {str(e)}"
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


DOCUMENT_TYPE_LABELS = {"prescription": "처방전", "diagnosis": "진단서", "receipt": "영수증"}


def check_scanned_documents(patient_id: int) -> str:
    """환자 본인이 보관 중인 스캔 문서(처방전/진단서/영수증)를 문서종류별 건수로 확인합니다.
    check_medical_records와 동일한 이유로, 문서 원문(OCR로 추출된 텍스트)은 이 도구가 직접
    읽어 답하지 않고 홈페이지의 진료기록 페이지로 안내한다 - 영수증/처방전 내용처럼 민감할 수
    있는 원문을 챗봇 대화(LLM 프롬프트/응답)에 노출시키지 않기 위함.
    patient_id는 호출부(run_agent)에서 세션값만 전달하므로, 다른 환자의 문서를 조회할 수 없다."""
    if not patient_id:
        return "환자 식별 정보를 확인할 수 없어 문서를 조회할 수 없습니다."

    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT document_type, COUNT(*) AS cnt FROM scanned_documents "
                "WHERE patient_id = %s GROUP BY document_type",
                (patient_id,),
            )
            rows = cursor.fetchall()

        if not rows:
            return "조회된 문서(처방전/진단서/영수증)가 없습니다."

        lines = ["보관 중인 문서 현황입니다:"]
        for row in rows:
            label = DOCUMENT_TYPE_LABELS.get(row["document_type"], row["document_type"])
            lines.append(f"- {label}: {row['cnt']}건")
        lines.append("자세한 내역은 다음 링크에서 확인하실 수 있습니다.\n[진료 기록 바로가기](/records.html)")
        return "\n".join(lines)
    except Exception as e:
        return f"문서 조회 중 오류가 발생했습니다: {str(e)}"
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
