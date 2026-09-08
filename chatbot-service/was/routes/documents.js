const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");

const router = express.Router();

const MAX_TEXT_LENGTH = 8000;
const ALLOWED_DOCUMENT_TYPES = ["prescription", "diagnosis", "receipt"];
const DOCUMENT_TYPE_LABELS = { prescription: "처방전", diagnosis: "진단서", receipt: "영수증" };

// 이 라벨이 포함된 줄은 parsed_fields에 절대 담지 않는다 (민감정보가 새 컬럼에 한 번 더 복제되는 것을 막기 위함).
// extracted_text(원문)에는 여전히 남아있지만, 그건 기존과 동일하게 API 응답에 포함되지 않는다.
const SENSITIVE_LABEL_KEYWORDS = ["주민등록번호", "연락처", "전화번호", "휴대폰", "카드번호", "계좌번호"];
const MAX_PARSED_FIELDS = 30;

// OCR 원문에서 날짜/금액을 정규식으로 뽑아내는 best-effort 파서.
// OCR 인식 오류가 그대로 오파싱으로 이어질 수 있으므로 참고용 데이터로만 취급해야 한다.
function parseDate(text) {
  const isoMatch = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const koreanMatch = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (koreanMatch) {
    const [, y, m, d] = koreanMatch;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(text) {
  const match = text.match(/([\d,]{1,12})\s*원/);
  if (!match) return null;
  const amount = parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(amount) ? amount : null;
}

// OCR 원문을 줄 단위로 훑어서 "라벨 : 값" 형태의 줄만 키-값으로 뽑아내는 best-effort 파서.
// 콜론이 없는 줄(안내문구, 깨진 OCR 잡음 등)은 애초에 매칭이 안 되어 자연스럽게 제외된다.
function parseLabeledFields(text, knownFields) {
  const fields = { ...knownFields };
  const lines = text.split("\n");

  for (const line of lines) {
    if (Object.keys(fields).length >= MAX_PARSED_FIELDS) break;

    const match = line.match(/^\s*(.{1,20}?)\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;

    const [, rawLabel, value] = match;
    const label = rawLabel.trim();
    if (!label || !value) continue;
    // 이미 확정된 값(문서종류/환자명)은 OCR 원문에 같은 라벨의 줄이 있어도 덮어쓰지 않는다 -> 신뢰할 수 있는 값이 우선
    if (Object.prototype.hasOwnProperty.call(knownFields, label)) continue;
    if (SENSITIVE_LABEL_KEYWORDS.some((keyword) => label.includes(keyword))) continue;

    fields[label] = value;
  }

  return fields;
}

// 관리자가 OCR 결과를 확인/수정한 뒤 저장 버튼을 눌렀을 때 호출됨.
// /api/ocr은 추출 전용으로 남겨두고 저장은 이 엔드포인트로 분리했다 —
// 관리자가 오인식된 텍스트를 고칠 기회를 준 뒤 최종본만 저장하기 위함.
router.post("/", verifyCsrfToken, requirePermission("documents:create"), async (req, res) => {
  const { patient_id, document_type, text } = req.body;
  const trimmedText = typeof text === "string" ? text.trim() : "";

  if (!patient_id || !trimmedText) {
    return res.status(400).json({ message: "환자를 선택하고 텍스트를 입력해주세요." });
  }
  if (!ALLOWED_DOCUMENT_TYPES.includes(document_type)) {
    return res.status(400).json({ message: "문서 종류를 선택해주세요." });
  }

  try {
    // patient_id가 실제 환자(role='patient')를 가리키는지 확인 -> 존재하지 않는 id나 admin 계정에 잘못 연결되는 것 방지
    const [patientRows] = await pool.query(
      "SELECT id, name FROM patients WHERE id = ? AND role = 'patient'",
      [patient_id]
    );
    if (patientRows.length === 0) {
      return res.status(400).json({ message: "존재하지 않는 환자입니다." });
    }

    const finalText = trimmedText.slice(0, MAX_TEXT_LENGTH);
    const parsedDate = parseDate(finalText);
    const parsedAmount = parseAmount(finalText);
    // "문서 종류"/"환자명"은 OCR로 다시 추측하지 않고 이미 확정된 값(관리자 선택, DB의 실제 환자명)을 그대로 채운다.
    const parsedFields = parseLabeledFields(finalText, {
      "문서 종류": DOCUMENT_TYPE_LABELS[document_type],
      "환자명": patientRows[0].name,
    });

    const [result] = await pool.query(
      `INSERT INTO scanned_documents (patient_id, scanned_by, document_type, extracted_text, parsed_date, parsed_amount, parsed_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, req.session.patientId, document_type, finalText, parsedDate, parsedAmount, JSON.stringify(parsedFields)]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    console.error("[documents save error]", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// 저장된 스캔 문서 목록 — 관리자 전용. OCR 원문(extracted_text)/parsed_fields는 응답에 아예 포함하지 않는다
// (화면에서 숨기는 게 아니라 서버가 애초에 내려보내지 않음 -> 클라이언트 실수로 노출될 여지 자체를 없앰).
// 환자용 조회 라우트도 만들지 않는다 (board.js가 IDOR을 막기 위해 소유권을 검증하는 것과 같은 맥락으로,
// 애초에 환자가 접근할 수 있는 경로 자체를 두지 않는 편이 더 안전함).
router.get("/", requirePermission("documents:view"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sd.id, sd.patient_id, p.name AS patient_name, sd.document_type, sd.created_at
       FROM scanned_documents sd
       JOIN patients p ON p.id = sd.patient_id
       ORDER BY sd.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("[documents list error]", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// ── 환자용 "내 진료기록(스캔 문서)" 조회 ────────────────────────────
// requirePermission 없이 로그인 여부 + 본인 소유 여부만 확인 (쿼리 자체에 patient_id 포함 - IDOR 방지).
// 챗봇의 진료기록 조회 도구(tools_db.py check_medical_records)가 안내하는 /records.html이
// 이 API(및 /api/records - medical_records 테이블)를 함께 사용해 화면을 구성한다.
router.get("/mine", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const [rows] = await pool.query(
    `SELECT id, document_type, parsed_date, parsed_amount, created_at
     FROM scanned_documents
     WHERE patient_id = ?
     ORDER BY created_at DESC`,
    [req.session.patientId]
  );
  res.json(rows.map((r) => ({ ...r, document_type_label: DOCUMENT_TYPE_LABELS[r.document_type] })));
});

router.get("/mine/:id", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const [rows] = await pool.query(
    `SELECT id, document_type, extracted_text, parsed_date, parsed_amount, parsed_fields, created_at
     FROM scanned_documents
     WHERE id = ? AND patient_id = ?`,
    [req.params.id, req.session.patientId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ message: "해당 기록을 찾을 수 없습니다." });
  }
  const doc = rows[0];
  res.json({ ...doc, document_type_label: DOCUMENT_TYPE_LABELS[doc.document_type] });
});

module.exports = router;
