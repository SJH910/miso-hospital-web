const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");

const router = express.Router();

// 관리자가 스캔 문서를 연결할 환자를 고르는 드롭다운용 목록.
// rrn(암호화되어 있어도) 같은 민감정보는 절대 포함하지 않는다.
router.get("/", requirePermission("patients:view"), async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, username, name FROM patients WHERE role = 'patient' ORDER BY id"
  );
  res.json(rows);
});

module.exports = router;
