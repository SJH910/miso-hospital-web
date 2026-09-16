const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const { encryptRrn } = require("../crypto-utils");
const { logAudit } = require("../audit");
const { verifyTotpCode } = require("../totp-utils");

const router = express.Router();

// [위치 탐지용] geoip-lite는 인터넷 호출 없이 로컬에 내장된 DB로 IP->국가/지역을 추정하는
// 패키지다. 외부 API를 쓰면 "그 서비스가 죽으면 로그인 자체가 막힌다"는 문제가 생기므로
// 오프라인 패키지를 선택했다. 설치 안 되어 있어도 앱이 죽지 않게 방어적으로 로드한다
// (없으면 "새 IP" 탐지는 그대로 동작하고, "새 지역" 탐지만 비활성화됨).
let geoip;
try {
  geoip = require("geoip-lite");
} catch (e) {
  geoip = null;
  console.warn("[auth] geoip-lite 미설치 - 관리자 신규 '지역' 탐지 비활성화 (신규 IP 탐지는 정상 동작). npm install geoip-lite로 설치 가능.");
}

// IPv4가 "::ffff:1.2.3.4"처럼 IPv6-매핑 형태로 들어올 때가 있어 geoip-lite가 못 알아보므로 정리.
// 사설 IP(127.0.0.1, 192.168.x.x 등)는 지역 추정이 불가능해 null을 반환한다(로컬 테스트 시 정상).
function getRegionForIp(ip) {
  if (!geoip) return null;
  const cleanIp = ip.replace("::ffff:", "");
  const geo = geoip.lookup(cleanIp);
  return geo ? `${geo.country}-${geo.region}` : null; // 예: "KR-11" (국가-지역코드)
}

// ── [비정상 요청 패턴 탐지] 반복 실패 + 이상 빈도 ──────────────────────
// 기존 loginLimiter(15분/5회, IP 기준 차단)와는 목적이 다르다: loginLimiter는 "더 이상 시도
// 못 하게 막는" 방어이고, 여기는 "이 요청 패턴이 비정상이다"라고 audit_log에 기록해서
// 나중에 관리자가 들여다볼 수 있게 하는 탐지다. 두 기준을 따로 두는 이유:
//   - 반복 실패(계정 기준): 여러 IP를 바꿔가며 한 계정을 노리면 IP 기준 rate limit만으론 못 잡음
//   - 이상 빈도(IP 기준): 한 IP가 여러 계정을 빠르게 순회하면 계정 기준 실패 카운트만으론 못 잡음
const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5분
const FAILURE_THRESHOLD = 5; // 같은 계정 5분 내 5회 실패
const FREQUENCY_WINDOW_MS = 60 * 1000; // 1분
const FREQUENCY_THRESHOLD = 10; // 같은 IP에서 1분 내 10회 시도(성공/실패 무관)

// [비정상적으로 긴 입력값] "문자열 엄청 길게 줬을 때 미탐" 문제 대응.
// 정상적인 아이디/비밀번호가 이 길이를 넘을 일은 없으므로, 넘으면 그 자체로 의심 신호.
const LONG_INPUT_MAX_LENGTH = 200;

// [관리자 계정 특별 감시] 관리자 계정은 뚫렸을 때 피해가 훨씬 크므로 일반 계정보다 낮은
// 임계값을 적용하고, 이전에 로그인한 적 없는 새 IP에서 성공하면 그 자체로 기록한다.
const ADMIN_FAILURE_THRESHOLD = 3; // 일반 계정(5)보다 낮게

// 실습/과제 규모라 메모리 저장으로 충분 (서버 재시작 시 초기화됨 - 운영 규모라면 Redis 등으로 교체 필요)
// 단, 관리자 신규 IP/지역("known" 위치) 기록은 db/init.sql의 admin_known_locations 테이블에
// 영속화한다 - [보안 수정 2026-09-16] 이것만 인메모리였을 때, WAS 재시작(배포마다 발생)마다
// "known" 기록이 통째로 사라져서 재시작 직후 첫 로그인은 누구든(TOTP 등록 여부 무관) 그냥
// 통과되는 실제 보안 공백으로 이어짐 - 운영 중 발견(팀원이 재시작 직후 admin으로 TOTP 없이
// 로그인됨). 반복 실패/빈도 카운터는 원래도 짧은 시간창(5분/1분) 기준이라 재시작으로 잃어도
// 영향이 적어 그대로 메모리에 둔다.
const failuresByUsername = new Map(); // username -> [실패 타임스탬프, ...]
const attemptsByIp = new Map(); // ip -> [시도 타임스탬프, ...]

// [보안 수정 2026-09-14] 위 3개 Map은 전부 "계정 username"을 키로 쓰는데, DB 조회(로그인 판단)는
// MySQL 기본 콜레이션이 대소문자를 구분 안 해서 "admin"/"Admin"/"ADMIN"이 전부 같은 계정으로
// 인식된다(실측: ADMIN으로 로그인해도 admin 계정으로 정상 로그인됨). 근데 이 Map들은 JS Map이라
// 대소문자를 그대로 구분해서 키로 쓰다 보니, 공격자가 매 시도마다 대소문자만 바꾸면(admin/Admin/ADMIN...)
// 매번 "처음 보는 키"로 취급되어 반복실패 카운트가 절대 안 쌓이고, 신규 IP/지역 탐지도 "기록이 아예
// 없으니 새로움 아님"으로 오판해서(isNewAdminLocation 참고) TOTP 추가인증까지 건너뛸 수 있었음 -
// 감사 로그 미탐일 뿐 아니라 실제 인증 우회로 이어질 수 있는 문제. DB 콜레이션에 맞춰 소문자로
// 정규화한 값을 Map 키로 통일해서 해결한다. 로그에 남기는 표시값(detail.username)은 실제로 무엇을
// 입력했는지 알아야 트리아지에 도움되므로 원문 그대로 유지 - 정규화는 내부 카운팅 키에만 적용.
function normalizeUsernameKey(username) {
  return typeof username === "string" ? username.toLowerCase() : username;
}

function pruneOld(timestamps, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
}

// 로그인 요청이 들어오는 즉시(비밀번호 검증 전) 호출: 아이디/비밀번호가 비정상적으로 길면
// 그 자체를 하나의 이상 신호로 기록한다. 실제 값은 남기지 않고 길이만 기록 (값 자체가 이미
// 의심스러운 페이로드일 수 있어 감사 로그에 그대로 옮겨적지 않는 편이 안전함).
async function detectLongInput({ username, password, ip }) {
  const usernameLen = (username || "").length;
  const passwordLen = (password || "").length;
  if (usernameLen > LONG_INPUT_MAX_LENGTH || passwordLen > LONG_INPUT_MAX_LENGTH) {
    await logAudit(null, "login_anomaly_long_input", "login_attempt", null, {
      ip, usernameLength: usernameLen, passwordLength: passwordLen, maxAllowed: LONG_INPUT_MAX_LENGTH,
    });
  }
}

// [보안 강화 2026-09-14] 쿼리가 파라미터화되어 있어 SQL 인젝션 자체는 실행되지 않지만,
// 지금까지는 그 "시도"가 그냥 평범한 login_fail(low)로만 기록돼서 오타와 구분 없이 묻혔음
// (감사 로그 위험도가 "무슨 이벤트인가"만 보고 "입력값이 어떻게 생겼는가"는 전혀 안 봤기 때문).
// 성공 여부와 무관하게 공격 시도 자체를 별도 이벤트(high)로 남겨서 놓치지 않게 한다.
// 흔한 SQLi 구문(따옴표+OR/AND, UNION SELECT, ;DROP 등, SQL 주석)만 보는 휴리스틱이라
// 완전한 탐지는 아니고(우회 가능), 반대로 우연히 비슷한 문자열이 정상 입력에 섞이면
// 오탐할 수도 있음 - 그래도 지금처럼 "전혀 안 보는 것"보다는 낫다고 판단.
const SQLI_PATTERNS = [
  /'\s*(or|and)\s+.{0,20}=/i, // ' OR '1'='1, ' AND 1=1
  /\bunion\b\s+(all\s+)?\bselect\b/i, // UNION SELECT
  /;\s*(drop|delete|update|insert|alter)\b/i, // ;DROP TABLE ...
  /--\s|--$|#\s*$|\/\*/, // SQL 주석(-- / # / /* */) - 흔히 인증 우회에 쓰임(예: admin'--)
  /\bsleep\s*\(/i, // SLEEP() 기반 블라인드 인젝션
  /\bor\s+1\s*=\s*1\b/i, // OR 1=1
];

function findSqlInjectionPattern(value) {
  if (!value) return null;
  const match = SQLI_PATTERNS.find((pattern) => pattern.test(value));
  return match ? match.source : null;
}

async function detectSqlInjectionPattern({ username, password, ip }) {
  const usernamePattern = findSqlInjectionPattern(username);
  const passwordPattern = findSqlInjectionPattern(password);
  if (!usernamePattern && !passwordPattern) return;

  // 이 로그는 audit:view(admin 전용) 권한으로만 조회 가능하고, 공격 시도의 실제 모양을
  // 봐야 트리아지에 도움이 되므로(오탐인지 진짜 공격 도구 서명인지 구분) - username 필드처럼
  // 마스킹하지 않고 원문을 남긴다(단, 로그 비대화 방지를 위해 LONG_INPUT_MAX_LENGTH로 자름).
  await logAudit(null, "login_anomaly_sqli_pattern", "login_attempt", null, {
    ip,
    field: usernamePattern ? "username" : "password",
    matchedPattern: usernamePattern || passwordPattern,
    payloadSample: (usernamePattern ? username : password).slice(0, LONG_INPUT_MAX_LENGTH),
  });
}

// 로그인 시도 1건마다 호출: 두 기준을 갱신하고, 기준을 넘었으면 audit_log에 이상탐지 이벤트를 남긴다.
// 반환값은 없음 - 탐지되어도 로그인 자체를 막지는 않는다 (그건 loginLimiter의 역할).
// isAdmin: 이 계정이 실제 존재하는 admin 계정인지 (반복 실패 임계값을 다르게 적용하기 위함)
async function detectAbnormalPattern({ username, ip, isFailure, isAdmin }) {
  const ipAttempts = attemptsByIp.get(ip) || [];
  pruneOld(ipAttempts, FREQUENCY_WINDOW_MS);
  ipAttempts.push(Date.now());
  attemptsByIp.set(ip, ipAttempts);

  if (ipAttempts.length === FREQUENCY_THRESHOLD) {
    // 임계값을 "넘어설 때"가 아니라 "정확히 도달한 순간"에만 기록해 같은 이벤트가 매 요청마다 중복 기록되지 않게 함
    await logAudit(null, "login_anomaly_high_frequency", "login_attempt", null, {
      ip, count: ipAttempts.length, windowMs: FREQUENCY_WINDOW_MS,
    });
  }

  const usernameKey = normalizeUsernameKey(username);
  if (isFailure) {
    const failures = failuresByUsername.get(usernameKey) || [];
    pruneOld(failures, FAILURE_WINDOW_MS);
    failures.push(Date.now());
    failuresByUsername.set(usernameKey, failures);

    const threshold = isAdmin ? ADMIN_FAILURE_THRESHOLD : FAILURE_THRESHOLD;
    if (failures.length === threshold) {
      await logAudit(null, isAdmin ? "login_anomaly_admin_repeated_failure" : "login_anomaly_repeated_failure", "login_attempt", null, {
        username, ip, count: failures.length, windowMs: FAILURE_WINDOW_MS, threshold,
      });
    }
  } else {
    failuresByUsername.delete(usernameKey); // 로그인 성공 시 실패 카운트 초기화
  }
}

// admin_known_locations에서 이 관리자 계정이 아는 IP/지역 전체를 한 번에 가져온다 -
// isNewAdminLocation/recordAdminLocation 둘 다 "전체를 보고 판단"하는 같은 모양이라 공유.
async function getKnownAdminLocations(usernameKey) {
  const [rows] = await pool.query(
    "SELECT location_type, value FROM admin_known_locations WHERE username = ?",
    [usernameKey]
  );
  const knownIps = new Set(rows.filter((r) => r.location_type === "ip").map((r) => r.value));
  const knownRegions = new Set(rows.filter((r) => r.location_type === "region").map((r) => r.value));
  return { knownIps, knownRegions };
}

// 로그인을 완성하기 *전에* "이 위치가 새로운가?"만 확인 (테이블을 건드리지 않음 - 순수 조회).
// 관리자가 아직 한 번도 로그인한 적 없으면(기록 자체가 없으면) "새로움"으로 보지 않는다 -
// 최초 로그인 때부터 인증을 요구하면 계정을 아예 못 쓰게 되므로.
// [보안 수정 2026-09-16] 예전엔 인메모리 Map이라 WAS 재시작마다 이 기록이 사라졌었다 -
// admin_known_locations 테이블로 영속화해서 재시작과 무관하게 유지되도록 함(아래 함수들
// 전체 참고). 로그인 흐름 밖(감사 대시보드 열람 시점, auditLog.js)에서도 재사용한다.
async function isNewAdminLocation({ username, ip }) {
  const usernameKey = normalizeUsernameKey(username);
  const { knownIps, knownRegions } = await getKnownAdminLocations(usernameKey);
  const isNewIp = knownIps.size > 0 ? !knownIps.has(ip) : false;

  const region = getRegionForIp(ip);
  const isNewRegion = region && knownRegions.size > 0 ? !knownRegions.has(region) : false;

  return isNewIp || isNewRegion;
}

// 로그인 성공이 확정된 *후에* 호출: IP/지역을 기록하고, 새로움이 감지되면 감사 로그도 남긴다.
// (TOTP 인증까지 통과해서 로그인이 최종 완료된 경우에만 호출 - 여기서 새 위치로 등록해야
//  다음번 같은 위치 로그인 때는 다시 인증을 요구하지 않는다.)
async function recordAdminLocation({ username, ip, patientId }) {
  const usernameKey = normalizeUsernameKey(username);
  const { knownIps, knownRegions } = await getKnownAdminLocations(usernameKey);

  if (knownIps.size > 0 && !knownIps.has(ip)) {
    await logAudit(patientId, "login_anomaly_admin_new_ip", "patients", patientId, {
      username, ip, knownIpCount: knownIps.size,
    });
  }
  await pool.query(
    "INSERT IGNORE INTO admin_known_locations (username, location_type, value) VALUES (?, 'ip', ?)",
    [usernameKey, ip]
  );

  const region = getRegionForIp(ip);
  if (region) {
    if (knownRegions.size > 0 && !knownRegions.has(region)) {
      await logAudit(patientId, "login_anomaly_admin_new_location", "patients", patientId, {
        username, ip, region, knownRegionCount: knownRegions.size,
      });
    }
    await pool.query(
      "INSERT IGNORE INTO admin_known_locations (username, location_type, value) VALUES (?, 'region', ?)",
      [usernameKey, region]
    );
  }
}

// [보안 강화 #6 Rate Limiting] 로그인 엔드포인트는 15분 내 5회로 제한.
// IP 단위로 카운트하며, 초과 시 429 응답. 브루트포스/자동화 공격 방어.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  // 비밀번호 검증(DB 조회, bcrypt 연산)보다 먼저 확인 - 불필요한 연산을 태우지 않기 위함
  await detectLongInput({ username, password, ip: req.ip });
  await detectSqlInjectionPattern({ username, password, ip: req.ip });

  try {
    // [보안 강화 #1 SQL Injection] Prepared Statement로 입력값을 쿼리 구조와 분리.
    const [rows] = await pool.query(
      "SELECT * FROM patients WHERE username = ?",
      [username]
    );
    const patient = rows[0];
    const isAdmin = patient?.role === "admin";

    // [보안 강화 #8 평문 비밀번호] bcrypt.compare로 해시 비교 (평문 비교 금지).
    // 계정이 없을 때도 동일한 시간이 걸리도록 더미 해시와 비교해 타이밍 공격 방지.
    const hashToCompare = patient ? patient.password : "$2b$10$invalidsaltinvalidsaltinvalidsaltinvalidsalt";
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!patient || !passwordMatches) {
      logAudit(patient ? patient.id : null, "login_fail", "patients", patient ? patient.id : null, { username });
      await detectAbnormalPattern({ username, ip: req.ip, isFailure: true, isAdmin });
      return res.status(401).json({ success: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    // [관리자 신규 위치 추가 인증] 비밀번호는 맞았지만, 관리자 계정이 TOTP를 등록해뒀고
    // 지금 로그인이 "처음 보는 IP 또는 지역"이면 인증 코드 없이는 세션을 만들어주지 않는다.
    // TOTP를 등록 안 한 관리자는 이 단계를 건너뛴다 (기존처럼 로그인은 되되, 이상 여부만 감사 로그에 남음).
    if (isAdmin && patient.totp_secret && (await isNewAdminLocation({ username, ip: req.ip }))) {
      const { totpCode } = req.body;
      if (!totpCode) {
        return res.status(401).json({
          success: false,
          requiresTotp: true,
          message: "새로운 위치에서의 로그인입니다. 인증 앱의 6자리 코드를 입력해주세요.",
        });
      }
      if (!verifyTotpCode(patient.totp_secret, totpCode)) {
        await logAudit(patient.id, "totp_verify_fail", "patients", patient.id, { username, ip: req.ip });
        return res.status(401).json({ success: false, message: "인증 코드가 올바르지 않습니다." });
      }
      await logAudit(patient.id, "totp_verify_success", "patients", patient.id, { username, ip: req.ip });
    }

    // [보안 강화 #4 세션 관리] 세션 고정 공격 방지를 위해 로그인 성공 시 세션 ID 재발급.
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ success: false, message: "로그인 처리 중 오류가 발생했습니다." });
      req.session.patientId = patient.id;
      req.session.patientName = patient.name;
      req.session.role = patient.role;
      // [2026-09-16] 관리자 신규 위치 탐지(isNewAdminLocation)는 admin_known_locations 조회가
      // "username" 문자열을 키로 쓰는데, 지금까지 세션엔 patientId/patientName만 있고 username
      // 자체가 없어서 로그인 이후(예: 감사 대시보드 조회 시점)에는 이 검사를 재사용할 수
      // 없었다. was/routes/auditLog.js가 "지금 이 조회가 admin의 평소 위치에서 온 게 맞는지"
      // 확인하려면 username이 세션에 있어야 한다.
      req.session.username = patient.username;
      // [보안 강화 #5 CSRF] 로그인 시 CSRF 토큰 발급. 이후 상태 변경 요청(POST 등)마다 이 값을 헤더로 첨부해야 함.
      req.session.csrfToken = crypto.randomBytes(24).toString("hex");
      logAudit(patient.id, "login_success", "patients", patient.id, { username });
      await detectAbnormalPattern({ username, ip: req.ip, isFailure: false, isAdmin });
      if (isAdmin) {
        await recordAdminLocation({ username, ip: req.ip, patientId: patient.id });
      }
      res.json({
        success: true,
        patient: { id: patient.id, name: patient.name, role: patient.role },
        csrfToken: req.session.csrfToken,
      });
    });
  } catch (err) {
    // [보안 강화 #7-b 정보 노출] 상세 에러는 서버 로그에만 남기고, 응답은 일반 메시지만 반환.
    console.error("[login error]", err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

router.post("/signup", async (req, res) => {
  const { username, password, name, rrn } = req.body;

  if (!username || !password || !name || !rrn) {
    return res.status(400).json({ success: false, message: "모든 항목을 입력해주세요." });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id FROM patients WHERE username = ?",
      [username]
    );

    // [보안 강화 #10 User Enumeration] 아이디 존재 여부를 노출하지 않도록,
    // 중복 시에도 로그인 실패와 동일하게 일반적인 메시지만 반환.
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "가입 처리 중 문제가 발생했습니다. 입력값을 확인해주세요." });
    }

    // [보안 강화 #8 평문 비밀번호] bcrypt로 단방향 해시 처리 후 저장.
    const hashedPassword = await bcrypt.hash(password, 12);

    // [보안 강화 #9 주민번호 미암호화] AES-256-GCM으로 암호화 후 저장 (평문 저장 금지).
    const encryptedRrn = encryptRrn(rrn);

    const [result] = await pool.query(
      "INSERT INTO patients (username, password, name, rrn) VALUES (?, ?, ?, ?)",
      [username, hashedPassword, name, encryptedRrn]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("[signup error]", err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

// 현재 세션의 로그인 사용자 정보 반환
router.get("/me", (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  res.json({
    id: req.session.patientId,
    name: req.session.patientName,
    role: req.session.role,
    csrfToken: req.session.csrfToken,
  });
});

// [보안 강화 #4 세션 관리] 로그아웃 시 세션을 서버에서 완전히 파기.
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: "로그아웃 처리 중 오류가 발생했습니다." });
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// [2026-09-16] was/routes/auditLog.js가 감사 대시보드 조회 자체도 "관리자의 평소 위치에서
// 온 게 맞는지" 확인할 수 있도록 재사용 - isNewAdminLocation은 순수 조회 함수(맵을 안 건드림)라
// 로그인 흐름 밖에서 호출해도 안전하다. router는 함수 객체라 프로퍼티를 붙여도
// app.use("/api", authRoutes)의 동작에는 영향이 없다.
router.isNewAdminLocation = isNewAdminLocation;

module.exports = router;
