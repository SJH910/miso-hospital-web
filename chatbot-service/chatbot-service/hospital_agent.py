from __future__ import annotations

import importlib.util
import re
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Optional

import tools_db
from audit_decorator import audit_log

BASE_DIR = Path(__file__).resolve().parent

def load_module(module_name: str, file_name: str):
    module_path = BASE_DIR / file_name
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"모듈을 불러올 수 없습니다: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module

DOCUMENTS = load_module("documents", "1-documents.py")
sys.modules.setdefault("documents", DOCUMENTS)
EMBEDDINGS = load_module("embeddings", "2-embeddings.py")
sys.modules.setdefault("embeddings", EMBEDDINGS)
LLM = load_module("llm", "3-1-llm.py")
sys.modules.setdefault("llm", LLM)
RAG = load_module("rag", "3-2-Rag.py")

@audit_log("list_documents")
def tool_list_documents() -> str:
    docs = DOCUMENTS.load_documents()
    lines = ["[도구] 병원 정보 문서 목록 조회"]
    for doc in docs:
        lines.append(f"- {doc.doc_id}: {doc.text}")
    return "\n".join(lines)

@audit_log("rag")
def tool_rag(question: str) -> str:
    return RAG.run_rag(question, top_k=2)

@audit_log("direct_answer")
def tool_direct_answer(question: str) -> str:
    return LLM.generate_direct_answer(question)

# [신규] 예약 생성 - 질문에서 날짜/시간/진료과를 추출.
# "2026-09-10 14:00"처럼 딱 떨어지는 형식뿐 아니라, "9월 10일 오후 2시", "내일 14시",
# "모레 2시 30분"처럼 자연스러운 한국어 표현도 이해하도록 규칙을 여러 개 조합해서 판단한다.
# 그래도 못 알아들으면(둘 다 매치 실패) 틀린 값으로 예약하는 대신 형식을 안내하는 메시지를 돌려준다.
# [진료과 인식] 실제 병원 진료과 이름 목록을 먼저 확인해서 정확히 매칭한다.
# "과" 앞 글자수 제한만으로 판단하면 "내과"(1글자+과)는 놓치고 "결과/효과"(1글자+과, 진료과 아님)는
# 잘못 잡는 딜레마가 있어서, 목록 매칭을 우선하고 목록에 없는 경우에만 정규식으로 보완한다.
COMMON_DEPARTMENTS = [
    "내과", "외과", "정형외과", "신경외과", "신경과", "안과", "이비인후과", "피부과",
    "비뇨기과", "산부인과", "소아청소년과", "정신건강의학과", "재활의학과", "가정의학과",
    "치과", "영상의학과", "마취통증의학과", "성형외과", "흉부외과", "가정의학과",
]
DEPARTMENT_PATTERN = re.compile(r"([가-힣]{2,6}과)")  # 목록에 없는 과를 위한 폴백 (오탐지 위험이 있어 2글자 이상만 허용)


def find_department(text: str) -> Optional[str]:
    for dept in COMMON_DEPARTMENTS:
        if dept in text:
            return dept
    fallback_match = DEPARTMENT_PATTERN.search(text)
    return fallback_match.group(1) if fallback_match else None

ISO_DATETIME_PATTERN = re.compile(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?")
MONTH_DAY_PATTERN = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일")
RELATIVE_DAY_PATTERN = re.compile(r"(오늘|내일|모레)")
HOUR_MINUTE_PATTERN = re.compile(r"(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?")
AMPM_PATTERN = re.compile(r"(오전|오후)")


def parse_datetime_kr(text: str) -> Optional[datetime]:
    """질문 문장에서 날짜+시간을 최대한 유연하게 뽑아 datetime으로 반환. 못 찾으면 None."""
    now = datetime.now()

    # ① "2026-09-10 14:00" 같은 명확한 형식이 있으면 그걸 최우선으로 사용
    iso_match = ISO_DATETIME_PATTERN.search(text)
    if iso_match:
        y, mo, d, h, mi, s = iso_match.groups()
        return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s or 0))

    # ② 날짜 부분: "오늘/내일/모레" 같은 상대 표현 우선, 없으면 "O월 O일"
    date_only = None
    relative_match = RELATIVE_DAY_PATTERN.search(text)
    if relative_match:
        offset = {"오늘": 0, "내일": 1, "모레": 2}[relative_match.group(1)]
        date_only = (now + timedelta(days=offset)).date()
    else:
        month_day_match = MONTH_DAY_PATTERN.search(text)
        if month_day_match:
            month, day = int(month_day_match.group(1)), int(month_day_match.group(2))
            year = now.year
            try:
                candidate = datetime(year, month, day).date()
            except ValueError:
                return None  # 예: 2월 30일처럼 실존하지 않는 날짜
            # 이미 지난 날짜면 "내년 그날"로 해석 (예약은 항상 미래여야 하므로)
            if candidate < now.date():
                year += 1
            date_only = datetime(year, month, day).date()

    if date_only is None:
        return None  # 날짜를 전혀 못 찾음

    # ③ 시간 부분: "O시[ O분]"
    hour_minute_match = HOUR_MINUTE_PATTERN.search(text)
    if hour_minute_match is None:
        return None  # 시간을 전혀 못 찾음

    hour = int(hour_minute_match.group(1))
    if hour_minute_match.group(2):
        minute = int(hour_minute_match.group(2))
    elif hour_minute_match.group(3):  # "반" = 30분
        minute = 30
    else:
        minute = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None

    # ④ 오전/오후 보정 (예: "오후 2시" -> 14시, "오전 12시" -> 0시)
    ampm_match = AMPM_PATTERN.search(text)
    if ampm_match:
        if ampm_match.group(1) == "오후" and hour < 12:
            hour += 12
        elif ampm_match.group(1) == "오전" and hour == 12:
            hour = 0
    elif 1 <= hour <= 8:
        # [병원 운영시간 자동 추론] 오전/오후를 안 밝힌 애매한 숫자(1~8)는
        # 그대로 두면 새벽 시간(01~08시)이 되어버려 병원 운영시간(09~18시) 밖이다.
        # +12(오후로 해석)하면 13~20시가 되어 대부분 운영시간 안에 들어오므로 오후로 간주한다.
        # 9~12시는 이미 오전으로 해석해도 운영시간 안이라 그대로 둔다.
        hour += 12

    return datetime(date_only.year, date_only.month, date_only.day, hour, minute)


# hospital_docs.json의 "hours" 문서(진료시간 안내)와 반드시 동일한 기준을 유지할 것.
# 평일: 09:00~18:00, 토요일: 09:00~13:00, 일요일: 휴진, 그리고 holidays 테이블에 등록된
# 날짜(공휴일/병원 자체 휴진일)도 휴진으로 처리한다 (was/routes/reservations.js와 동일 테이블 참조).
WEEKDAY_OPEN, WEEKDAY_CLOSE = time(9, 0), time(18, 0)
SATURDAY_OPEN, SATURDAY_CLOSE = time(9, 0), time(13, 0)
BUSINESS_HOURS_NOTICE = "평일은 오전 9시~오후 6시, 토요일은 오전 9시~오후 1시까지 진료합니다 (일요일·공휴일 휴진)."


def is_within_business_hours(dt: datetime) -> bool:
    weekday = dt.weekday()  # 0=월 ... 5=토 6=일
    if weekday == 6:
        return False
    if tools_db.is_holiday(dt.strftime("%Y-%m-%d")):
        return False
    if weekday == 5:
        return SATURDAY_OPEN <= dt.time() <= SATURDAY_CLOSE
    return WEEKDAY_OPEN <= dt.time() <= WEEKDAY_CLOSE


@audit_log("book_appointment")
def tool_book_appointment(question: str, patient_id: Optional[int]) -> str:
    department = find_department(question)
    if not department:
        return (
            "예약을 도와드리려면 진료과 정보가 필요합니다. "
            "예: '9월 10일 오후 2시에 내과 예약해줘'처럼 말씀해주세요."
        )

    parsed_dt = parse_datetime_kr(question)
    if parsed_dt is None:
        return (
            "예약 날짜와 시간을 이해하지 못했습니다. "
            "'9월 10일 오후 2시', '내일 14시', '2026-09-10 14:00'처럼 "
            "날짜와 시간을 함께 말씀해주세요."
        )

    if not is_within_business_hours(parsed_dt):
        requested = parsed_dt.strftime("%Y-%m-%d %H:%M")
        return (
            f"요청하신 {requested}은(는) 병원 운영시간이 아닙니다. "
            f"{BUSINESS_HOURS_NOTICE} 운영시간 내로 다시 말씀해주세요."
        )

    date_str = parsed_dt.strftime("%Y-%m-%d %H:%M:%S")
    return tools_db.book_appointment(patient_id, date_str, department)

@audit_log("check_appointments")
def tool_check_appointments(patient_id: Optional[int]) -> str:
    return tools_db.check_appointments(patient_id)

@audit_log("check_medical_records")
def tool_check_medical_records(patient_id: Optional[int]) -> str:
    return tools_db.check_medical_records(patient_id)

def choose_action(question: str) -> tuple[str, str]:
    """두 번째 값은 액션 종류를 나타내는 문자열 키 (아래 run_agent의 분기와 대응).
    순서가 중요하다: "예약 조회"/"진료기록 조회"처럼 구체적인 의도를 먼저 걸러내야,
    그 문장에 "예약"이라는 단어가 겹쳐 있어도 예약 생성으로 잘못 분류되지 않는다."""
    lowered = question.lower()

    if any(keyword in question for keyword in ["내 예약", "예약 확인", "예약 조회", "예약 내역"]):
        return ("예약 조회 요청이므로 예약 조회 도구를 사용", "check_appointments")

    if any(keyword in question for keyword in ["진료기록", "진료 기록", "차트 기록", "기록 확인"]):
        return ("진료기록 조회 요청이므로 진료기록 도구를 사용", "check_medical_records")

    # "예약해줘"처럼 구체적인 문구뿐 아니라, 그냥 "예약"이라는 단어만 있어도 예약 시도로 간주한다.
    # (위에서 조회 의도는 이미 먼저 걸러졌으므로, 여기서 "예약"만 봐도 조회와 헷갈릴 일이 없다.)
    if any(keyword in question for keyword in ["예약해줘", "예약 신청", "예약하고 싶", "예약할래", "예약"]):
        return ("예약 생성 요청이므로 예약 도구를 사용", "book_appointment")

    if any(keyword in question for keyword in ["시간", "위치", "어디", "증상", "아파", "진료", "기침", "복통", "응급실"]):
        return ("병원 정보 관련 질문이므로 RAG 도구를 사용", "rag")

    if any(keyword in lowered for keyword in ["hospital", "time", "location", "symptom"]):
        return ("영문 병원 질문이므로 RAG 도구를 사용", "rag")

    return ("일반적인 질문이거나 확인되지 않은 질문이므로 일반 답변을 사용", "direct")

def run_agent(question: str, patient_id: Optional[int] = None) -> str:
    """patient_id: 로그인한 환자의 id. WAS(Node)가 세션에서 꺼내 넘겨주며, 클라이언트가
    임의로 바꿀 수 없는 값이다 (IDOR 방지 - chat.js 참고). 예약/기록 조회 도구는 이 값이
    없으면(비로그인) 동작을 거부한다."""
    reason, action_key = choose_action(question)

    if action_key == "book_appointment":
        return tool_book_appointment(question, patient_id)
    if action_key == "check_appointments":
        return tool_check_appointments(patient_id)
    if action_key == "check_medical_records":
        return tool_check_medical_records(patient_id)
    if action_key == "rag":
        return tool_rag(question)
    return tool_direct_answer(question)

if __name__ == "__main__":
    test_q = "배가 아프고 토할 것 같은데 어디로 가야하나요?"
    print(run_agent(test_q))
