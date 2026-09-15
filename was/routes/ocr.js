const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const rateLimit = require("express-rate-limit");
const { createWorker, PSM } = require("tesseract.js");
const requirePermission = require("../middleware/requirePermission");
const { verifyCsrfToken } = require("../middleware/csrf");
const { parseItemTable, parseDisplayFields } = require("../document-parsing");

const router = express.Router();

// [OCR 개선 2026-09-15] 어둡거나 흐린 이미지에서 인식률이 떨어지는 문제 - Tesseract는 내부적으로
// 이미지를 흑백으로 이진화한 뒤 문자를 인식하는데, 대비가 낮거나(어두움) 경계가 무뎌지면(흐림/
// 압축 열화) 이 단계에서 글자와 배경을 잘못 구분한다. 언어 모델(kor/eng traineddata) 교체로는
// 절대 못 고치는 문제 - 모델은 "어떤 문자를 인식하는가"만 결정할 뿐 화질 문제와는 무관하다.
//
// [시행착오 1 - 어둠 보정 무조건 적용] 처음엔 "그레이스케일+정규화"를 모든 이미지에 무조건
// 적용했는데, 정상(밝은) 이미지에서 "15000원"이 "19000원"으로 오인식되는 회귀가 실측 확인됨
// (노이즈가 없어도 median 블러가 숫자 획을 뭉개서 다른 숫자로 잘못 읽힘). 그래서 평균 밝기가
// 낮을 때만 적용하도록 임계값을 뒀었다.
//
// [시행착오 2 - 샤픈 필터 추가] 실제 사용자 테스트 이미지(약하게 흐려진 진단서 스캔본)로
// 재현해보니, 표 부분 인식률이 급격히 떨어지는 게 밝기가 아니라 흐림 열화 때문임을 확인 -
// 샤픈 필터(sigma 1.5)를 적용하니 14개 필드 중 정확히 맞는 개수가 2->10으로 크게 개선됨.
// 그런데 이미 선명한 이미지에 샤픈을 걸면 오히려 "영수증번호" 같은 글자가 깨지는 새로운 회귀가
// 실측 확인됨(과다 샤픈으로 인한 링잉 아티팩트로 추정) - "밝기 임계값"과 완전히 같은 클래스의
// 문제가 "흐림"에도 그대로 있었다.
//
// [최종 방식 - 사전 판단을 포기하고 Tesseract 자신의 신뢰도로 사후 선택] 이미지를 미리 보고
// "이건 어둡다/흐리다"를 판단해서 어떤 보정을 적용할지 미리 정하는 방식 자체가 계속 새로운
// 회귀를 만들어냈다. 그래서 원본/어둠보정/샤픈 3가지 버전을 전부 실제로 인식시켜보고,
// Tesseract가 각 단어에 매기는 인식 신뢰도(confidence, 0~100)의 평균이 가장 높은 결과를
// 채택하는 방식으로 바꿨다 - 밝기·흐림 임계값 같은 임의의 숫자가 전혀 필요 없고, 실측 4개
// 케이스(정상 2개/어두움 1개/흐림 1개)에서 전부 정확한 버전을 스스로 골라내는 것을 확인했다.
// [트레이드오프] Tesseract 인식을 건마다 3번 돌리므로 처리 시간이 약 3배 늘어난다(실측
// 1~2.6초 -> 약 3~8초). 분당 10회 제한이 걸린 관리자 전용 기능이라 감내 가능하다고 판단.
const PREPROCESS_CANDIDATES = {
  원본: async (buffer) => buffer,
  어둠보정: async (buffer) => sharp(buffer).grayscale().median(3).normalize().toBuffer(),
  샤픈: async (buffer) => sharp(buffer).sharpen({ sigma: 1.5 }).toBuffer(),
};

function averageWordConfidence(data) {
  const words = flattenWords(data);
  if (words.length === 0) return -1; // 단어를 하나도 못 찾은 결과는 항상 최하위로 취급
  return words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
}

// 후보 하나당 recognize() 한 번(수백ms~초 단위)이라 순차 실행 - 병렬로 돌리면 워커 풀
// 크기(2)를 이 함수 하나가 다 차지해서 다른 요청이 완전히 막히므로 의도적으로 순차 처리한다.
async function recognizeBestOf(worker, buffer) {
  let best = null;
  for (const [name, transform] of Object.entries(PREPROCESS_CANDIDATES)) {
    let pre;
    try {
      pre = await transform(buffer);
    } catch (err) {
      pre = buffer; // 특정 후보 전처리 자체가 실패해도(손상된 이미지 등) 원본으로는 계속 시도
    }
    const { data } = await worker.recognize(pre, {}, { text: true, blocks: true });
    const confidence = averageWordConfidence(data);
    if (!best || confidence > best.confidence) {
      best = { name, confidence, data };
    }
  }
  return best.data;
}

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

// [OCR 개선 2026-09-15 - 근본 원인] 테두리 있는 표(진료비 영수증처럼 그리드로 그려진 문서)를
// 스캔하면 표 부분이 통째로 인식 안 되거나 깨지는 문제 - 어두움/선명도와는 전혀 무관했다.
// createWorker에 페이지 분할 모드(PSM)를 아무것도 지정 안 하면 Tesseract가 내부적으로 쓰는
// 기본값이 "표 테두리를 텍스트가 아닌 이미지/장식으로 오인해 그 영역 전체를 건너뛰는" 모드였음
// (실측 확인: 합성 영수증 이미지 통과 시 표 헤더 3칸+본문 13개 필드가 통째로 사라지고 나머지도
// 깨짐). 언어 모델(kor/eng traineddata) 교체로는 절대 못 고치는 문제 - PSM은 "레이아웃을 어떻게
// 나눌지"를 결정하는 것이라 어떤 언어를 쓰든 동일하게 겪는다.
// PSM 후보를 실측 비교(합성 표 문서 + 텍스트 몇 줄뿐인 여백 많은 문서 둘 다로 교차 검증):
//   - 미지정(사실상 SINGLE_BLOCK류): 표 영역 통째로 누락
//   - AUTO(3): 표는 대부분 잡히지만, 반대로 "텍스트가 몇 줄뿐이고 여백이 넓은" 문서에서는
//     페이지 레이아웃 분석이 헷갈려 멀쩡한 줄까지 누락시킴(실측 확인)
//   - SPARSE_TEXT(11): 두 경우 다 텍스트 자체는 전부 잡아냄 - 대신 한글이 음절 단위로 쪼개지고
//     표의 행/열 구분(어떤 텍스트가 같은 줄·같은 칸인지)이 사라져서, 그 재조립은 별도로
//     직접 해야 함(아래 flattenWords/groupIntoRows/reconstructRowText 참고).
// "텍스트를 놓치는 것"보다 "재조립을 우리가 직접 하는 것"이 복구 가능한 문제라 SPARSE_TEXT를
// 선택했다.
function getWorkerPool() {
  if (!workerPoolPromise) {
    workerPoolPromise = Promise.all(
      Array.from({ length: WORKER_POOL_SIZE }, async () => {
        const worker = await createWorker("kor+eng");
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        return worker;
      })
    ).catch((err) => {
      workerPoolPromise = null; // 초기화 실패 시 다음 요청에서 재시도할 수 있도록 리셋
      throw err;
    });
  }
  return workerPoolPromise;
}

const MAX_TEXT_LENGTH = 8000;

// [2026-09-15 재작성] SPARSE_TEXT 모드로 바꾸면서 Tesseract 자신의 block/paragraph/line
// 그룹핑을 더 이상 못 믿게 됐다 - 실측해보니 한글이 음절 단위로 쪼개지고("영수증번호"가
// "영"/"수"/"증"/"번"/"호" 각각 별도 word로 나옴), 원래 같은 줄/같은 표 행이어야 할 텍스트가
// Tesseract 기준 서로 다른 line/paragraph로 흩어진다. 그래서 Tesseract의 구조를 따라가는 대신,
// 페이지 전체 단어(사실상 음절/토큰) bbox만 모아서 우리가 직접 "이게 같은 행인지", "이게 같은
// 칸인지"를 재구성한다.
function flattenWords(data) {
  const words = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const w of line.words || []) words.push(w);
      }
    }
  }
  return words;
}

// 1단계 - y좌표가 겹치는 토큰들을 같은 시각적 "행"으로 묶는다. 정렬 후 바로 이전 행과만
// 비교하면 되는 이유: 문서는 위에서 아래로 읽으므로 y0 오름차순 정렬 후 새 토큰은 항상
// 직전에 만들어진 행과만 겹칠 가능성이 있다.
function groupIntoRows(words) {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = [];
  for (const w of sorted) {
    const last = rows[rows.length - 1];
    if (last) {
      const overlap = Math.min(last.y1, w.bbox.y1) - Math.max(last.y0, w.bbox.y0);
      const minHeight = Math.min(w.bbox.y1 - w.bbox.y0, last.y1 - last.y0);
      if (overlap > minHeight * 0.4) {
        // 세로로 40% 이상 겹치면 같은 행 - 살짝 삐뚤어진 스캔에서도 여유를 둠.
        last.words.push(w);
        last.y0 = Math.min(last.y0, w.bbox.y0);
        last.y1 = Math.max(last.y1, w.bbox.y1);
        continue;
      }
    }
    rows.push({ y0: w.bbox.y0, y1: w.bbox.y1, words: [w] });
  }
  return rows;
}

// 2단계 - 한 행 안에서 x축 간격을 세 단계로 구분한다: 표 열 간격(가장 넓음, 줄 높이의 2배
// 이상 - 기존 표 인식 휴리스빅과 동일 기준) / 같은 칸 안의 단어 간 공백(중간) / 같은 단어를
// 이루는 음절 사이 간격(가장 좁음 - 공백 없이 붙여야 함, 한글은 음절 사이에 공백이 없으므로).
// SPARSE_TEXT가 한글을 음절 단위로 쪼개기 때문에 이 3단계 구분이 꼭 필요함 - 기존(Tesseract가
// 준 line.words가 이미 "단어" 단위였을 때) 로직은 2단계(칸 vs 단어)만 구분하면 충분했었다.
function reconstructRowText(row) {
  const sorted = [...row.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const lineHeight = row.y1 - row.y0;
  const columnGap = Math.max(30, lineHeight * 2);
  const wordGap = Math.max(8, lineHeight * 0.5);

  const columns = [sorted[0].text];
  let lastX1 = sorted[0].bbox.x1;
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    const gap = w.bbox.x0 - lastX1;
    if (gap > columnGap) {
      columns.push(w.text); // 새 열(표 칸 경계)
    } else if (gap > wordGap) {
      columns[columns.length - 1] += " " + w.text; // 같은 열, 다른 단어
    } else {
      columns[columns.length - 1] += w.text; // 같은 단어의 음절 - 공백 없이 이어붙임
    }
    lastX1 = w.bbox.x1;
  }
  return columns;
}

// [document-parsing.js와의 계약] 다운스트림 파서가 기대하는 줄 형식이 서로 다르다:
//   - parseLabeledFields/parseDisplayFields: "라벨: 값" 또는 "라벨" + 공백 2칸 이상 + "값"
//     (콜론 또는 넓은 공백만 인식 - 탭은 못 알아봄)
//   - parseItemTable: 탭으로 나눈 뒤 금액(...원) 패턴 검사를 우선 시도, 탭이 없으면
//     "라벨 + 공백 + 금액원" 한 줄짜리 폴백으로 처리
// 열이 정확히 2개(라벨 + 값 1개)면 위 두 파서 다 잠재적 대상이라, 탭 대신 공백 3칸으로 합쳐서
// parseDisplayFields의 "공백 2칸 이상" 규칙과 parseItemTable의 공백 폴백을 동시에 만족시킨다.
// 열이 3개 이상(품목표처럼 값이 여러 개인 행)이면 parseItemTable의 탭 우선 분기만 대상이므로
// 기존처럼 탭으로 합친다.
function joinColumns(columns) {
  if (columns.length <= 1) return columns[0] || "";
  if (columns.length === 2) return columns.join("   ");
  return columns.join("\t");
}

function buildTabularText(data, fallbackText) {
  try {
    const words = flattenWords(data);
    if (words.length === 0) return fallbackText;
    const rows = groupIntoRows(words);
    const lines = rows.map((row) => joinColumns(reconstructRowText(row)));
    const joined = lines.join("\n").trim();
    return joined || fallbackText;
  } catch (e) {
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

      const data = await recognizeBestOf(worker, req.file.buffer);
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
