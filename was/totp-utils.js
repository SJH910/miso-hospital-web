const crypto = require("crypto");

// [설계 이유] otplib 같은 npm 패키지를 쓰지 않고 직접 구현한 이유:
// 1) TOTP는 표준 HMAC 연산일 뿐이라 Node 내장 crypto만으로 충분함
// 2) 이 프로젝트에서 bcrypt/tesseract.js 네이티브 컴파일 문제를 여러 번 겪었던 걸 감안하면,
//    필수도 아닌 새 의존성을 늘리는 것 자체가 리스크 - 안 늘려도 되면 안 늘리는 게 안전함

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30; // 코드가 30초마다 바뀜 (인증 앱들의 표준 주기)
const DIGITS = 6;

function base32Encode(buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 관리자 등록(enroll)용 새 비밀키 생성 (160비트 - RFC 4226 권장 길이)
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTotpCode(secretBase32, forTimeMs = Date.now()) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(forTimeMs / 1000 / STEP_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binCode % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

// window=1이면 앞뒤 30초까지 허용 (기기 간 시계 오차 대비 - 인증 앱들의 일반적인 관례)
function verifyTotpCode(secretBase32, token, window = 1) {
  if (!token || !/^\d{6}$/.test(token)) return false;
  for (let step = -window; step <= window; step++) {
    const time = Date.now() + step * STEP_SECONDS * 1000;
    if (generateTotpCode(secretBase32, time) === token) return true;
  }
  return false;
}

// 인증 앱에 QR 대신 "수동 입력"으로 등록할 수 있게 안내 문자열도 함께 제공
function buildOtpAuthUri(secretBase32, username) {
  const label = encodeURIComponent(`미소병원:${username}`);
  const issuer = encodeURIComponent("미소병원");
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { generateTotpSecret, generateTotpCode, verifyTotpCode, buildOtpAuthUri };
