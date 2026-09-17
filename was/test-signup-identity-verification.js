// TDD - Red 단계 (auth.js에 실명 인증 호출 로직 추가 전에 요구사항을 테스트로 고정)
//
// 배경: 강사님 피드백 - 회원가입이 이름/주민번호를 그대로 텍스트로만 받아 "김치볶음밥" 같은
// 가짜 이름으로도 가입되던 문제. chatbot-service의 POST /internal/verify-identity를 호출해
// 실제 등록된 사람(human.csv)인지 확인한다. (IDENTITY_VERIFICATION_WORKFLOW.md 참고)
//
// isRegisteredPerson()은 네트워크 호출(fetch)과 라우트 핸들러(req/res)를 분리한 순수 판정
// 함수라 - test-discord-notify.js의 shouldSend()와 같은 이유로 - fetch만 목(mock)하면
// Express req/res 없이도 바로 테스트할 수 있다. supertest 등 프레임워크가 설치돼 있지 않아
// 이 저장소의 기존 테스트들(test-crypto-utils-secrets.js 등)과 동일한 순수 assert 스타일로 작성.
const assert = require("assert");
const { isRegisteredPerson } = require("./routes/auth");

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (e) {
    console.log(`FAIL - ${name}`);
    console.log(`       ${e.message}`);
    failed += 1;
  }
}

async function run() {
  await test("verified:true 응답이면 true를 반환한다", async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ verified: true }) });
    const result = await isRegisteredPerson("김환자", "990101-1234567");
    assert.strictEqual(result, true);
  });

  await test("verified:false 응답이면 false를 반환한다", async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ verified: false }) });
    const result = await isRegisteredPerson("김치볶음밥", "010101-1234567");
    assert.strictEqual(result, false);
  });

  await test("chatbot-service가 4xx/5xx를 반환하면 fail-closed(false)로 처리한다", async () => {
    global.fetch = async () => ({ ok: false, status: 500 });
    const result = await isRegisteredPerson("김환자", "990101-1234567");
    assert.strictEqual(result, false);
  });

  await test("fetch 자체가 예외를 던져도(네트워크 장애) fail-closed(false)로 처리한다", async () => {
    global.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await isRegisteredPerson("김환자", "990101-1234567");
    assert.strictEqual(result, false);
  });

  if (failed > 0) {
    console.log(`\n${failed}개 실패`);
    process.exit(1);
  } else {
    console.log("\n모두 통과");
  }
}

run();
