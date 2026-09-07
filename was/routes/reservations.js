const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { hasPermission } = requirePermission;
const { verifyCsrfToken } = require("../middleware/csrf");

const router = express.Router();

const VALID_STATUSES = ["requested", "confirmed", "cancelled"];

// patient는 본인 예약만, staff/admin(reservations:manage)은 전체 예약을 본다.
// 두 권한 중 하나라도 있으면 통과시키고, 실제 조회 범위는 권한에 따라 쿼리에서 분기한다.
async function requireReservationView(req, res, next) {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  next();
}

router.get("/", requireReservationView, async (req, res) => {
  const canManage = await hasPermission(req.session.role, "reservations:manage");
  const canViewOwn = await hasPermission(req.session.role, "reservations:view:own");

  if (canManage) {
    const [rows] = await pool.query(
      `SELECT r.id, r.patient_id, p.name AS patient_name, r.department, r.reserved_at, r.status
       FROM reservations r JOIN patients p ON p.id = r.patient_id
       ORDER BY r.reserved_at DESC`
    );
    return res.json(rows);
  }

  if (canViewOwn) {
    const [rows] = await pool.query(
      "SELECT id, patient_id, department, reserved_at, status FROM reservations WHERE patient_id = ? ORDER BY reserved_at DESC",
      [req.session.patientId]
    );
    return res.json(rows);
  }

  return res.status(403).json({ message: "권한이 없습니다." });
});

router.post("/", verifyCsrfToken, requirePermission("reservations:create"), async (req, res) => {
  const { department, reserved_at } = req.body;
  if (!department || typeof department !== "string" || department.length > 50) {
    return res.status(400).json({ message: "진료과를 확인해주세요." });
  }
  const reservedAt = new Date(reserved_at);
  if (Number.isNaN(reservedAt.getTime())) {
    return res.status(400).json({ message: "예약 일시를 확인해주세요." });
  }

  // patient_id는 body가 아니라 세션에서만 가져온다 (IDOR 방지 — 다른 환자 명의로 예약 생성 불가).
  const [result] = await pool.query(
    "INSERT INTO reservations (patient_id, department, reserved_at) VALUES (?, ?, ?)",
    [req.session.patientId, department, reservedAt]
  );
  res.json({ id: result.insertId, patient_id: req.session.patientId, department, reserved_at: reservedAt, status: "requested" });
});

router.patch("/:id/status", verifyCsrfToken, requirePermission("reservations:manage"), async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ message: "status 값이 올바르지 않습니다." });
  }

  const [result] = await pool.query(
    "UPDATE reservations SET status = ? WHERE id = ?",
    [status, req.params.id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "예약을 찾을 수 없습니다." });
  }
  res.json({ id: Number(req.params.id), status });
});

module.exports = router;
