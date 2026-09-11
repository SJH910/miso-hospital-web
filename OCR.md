# OCR 기능 작업 정리

최종 수정: 2026-09-08
이 문서는 **OCR 관련 작업만** 정리한다. 전체 취약점 수정/챗봇은 별도 담당이라 여기서 다루지 않는다 (해당 내용은 `Plan.md`/`PROGRESS.md` 참고).

> **폴더명 변경 안내**: 아래 "다른 저장소로 포팅" 섹션 등에서 계속 언급되는 `miso-hospital-3tier-secure-master`는 2026-09-04에 `miso-hospital-3tier-secure-ocr`로 폴더명이 바뀌었다. 이 문서의 옛 경로 표기는 당시 기록을 그대로 남겨둔 것이고, **지금 실제 경로는 `miso-hospital-3tier-secure-ocr`**이다. 자세한 경위는 맨 아래 "2026-09-04 진행 상황" 섹션 참고.

---

## 현재 상태

### 구현 완료
- **문서 이미지 → 텍스트 추출 엔드포인트**: `POST /api/ocr` ([was/routes/ocr.js](was/routes/ocr.js))
  - `tesseract.js`(`kor+eng`)로 처리, 메모리 버퍼만 사용(디스크 미기록)
  - 매직 바이트 검증(JPEG/PNG/WEBP), 5MB·1장 제한, 텍스트 8000자 제한
  - 로그인 사용자 단위 분당 10회 rate limit
- **관리자 전용 접근 제어**: 로그인은 되어 있지만 `role`이 `admin`이 아니면 403
  - `patients.role` 컬럼 추가 (`db/init.sql`, 로컬 DB에도 마이그레이션 적용됨)
  - 로그인 시 세션에 `role` 저장 ([was/routes/auth.js](was/routes/auth.js))
  - `admin` 계정(`admin` / `admin_test_123!`)만 `role='admin'`, 나머지 `patient1~3`은 `patient`
- **환자 화면에서 OCR UI 제거**: `frontend/board.html`/`frontend/js/board.js`에서 업로드 버튼·입력창 삭제 완료. **의도된 동작** — `board.html`에는 OCR 관련 UI가 전혀 없어야 정상.
- **관리자용 문서 스캔 페이지**: `frontend/admin.html` + `frontend/js/admin.js`
  - 이미지 업로드 → "텍스트 추출" 버튼 → 결과를 textarea에 표시 (`.value`로만 삽입, innerHTML 아님)
  - 로그인 시 `role === 'admin'`이면 `login.js`가 `admin.html`로 이동시킴 (`patient`는 `board.html` 그대로)
  - `admin.js`는 `/api/me`로 role을 다시 확인해, admin이 아니면 안내 후 `board.html`로 돌려보냄(프론트단 보조 가드 — 실제 차단은 서버의 403이 담당)
- **스캔 결과 저장 + 문서종류 + 필드 파싱**: `db/init.sql`의 `scanned_documents` 테이블(`document_type`, `parsed_date`, `parsed_amount` 포함), `GET /api/patients`, `POST/GET /api/documents` ([was/routes/patients.js](was/routes/patients.js), [was/routes/documents.js](was/routes/documents.js))
  - 저장 시 관리자가 환자 + 문서종류(처방전/진단서/영수증)를 직접 선택
  - `POST /api/documents`가 OCR 원문에서 날짜·금액을 정규식으로 파싱해 `parsed_date`/`parsed_amount`로 같이 저장 (실패 시 `NULL`, best-effort)
  - `GET /api/documents` 응답에는 `extracted_text`(원문)를 아예 포함하지 않음 — 화면에서 숨기는 게 아니라 서버가 애초에 내려보내지 않음
  - `admin.html`/`admin.js` 목록에는 이름/날짜·시간/문서종류만 표시 (원문 렌더링 코드 자체를 제거함)
  - 테스트: `"2026년 9월 3일 진료비 45,000원 결제완료"` 텍스트로 저장 → DB에 `parsed_date=2026-09-03`, `parsed_amount=45000` 정확히 저장 확인. `document_type` 누락 시 400 확인. 브라우저에서 실제 이미지로 추출→환자/문서종류 선택→저장→목록에 원문 없이 이름/날짜·시간/문서종류만 표시되는 것 확인.
- **범용 키-값 필드 추출**: `parsed_fields`(JSON) 컬럼 추가, `was/routes/documents.js`의 `parseLabeledFields`가 OCR 원문의 "라벨:값" 줄을 전부 구조화해서 저장 (주민등록번호/연락처/카드번호/계좌번호는 제외). "문서 종류"/"환자명"은 OCR로 다시 추측하지 않고 신뢰할 수 있는 값(관리자 선택/DB의 실제 환자명)을 그대로 사용. 실제 진단서 이미지의 지저분한 OCR 원문으로 검증 완료 (자세한 내용은 아래 "범용 키-값 필드 추출" 섹션 참고).
- **OCR 인식 결과 미리보기**: admin.html에 읽기 전용 미리보기 영역 추가 (저장용 textarea와 별개, 추출 직후 원본 참고용). 신뢰도 기반 강조 표시는 한 차례 구현했다가 제거하기로 결정 — 자세한 경위는 아래 "OCR 인식 결과 미리보기" 섹션 참고.
- **`miso-hospital-3tier-secure-master`로 포팅**: 위 OCR 기능 전체를 취약점이 이미 수정된 별도 저장소로 이식하고 그 저장소의 보안 패턴(CSRF 토큰 등)에 맞춰 조정 완료, 브라우저로 전체 흐름 검증까지 완료. 자세한 내용은 아래 "다른 저장소로 포팅" 섹션 참고.

### 아직 안 된 것 / 확인 중
(현재 없음 — 위 항목까지 모두 구현·테스트 완료)

---

## 문서 종류 분류 — 이력 (미채택 → 재도입)

한때 "분류만 하자"는 방향을 검토했다가 **미채택**으로 결정한 적이 있었다. 이후 "저장된 문서 목록에는 이름/날짜/시간/문서종류만 보이고, 내용은 화면에 안 보이게 하되 개별 필드는 파싱해서 저장하자"는 요구가 다시 나오면서 **문서종류 분류를 재도입**하기로 확정했다. 최신 결정은 아래 "문서 내용 비공개 + 필드 파싱" 섹션을 따른다.

---

## 문서 내용 비공개 + 필드 파싱 (구현 완료)

**결정된 것**:
- 저장된 스캔 문서 목록 화면에는 **이름 / 날짜 / 시간 / 문서종류만** 보여준다. OCR 원문(추출된 텍스트)은 화면에 절대 표시하지 않는다.
- **문서종류**(처방전/진단서/영수증)는 관리자가 저장할 때 드롭다운에서 직접 선택한다 (자동 판별 아님).
- OCR 원문에서 **날짜, 금액 등 개별 필드를 프로그램이 자동으로 추출(파싱)**해서 DB에 저장한다.

**설계 메모**:
- 원문(`extracted_text`)은 계속 DB에는 저장한다 (파싱의 원본 근거, 추후 필요 시 대조용). 다만 목록 조회 API(`GET /api/documents`) 응답에서 아예 제외해서, 서버가 프론트로 원문을 내려보내는 일 자체가 없게 한다 — "화면에만 안 보이게 숨김" 대신 "애초에 전송하지 않음"으로 처리 (더 안전함, 클라이언트 코드 실수로 노출될 여지 자체를 없앰).
- 파싱은 정규식 기반 best-effort로 처리한다. 날짜(`YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY년 M월 D일` 등)와 금액(`1,234원` 형태) 패턴을 찾아 각각 `parsed_date`, `parsed_amount` 컬럼에 저장. 못 찾으면 `NULL` — 파싱 실패가 저장 자체를 막지는 않는다.
- OCR 인식 오류가 그대로 파싱 오류로 이어질 수 있다(예: 숫자를 잘못 읽으면 금액도 잘못 추출됨). 이 데이터를 진료비 정산 등 중요한 판단에 그대로 쓰면 안 되고, 참고용으로만 취급해야 한다.

**스키마 변경** (`scanned_documents`에 컬럼 추가):
```sql
ALTER TABLE scanned_documents
  ADD COLUMN document_type ENUM('prescription', 'diagnosis', 'receipt') NOT NULL AFTER scanned_by,
  ADD COLUMN parsed_date DATE NULL AFTER extracted_text,
  ADD COLUMN parsed_amount INT NULL AFTER parsed_date;
```
(enum 값은 기존 `patients.role`처럼 영문으로 통일하고, 화면 표시용 한글 라벨은 프론트에서 매핑)

**API 변경**:
- `POST /api/documents` — 요청 바디에 `document_type` 추가: `{ patient_id, document_type, text }`. 서버에서 `document_type`이 허용된 값인지 검증. 저장 시 `text`에서 날짜/금액을 파싱해 `parsed_date`/`parsed_amount`도 같이 저장.
- `GET /api/documents` — 응답에서 `extracted_text`(원문) 제거. `id`, `patient_name`, `document_type`, `created_at`만 반환 (이름/날짜·시간/문서종류에 대응).

**구현 순서** (모두 완료, 아래 "확인해야 할 것" 참고):
1. `db/init.sql` + 로컬 DB에 위 컬럼 3개 추가
2. `was/routes/documents.js`에 날짜/금액 파싱 함수 추가, `POST /api/documents`에서 호출해 저장
3. `GET /api/documents` 응답에서 `extracted_text` 제외하도록 쿼리 수정
4. `admin.html`에 문서종류 드롭다운(처방전/진단서/영수증) 추가
5. `admin.js`: 저장 요청에 `document_type` 포함, 목록 렌더링(`renderDocument`)에서 원문 표시 부분 제거하고 이름/날짜·시간/문서종류만 표시

<details>
<summary>이전 초안(참고용, 위 최신 결정으로 대체됨)</summary>

- 스캔 결과를 저장할 새 테이블(`scanned_documents`: `id`, `document_type`, `extracted_text`, `patient_id`, `scanned_by`, `created_at`)
- 문서-환자 연결 UI, 분류 시점(업로드 전/후), 조회 권한 설계

</details>

---

## OCR 인식 결과 미리보기 (강조 표시는 제거됨)

**배경**: 실제 사용 중 `RCT-2025-0007421`이 `8ㄷ1-2025-0007421`로 잘못 인식되는 사례가 확인됨. `kor+eng` 혼합 모드에서 라틴 문자가 비슷하게 생긴 한글 자모로 오인식되는 건 OCR 엔진 자체의 구조적 한계라 "완벽하게 고치는" 건 불가능.

**1차 시도 (채택 후 제거됨)**: Tesseract가 단어마다 매기는 인식 신뢰도(0~100)를 받아와, 신뢰도 80 미만 단어를 노란색으로 강조하는 기능을 구현했었다 (`POST /api/ocr`이 `{ text, words }`를 반환, `words`는 `{ text, confidence, line }`). 실제로 저신뢰도 단어만 정확히 강조되는 것까지 확인했으나, 이후 **강조 스타일은 제거하고 미리보기 자체는 유지**하기로 결정.

**현재 상태**:
- `POST /api/ocr`은 다시 `{ text }`만 반환 (단어별 신뢰도 데이터, `extractWords()`, `blocks:true` 옵션 모두 제거)
- admin.html의 "인식 결과 미리보기" 영역은 그대로 남아있음 — 저장에 쓰이는 `resultText` textarea와 별개로, 추출 직후의 원본 결과를 강조 없이 보여주는 읽기 전용 참고용 영역
- `.ocr-low-confidence` CSS 클래스 삭제

**보안 메모**: 미리보기도 OCR 원문(신뢰할 수 없는 값)을 화면에 그리는 부분이라 `textContent`만 사용하고 `innerHTML`은 쓰지 않음 ([frontend/js/admin.js](frontend/js/admin.js)의 `renderConfidencePreview`).

**테스트**: 제거 후에도 `/api/ocr` 응답이 `{ text }`만 포함하는 것, 실제 스캔 버튼 클릭 시 미리보기에 강조 없이 일반 텍스트로 표시되는 것을 브라우저에서 재확인.

---

## 범용 키-값 필드 추출 (구현 완료)

**요청 배경**: OCR 원문이 "환자명: 김환자", "진단일: 2025-03-10", "발급기관: 가상종합병원" 처럼 "라벨 : 값" 형태의 줄로 구성된 경우가 많다. 지금은 날짜/금액 두 개만 규칙 기반으로 뽑고 있는데, 이걸 문서에 있는 모든 라벨:값 정보로 확장한다. 동시에 `[TEST DATA / ...]` 같은 이미지 안의 안내문구는 라벨:값 형태가 아니므로 자연스럽게 제외된다.

**결정된 것**:
- `parsed_date`/`parsed_amount` 컬럼은 그대로 유지. 나머지 모든 필드는 새 `parsed_fields`(JSON) 컬럼에 `{ "라벨": "값", ... }` 형태로 저장.
- "문서 종류"와 "환자명"은 OCR로 다시 추측하지 않고, 이미 알고 있는 값(관리자가 선택한 `document_type`, `patient_id`로 조회한 실제 환자 이름)을 그대로 `parsed_fields`에 채운다 — OCR 오인식 위험이 없는 값을 굳이 텍스트에서 다시 뽑을 필요가 없기 때문.
- 주민등록번호/연락처(전화번호)/카드번호/계좌번호 라벨은 `parsed_fields`에서 **제외**한다 (민감정보가 새 컬럼에 한 번 더 복제되는 것을 막기 위함). 원문(`extracted_text`)에는 여전히 남아있지만, 그건 기존과 동일하게 응답에 포함되지 않는다.

**파싱 규칙**:
- OCR 원문을 줄 단위로 나눠서, `라벨 : 값` 또는 `라벨: 값` 형태(라벨은 20자 이내)로 매칭되는 줄만 인식. 콜론이 없는 줄(안내문구, 깨진 OCR 잡음 등)은 자동으로 무시됨.
- 라벨이 민감정보 차단 목록(주민등록번호, 연락처, 전화번호, 휴대폰, 카드번호, 계좌번호)에 해당하면 건너뜀.
- 과도하게 많은 필드가 잡히는 것을 막기 위해 최대 30개까지만 저장.
- OCR 오인식으로 라벨 자체가 깨질 수 있다(예: "진단명"이 "a 할"로 잘못 인식된 사례 확인됨) — best-effort이며 완벽한 정확도를 보장하지 않는다.

**스키마 변경**:
```sql
ALTER TABLE scanned_documents ADD COLUMN parsed_fields JSON NULL AFTER parsed_amount;
```

**API 변경**:
- `POST /api/documents` — 저장 시 `text`를 줄 단위로 파싱해 `parsed_fields`도 함께 저장 (날짜/금액 파싱 로직은 그대로 유지).
- `GET /api/documents` — 이번 변경에서는 응답에 `parsed_fields`를 포함하지 않음 (기존처럼 목록에는 이름/날짜·시간/문서종류만 표시). 화면에 보여주는 기능은 별도 요청 시 추가.

**구현 순서** (모두 완료):
1. `db/init.sql` + 로컬 DB에 `parsed_fields` 컬럼 추가
2. `was/routes/documents.js`에 라벨:값 파싱 함수(`parseLabeledFields`) 추가 (민감정보 차단 목록 포함), `POST /api/documents`에서 호출해 저장

**테스트 결과**: 실제 진단서 이미지에서 나온 OCR 원문(오탈자·잡음 포함)으로 저장해본 결과:
```json
{"문서 종류":"진단서","환자명":"김환자","주 소":"서울특별시 강남구 테스트로 123, 456동 789호","a 할":"본태성(원발성) 고혈압","KCD 코드":"110","진단일":"2025-03-10","치료기간":"2025-03-10 ~ 진행중","발급일":"2025-03-14","발급기관":"가상종합병원 (사업자등록번호 123-45-67890)","진 료 과":"내과","담당의사":"이가상 (면허번호 제12345호)","발급목적":"보험 청구용"}
```
- "문서 종류"/"환자명"은 OCR 원문에 다른 값("김테스트")이 있어도 DB의 실제 값으로 정확히 유지됨 (처음엔 반대로 OCR 값에 덮어써지는 버그가 있었으나 발견 즉시 수정)
- "주민등록번호"·"연락처" 줄은 정상적으로 제외됨
- `[TEST DATA / ...]` 안내문구와 서술형 문장("위 환자는...")은 콜론이 없어 자동으로 제외됨
- "a 할"(원래 "진단명"인데 OCR이 잘못 읽음), "진 료 과"(공백 오인식) 같이 라벨 자체가 깨지는 경우가 실제로 확인됨 — best-effort 특성상 감수해야 하는 부분
- `GET /api/documents` 응답에 `parsed_fields`/`extracted_text`가 새지 않는 것도 재확인함

---

## 다른 저장소로 포팅: miso-hospital-3tier-secure-master (구현 완료)

**배경**: `Plan.md`의 "전체 웹 취약점 수정"은 다른 담당이 별도 저장소(`/Users/yong/Desktop/miso-hospital-3tier-secure-master`)에서 진행해왔다. 그 저장소는 이 프로젝트의 원본 취약점들을 이미 다 고친 하드닝 버전(`SECURITY_FIXES.md`에 11건 수정 내역 기록 — SQLi, XSS, IDOR, 세션 관리, CSRF, rate limit, 정보 노출 2건, 평문 비밀번호, 주민번호 암호화, 전송구간 암호화). 이 문서에서 만든 OCR 기능 전체를 그 저장소로 이식했다.

**단순 복사가 아니라 그 저장소의 기존 보안 패턴에 맞춰 조정한 부분**:
- **CSRF**: 그 저장소는 상태 변경 POST에 `verifyCsrfToken`(Synchronizer Token Pattern)을 적용 중 — `POST /api/ocr`/`POST /api/documents`에도 동일하게 적용(요청 순서: CSRF 검증 → `requireAdmin` → 나머지 처리). 프론트(`admin.js`)는 로그인/`/api/me`에서 받은 CSRF 토큰을 `X-CSRF-Token` 헤더로 자동 첨부.
- **`role` 컬럼**: 원본엔 없던 개념이라 그 저장소의 `patients` 테이블에도 새로 추가(`db/init.sql`), `seed.js`에서 admin 계정에 `role='admin'` 부여, 로그인/`/api/me` 응답에 `role` 포함되도록 `auth.js` 수정.
- **비밀번호/주민번호**: 그 저장소는 이미 bcrypt 해시 + AES-256-GCM 암호화를 쓰고 있음 — OCR 관련 코드는 이 부분을 건드리지 않음.
- **`express-rate-limit` 버전**: 그 저장소가 이미 v7(default export 방식, `const rateLimit = require(...)`)을 쓰고 있어서, 이 프로젝트에서 쓰던 v8 전용 `ipKeyGenerator` 헬퍼 없이 v7 방식(`req.ip` 직접 사용)으로 다시 작성.

**추가/수정된 파일** (그 저장소 기준, 경로는 그 저장소 루트 기준):
- 신규: `was/middleware/requireAdmin.js`, `was/routes/ocr.js`, `was/routes/patients.js`, `was/routes/documents.js`, `frontend/admin.html`, `frontend/js/admin.js`
- 수정: `db/init.sql`(role 컬럼 + scanned_documents 테이블), `was/seed.js`(admin role 부여), `was/routes/auth.js`(role 응답), `was/server.js`(라우트 등록), `was/package.json`(multer, tesseract.js 추가), `frontend/js/login.js`, `frontend/board.html`/`frontend/js/board.js`(아래 "관리자 진입 경로 변경" 참고), `frontend/css/style.css`(`.ocr-preview`)

**관리자 진입 경로 변경**: 처음엔 로그인 시 `role==='admin'`이면 `login.js`가 자동으로 `admin.html`로 보냈으나, 이후 "관리자도 일단 board.html로 가고, 거기서 버튼을 눌러야 문서 스캔 페이지로 이동"하는 방식으로 변경 결정. 그래서:
- `login.js`: 역할 구분 없이 항상 `board.html`로 이동하도록 되돌림
- `board.html`: 헤더에 "문서 스캔 페이지로 이동" 링크(`#adminLink`) 추가, 기본은 `display:none`
- `board.js`의 `loadUserInfo()`: `/api/me` 응답의 `role==='admin'`일 때만 이 링크를 보이게 함 (환자 화면에는 이 기능의 존재 자체를 드러내지 않는다는 기존 원칙 유지) — 실제 접근 차단은 여전히 서버의 `requireAdmin`이 담당하고, 이 링크는 UI 편의일 뿐
- 브라우저로 확인: admin 로그인 → board.html에 링크 노출 → 클릭 시 admin.html 정상 진입. patient1 로그인 시 링크 노출 안 됨

**중요 — 로컬 DB를 원본과 공유하고 있었음**: 그 저장소의 `was/config.js`가 이 저장소와 **동일한 DB 이름(`vulnapp`)·계정**을 기본값으로 써서 같은 로컬 MariaDB를 공유한다. 그 저장소의 `db/init.sql`은 실행할 때마다 테이블을 DROP 후 재생성하도록 되어 있어, 포팅을 검증하기 위해 그걸 실행하면서 **이 저장소가 로컬에서 쓰던 데이터(이 문서의 테스트 결과들을 만들어낸 데이터)가 지워졌다** (사용자 승인 하에 진행). 그래서 지금 로컬 `vulnapp` DB는 secure 저장소의 스키마(bcrypt 해시, 암호화된 rrn 등)로 재시드된 상태 — 이 문서 위쪽에 남아있는 curl 예시들을 이 저장소 기준으로 다시 재현하려면 이 저장소의 `db/init.sql`을 다시 실행해야 한다.

**검증**: curl로 CSRF 토큰 미포함 시 403, 포함 시 200 확인. 브라우저로 로그인→`admin.html` 리다이렉트→추출→환자/문서종류 선택→저장→목록 반영까지 전체 흐름 확인. 환자 계정은 `/api/patients`/`/api/documents` 모두 403, `admin.html` 직접 접근 시 `board.html`로 리다이렉트 확인.

**미해결/참고 사항**:
- `npm install` 시 `npm audit`에서 취약점 5건(moderate 3, high 1, critical 1) 발견. 원인을 추적해보니 이번에 추가한 `multer`/`tesseract.js`가 아니라 **이미 있던** `express`(→`qs`)와 `bcrypt`(→`tar`)의 전이 의존성 문제 — OCR 작업과 무관해서 조치하지 않고 남겨둠. 필요 시 별도로 `npm audit fix` 검토 권장 (버전이 올라가면서 기존 기능에 영향이 있을 수 있어 별도 검증 필요).

---

## 포팅 검증 중 발생한 오류 2건 — 원인과 해결

secure 저장소에서 admin 로그인/OCR을 테스트하는 과정에서 "로그인해도 자동 이동이 안 됨", "patient3로 로그인했는데 admin.html에 들어가짐", "텍스트 추출 오류" 등 여러 증상이 보고됐다. 원인은 OCR 코드 자체의 버그가 아니라 **로컬 개발 환경 운영 문제 2가지**였다.

### 1) WAS 서버 프로세스가 완전히 멈춤 (hang)

- **증상**: `curl`로 `/api/login`을 호출해도 5초 타임아웃까지 응답이 전혀 없음(`HTTP 000`). `OPTIONS` 프리플라이트조차 응답 없음. Origin 헤더 유무와 무관하게 동일 증상.
- **원인 추정**: 코드 버그가 아니라, 짧은 시간에 자동화 테스트(Playwright 브라우저를 반복적으로 여러 개 띄움)로 요청이 몰리면서 서버 프로세스(Node 이벤트 루프 또는 mysql2 커넥션 풀)가 응답 불능 상태에 빠진 것으로 보임. 재현 조건을 정확히 특정하지는 못함(별도 조사 필요 항목으로 아래 체크리스트에 남김).
- **해결**: WAS 프로세스를 강제 종료 후 재시작 → 즉시 0.2초대로 정상 응답 복구.
- **처음 세운 가설(브라우저 캐시)은 틀렸음**: 정적 파일 서버가 `Cache-Control` 헤더를 안 보내서 브라우저가 이전 버전 JS를 캐시했을 거라고 처음엔 판단했으나, 실제로는 서버가 아예 응답을 안 하고 있었던 것으로 확인되어 정정함.

### 2) 로그인/OCR 요청 횟수 제한(rate limit)에 걸림

- **증상**: 위 hang 해결 후에도 간헐적으로 로그인 리다이렉트가 안 되거나 OCR 요청이 실패.
- **원인**: 이 저장소의 로그인 라우트는 15분당 5회, OCR 라우트는 분당 10회로 **IP 단위** 요청을 제한한다. 그런데 개발/테스트가 전부 로컬 macOS 한 대에서 이뤄져서, **AI(Claude)가 진단용으로 실행한 자동화 브라우저 테스트와 실제 사용자의 브라우저가 정확히 같은 IP(`localhost`/`::1`)를 공유**한다. AI가 진단 목적으로 로그인을 반복 호출하면 그 카운트가 사용자의 실제 시도 몫까지 깎아먹어, 사용자가 정상적으로 로그인해도 429("로그인 시도가 너무 많습니다")로 막히는 상황이 발생.
- **해결**: WAS 재시작(요청 횟수 카운터가 메모리에만 있어 재시작하면 즉시 초기화됨) + 이후 AI 쪽에서 반복 자동화 테스트를 자제.
- **재발 방지 메모**: 로컬에서 AI와 사람이 동시에 같은 서버를 테스트할 때는 이 충돌을 염두에 둬야 함. 급하면 재시작으로 즉시 리셋 가능하고, 근본적으로는 rate limit 설정에 개발 환경용 예외(예: `NODE_ENV=development`일 때 제한 완화)를 두는 것도 고려해볼 만함(아직 적용 안 함).

---

## 확인해야 할 것 (체크리스트)

- [ ] **파싱 실패/부정확 시 UX** — 날짜·금액·기타 필드를 못 찾거나 잘못 뽑았을 때 관리자가 알아챌 방법이 없음(목록에 파싱 결과 자체를 안 보여주기로 했으므로). 미리보기는 강조 없이 원본 텍스트만 보여주므로 이 부분에 직접적인 도움은 안 됨 — 여전히 미정.
- [ ] **원문 재조회 필요성** — 목록 API가 원문을 아예 안 내려주기로 했는데, 나중에 관리자가 특정 문서의 원문을 다시 봐야 할 상황(예: 분쟁 확인)이 생기면 어떻게 할지. 지금은 그런 상세조회 기능이 없음.
- [ ] **운영 환경 인터넷 접근 여부 확인** — `tesseract.js`는 첫 실행 시 `kor+eng` 언어 데이터를 인터넷에서 내려받는다. 병원 내부망처럼 외부 인터넷이 막힌 환경에 배포한다면 언어 데이터를 사전에 다운로드해서 같이 배포해야 한다.
- [ ] **예상 사용량 대비 워커 풀 크기 점검** — 현재 `tesseract.js` 워커는 프로세스당 2개 고정(`WORKER_POOL_SIZE`, [was/routes/ocr.js](was/routes/ocr.js)). 관리자가 동시에 여러 명 스캔할 상황이 있다면 이 값과 rate limit(분당 10회)이 충분한지 재검토.
- [ ] **세션 쿠키 보안 설정** — OCR 접근 제어가 세션(`req.session.role`)에 의존하는데, 현재 세션 쿠키는 `httpOnly: false`이고 `secure` 미설정 상태다(`was/server.js`, `VULNERABILITIES.md` #7). 이건 담당이 다른 항목이지만, 세션이 털리면 관리자 권한 검사도 같이 무력화된다는 점은 인지해두는 게 좋음.
- [ ] **로컬 DB 재설정 필요** — `miso-hospital-3tier-secure-master` 포팅을 검증하면서 로컬 `vulnapp` DB가 그 저장소의 스키마(bcrypt 해시, 암호화된 rrn)로 재시드됨. 이 저장소 기준으로 다시 테스트하려면 이 저장소의 `db/init.sql`을 다시 실행해서 `role` 컬럼과 `admin` 계정이 의도대로 들어가는지 재확인 필요.
- [ ] **WAS 서버 hang 근본 원인 미조사** — secure 저장소 테스트 중 서버가 완전히 응답 불능 상태에 빠진 사례가 있었음(재시작으로 임시 해결). Node 이벤트 루프 문제인지 mysql2 커넥션 풀 고갈인지 등 근본 원인은 확인 못 함 — 재발하면 원인 조사 필요.

---

## 테스트 방법

### 브라우저 (admin.html)
1. `index.html`에서 `admin` / `admin_test_123!`로 로그인 → 자동으로 `admin.html`로 이동
2. 이미지 파일 선택 후 "텍스트 추출" 클릭 → 결과가 아래 textarea에 표시됨
3. 텍스트를 확인/수정한 뒤, 환자와 문서종류 선택 → "저장" 클릭 → 아래 "저장된 스캔 문서" 목록에 이름/날짜·시간/문서종류만 표시됨 (원문 미표시)
4. (차단 확인용) 환자 계정(`patient1`/`pass1234`)으로 로그인한 상태에서 주소창에 `admin.html`을 직접 입력해보면 `board.html`로 돌려보내야 정상
5. (확인됨) 관리자로 로그인한 뒤에도 `board.html`에는 OCR 업로드 UI가 전혀 없는 것이 정상 — 업로드는 `admin.html`에서만 한다.

### API 직접 호출 (curl)

```bash
# 관리자 로그인
curl -c /tmp/cookies.txt -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin_test_123!"}'

# OCR 요청
curl -b /tmp/cookies.txt -X POST http://localhost:3000/api/ocr \
  -F "image=@/path/to/image.png"
```

일반 환자 계정(`patient1`/`pass1234` 등)으로 동일 요청을 보내면 `403`이 반환되어야 정상.

### DB 직접 확인 (mysql)

API 응답만으로는 안 보이는 값(예: `GET /api/documents`가 일부러 안 내려주는 `parsed_date`/`parsed_amount`/`parsed_fields`, `extracted_text`)을 직접 확인할 때 사용.

```bash
# 접속 (반드시 --default-character-set=utf8mb4 붙일 것 — 안 붙이면 한글이 깨져서 저장/조회될 수 있음.
# 실제로 admin 계정 이름이 이걸 빠뜨려서 깨진 적이 있었음)
mysql -u vulnuser -pvulnpass vulnapp --default-character-set=utf8mb4
```

접속 후(또는 `-e "..."` 옵션으로 한 줄 실행) 자주 쓰는 조회:

```sql
-- 계정 목록과 역할(관리자 전용 기능 접근 권한) 확인
SELECT id, username, role FROM patients;

-- 저장된 스캔 문서 전체(원문/파싱 결과 포함 — API로는 안 내려오는 값들)
SELECT id, patient_id, document_type, parsed_date, parsed_amount, parsed_fields, extracted_text
FROM scanned_documents
ORDER BY id DESC;

-- 특정 환자에게 연결된 문서만
SELECT sd.id, sd.document_type, sd.created_at
FROM scanned_documents sd
JOIN patients p ON p.id = sd.patient_id
WHERE p.username = 'patient1';
```

한 줄로 바로 실행하고 싶으면 (매번 접속 안 해도 됨, 이 문서의 다른 테스트 기록들도 이 방식으로 확인함):

```bash
mysql -u vulnuser -pvulnpass vulnapp --default-character-set=utf8mb4 -e "SELECT id, patient_id, document_type, parsed_date, parsed_amount, parsed_fields FROM scanned_documents ORDER BY id DESC LIMIT 5;"
```

**주의**: 원본 저장소와 `miso-hospital-3tier-secure-master`(현재는 `miso-hospital-3tier-secure-ocr`로 개명)가 로컬에서 같은 DB(`vulnapp`)를 공유한다 (위 "다른 저장소로 포팅" 섹션 참고). 그래서 지금 이 명령으로 보이는 데이터가 어느 저장소 기준인지는, 마지막으로 어느 저장소의 `db/init.sql`을 실행했는지에 따라 달라진다 — `patients.password` 컬럼 값이 평문이면 원본 저장소, `$2b$...`로 시작하는 bcrypt 해시면 secure 저장소 기준이다.

---

## 2026-09-04 진행 상황 — 랜딩 페이지 + 저장소 정리

### 폴더명 변경: `-master` → `-ocr`

작업 도중 `miso-hospital-3tier-secure-master` 폴더 이름을 `miso-hospital-3tier-secure-ocr`로 변경함. 이 문서의 위쪽 섹션들(특히 "다른 저장소로 포팅")에 남아있는 `-master` 경로 표기는 당시 기록 그대로 두고, 실제 작업은 새 이름(`-ocr`) 기준으로 진행함.

**겪은 문제**: 이름 변경 시점과 AI의 파일 작업(랜딩 페이지 `index.html` 작성)이 겹치면서, 옛 이름(`-master`) 경로에 `frontend/index.html` 파일 하나만 있는 빈 폴더가 새로 생성되는 일이 있었음 (실제 프로젝트 데이터 유실은 아니었고, 이미 이름이 바뀐 뒤였는데 옛 경로로 쓰기 작업이 들어가면서 OS가 그 경로를 새로 만든 것으로 추정). `-ocr` 폴더의 `.git`/`db`/`was`/나머지 프론트 파일은 전부 정상이었음을 확인 후, 스탠딩 처리:
- 랜딩 페이지 결과물을 `-ocr` 쪽 `frontend/index.html`에 다시 적용
- `-master`에 남았던 빈 껍데기 폴더는 삭제

**교훈**: 프로젝트 폴더 이름을 바꿀 계획이면, AI가 같은 세션에서 그 폴더를 다루기 전에 먼저 알려주는 게 안전함 (경로가 세션 중간에 바뀌면 이런 혼선이 생길 수 있음).

### 프론트 랜딩 페이지 추가 (`frontend/index.html`, `frontend/css/style.css`)

기존 `index.html`은 로그인 폼만 있는 페이지였음. 병원 홈페이지 스타일 시안(히어로 배너 + 퀵링크 + 소개 섹션이 있는 마케팅형 레이아웃)을 참고해서, **실제 프로젝트에 있는 기능만으로** 랜딩 영역을 새로 구성:

- 헤더 네비(로고, 진료문의 게시판/회원가입 링크, 로그인 버튼) + 히어로 섹션(실제 기능 3가지 소개: 세션 기반 로그인/CSRF, 진료문의 게시판, 문서 스캔 OCR) + 퀵링크 카드 3개(로그인/회원가입/진료문의 게시판) + 기능 소개 카드 3개 + 로그인 폼(기존 `#loginForm`, `#userid`, `#password` id 그대로 유지해서 `login.js` 수정 없이 동작) + 푸터
- 예약·조회, 건강정보 같이 이 프로젝트에 실제로 없는 메뉴/통계는 넣지 않음 (사진 속 디자인 톤만 참고하고 내용은 프로젝트 실제 기능으로 대체)
- CSS는 `body.landing-page`, `.hero`, `.quicklinks`, `.feature-card`, `.login-card` 등 새 클래스로 `style.css`에 추가만 했고, 기존 `.login-container`/`.board-container` 등은 건드리지 않아서 `board.html`/`signup.html`/`admin.html`/`view.html` 스타일에는 영향 없음
- Playwright로 렌더링 확인(콘솔 에러 없음) + `patient1`/`pass1234`로 실제 로그인 → `board.html` 리다이렉트까지 전체 흐름 확인함
- `signup.html`이 기존 스타일 그대로인 것도 스크린샷으로 재확인함 (랜딩 페이지 CSS가 새 클래스로만 스코프돼서 영향 없음)

### Git: `feature/ocr` 브랜치를 새 저장소로 push

- 기존 `origin`은 `https://github.com/yysong1249/miso-hospital-ocr.git` 그대로 두고, `target`이라는 이름으로 `https://github.com/yysong1249/miso-hospital.git`(빈 저장소) 리모트를 추가
- `feature/ocr` 브랜치 생성 후, 그 시점에 미커밋 상태로 남아있던 변경사항(랜딩 페이지 + `was/middleware/requireAdmin.js` → `requirePermission.js` 전환 등 RBAC 관련 변경 — RBAC 쪽은 이 세션에서 새로 만든 게 아니라 이미 워킹트리에 있던 변경사항을 함께 커밋한 것)을 한 커밋으로 묶어서 커밋
- `git push -u target feature/ocr`로 push 완료: https://github.com/yysong1249/miso-hospital/tree/feature/ocr
- PR 생성 여부는 아직 미정 (사용자 확인 대기 중)

### 로컬 프론트 서버 관련 메모

`-ocr` 폴더에서 `python3 -m http.server 5500`로 오래 떠 있던 프로세스가 새로 고친 파일(`index.html`)을 계속 404로 못 찾는 문제가 있었음 — 재시작하니 바로 해결됨. 원인은 정확히 특정 못 했지만(폴더 이름 변경 전에 뜬 프로세스였다는 점이 의심됨), **파일을 고쳤는데 브라우저에 반영이 안 되면 정적 서버부터 재시작**해볼 것.

백엔드(`node server.js`, 포트 3000)와 프론트 서버(포트 5500)는 이미 로컬에 켜져 있고, MySQL도 `vulnapp` DB에 시드까지 끝난 상태 확인함 (`node seed.js`를 다시 돌릴 필요 없음). 프론트는 반드시 5500 포트로 열어야 CORS가 통과됨 (`was/config.js`의 `allowedOrigin` 참고).

### 로그인 페이지 분리 + 메인 페이지가 로그인 상태를 반영하도록 변경

- `frontend/login.html` 신설 — 랜딩 페이지(`index.html`) 맨 아래 박혀있던 로그인 폼을 별도 페이지로 분리 (기존 `#loginForm`/`#userid`/`#password` id 그대로라 `login.js` 수정 없이 동작)
- `frontend/js/home.js` 신설 — `index.html`이 뜨면 `/api/me`로 로그인 여부를 확인해서, 로그인 상태면 헤더의 "로그인" 버튼을 "OO님 + 로그아웃"으로, 히어로 버튼/퀵링크 카드를 "게시판 바로가기"(관리자는 "문서 스캔"도 추가)로 자동 전환. 로그아웃 버튼은 `POST /api/logout` 호출 후 `index.html`로 이동.
- `login.js`: 로그인 성공 시 이동 대상을 `board.html` → `index.html`로 변경 (곧장 게시판으로 보내지 않고, 로그인된 상태의 메인 페이지를 먼저 보여줌)
- `board.js`/`admin.js`/`signup.js`/`signup.html`의 로그인 관련 리다이렉트를 전부 `index.html` → `login.html`로 통일 (이제 `index.html`은 로그인 폼이 없는 랜딩 페이지이므로, 실제 로그인이 필요한 곳은 전부 `login.html`을 가리켜야 함)
- **처음에 놓쳤던 버그**: 퀵링크 카드 3개 중 "로그인" 카드를 로그인 상태에서 "진료문의 게시판"으로 바꿨더니, 원래 있던 3번째 카드("진료문의 게시판")와 완전히 중복되고 "회원가입" 카드는 로그인 상태에서도 그대로 남는 문제가 있었음. Playwright 스크린샷으로 발견 → "로그인" 카드는 "새 문의 작성"(`board.html#inquiryForm`)으로, "회원가입" 카드는 관리자면 "문서 스캔"으로 바꾸고 아니면 아예 제거하도록 수정.

### 게시판/문의상세 페이지를 메인 페이지와 같은 톤으로 리디자인

- `board.html`, `view.html`을 랜딩 페이지와 같은 네이비·민트 헤더/브레드크럼/카드 스타일로 변경 (`frontend/css/style.css`에 `.page-header`, `.panel`, `.board-table`, `.user-chip`, `.btn-logout` 등 클래스 추가)
- 문의 목록을 `<ul>`에서 표(번호/제목/작성일)로 변경, 제목 검색창(클라이언트 사이드 필터) 추가
- `was/routes/board.js`의 `GET /api/board`가 `created_at`도 함께 반환하도록 SELECT 컬럼 추가 (기존엔 `id, patient_id, title`만 반환해서 작성일을 표시할 수가 없었음)
- 두 페이지 모두 헤더에 사용자 이름 + 로그아웃 버튼을 넣어서, `index.html`의 로그인 상태 UI와 통일

### LAN 접속 시 옛날 페이지가 보이는 문제 — 원인은 브라우저 캐시, 겸사겸사 서버 hang 버그도 발견

- **증상**: `http://172.16.24.67:5500`(다른 기기에서 LAN IP로 접속)로 들어가면 오늘 고친 페이지가 아니라 아주 예전(오늘 작업 시작 전) 로그인 페이지가 그대로 보임. `curl`로 서버에 직접 물어보면 최신 파일이 정확히 내려오는 것으로 확인 — **서버 문제가 아니라 그 기기 브라우저가 예전 응답을 캐시해두고 계속 재사용**하고 있던 것.
- **재발 방지책**: `frontend/serve.py` 신설 — 매 응답에 `Cache-Control: no-store` 등을 붙여서 브라우저가 아예 캐시를 못 하게 하는 정적 서버. `python -m http.server` 대신 `python3 serve.py 5500`으로 실행.
- **`serve.py`를 만들면서 진짜 버그를 하나 더 발견함**: 처음 버전은 기본 `http.server.HTTPServer`를 썼는데, 이건 연결을 한 번에 하나씩만 처리한다. `curl`은 연결을 하나만 쓰니까 멀쩡했지만, 실제 브라우저(Playwright로 재현)가 페이지 로드하면서 여러 연결을 동시에 여는 순간 서버 전체가 완전히 멈춰버림(`curl`도 같이 응답 없음, `HTTP 000`). **위쪽 "포팅 검증 중 발생한 오류 2건 — WAS 서버 hang"과 완전히 같은 종류의 버그**(단일 스레드 서버 + 여러 연결)가 이번엔 프론트 정적 서버 쪽에서도 재현된 것 — `http.server.ThreadingHTTPServer`로 바꿔서 해결. Playwright로 로그인→게시판→로그아웃 전체 흐름을 이 서버로 재검증 완료.

### Git: 두 번째 커밋 push + `페이지수정.md` 신설

- 위 로그인 분리/게시판 리디자인 변경사항을 `feature/ocr` 브랜치에 커밋 → `git push` (이미 `target/feature/ocr`를 추적 중이라 그냥 `git push`만으로 반영됨)
- 프론트 변경사항만 간략히 정리하는 `페이지수정.md`를 저장소 루트에 새로 만들어서 같이 커밋/push (원래 Desktop 루트에 빈 파일로 있던 걸 저장소 안으로 옮겨서 작성 — git에 추가하려면 저장소 폴더 안에 있어야 하기 때문)

---

## 2026-09-07 — 챗봇 API 키 / 암호화 키 관련 문제 (담당 외 항목, 사용자 요청으로 기재)

> 이 섹션은 문서 맨 위 안내("OCR 관련 작업만 정리, 챗봇은 별도 담당")의 예외로, 서버 재기동 중 우연히 발견된 문제를 사용자 요청에 따라 개선사항으로 남겨두는 것이다. 실제 수정은 진행하지 않았다(코드 변경 제안은 반려됨).

### 1) Gemini 모델 단종으로 챗봇이 응답 불가 상태

- **증상**: `/chat` 호출 시 항상 `"죄송합니다. 현재 챗봇 서비스에 문제가 발생했습니다."`만 반환. HTTP 상태는 200이라 클라이언트 쪽에서는 정상 요청처럼 보임.
- **원인**: `chatbot-service/3-1-llm.py`의 기본 모델 `gemini-2.5-flash`가 신규 사용자에게 404로 차단됨(Google 측 단종). `.env`의 `GEMINI_MODEL`을 `gemini-1.5-flash`로 바꿔도 동일하게 404(`models/gemini-1.5-flash is not found for API version v1beta`) — 더 오래된 모델이라 이미 함께 단종된 상태.
- **개선 필요**: 현재 키로 실제 사용 가능한 모델 목록을 확인해 `GEMINI_MODEL`을 유효한 값으로 갱신 필요. 또한 `google.generativeai` 패키지 자체가 지원 종료(deprecated)되어 매 요청마다 `FutureWarning`이 발생 중 — 후속 `google.genai` 패키지로의 마이그레이션도 검토 필요.
- **부가 문제(에러 은폐)**: `app.py`의 `/chat` 핸들러가 `run_agent()`의 모든 예외를 뭉뚱그려 잡아 사용자에게는 항상 같은 안내 문구만 보여주고, 실제 원인(404 등)은 서버 로그에만 남는다. 운영 중 챗봇이 조용히 죽어 있어도 겉보기엔 "정상 응답(200)"이라 알아채기 어려움 — 관리자용 상태 모니터링/알림 또는 최소한 에러 유형별 로그 레벨 구분이 필요.

### 2) `.env` 안내 문구와 실제 코드 불일치 (Gemini ↔ DeepSeek)

- `chatbot-service/.env`의 주석은 "DeepSeek API Configuration / 새로 발급받은 DeepSeek API 키를 입력해 주세요"라고 안내하지만, 실제 `3-1-llm.py`는 `google.generativeai`(Gemini 전용)로 하드코딩되어 있어 DeepSeek 키를 넣으면 애초에 동작하지 않는다 (코드 주석에도 "교육용으로 다른 프로바이더는 넣지 않음"이라 명시됨).
- 이번엔 실제로 입력된 키 값이 Gemini 형식(`AIzaSy...`)이라 이 불일치가 실패의 직접 원인은 아니었지만, 안내 문구만 보고 DeepSeek 키를 발급받아 넣으면 바로 실패할 수 있는 상태 — `.env` 주석을 실제 지원 프로바이더(Gemini)에 맞게 수정하거나, DeepSeek 지원을 실제로 추가하는 쪽으로 정리 필요.

### 3) `.env` 파일 포맷 오류 (주석에 `#` 누락)

- `.env`의 설명용 줄들(`---------`, `DeepSeek API Configuration` 등)이 `#` 없이 일반 텍스트로 들어가 있어, `python-dotenv`가 매 기동마다 `python-dotenv could not parse statement starting at line N` 경고를 여러 줄 출력함. `KEY=VALUE` 형식의 줄 자체는 정상 파싱되어 치명적이지는 않지만, 로그 노이즈이자 잠재적 혼선 요인 — 설명 줄 앞에 `#`을 붙여야 함.

### 4) 감사 로그 암호화 키가 두 군데로 이원화되어 있음

- `chatbot-service/app.py`: 프로젝트 루트에 `secret.key` 파일이 없으면 `Fernet.generate_key()`로 **자동 생성**해서 사용 — SQLite(`chatbot_logs.db`)에 저장되는 감사 로그(원문 질문)를 암호화하는 키.
- `chatbot-service/audit_decorator.py`: `.env`의 `AUDIT_ENCRYPTION_KEY`를 사용 — `audit-agent`(JSONL, `audit-logs/`)로 남는 별도의 감사 로그 파이프라인을 암호화하는 키.
- 즉 같은 서비스 안에 "감사 로그"라는 이름의 암호화된 저장소가 **키도 다르고 저장 위치·포맷도 다르게 두 벌** 존재한다. 어느 로그가 공식 감사 기록인지, 왜 두 벌이 필요한지가 코드만 봐서는 불명확 — 정리(통합 또는 역할 문서화) 필요.
- **특히 `secret.key`는 자동 생성 + 파일로만 존재**(백업 언급 없음)라서, 이 파일을 유실하면 `chatbot_logs.db`에 이미 저장된 암호화 원문 질문들을 영구히 복호화할 수 없게 된다. `secret.key`/`.env` 모두 `.gitignore`에 포함되어 git에는 올라가지 않는 것은 확인됨(정보 유출 방지 측면에선 정상) — 다만 그 말은 곧 **git 히스토리로도 복구가 안 된다**는 뜻이라, 로컬 파일이 지워지면 별도 백업 없이는 못 살린다는 점은 그대로 리스크로 남는다.

### 문제점
암호화 키(챗봇 이용 중 pii를 마스킹하기 위해 필요)를 하드코딩해 놓음. 챗봇 담당자 서버에서는 처음부터 암호화 키가 고정이었고, 외 2명 서버에서는 암호화 키 없이 api만 고정으로 돌아가며 서버 시작할 때마다 키가 변경되어 영원히 챗봇을 이용할 수 없게 됨.
개선 방안 
1. 암호화 키를 kms로? (키 발급 서버를 따로 구축해야 함)
2. 키를 변수로 두고 kms에서 키를 시간단위로 갱신해서 가져다 쓰도록? 30분 단위?

- 챗봇 안 되는 거
server.js, chat.js 파일 변경(뭐가 변경됐는지 상세하게 확인)

---

## 2026-09-08 — 랜딩 페이지 기능 재확인: "예약"은 여전히 없고, "진료기록 조회"는 실제로 추가됨

**배경**: 위 2026-09-04 섹션에서 랜딩 페이지에 "예약·조회, 건강정보 같이 실제로 없는 메뉴"는 넣지 않기로 결정했었다. 그 이후 세션에서 실제로 기능이 추가된 게 있는지 다시 확인해봄.

**재확인 결과** (`was/server.js`의 라우트 등록 + `frontend/` 실제 파일 기준):
- **프론트 화면까지 있는 실제 기능**: 게시판(`board.html`), 문서 스캔 OCR(`admin.html`, 관리자 전용), **진료기록 조회(`frontend/records.html`, "내 진료기록")** — 이건 09-04 랜딩 작업 이후에 새로 생긴 기능, 챗봇 위젯(`frontend/js/chat-widget.js`)
- **API는 있지만 연결된 프론트 화면이 하나도 없는 것**: `/api/reservations`(예약), `/api/accounts`(계정 관리), `/api/audit-log`(감사 로그 조회) — `was/routes/`에 라우트 파일은 있으나 `frontend/` 어디에도 이 API를 호출하는 페이지·버튼이 없음

**결론**: "진료기록 조회"는 이제 랜딩 페이지에 넣어도 되는 진짜 기능이지만, "예약"은 여전히 넣으면 안 된다(클릭해도 갈 페이지가 없어 사용자가 실제로 쓸 수 없음). 랜딩 페이지에 실제로 반영할지는 아직 미정 — 요청 시 진행.