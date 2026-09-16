const express = require("express");
const pool = require("../db");
const { verifyCsrfToken } = require("../middleware/csrf");
const { logAudit } = require("../audit");
const { generateTotpSecret, verifyTotpCode, buildOtpAuthUri } = require("../totp-utils");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

function requireAdminSession(req, res, next) {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ message: "관리자만 이용할 수 있습니다." });
  }
  next();
}

router.use(requireAdminSession);

// 현재 등록 여부만 알려줌 (비밀키 자체는 절대 다시 내려주지 않음)
router.get("/status", asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT totp_secret FROM patients WHERE id = ?", [req.session.patientId]);
  res.json({ enabled: !!rows[0]?.totp_secret });
}));

// 1단계: 새 비밀키를 생성해서 "아직 저장하지 않고" 클라이언트에 보여준다.
// 클라이언트가 이 값을 인증 앱에 입력한 뒤, 앱이 만든 코드로 /verify-setup을 호출해야
// 실제 DB에 저장된다 - 등록 과정에서 오타/스캔 실패로 망가진 비밀키가 그대로 저장되는 것을 방지.
router.post("/setup", verifyCsrfToken, (req, res) => {
  const secret = generateTotpSecret();
  const otpauthUri = buildOtpAuthUri(secret, req.session.patientName || `patient${req.session.patientId}`);
  res.json({ secret, otpauthUri });
});

router.post("/verify-setup", verifyCsrfToken, asyncHandler(async (req, res) => {
  const { secret, code } = req.body;
  if (!secret || !verifyTotpCode(secret, code)) {
    return res.status(400).json({ success: false, message: "인증 코드가 올바르지 않습니다. 다시 시도해주세요." });
  }
  await pool.query("UPDATE patients SET totp_secret = ? WHERE id = ?", [secret, req.session.patientId]);
  await logAudit(req.session.patientId, "totp_enrolled", "patients", req.session.patientId, { ip: req.ip, path: req.originalUrl });
  res.json({ success: true });
}));

// 해제 (분실 등으로 재등록이 필요할 때) - 본인만 가능
router.delete("/", verifyCsrfToken, asyncHandler(async (req, res) => {
  await pool.query("UPDATE patients SET totp_secret = NULL WHERE id = ?", [req.session.patientId]);
  await logAudit(req.session.patientId, "totp_disabled", "patients", req.session.patientId, { ip: req.ip, path: req.originalUrl });
  res.json({ success: true });
}));

module.exports = router;
