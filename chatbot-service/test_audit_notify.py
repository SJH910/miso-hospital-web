"""TDD - Red 단계.
audit_notify.notify_discord()가 구현되기 전에 먼저 요구사항을 테스트로 고정한다.

배경: was/audit-severity.js·chatbot-service/audit_summary.py(오늘 병합된 실제 대시보드,
2a1a303)가 위험도 조회는 이미 커버하지만 실시간 알림은 없다 - 관리자 웹 세션이 뚫리면
대시보드도 같이 뚫린다는 문제는 여전히 남아있어, 그 세션과 분리된 Discord 알림 경로를 추가한다
(제안서: https://claude.ai/code/artifact/2f536ff6-4219-4fd1-8e3b-55437c7f5112).

요구사항:
1. DISCORD_WEBHOOK_URL이 설정 안 됐으면 아무 요청도 안 보낸다(조용히 스킵, 예외 없음).
2. 설정돼 있으면 action/actor/detail을 담아 웹훅에 POST한다.
3. 같은 (action, actor) 조합은 5분 안에 재발송하지 않는다(디바운스).
4. actor가 다르면 디바운스되지 않는다(별개 사건으로 취급).
5. 웹훅 전송이 실패(네트워크 오류)해도 예외를 밖으로 던지지 않는다 - 알림은 부가기능이라
   호출 측(engine.py의 챗봇 응답 흐름)을 막으면 안 됨.
"""
import importlib
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

chatbot_service_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(chatbot_service_dir))

audit_notify = importlib.import_module("audit_notify")


class TestNotifyDiscordSkipsWithoutWebhook(unittest.TestCase):
    def setUp(self):
        audit_notify._recent_sent.clear()
        self._old = os.environ.pop("DISCORD_WEBHOOK_URL", None)

    def tearDown(self):
        if self._old is not None:
            os.environ["DISCORD_WEBHOOK_URL"] = self._old

    @patch("audit_notify.urllib.request.urlopen")
    def test_no_request_sent_when_webhook_not_configured(self, mock_urlopen):
        audit_notify.notify_discord("totp_disabled", actor=1)
        mock_urlopen.assert_not_called()


class TestNotifyDiscordSendsAndDebounces(unittest.TestCase):
    def setUp(self):
        audit_notify._recent_sent.clear()
        os.environ["DISCORD_WEBHOOK_URL"] = "https://discord.test/webhook"

    @patch("audit_notify.urllib.request.urlopen")
    def test_sends_request_with_action_and_actor_in_body(self, mock_urlopen):
        audit_notify.notify_discord("login_anomaly_admin_new_ip", actor=42, detail="상세")
        self.assertEqual(mock_urlopen.call_count, 1)
        sent_request = mock_urlopen.call_args[0][0]
        body = json.loads(sent_request.data.decode("utf-8"))
        self.assertIn("login_anomaly_admin_new_ip", body["content"])
        self.assertIn("42", body["content"])
        self.assertIn("상세", body["content"])

    @patch("audit_notify.urllib.request.urlopen")
    def test_second_call_within_debounce_window_is_skipped(self, mock_urlopen):
        audit_notify.notify_discord("totp_disabled", actor=7)
        audit_notify.notify_discord("totp_disabled", actor=7)
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("audit_notify.urllib.request.urlopen")
    def test_different_actor_is_not_debounced_together(self, mock_urlopen):
        audit_notify.notify_discord("totp_disabled", actor=7)
        audit_notify.notify_discord("totp_disabled", actor=9)
        self.assertEqual(mock_urlopen.call_count, 2)

    @patch("audit_notify.urllib.request.urlopen", side_effect=OSError("network down"))
    def test_network_failure_does_not_raise(self, mock_urlopen):
        try:
            audit_notify.notify_discord("totp_disabled", actor=7)
        except Exception as e:
            self.fail(f"notify_discord()가 네트워크 실패 시 예외를 던짐: {e}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
