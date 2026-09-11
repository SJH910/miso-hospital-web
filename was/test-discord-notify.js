// TDD - Red 단계 (discord-notify.js 구현 전에 요구사항을 테스트로 고정)
//
// 배경: was/audit-severity.js·chatbot-service/audit_summary.py(오늘 병합된 실제 대시보드,
// 2a1a303)는 조회형이라 관리자 웹 세션이 뚫리면 대시보드도 같이 뚫린다 - 그 세션과 분리된
// Discord 알림 경로로 보완한다 (제안서: https://claude.ai/code/artifact/2f536ff6-4219-4fd1-
// 8e3b-55437c7f5112 "왜 디스코드인가" 참고).
//
// 요구사항:
// 1. 같은 (action, actor) 조합은 5분 안에 재발송하지 않는다(디바운스).
// 2. actor가 다르면 디바운스되지 않는다.
// 3. 5분이 지나면 다시 보낼 수 있다.
// shouldSend()는 네트워크 호출과 분리된 순수 판정 함수라 fetch를 목(mock)하지 않고도
// 바로 테스트할 수 있다 - test-crypto-utils-secrets.js와 같은 스타일(assert + 커스텀 러너).
const assert = require("assert");
const { shouldSend, _recentSent } = require("./discord-notify");

let failed = 0;
function test(name, fn) {
  _recentSent.clear();
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (e) {
    console.log(`FAIL - ${name}`);
    console.log(`       ${e.message}`);
    failed += 1;
  }
}

test("첫 호출은 보낸다", () => {
  assert.strictEqual(shouldSend("totp_disabled", 7, 1000), true);
});

test("같은 action+actor를 5분 안에 다시 부르면 막는다", () => {
  shouldSend("totp_disabled", 7, 1000);
  assert.strictEqual(shouldSend("totp_disabled", 7, 1000 + 60_000), false);
});

test("5분이 지나면 다시 보낸다", () => {
  shouldSend("totp_disabled", 7, 1000);
  assert.strictEqual(shouldSend("totp_disabled", 7, 1000 + 5 * 60_000 + 1), true);
});

test("actor가 다르면 디바운스되지 않는다", () => {
  shouldSend("totp_disabled", 7, 1000);
  assert.strictEqual(shouldSend("totp_disabled", 9, 1000 + 1), true);
});

test("action이 다르면 디바운스되지 않는다", () => {
  shouldSend("totp_disabled", 7, 1000);
  assert.strictEqual(shouldSend("login_anomaly_admin_new_ip", 7, 1000 + 1), true);
});

if (failed > 0) {
  console.log(`\n${failed}개 실패`);
  process.exit(1);
} else {
  console.log("\n모두 통과");
}
