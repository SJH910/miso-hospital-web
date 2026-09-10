const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");
const { encryptBuffer, decryptBuffer } = require("../crypto-utils");

const router = express.Router();

const MAX_TEXT_LENGTH = 8000;
const ALLOWED_DOCUMENT_TYPES = ["prescription", "diagnosis", "receipt"];
const DOCUMENT_TYPE_LABELS = { prescription: "처방전", diagnosis: "진단서", receipt: "영수증" };

// scanned-images/ — 암호화된 원본 이미지 저장 위치. secret.key/chatbot_logs.db와 같은 패턴으로
// 프로젝트 루트에 두고 .gitignore로 제외(민감한 의료 이미지라 git에 올리면 안 됨).
const IMAGE_DIR = path.join(__dirname, "..", "..", "scanned-images");
fs.mkdirSync(IMAGE_DIR, { recursive: true });

// ocr.js와 동일한 매직 바이트 검증 — 이 라우트로 오는 이미지도 클라이언트가 보낸 걸 그대로
// 믿지 않고 다시 검증한다(같은 파일이 재전송되는 거라 원칙적으로 이미 검증된 것이지만,
// 이 엔드포인트를 직접 호출하는 경로도 있을 수 있으므로 방어적으로 재확인).
// 복호화한 이미지를 브라우저가 바로 렌더링할 수 있도록, 매직 바이트로 실제 형식을 판별해
// Content-Type을 맞춰준다(저장 전 isAllowedImage를 통과한 것만 저장되므로 셋 중 하나로 판정됨).
function detectImageContentType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  return "image/webp";
}

function isAllowedImage(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  const isWebp =
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  return isJpeg || isPng || isWebp;
}

// 이미지도 메모리 버퍼로만 받는다(디스크 미기록 원칙은 그대로 유지 — 암호화해서 저장하는 건
// 이 핸들러가 명시적으로 하는 것이지, multer가 임의 위치에 평문으로 남기지 않는다는 점이 중요).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

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
// [2026-09-10] 원본 이미지도 함께 받아 암호화 후 저장하도록 확장 — 이전엔 JSON만 받고 이미지는
// /api/ocr 단계에서 버려졌는데, "원본 재조회 필요" 결정에 따라 저장 확정 시점(여기)에 같이 보냄.
// 이미지는 선택 사항으로 유지 — 없어도 텍스트만으로 기존처럼 저장 가능(하위 호환).
router.post("/", verifyCsrfToken, requirePermission("documents:create"), (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: "이미지 파일(5MB 이하) 1장만 첨부할 수 있습니다." });
    }
    if (err) {
      return res.status(400).json({ message: "업로드 처리 중 오류가 발생했습니다." });
    }

    const { patient_id, document_type, text } = req.body;
    const trimmedText = typeof text === "string" ? text.trim() : "";

    if (!patient_id || !trimmedText) {
      return res.status(400).json({ message: "환자를 선택하고 텍스트를 입력해주세요." });
    }
    if (!ALLOWED_DOCUMENT_TYPES.includes(document_type)) {
      return res.status(400).json({ message: "문서 종류를 선택해주세요." });
    }
    if (req.file && !isAllowedImage(req.file.buffer)) {
      return res.status(400).json({ message: "지원하지 않는 이미지 형식입니다. (JPEG/PNG/WEBP만 허용)" });
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

      // 이미지가 첨부됐으면 암호화해서 파일로 저장 — 파일명은 원본과 무관한 랜덤값
      // (파일명만 보고 어떤 문서인지 유추할 수 없게).
      let imagePath = null;
      if (req.file) {
        imagePath = `${crypto.randomBytes(16).toString("hex")}.enc`;
        fs.writeFileSync(path.join(IMAGE_DIR, imagePath), encryptBuffer(req.file.buffer));
      }

      const [result] = await pool.query(
        `INSERT INTO scanned_documents (patient_id, scanned_by, document_type, extracted_text, parsed_date, parsed_amount, parsed_fields, image_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [patient_id, req.session.patientId, document_type, finalText, parsedDate, parsedAmount, JSON.stringify(parsedFields), imagePath]
      );
      res.json({ id: result.insertId, hasImage: Boolean(imagePath) });
    } catch (err) {
      console.error("[documents save error]", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  });
});

// 저장된 스캔 문서 목록 — 관리자 전용. OCR 원문(extracted_text)/parsed_fields는 응답에 아예 포함하지 않는다
// (화면에서 숨기는 게 아니라 서버가 애초에 내려보내지 않음 -> 클라이언트 실수로 노출될 여지 자체를 없앰).
// 환자용 조회 라우트도 만들지 않는다 (board.js가 IDOR을 막기 위해 소유권을 검증하는 것과 같은 맥락으로,
// 애초에 환자가 접근할 수 있는 경로 자체를 두지 않는 편이 더 안전함).
router.get("/", requirePermission("documents:view"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sd.id, sd.patient_id, p.name AS patient_name, sd.document_type, sd.created_at,
              (sd.image_path IS NOT NULL) AS hasImage
       FROM scanned_documents sd
       JOIN patients p ON p.id = sd.patient_id
       ORDER BY sd.created_at DESC`
    );
    res.json(rows.map((r) => ({ ...r, hasImage: Boolean(r.hasImage) })));
  } catch (err) {
    console.error("[documents list error]", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// image_path(파일명)를 복호화해서 이미지 바이트로 응답 — 관리자용/환자 본인용 두 라우트가
// "누구 것을 볼 수 있는가"(권한/소유권 검증)만 다르고 그 이후 처리는 동일하므로 공통화.
async function sendImage(res, imagePath) {
  if (!imagePath) {
    return res.status(404).json({ message: "저장된 원본 이미지가 없습니다." });
  }
  // imagePath는 이 라우트가 직접 만든 랜덤 16진수 파일명(crypto.randomBytes(16).toString("hex") + ".enc")만
  // 저장되므로 경로 조작 문자가 들어올 수 없지만, 혹시 모를 변형에 대비해 파일명 형식을 한 번 더 검증한다.
  if (!/^[0-9a-f]{32}\.enc$/.test(imagePath)) {
    return res.status(500).json({ message: "잘못된 이미지 참조입니다." });
  }
  const encrypted = fs.readFileSync(path.join(IMAGE_DIR, imagePath));
  const decrypted = decryptBuffer(encrypted);
  res.set("Content-Type", detectImageContentType(decrypted));
  res.send(decrypted);
}

// 저장된 원본 이미지 조회 — 관리자 전용(다른 환자 것도 포함해 전체 조회 가능).
router.get("/:id/image", requirePermission("documents:view"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT image_path FROM scanned_documents WHERE id = ?",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "저장된 원본 이미지가 없습니다." });
    }
    await sendImage(res, rows[0].image_path);
  } catch (err) {
    console.error("[documents image error]", err);
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
    `SELECT id, document_type, extracted_text, parsed_date, parsed_amount, parsed_fields, created_at,
            (image_path IS NOT NULL) AS hasImage
     FROM scanned_documents
     WHERE id = ? AND patient_id = ?`,
    [req.params.id, req.session.patientId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ message: "해당 기록을 찾을 수 없습니다." });
  }
  const doc = rows[0];
  res.json({ ...doc, hasImage: Boolean(doc.hasImage), document_type_label: DOCUMENT_TYPE_LABELS[doc.document_type] });
});

// [2026-09-10] 환자 본인의 원본 이미지 조회 — "OCR 원문 재조회" 결정에서 admin만 대상이었던
// 범위를 환자 본인 것까지 확장. requirePermission이 아니라 /mine/:id와 동일하게 세션의
// patientId로 소유권을 직접 검증(WHERE ... AND patient_id = ?) — documents:view 권한을 그대로
// 환자에게 주면 다른 환자 문서까지 전부 보이게 되므로, 권한 부여가 아니라 소유자 스코핑으로 해결.
router.get("/mine/:id/image", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  try {
    const [rows] = await pool.query(
      "SELECT image_path FROM scanned_documents WHERE id = ? AND patient_id = ?",
      [req.params.id, req.session.patientId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "저장된 원본 이미지가 없습니다." });
    }
    await sendImage(res, rows[0].image_path);
  } catch (err) {
    console.error("[documents mine image error]", err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
