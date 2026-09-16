// [2026-09-16] INCIDENT_RESPONSE.md 3-4번 섹션의 공백("IP 차단/블랙리스트 없음")을 메운다.
// 설계 결정 근거는 db/init.sql의 ip_blocklist 테이블 주석 참고 - 여기서는 그 결정을 그대로
// API로 구현: 관리자가 IP+사유+기간을 등록하면 was/middleware/ipBlocklist.js가 이후 모든
// 요청에서 걸러낸다.
const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");
const { invalidateCache } = require("../middleware/ipBlocklist");
const { logAudit } = require("../audit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// 엄격한 검증(정확한 IPv4/IPv6 파서)까지는 필요 없음 - 어차피 관리자만 쓰는 내부 도구고,
// 형식이 심하게 틀린 값(빈 문자열, 임의 텍스트)만 걸러내면 충분하다.
const IP_PATTERN = /^[0-9a-fA-F:.]{3,45}$/;

const DURATION_MS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  permanent: null,
};

router.get("/", requirePermission("security:manage"), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.id, b.ip, b.reason, b.blocked_at, b.expires_at, p.username AS blocked_by_username
     FROM ip_blocklist b LEFT JOIN patients p ON p.id = b.blocked_by
     ORDER BY b.blocked_at DESC`
  );
  res.json(rows);
}));

router.post("/", verifyCsrfToken, requirePermission("security:manage"), asyncHandler(async (req, res) => {
  const { ip, reason, duration } = req.body;
  if (!ip || typeof ip !== "string" || !IP_PATTERN.test(ip)) {
    return res.status(400).json({ message: "IP 형식이 올바르지 않습니다." });
  }
  if (!Object.prototype.hasOwnProperty.call(DURATION_MS, duration)) {
    return res.status(400).json({ message: "duration 값이 올바르지 않습니다 (1h/24h/7d/permanent)." });
  }
  // 관리자 본인이 지금 접속 중인 IP를 실수로 차단하면 스스로를 잠그게 되므로 원천 차단.
  if (ip === req.ip) {
    return res.status(400).json({ message: "현재 접속 중인 IP는 차단할 수 없습니다." });
  }

  const ms = DURATION_MS[duration];
  const expiresAt = ms === null ? null : new Date(Date.now() + ms);

  // 이미 차단돼 있던 IP를 다시 등록하면(예: 기간 연장) 새 사유/기간으로 덮어쓴다.
  await pool.query(
    `INSERT INTO ip_blocklist (ip, reason, blocked_by, expires_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), blocked_by = VALUES(blocked_by),
       blocked_at = CURRENT_TIMESTAMP, expires_at = VALUES(expires_at)`,
    [ip, reason || null, req.session.patientId, expiresAt]
  );
  invalidateCache();

  // [2026-09-16] "조치 결과를 감사 로그에 기록" 요구사항은 별도 기능이 아니라 여기 한 줄로
  // 흡수(INCIDENT_RESPONSE.md 4번 표 "IP/계정 블랙리스트" 항목 결정과 동일한 판단) - 차단 행위
  // 자체가 감사 대상이므로, 차단 기능을 만들면서 자연히 같이 해결된다. ip는 관례대로 "이 요청을
  // 보낸 사람"(관리자 본인)의 IP, 실제로 차단된 대상은 detail.targetIp로 구분한다 - 대시보드의
  // IP 전용 컬럼과 의미가 헷갈리지 않게 하기 위함.
  await logAudit(req.session.patientId, "ip_blocked", "ip_blocklist", null, {
    targetIp: ip,
    reason: reason || null,
    duration,
    ip: req.ip,
    path: req.originalUrl,
  });

  res.json({ success: true });
}));

router.delete("/:id", verifyCsrfToken, requirePermission("security:manage"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "id가 올바르지 않습니다." });
  }
  const [rows] = await pool.query("SELECT ip FROM ip_blocklist WHERE id = ?", [id]);
  if (rows.length === 0) {
    return res.status(404).json({ message: "차단 기록을 찾을 수 없습니다." });
  }
  await pool.query("DELETE FROM ip_blocklist WHERE id = ?", [id]);
  invalidateCache();

  await logAudit(req.session.patientId, "ip_unblocked", "ip_blocklist", id, {
    targetIp: rows[0].ip,
    ip: req.ip,
    path: req.originalUrl,
  });

  res.json({ success: true });
}));

module.exports = router;
