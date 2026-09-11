const crypto = require("crypto");
const config = require("./config");

const ALGORITHM = "aes-256-gcm";

// 주민번호처럼 "나중에 복호화해서 봐야 할 수도 있는" 데이터는 해시가 아닌 대칭키 암호화를 사용.
// config.rrnEncryptionKey는 32바이트(256비트) 키여야 함 (환경변수로 관리, 기본값은 개발용).
function encryptRrn(plainText) {
  const iv = crypto.randomBytes(12); // GCM은 96비트(12바이트) IV 권장
  const cipher = crypto.createCipheriv(ALGORITHM, config.rrnEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv + authTag + 암호문을 하나의 문자열로 합쳐 저장 (복호화 시 다시 분리)
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptRrn(storedValue) {
  const raw = Buffer.from(storedValue, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, config.rrnEncryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// [챗봇 통합] 상담 원문도 동일 방식(원문 암호화 저장 + 조회시 마스킹)을 쓰므로 이름만 범용으로 별칭.
const encryptText = encryptRrn;
const decryptText = decryptRrn;

// [스캔 문서 원본 이미지용] encryptRrn/decryptRrn과 같은 AES-256-GCM·같은 키를 쓰지만,
// decryptRrn은 마지막에 .toString("utf8")로 변환해서 문자열 전용이다 — 이미지 같은 임의
// 바이너리를 거기 넣으면 유효하지 않은 UTF-8 시퀀스가 깨져서 원본 바이트가 손상된다.
// 그래서 문자열 변환 없이 Buffer를 그대로 주고받는 버전을 따로 둔다.
function encryptBuffer(plainBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, config.rrnEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]); // 파일로 그대로 저장할 것이므로 base64 변환 안 함
}

function decryptBuffer(storedBuffer) {
  const iv = storedBuffer.subarray(0, 12);
  const authTag = storedBuffer.subarray(12, 28);
  const encrypted = storedBuffer.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, config.rrnEncryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// 화면 표시가 필요해질 경우를 대비한 마스킹 함수 (뒷자리 일부만 노출)
// 예: 990101-1234567 -> 990101-1******
function maskRrn(plainRrn) {
  const [front, back] = plainRrn.split("-");
  if (!back) return plainRrn;
  return `${front}-${back[0]}${"*".repeat(back.length - 1)}`;
}

// [챗봇 상담 원문 마스킹] 주민번호/전화번호/이메일/내부 URL/API 키 패턴 마스킹.
// 챗봇(Python) 쪽 pii_masking.py는 "LLM에 보내기 전" 마스킹이 목적이고,
// 이 함수는 "채팅 이력을 환자에게 다시 보여줄 때" 마스킹이 목적이라 역할이 다르다(둘 다 필요).
// 내부 URL/API 키 탐지 규칙은 Python의 pii_masking.py(mask_secrets)와 동일하게 맞춰뒀다 -
// 언어가 달라 import는 못 해도, 규칙 자체는 반드시 같이 업데이트할 것 (test-crypto-utils-secrets.js 참고).
//
// [보안 수정 2026-09-11] SSN_PATTERN/PHONE_PATTERN이 하이픈 구분자·"010-" 접두사 하나만
// 하드코딩돼 있어서, 점/공백으로 구분하거나("900101.1234567") 010이 아닌 구형 국번
// (011/016/017/018/019)이면 매칭 자체가 안 되고 그대로 통과되던 버그가 있었음
// (BUG_REVIEW_2026-09-10.md 참고 - Python 쪽 pii_masking.py는 2026-09-10에 구분자 문제를
// 먼저 고쳤는데 이 파일엔 그 수정이 반영되지 않았었음). Python과 동일한 SEPARATOR 방식으로
// 통일해서 재구성한다 - 언어가 달라 코드 공유는 못 해도 정규식이 찾는 "형태"는 반드시 맞춰야
// 하므로, pii_masking.py를 고칠 때는 이 파일도 같이 볼 것(반대 방향도 마찬가지).
const SEPARATOR = "[\\s\\-~_.]";

function spacedDigits(count) {
  return Array(count).fill("\\d").join(SEPARATOR + "*");
}

const SSN_PATTERN = new RegExp(`(${spacedDigits(6)})${SEPARATOR}*(${spacedDigits(7)})`, "g");

// 010/011/016/017/018/019 전부 허용("0"+"1"+[016789]). 중간 구간은 010 등 신형(4자리)과
// 011~019 구형(3자리, 예: 011-234-5678) 둘 다 허용 - 4자리를 먼저 시도해야 실제 4자리
// 번호가 3자리로 잘못 잘려서 마지막 구간(고정 4자리)과 안 맞는 상황을 피할 수 있다.
const PHONE_PREFIX = `0${SEPARATOR}*1${SEPARATOR}*[016789]`;
const PHONE_MIDDLE = `(?:${spacedDigits(4)}|${spacedDigits(3)})`;
const PHONE_LAST = spacedDigits(4);
const PHONE_PATTERN = new RegExp(`(${PHONE_PREFIX})${SEPARATOR}*(${PHONE_MIDDLE})${SEPARATOR}*(${PHONE_LAST})`, "g");

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// --- 내부 URL / 사설 IP ---
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const PRIVATE_IP =
  "(?:10(?:\\." + OCTET + "){3}" +
  "|172\\.(?:1[6-9]|2\\d|3[01])(?:\\." + OCTET + "){2}" +
  "|192\\.168(?:\\." + OCTET + "){2}" +
  "|127(?:\\." + OCTET + "){3})";

const INTERNAL_URL_PATTERN = new RegExp(
  "(?:https?://)?(?:" + PRIVATE_IP + "|localhost)(?::\\d{2,5})?(?:/[^\\s,]*)?" +
    "|(?:https?://)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.(?:internal|corp|local|intranet)(?:/[^\\s,]*)?",
  "g"
);

// --- 알려진 서비스 API 키 시그니처 (테이블 기반, Python과 동일 순서) ---
// 주의: sk-ant-를 sk-보다 먼저 둬야 부분매칭(잔여 "ant-..." 남는 버그)이 안 생김.
const API_KEY_SIGNATURES = [
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,48}/g,
  /AIza[0-9A-Za-z\-_]{30,45}/g,
  /sk-ant-[A-Za-z0-9-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

function maskKnownSignatures(text) {
  return API_KEY_SIGNATURES.reduce((acc, pattern) => acc.replace(pattern, "[MASKED_API_KEY]"), text);
}

// --- 키워드 문맥 기반 시크릿 ---
const KEYWORD_SECRET_PATTERN = new RegExp(
  "((?:api[_\\s-]?key|secret|access[_\\s-]?key|token|password|bearer" +
    "|API\\s*키|시크릿\\s*키|액세스\\s*키|비밀번호)" +
    "\\s*[:=]?\\s*(?:은|는|이|가)?\\s*)" +
    "([A-Za-z0-9][A-Za-z0-9._-]{7,})",
  "gi"
);

// --- 엔트로피 기반 폴백 ---
function shannonEntropy(s) {
  if (!s) return 0;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const length = s.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const ENTROPY_CANDIDATE_PATTERN = /(?<![A-Za-z0-9_.\-])[A-Za-z][A-Za-z0-9]{15,}(?![A-Za-z0-9_.\-])/g;
const ENTROPY_THRESHOLD = 3.5;

function maskEntropyCandidates(text) {
  return text.replace(ENTROPY_CANDIDATE_PATTERN, (token) => {
    if (token.includes("MASKED")) return token; // 이미 마스킹된 placeholder는 건드리지 않음
    return shannonEntropy(token) >= ENTROPY_THRESHOLD ? "[MASKED_API_KEY]" : token;
  });
}

function maskSecrets(text) {
  if (!text) return text;
  let masked = text;
  masked = masked.replace(INTERNAL_URL_PATTERN, "[MASKED_INTERNAL_URL]");
  masked = maskKnownSignatures(masked);
  masked = masked.replace(KEYWORD_SECRET_PATTERN, "$1[MASKED_API_KEY]");
  masked = maskEntropyCandidates(masked);
  return masked;
}

function maskPii(text) {
  if (typeof text !== "string") return text;
  // 내부 URL/API 키를 먼저 거르고, 그다음 기존 PII 패턴을 적용한다 (Python 쪽과 동일한 순서).
  let masked = maskSecrets(text);
  // [보안 수정 2026-09-11] 구분자가 하이픈이 아닐 수 있어서(점/공백 등) 매칭된 문자열을
  // m.split("-")로 쪼개면 실패한다 - 정규식 캡처 그룹에서 직접 꺼내 써야 함.
  masked = masked.replace(SSN_PATTERN, (m, front) => `${front}-*******`);
  masked = masked.replace(PHONE_PATTERN, (m, prefix, _middle, last) => `${prefix}-****-${last}`);
  masked = masked.replace(EMAIL_PATTERN, (m) => {
    const [local, domain] = m.split("@");
    const visible = local.length > 3 ? local.slice(0, 3) : local[0];
    return `${visible}${"*".repeat(local.length - visible.length)}@${domain}`;
  });
  return masked;
}

module.exports = { encryptText, decryptText, encryptRrn, decryptRrn, encryptBuffer, decryptBuffer, maskRrn, maskPii };
