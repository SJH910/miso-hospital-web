// [2026-09-16] INCIDENT_RESPONSE.md 3-4번 섹션의 공백("IP 차단/블랙리스트 없음")을 메운다.
// 관리자가 was/routes/ipBlocklist.js를 통해 등록한 IP는 여기서 모든 요청보다 먼저 걸러진다.
//
// 매 요청마다 DB를 조회하면 느려지므로 인메모리에 캐싱한다 - was/middleware/requirePermission.js의
// permissionsByRole과 같은 패턴(참조 데이터를 캐싱하고, 바뀔 때만 갱신). 다만 차단은 보안
// 기능이라 "느리게 반영돼도 그만"인 권한 캐시와 달리 즉시 반영이 중요해서, TTL로만 기대지 않고
// was/routes/ipBlocklist.js가 등록/해제할 때마다 invalidateCache()로 즉시 무효화한다. TTL은
// "다른 프로세스(예: VM 재배포 중 잠깐 떠 있던 이전 프로세스)가 만든 차단"까지 결국은 반영되도록
// 하는 보조 장치일 뿐이다.
const pool = require("../db");

const CACHE_TTL_MS = 30 * 1000;
let cachedBlocklist = null; // Map(ip -> expiresAt(Date|null))
let cachedAt = 0;

async function loadBlocklist() {
  const [rows] = await pool.query(
    "SELECT ip, expires_at FROM ip_blocklist WHERE expires_at IS NULL OR expires_at > NOW()"
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.ip, row.expires_at);
  }
  cachedBlocklist = map;
  cachedAt = Date.now();
  return map;
}

// was/routes/ipBlocklist.js가 차단 등록/해제 직후 호출 - 다음 요청부터 바로 반영되게 한다.
function invalidateCache() {
  cachedBlocklist = null;
}

async function getBlocklist() {
  if (!cachedBlocklist || Date.now() - cachedAt > CACHE_TTL_MS) {
    return loadBlocklist();
  }
  return cachedBlocklist;
}

// [2026-09-16] 차단 메시지를 일부러 뭉뚱그린다("일시적으로 이용이 제한되었습니다") - "IP가
// 차단됐다"고 구체적으로 알려주면 공격자가 VPN/프록시로 우회를 시도하라는 힌트를 주는 셈이라
// db/init.sql의 설계 결정(차단 메시지 항목)을 그대로 따른다.
async function ipBlocklistMiddleware(req, res, next) {
  try {
    const blocklist = await getBlocklist();
    if (blocklist.has(req.ip)) {
      return res.status(403).json({ message: "일시적으로 이용이 제한되었습니다." });
    }
    next();
  } catch (err) {
    // 차단 목록 조회 실패(예: DB 일시 장애)가 서비스 전체를 막으면 안 됨 - 이 프로젝트 전반의
    // "부가 기능 장애가 핵심 기능을 막으면 안 된다" 원칙과 동일하게, 실패 시엔 차단 없이 통과시킨다.
    console.error("[ip blocklist] 조회 실패 - 이번 요청은 차단 없이 통과", err.message);
    next();
  }
}

module.exports = { ipBlocklistMiddleware, invalidateCache };
