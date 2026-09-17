"""
[TDD] POST /internal/verify-identity - 회원가입 시 WAS가 호출할 내부 전용 엔드포인트.
/chat과 동일하게 verify_internal_caller()로 보호되어야 한다.
(IDENTITY_VERIFICATION_WORKFLOW.md 참고)

작성 시점에는 이 라우트가 없어 전부 Red(404) 상태다.
"""
import os
import sys
from pathlib import Path

CHATBOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CHATBOT_DIR))

from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402

client = TestClient(app_module.app)
VALID_KEY = app_module.INTERNAL_SERVICE_KEY


def test_verified_person_returns_true():
    res = client.post(
        "/internal/verify-identity",
        json={"name": "김환자", "rrn": "990101-1234567"},
        headers={"X-Internal-Auth": VALID_KEY},
    )
    assert res.status_code == 200
    assert res.json() == {"verified": True}


def test_fake_person_returns_false_not_error():
    res = client.post(
        "/internal/verify-identity",
        json={"name": "김치볶음밥", "rrn": "010101-1234567"},
        headers={"X-Internal-Auth": VALID_KEY},
    )
    assert res.status_code == 200
    assert res.json() == {"verified": False}


def test_missing_internal_auth_header_returns_401():
    res = client.post(
        "/internal/verify-identity",
        json={"name": "김환자", "rrn": "990101-1234567"},
    )
    assert res.status_code == 401


def test_wrong_internal_auth_header_returns_401():
    res = client.post(
        "/internal/verify-identity",
        json={"name": "김환자", "rrn": "990101-1234567"},
        headers={"X-Internal-Auth": "wrong-key"},
    )
    assert res.status_code == 401
