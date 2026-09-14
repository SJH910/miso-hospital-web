const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { createWorker } = require("tesseract.js");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");
const { parseItemTable, parseDisplayFields } = require("../document-parsing");

const router = express.Router();

// 디스크에 절대 쓰지 않고 메모리 버퍼로만 처리한다.
// (경로 조작/웹쉘 업로드 같은 "저장된 파일" 계열 취약점을 애초에 성립 불가능하게 만드는 설계)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// OCR은 CPU 비용이 커서 남용 시 서버 전체가 느려질 수 있다.
// 로그인 사용자 단위(비로그인은 IP 단위)로 분당 요청 수를 제한한다.
const ocrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.session && req.session.patientId ? `patient:${req.session.patientId}` : req.ip),
  message: { message: "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요." },
});

// 클라이언트가 보내는 Content-Type/확장자는 위조 가능하므로 신뢰하지 않는다.
// 실제 파일 시그니처(매직 바이트)를 검사해 진짜 이미지인지 확인한다.
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

// Tesseract 워커는 생성(언어 데이터 로드) 비용이 크므로 프로세스당 소수만 만들어 재사용한다.
// 워커 수를 고정해두면 요청이 몰려도 동시 처리량이 상수로 제한되어 메모리/CPU가 무한정 늘지 않는다.
const WORKER_POOL_SIZE = 2;
let workerPoolPromise = null;
let nextWorkerIndex = 0;

function getWorkerPool() {
  if (!workerPoolPromise) {
    workerPoolPromise = Promise.all(
      Array.from({ length: WORKER_POOL_SIZE }, () => createWorker("kor+eng"))
    ).catch((err) => {
      workerPoolPromise = null; // 초기화 실패 시 다음 요청에서 재시도할 수 있도록 리셋
      throw err;
    });
  }
  return workerPoolPromise;
}

const MAX_TEXT_LENGTH = 8000;

// [2026-09-11 시도] Tesseract가 내려주는 일반 텍스트(data.text)는 이미 한 줄로 평탄화돼 있어서
// "항목 / 금액 / 본인부담금 / 비급여"처럼 여러 열로 인쇄된 표의 열 구분이 사라진다. 대신
// data.blocks(옵션으로 요청해야 나옴)에 들어있는 단어별 좌표(bbox)를 이용해, 같은 줄 안에서
// 단어 사이 간격이 유난히 큰 지점을 "다음 열로 넘어감"으로 보고 탭 문자로 구분해 재조립한다.
// 어디까지나 휴리스틱이라 완벽하지 않음 - 열이 잘못 나뉘거나(간격이 애매한 경우), 표가 아닌
// 문장인데 우연히 큰 간격이 있으면 탭이 잘못 들어갈 수 있음. 실패해도 최악의 경우 기존과
// 똑같은(탭 없는) 한 줄짜리 텍스트로 남을 뿐이라 저장 자체에는 위험이 없다고 판단해 시도한다.
function groupWordsIntoColumns(words, lineHeight) {
  if (!words || words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  // 단어 폭 평균으로 임계값을 잡으면 유난히 긴 단어(예: "Consultation") 하나가 그 줄 전체
  // 임계값을 실제 열 간격보다 훨씬 크게 끌어올려서, 진짜 열 경계를 놓치는 문제가 실측에서
  // 확인됨. 대신 줄 높이(=글자 크기와 비례, 문서 내용 길이에 안 흔들림)를 기준으로 삼는다 -
  // 표 열 간격은 보통 줄 높이의 2배 이상, 일반 단어 사이 공백은 그보다 훨씬 좁다.
  const gapThreshold = Math.max(30, (lineHeight || 20) * 2);

  const columns = [[sorted[0].text]];
  let lastX1 = sorted[0].bbox.x1;
  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    if (word.bbox.x0 - lastX1 > gapThreshold) {
      columns.push([word.text]);
    } else {
      columns[columns.length - 1].push(word.text);
    }
    lastX1 = word.bbox.x1;
  }
  return columns.map((col) => col.join(" "));
}

function buildTabularText(data, fallbackText) {
  try {
    const lines = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const lineHeight = line.bbox ? line.bbox.y1 - line.bbox.y0 : null;
          const columns = groupWordsIntoColumns(line.words, lineHeight);
          // 열이 2개 이상으로 나뉜 줄만 탭으로 합침 - 1개면(=보통 문장) 원래 줄 텍스트 그대로 사용.
          lines.push(columns.length >= 2 ? columns.join("\t") : (line.text || "").trim());
        }
      }
    }
    const joined = lines.join("\n").trim();
    return joined || fallbackText;
  } catch {
    // blocks 구조가 예상과 다르거나 비어있으면 기존 방식(순수 텍스트)으로 안전하게 폴백.
    return fallbackText;
  }
}

// [보안 강화 #5 CSRF] 이 프로젝트의 다른 상태 변경 POST 라우트(routes/board.js)와 동일하게
// CSRF 토큰 검증을 첫 게이트로 적용. 권한 확인(RBAC)은 requirePermission이 이어서 담당.
router.post("/", verifyCsrfToken, requirePermission("ocr:scan"), ocrLimiter, (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: "이미지 파일(5MB 이하) 1장만 업로드할 수 있습니다." });
    }
    if (err) {
      return res.status(400).json({ message: "업로드 처리 중 오류가 발생했습니다." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "이미지 파일을 첨부해주세요." });
    }
    if (!isAllowedImage(req.file.buffer)) {
      return res.status(400).json({ message: "지원하지 않는 이미지 형식입니다. (JPEG/PNG/WEBP만 허용)" });
    }

    try {
      const startedAt = Date.now();
      const workers = await getWorkerPool();
      const worker = workers[nextWorkerIndex % workers.length];
      nextWorkerIndex += 1;

      const { data } = await worker.recognize(req.file.buffer, {}, { text: true, blocks: true });
      const flatText = (data.text || "").trim();
      const text = buildTabularText(data, flatText).slice(0, MAX_TEXT_LENGTH);
      // [2026-09-11] 관리자 화면에 "처리 시간"을 보여주기 위한 실측값 - 꾸밈이 아니라
      // 실제로 이 요청이 Tesseract 인식에 걸린 시간(ms)을 그대로 반환한다.
      // [2026-09-11] 스캔 직후 화면에도 저장된 문서 상세보기와 동일한 구조화 미리보기(라벨:값,
      // 항목표)를 보여주기 위해 documents.js와 같은 파서를 공유해서 계산 - was/document-parsing.js 참고.
      res.json({
        text,
        processingMs: Date.now() - startedAt,
        fileSize: req.file.buffer.length,
        parsed_items: parseItemTable(text),
        parsed_display_fields: parseDisplayFields(text),
      });
    } catch (e) {
      // [보안 강화 #7-b 정보 노출] 상세 에러는 서버 로그에만 남기고 응답에는 일반 메시지만 반환
      console.error("[ocr error]", e);
      res.status(500).json({ message: "이미지에서 텍스트를 추출하지 못했습니다." });
    }
  });
});

module.exports = router;
