// [2026-09-11] was/routes/documents.js와 was/routes/ocr.js 둘 다 "OCR 원문에서 날짜/금액/
// 항목표/라벨:값을 뽑아내는" 같은 파싱 로직이 필요해져서(원래는 documents.js에만 있었는데,
// /api/ocr 응답에도 같은 구조화 미리보기를 보여줘야 해서) 공용 모듈로 뽑았다. 두 라우트
// 파일이 각자 복사해서 들고 있으면 나중에 한쪽만 고치고 잊어버리기 쉬운 문제(이 프로젝트에서
// 실제로 반복됐던 종류의 버그)라, 하나만 두고 같이 참조하게 한다.
const { maskPii } = require("./crypto-utils");

const MAX_TEXT_LENGTH = 8000;

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

// [2026-09-11] "항목 / 금액(들)" 형태 줄을 표로 보여주기 위한 best-effort 파서 (관리자 화면 요청).
// was/routes/ocr.js가 단어 좌표(bbox)를 보고 열 구분이 뚜렷한 줄은 탭(\t)으로 이미 재조립해서
// 넘겨주므로, 여기서는 그 탭을 우선 신뢰해서 "항목/금액/본인부담금/비급여"처럼 여러 열도 인식한다.
// 탭이 없는 줄(오래된 저장 데이터 - 이 개선 이전에 스캔된 문서, 또는 열 구분에 실패한 경우)은
// 기존처럼 "라벨 하나 + 금액 하나"인 줄만 인식하는 걸로 대체(fallback). 열 인식 자체가 열마다
// 안정적이지 않을 수 있어서(문서마다 열 개수가 다르면 표 전체를 신뢰하기 어려움), 표로 인정하는
// 건 "행마다 열 개수가 일정하게 2줄 이상 나올 때"로 제한한다. DB에는 저장 안 하고(파생 데이터라
// extracted_text만 있으면 언제든 다시 계산 가능) API 응답 시점에 매번 계산한다.
const DEFAULT_ITEM_HEADERS = ["금액", "본인부담금", "비급여"];
const AMOUNT_CELL_PATTERN = /[\d,]{1,12}\s?원$/;

function parseItemTable(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (line.includes("\t")) {
      const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && cells.slice(1).every((c) => AMOUNT_CELL_PATTERN.test(c))) {
        rows.push({ label: cells[0], values: cells.slice(1) });
        continue;
      }
    }
    const match = line.match(/^\s*([가-힣A-Za-z0-9][가-힣A-Za-z0-9 ]{0,18})\s+([\d,]{1,12}\s?원)\s*$/);
    if (match && match[1].trim()) {
      rows.push({ label: match[1].trim(), values: [match[2]] });
    }
  }
  // 한두 줄만 우연히 매칭되는 건 진짜 표라고 보기 어려움 + 행마다 열 개수가 다르면(예: 어떤 줄은
  // 2열, 어떤 줄은 3열로 잘못 나뉨) 표 하나로 묶어 보여주기 애매하므로, 가장 흔한 열 개수만
  // 채택하고 그 개수와 다른 행은 버린다.
  if (rows.length < 2) return null;
  const countFrequency = new Map();
  rows.forEach((r) => countFrequency.set(r.values.length, (countFrequency.get(r.values.length) || 0) + 1));
  const commonCount = [...countFrequency.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const filteredRows = rows.filter((r) => r.values.length === commonCount);
  if (filteredRows.length < 2) return null;

  return { headers: DEFAULT_ITEM_HEADERS.slice(0, commonCount), rows: filteredRows };
}

// [2026-09-11] 화면에 "환자명/병원명/진료기간" 같은 라벨:값 쌍을 보여주기 위한 표시 전용 파서.
// 저장되는 parsed_fields(위 parseLabeledFields)와는 별개 - 그쪽은 민감 라벨을 아예 안 담아서
// DB에 절대 안 남게 하는 게 목적이고, 이건 화면에 "보여주기 위한" 값이라 민감 라벨도 포함하되
// 대신 마스킹해서 내려준다("텍스트 결과에서는 마스킹, 수정하기(원문 textarea)에서는 원문 그대로
// 보이게" 결정). DB에 저장 안 함(parsed_items와 같은 원칙 - extracted_text에서 매번 재계산).
// 콜론 있는 줄("라벨: 값")뿐 아니라 콜론 없이 공백으로만 구분된 줄("라벨   값")도 인식 -
// 다만 이쪽은 오탐 위험이 있어 공백 2칸 이상으로 제한해 일반 문장과는 구분되게 함.
const RRN_LABEL_KEYWORDS = ["주민등록번호", "주민번호"];
const ACCOUNT_LABEL_KEYWORDS = ["카드번호", "계좌번호"];
const PHONE_LABEL_KEYWORDS = ["전화번호", "연락처", "휴대폰"];

function maskDigitsKeepingLast(value, keepLast) {
  const digitCount = (value.match(/\d/g) || []).length;
  if (digitCount <= keepLast) return value;
  let seen = 0;
  return value.replace(/\d/g, (d) => (++seen > digitCount - keepLast ? d : "*"));
}

function maskFieldValue(label, value) {
  if (RRN_LABEL_KEYWORDS.some((k) => label.includes(k))) {
    const digits = value.replace(/[^\d]/g, "");
    if (digits.length === 13) return `${digits.slice(0, 6)}-${digits[6]}${"*".repeat(6)}`;
    return value.replace(/\d/g, "*"); // 형식이 안 맞으면 안전하게 숫자 전부 마스킹
  }
  if (ACCOUNT_LABEL_KEYWORDS.some((k) => label.includes(k))) {
    return maskDigitsKeepingLast(value, 4);
  }
  if (PHONE_LABEL_KEYWORDS.some((k) => label.includes(k))) {
    return maskPii(value);
  }
  return value;
}

function parseDisplayFields(text) {
  const fields = [];
  const seenLabels = new Set();

  for (const line of text.split("\n")) {
    if (fields.length >= MAX_PARSED_FIELDS) break;

    let match = line.match(/^\s*(.{1,20}?)\s*[:：]\s*(.+?)\s*$/);
    if (!match) match = line.match(/^\s*([가-힣A-Za-z][가-힣A-Za-z0-9 ]{0,12}?)\s{2,}(.+?)\s*$/);
    if (!match) continue;

    const label = match[1].trim();
    const rawValue = match[2].trim();
    if (!label || !rawValue || seenLabels.has(label)) continue;
    seenLabels.add(label);

    fields.push({ label, value: maskFieldValue(label, rawValue) });
  }

  return fields.length > 0 ? fields : null;
}

module.exports = {
  MAX_TEXT_LENGTH,
  SENSITIVE_LABEL_KEYWORDS,
  parseDate,
  parseAmount,
  parseLabeledFields,
  parseItemTable,
  parseDisplayFields,
};
