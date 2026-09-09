// TDD - Red 단계 (JS 이식)
// Python pii_masking.py의 테스트 케이스를 동일하게 JS maskPii에 대해 재현.
const assert = require("assert");
const { maskPii } = require("./crypto-utils");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (e) {
    console.log(`FAIL - ${name}`);
    console.log(`       ${e.message}`);
    failed += 1;
  }
}

// --- 내부 URL / 사설 IP ---
test("사설 IP(10.x)가 마스킹된다", () => {
  assert.ok(maskPii("내부망 접속: 10.0.5.23").includes("[MASKED_INTERNAL_URL]"));
});
test("localhost + 포트 + 경로가 마스킹된다", () => {
  assert.ok(maskPii("http://localhost:3000/health 확인해줘").includes("[MASKED_INTERNAL_URL]"));
});
test("내부 도메인 접미사(.corp)가 마스킹된다", () => {
  assert.ok(maskPii("admin.corp 도메인으로 접속하세요").includes("[MASKED_INTERNAL_URL]"));
});
test("공개 도메인(naver.com)은 마스킹되지 않는다", () => {
  assert.ok(!maskPii("네이버(naver.com)에 접속했어요").includes("[MASKED_INTERNAL_URL]"));
});
test("공인 IP(8.8.8.8)는 마스킹되지 않는다", () => {
  assert.ok(!maskPii("구글 DNS는 8.8.8.8 입니다").includes("[MASKED_INTERNAL_URL]"));
});

// --- API 키 시그니처 ---
test("AWS 키가 마스킹된다", () => {
  const r = maskPii("AWS 키는 AKIAIOSFODNN7EXAMPLE 입니다");
  assert.ok(!r.includes("AKIA"));
  assert.ok(r.includes("[MASKED_API_KEY]"));
});
test("Slack 토큰이 마스킹된다", () => {
  assert.ok(maskPii("슬랙 토큰 xoxb-1234567890-abcdefghijklmnop").includes("[MASKED_API_KEY]"));
});
test("Anthropic 키가 OpenAI 규칙에 부분매칭되지 않고 통째로 마스킹된다", () => {
  const r = maskPii("앤트로픽 키 sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ 입니다");
  assert.ok(!r.includes("ant-"));
  assert.ok(r.includes("[MASKED_API_KEY]"));
});

// --- 키워드 문맥 ---
test("secret= 문맥의 값이 마스킹된다", () => {
  assert.ok(maskPii("secret=myS3cr3tInternalValue2024xyz").includes("[MASKED_API_KEY]"));
});

// --- 엔트로피 폴백 ---
test("시그니처 없는 고엔트로피 토큰이 마스킹된다", () => {
  assert.ok(maskPii("이 값 저장해줘: aZ7kQ2mP9xL4vN8wT1rB").includes("[MASKED_API_KEY]"));
});
test("평범한 한국어 문장은 마스킹되지 않는다", () => {
  assert.ok(!maskPii("오늘 회의는 3시에 시작합니다").includes("[MASKED_API_KEY]"));
});

// --- 회귀 (기존 기능) ---
test("기존 전화번호 마스킹 유지", () => {
  assert.ok(maskPii("전화번호는 010-1234-5678 입니다.").includes("****"));
});
test("기존 이메일 마스킹 유지", () => {
  assert.ok(!maskPii("내 이메일은 test@example.com 이야").includes("test@example.com"));
});
test("기존 주민번호 마스킹 유지", () => {
  assert.ok(!maskPii("제 주민번호는 900101-1234567 입니다.").includes("1234567"));
});

console.log(`\n${failed === 0 ? "모두 통과" : failed + "개 실패"}`);
process.exit(failed === 0 ? 0 : 1);
