const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { hasPermission } = requirePermission;
const { verifyCsrfToken } = require("../middleware/csrf");

const router = express.Router();

const VALID_STATUSES = ["requested", "confirmed", "cancelled"];

// [운영시간 검증] chatbot-service/hospital_agent.py의 is_within_business_hours()와
// 반드시 동일한 기준을 유지할 것 — 챗봇을 거치든(Python) API를 직접 호출하든(이 파일)
// 같은 규칙으로 막아야 우회가 안 생긴다. 평일 09:00~18:00, 토요일 09:00~13:00, 일요일 휴진,
// 그리고 holidays 테이블에 등록된 날짜(공휴일/병원 자체 휴진일)도 휴진으로 처리한다.
const BUSINESS_HOURS_NOTICE =
  "평일은 오전 9시~오후 6시, 토요일은 오전 9시~오후 1시까지 진료합니다 (일요일·공휴일 휴진).";

async function isWithinBusinessHours(date) {
  const day = date.getDay(); // 0=일 ... 6=토
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (day === 0) return false; // 일요일 휴진

  // YYYY-MM-DD 형식으로 맞춰서 holidays.holiday_date와 비교 (시간대 영향 없이 날짜만 비교)
  const dateOnly = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const [rows] = await pool.query("SELECT 1 FROM holidays WHERE holiday_date = ?", [dateOnly]);
  if (rows.length > 0) return false; // 공휴일/병원 휴진일

  if (day === 6) return minutes >= 9 * 60 && minutes <= 13 * 60; // 토요일 09:00~13:00
  return minutes >= 9 * 60 && minutes <= 18 * 60; // 평일 09:00~18:00
}

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

const MAX_RESERVATIONS_PER_SLOT = 2;

router.post("/", verifyCsrfToken, requirePermission("reservations:create"), async (req, res) => {
  const { department, reserved_at } = req.body;
  if (!department || typeof department !== "string" || department.length > 50) {
    return res.status(400).json({ message: "진료과를 확인해주세요." });
  }
  const reservedAt = new Date(reserved_at);
  if (Number.isNaN(reservedAt.getTime())) {
    return res.status(400).json({ message: "예약 일시를 확인해주세요." });
  }

  if (!(await isWithinBusinessHours(reservedAt))) {
    return res.status(400).json({ message: `요청하신 시간은 병원 운영시간이 아닙니다. ${BUSINESS_HOURS_NOTICE}` });
  }

  // 같은 시간대(reserved_at)에 취소되지 않은 예약이 이미 정원(2명)만큼 있으면 거부.
  const [[{ count }]] = await pool.query(
    "SELECT COUNT(*) AS count FROM reservations WHERE reserved_at = ? AND status != 'cancelled'",
    [reservedAt]
  );
  if (count >= MAX_RESERVATIONS_PER_SLOT) {
    return res.status(409).json({ message: "해당 시간대는 예약이 마감되었습니다." });
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
