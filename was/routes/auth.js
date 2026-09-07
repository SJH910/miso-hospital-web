const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const { encryptRrn } = require("../crypto-utils");
const { logAudit } = require("../audit");

const router = express.Router();

// [보안 강화 #6 Rate Limiting] 로그인 엔드포인트는 15분 내 5회로 제한.
// IP 단위로 카운트하며, 초과 시 429 응답. 브루트포스/자동화 공격 방어.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    // [보안 강화 #1 SQL Injection] Prepared Statement로 입력값을 쿼리 구조와 분리.
    const [rows] = await pool.query(
      "SELECT * FROM patients WHERE username = ?",
      [username]
    );
    const patient = rows[0];

    // [보안 강화 #8 평문 비밀번호] bcrypt.compare로 해시 비교 (평문 비교 금지).
    // 계정이 없을 때도 동일한 시간이 걸리도록 더미 해시와 비교해 타이밍 공격 방지.
    const hashToCompare = patient ? patient.password : "$2b$10$invalidsaltinvalidsaltinvalidsaltinvalidsalt";
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!patient || !passwordMatches) {
      logAudit(patient ? patient.id : null, "login_fail", "patients", patient ? patient.id : null, { username });
      return res.status(401).json({ success: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    // [보안 강화 #4 세션 관리] 세션 고정 공격 방지를 위해 로그인 성공 시 세션 ID 재발급.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ success: false, message: "로그인 처리 중 오류가 발생했습니다." });
      req.session.patientId = patient.id;
      req.session.patientName = patient.name;
      req.session.role = patient.role;
      // [보안 강화 #5 CSRF] 로그인 시 CSRF 토큰 발급. 이후 상태 변경 요청(POST 등)마다 이 값을 헤더로 첨부해야 함.
      req.session.csrfToken = crypto.randomBytes(24).toString("hex");
      logAudit(patient.id, "login_success", "patients", patient.id, { username });
      res.json({
        success: true,
        patient: { id: patient.id, name: patient.name, role: patient.role },
        csrfToken: req.session.csrfToken,
      });
    });
  } catch (err) {
    // [보안 강화 #7-b 정보 노출] 상세 에러는 서버 로그에만 남기고, 응답은 일반 메시지만 반환.
    console.error("[login error]", err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

router.post("/signup", async (req, res) => {
  const { username, password, name, rrn } = req.body;

  if (!username || !password || !name || !rrn) {
    return res.status(400).json({ success: false, message: "모든 항목을 입력해주세요." });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id FROM patients WHERE username = ?",
      [username]
    );

    // [보안 강화 #10 User Enumeration] 아이디 존재 여부를 노출하지 않도록,
    // 중복 시에도 로그인 실패와 동일하게 일반적인 메시지만 반환.
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "가입 처리 중 문제가 발생했습니다. 입력값을 확인해주세요." });
    }

    // [보안 강화 #8 평문 비밀번호] bcrypt로 단방향 해시 처리 후 저장.
    const hashedPassword = await bcrypt.hash(password, 12);

    // [보안 강화 #9 주민번호 미암호화] AES-256-GCM으로 암호화 후 저장 (평문 저장 금지).
    const encryptedRrn = encryptRrn(rrn);

    const [result] = await pool.query(
      "INSERT INTO patients (username, password, name, rrn) VALUES (?, ?, ?, ?)",
      [username, hashedPassword, name, encryptedRrn]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("[signup error]", err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

// 현재 세션의 로그인 사용자 정보 반환
router.get("/me", (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  res.json({
    id: req.session.patientId,
    name: req.session.patientName,
    role: req.session.role,
    csrfToken: req.session.csrfToken,
  });
});

// [보안 강화 #4 세션 관리] 로그아웃 시 세션을 서버에서 완전히 파기.
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: "로그아웃 처리 중 오류가 발생했습니다." });
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

module.exports = router;
