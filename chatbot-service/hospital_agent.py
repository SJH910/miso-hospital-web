from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Optional

import tools_db

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

def tool_list_documents() -> str:
    docs = DOCUMENTS.load_documents()
    lines = ["[도구] 병원 정보 문서 목록 조회"]
    for doc in docs:
        lines.append(f"- {doc.doc_id}: {doc.text}")
    return "\n".join(lines)

def tool_rag(question: str) -> str:
    return RAG.run_rag(question, top_k=2)

def tool_direct_answer(question: str) -> str:
    return LLM.generate_direct_answer(question)

# [신규] 예약 생성 - 질문에서 날짜/시간/진료과를 정규식으로 추출.
# 형식이 자유로운 자연어 예약 요청을 완벽히 파싱하기는 어려우므로, 명확한 형식일 때만 처리하고
# 그렇지 않으면 형식을 안내하는 메시지를 돌려준다 (틀린 값으로 예약이 생성되는 것보다 안전).
DATE_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?")
DEPARTMENT_PATTERN = re.compile(r"([가-힣]{2,6}과)")

def tool_book_appointment(question: str, patient_id: Optional[int]) -> str:
    date_match = DATE_PATTERN.search(question)
    dept_match = DEPARTMENT_PATTERN.search(question)
    if not date_match or not dept_match:
        return (
            "예약을 도와드리려면 날짜/시간과 진료과가 필요합니다. "
            "예: '2026-09-10 14:00에 내과 예약해줘' 형식으로 다시 말씀해주세요."
        )
    seconds = date_match.group(3) or "00"
    date_str = f"{date_match.group(1)} {date_match.group(2)}:{seconds}"
    return tools_db.book_appointment(patient_id, date_str, dept_match.group(1))

def tool_check_appointments(patient_id: Optional[int]) -> str:
    return tools_db.check_appointments(patient_id)

def tool_check_medical_records(patient_id: Optional[int]) -> str:
    return tools_db.check_medical_records(patient_id)

def choose_action(question: str) -> tuple[str, str]:
    """두 번째 값은 액션 종류를 나타내는 문자열 키 (아래 run_agent의 분기와 대응)."""
    lowered = question.lower()

    if any(keyword in question for keyword in ["예약해줘", "예약 신청", "예약하고 싶", "예약할래"]):
        return ("예약 생성 요청이므로 예약 도구를 사용", "book_appointment")

    if any(keyword in question for keyword in ["내 예약", "예약 확인", "예약 조회", "예약 내역"]):
        return ("예약 조회 요청이므로 예약 조회 도구를 사용", "check_appointments")

    if any(keyword in question for keyword in ["진료기록", "진료 기록", "차트 기록", "기록 확인"]):
        return ("진료기록 조회 요청이므로 진료기록 도구를 사용", "check_medical_records")

    if any(keyword in question for keyword in ["시간", "위치", "어디", "증상", "아파", "예약", "진료", "기침", "복통", "응급실"]):
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
