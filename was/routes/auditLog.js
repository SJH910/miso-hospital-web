const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");

const router = express.Router();

const VALID_RISK_LEVELS = ["low", "medium", "high"];

// 최신순 페이지네이션. limit은 남용 방지를 위해 100으로 상한.
// ?risk=high 처럼 위험도로 필터링 가능 - 운영 중 "상 등급만 훑어보기" 같은 용도.
router.get("/", requirePermission("audit:view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { risk } = req.query;

  if (risk && !VALID_RISK_LEVELS.includes(risk)) {
    return res.status(400).json({ message: "risk 값이 올바르지 않습니다 (low/medium/high)." });
  }

  const whereClause = risk ? "WHERE al.risk_level = ?" : "";
  const params = risk ? [risk, limit, offset] : [limit, offset];

  const [rows] = await pool.query(
    `SELECT al.id, al.actor_id, p.username AS actor_username, al.action, al.target_type, al.target_id, al.detail, al.risk_level, al.created_at
     FROM audit_log al LEFT JOIN patients p ON p.id = al.actor_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
  res.json(rows);
});

module.exports = router;
