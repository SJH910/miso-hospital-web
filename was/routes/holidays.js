const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");

const router = express.Router();

// 조회는 로그인한 누구나 가능하게 둔다 - 예약 화면/챗봇이 "이 날짜는 휴진입니다"를
// 미리 안내하려면 환자도 이 목록을 볼 수 있어야 하므로 (등록/삭제만 관리자 전용).
router.get("/", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const [rows] = await pool.query(
    "SELECT id, holiday_date, reason FROM holidays ORDER BY holiday_date"
  );
  res.json(rows);
});

router.post("/", verifyCsrfToken, requirePermission("holidays:manage"), async (req, res) => {
  const { holiday_date, reason } = req.body;
  if (!holiday_date || Number.isNaN(new Date(holiday_date).getTime())) {
    return res.status(400).json({ message: "날짜를 확인해주세요." });
  }
  if (!reason || typeof reason !== "string" || reason.length > 100) {
    return res.status(400).json({ message: "사유를 확인해주세요." });
  }
  try {
    const [result] = await pool.query(
      "INSERT INTO holidays (holiday_date, reason) VALUES (?, ?)",
      [holiday_date, reason]
    );
    res.json({ id: result.insertId, holiday_date, reason });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "이미 등록된 날짜입니다." });
    }
    console.error("[holidays] 등록 실패:", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

router.delete("/:id", verifyCsrfToken, requirePermission("holidays:manage"), async (req, res) => {
  const [result] = await pool.query("DELETE FROM holidays WHERE id = ?", [req.params.id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "해당 휴진일을 찾을 수 없습니다." });
  }
  res.json({ id: Number(req.params.id) });
});

module.exports = router;
