const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { createWorker } = require("tesseract.js");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");

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
      const workers = await getWorkerPool();
      const worker = workers[nextWorkerIndex % workers.length];
      nextWorkerIndex += 1;

      const { data } = await worker.recognize(req.file.buffer);
      const text = (data.text || "").trim().slice(0, MAX_TEXT_LENGTH);
      res.json({ text });
    } catch (e) {
      // [보안 강화 #7-b 정보 노출] 상세 에러는 서버 로그에만 남기고 응답에는 일반 메시지만 반환
      console.error("[ocr error]", e);
      res.status(500).json({ message: "이미지에서 텍스트를 추출하지 못했습니다." });
    }
  });
});

module.exports = router;
