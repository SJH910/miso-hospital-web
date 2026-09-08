const express = require("express");
const pool = require("../db");
const { hasPermission } = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");

const router = express.Router();

// staff는 진료기록을 열람만 하고 수정은 못 한다 — diagnosis/treatment를 마스킹해서 내려준다.
function maskRecord(record) {
  return {
    ...record,
    diagnosis: record.diagnosis ? record.diagnosis.slice(0, 2) + "***" : record.diagnosis,
    treatment: record.treatment ? "***" : record.treatment,
  };
}

// patient는 본인 것만(records:view:own), staff는 마스킹해서 전체(records:view:masked),
// admin은 전체를 그대로(records:view:full) 본다. 세 권한 중 하나도 없으면 403.
router.get("/", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  const role = req.session.role;
  const canViewFull = await hasPermission(role, "records:view:full");
  const canViewMasked = await hasPermission(role, "records:view:masked");
  const canViewOwn = await hasPermission(role, "records:view:own");

  const baseQuery = `SELECT mr.id, mr.patient_id, p.name AS patient_name, mr.diagnosis, mr.treatment, mr.created_at
                      FROM medical_records mr JOIN patients p ON p.id = mr.patient_id`;

  if (canViewFull) {
    const [rows] = await pool.query(`${baseQuery} ORDER BY mr.created_at DESC`);
    return res.json(rows);
  }

  if (canViewMasked) {
    const [rows] = await pool.query(`${baseQuery} ORDER BY mr.created_at DESC`);
    return res.json(rows.map(maskRecord));
  }

  if (canViewOwn) {
    const [rows] = await pool.query(
      `${baseQuery} WHERE mr.patient_id = ? ORDER BY mr.created_at DESC`,
      [req.session.patientId]
    );
    return res.json(rows);
  }

  return res.status(403).json({ message: "권한이 없습니다." });
});

router.post("/", verifyCsrfToken, async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  if (!(await hasPermission(req.session.role, "records:write"))) {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  const { patient_id, diagnosis, treatment } = req.body;
  if (!patient_id || !diagnosis || typeof diagnosis !== "string") {
    return res.status(400).json({ message: "환자와 진단 내용을 확인해주세요." });
  }

  const [result] = await pool.query(
    "INSERT INTO medical_records (patient_id, written_by, diagnosis, treatment) VALUES (?, ?, ?, ?)",
    [patient_id, req.session.patientId, diagnosis, treatment || null]
  );
  res.json({ id: result.insertId, patient_id, written_by: req.session.patientId, diagnosis, treatment });
});

module.exports = router;
