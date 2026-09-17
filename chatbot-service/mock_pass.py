"""
실명 인증(모의 PASS) - 회원가입 시 이름+주민번호를 human.csv(사전 등록된 실제 인물 명단)와
대조해 일치할 때만 True를 반환한다. 진짜 PASS 앱처럼 외부 기관 연동 없이, 교육용으로
CSV 파일을 "진짜 사람 명단" 삼아 모의(mock) 처리한다.
(IDENTITY_VERIFICATION_WORKFLOW.md 참고)
"""
import csv
from pathlib import Path
from typing import Optional

HUMAN_CSV_PATH = Path(__file__).resolve().parent / "human.csv"


def _normalize_name(name: str) -> str:
    return name.strip()


def _normalize_rrn(rrn: str) -> str:
    # 하이픈 유무/공백 등 입력 형식 편차를 없애기 위해 숫자만 남긴다.
    return "".join(ch for ch in rrn if ch.isdigit())


def _load_registry() -> set[tuple[str, str]]:
    registry: set[tuple[str, str]] = set()
    with open(HUMAN_CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            registry.add((_normalize_name(row["name"]), _normalize_rrn(row["rrn"])))
    return registry


def verify_identity(name: Optional[str], rrn: Optional[str]) -> bool:
    """human.csv에 등록된 (이름, 주민번호) 조합과 정확히 일치하면 True."""
    if not name or not rrn:
        return False

    registry = _load_registry()
    return (_normalize_name(name), _normalize_rrn(rrn)) in registry
