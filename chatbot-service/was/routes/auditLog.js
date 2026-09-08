const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");

const router = express.Router();

// 최신순 페이지네이션. limit은 남용 방지를 위해 100으로 상한.
router.get("/", requirePermission("audit:view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT al.id, al.actor_id, p.username AS actor_username, al.action, al.target_type, al.target_id, al.detail, al.created_at
     FROM audit_log al LEFT JOIN patients p ON p.id = al.actor_id
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json(rows);
});

module.exports = router;
