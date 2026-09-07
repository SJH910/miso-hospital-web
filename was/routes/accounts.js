const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");
const { encryptRrn } = require("../crypto-utils");
const { logAudit } = require("../audit");

const router = express.Router();

// 전체 계정 목록. password(해시)/rrn(암호문)은 관리 화면에도 필요 없는 값이라 응답에서 제외.
router.get("/", requirePermission("accounts:manage"), async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, username, name, role FROM patients ORDER BY id"
  );
  res.json(rows);
});

// staff/admin이 환자를 대신 등록. role은 항상 'patient'로 고정 — staff가 admin 계정을
// 만들 수는 없어야 하므로, 역할을 바꾸는 accounts:manage와는 별개 권한(patients:register)으로 분리.
router.post("/", verifyCsrfToken, requirePermission("patients:register"), async (req, res) => {
  const { username, password, name, rrn } = req.body;

  if (!username || !password || !name || !rrn) {
    return res.status(400).json({ message: "모든 항목을 입력해주세요." });
  }

  const [existing] = await pool.query("SELECT id FROM patients WHERE username = ?", [username]);
  if (existing.length > 0) {
    return res.status(400).json({ message: "등록 처리 중 문제가 발생했습니다. 입력값을 확인해주세요." });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const encryptedRrn = encryptRrn(rrn);

  const [result] = await pool.query(
    "INSERT INTO patients (username, password, name, rrn, role) VALUES (?, ?, ?, ?, 'patient')",
    [username, hashedPassword, name, encryptedRrn]
  );
  logAudit(req.session.patientId, "patient_register", "patients", result.insertId, { username });
  res.json({ id: result.insertId, username, name, role: "patient" });
});

// [보안 강화 #5 CSRF] 상태 변경 요청(PATCH)에 CSRF 토큰 검증 미들웨어 적용.
router.patch("/:id/role", verifyCsrfToken, requirePermission("accounts:manage"), async (req, res) => {
  const targetId = Number(req.params.id);
  const { role } = req.body;

  if (!["patient", "staff", "admin"].includes(role)) {
    return res.status(400).json({ message: "role 값이 올바르지 않습니다." });
  }

  // 마지막 admin이 실수로 스스로를 강등시켜 아무도 계정을 관리할 수 없게 되는 상황 방지.
  if (targetId === req.session.patientId && role !== "admin") {
    return res.status(400).json({ message: "자기 자신의 관리자 권한은 낮출 수 없습니다." });
  }

  const [before] = await pool.query("SELECT role FROM patients WHERE id = ?", [targetId]);
  const [result] = await pool.query(
    "UPDATE patients SET role = ? WHERE id = ?",
    [role, targetId]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "계정을 찾을 수 없습니다." });
  }

  logAudit(req.session.patientId, "account_role_change", "patients", targetId, {
    from: before[0]?.role,
    to: role,
  });
  res.json({ id: targetId, role });
});

module.exports = router;
