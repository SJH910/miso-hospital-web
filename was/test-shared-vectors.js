// 교차검증: shared_test_vectors.json에 대해 JS maskPii가 Python과 같은 판정을 내리는지 확인.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { maskPii } = require("./crypto-utils");

const vectorsPath = path.join(__dirname, "..", "shared_test_vectors.json");
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf-8"));

let failed = 0;
for (const v of vectors) {
  const result = maskPii(v.text);
  const hasUrl = result.includes("[MASKED_INTERNAL_URL]");
  const hasKey = result.includes("[MASKED_API_KEY]");
  try {
    assert.strictEqual(hasUrl, v.expect_internal_url, `internal_url 판정 불일치: "${v.text}" -> "${result}"`);
    assert.strictEqual(hasKey, v.expect_api_key, `api_key 판정 불일치: "${v.text}" -> "${result}"`);
    console.log(`ok   - ${v.text}`);
  } catch (e) {
    console.log(`FAIL - ${v.text}`);
    console.log(`       ${e.message}`);
    failed += 1;
  }
}

console.log(`\n${failed === 0 ? "모두 통과 (Python과 판정 일치)" : failed + "개 불일치"}`);
process.exit(failed === 0 ? 0 : 1);
