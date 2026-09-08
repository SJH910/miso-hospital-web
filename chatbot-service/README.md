# 🔒 미소 병원 3-Tier 웹 프로젝트

이 저장소는 취약점 실습용 원본 프로젝트의 보안 강화 버전입니다. 이 문서는 그 위에 **새로 추가/수정된 사항**만 기록합니다.

계정 정보
username	password	role
patient1	pass1234	patient
patient2	pw5678	patient
patient3	qwerty1	patient
staff1	staff1234	staff
admin	admin_test_123!	admin
newpatient1	newpass123	patient


## 실행 방법

```bash
cd was
npm install
node seed.js      # 더미 계정/게시글 생성 (비밀번호 해시·주민번호 암호화·역할(role) 부여를 이 스크립트가 처리)
node server.js

cd ../frontend
python3 -m http.server 5500
```

환경변수(선택, 운영 배포 시 필수): `SESSION_SECRET`, `RRN_ENCRYPTION_KEY`(32바이트 hex), `FRONTEND_ORIGIN`, `USE_HTTPS=true`

테스트 계정 (`was/seed.js` 참고): `patient1`/`pass1234`, `patient2`/`pw5678`, `patient3`/`qwerty1`(모두 일반 환자), `staff1`/`staff1234`(원무/접수), `admin`/`admin_test_123!`(관리자 — 문서 스캔·계정 관리·진료기록 작성·감사 로그 조회 가능)

> OCR 기능은 첫 실행 시 `tesseract.js`가 언어 데이터(`kor`/`eng`, 약 7MB)를 인터넷에서 자동으로 내려받습니다. 오프라인 환경에 배포한다면 사전에 받아둔 `.traineddata` 파일을 `was/`에 미리 배치해야 합니다.

> 로그인 rate limit(IP당 15분에 5회)은 같은 컴퓨터에서 자동화 테스트와 실제 로그인을 동시에 하면 카운트를 공유해 서로 영향을 줄 수 있습니다. 원인 모를 429가 뜬다면 이걸 의심해보세요.

---

## 신규 기능: 문서 스캔 (OCR, 관리자 전용)

처방전/진단서/영수증 이미지에서 텍스트를 추출해 환자 기록으로 저장하는 기능을 추가했습니다. 원본 저장소(`miso-hospital-3tier/`)에서 먼저 설계·구현한 뒤, 이 저장소의 기존 보안 패턴(CSRF 토큰, bcrypt, AES 암호화 등)에 맞춰 이식했습니다. 설계 과정에서의 세부 의사결정(문서 종류 분류 도입 경위, 필드 파싱 규칙, 신뢰도 강조 표시를 만들었다가 뺀 이유 등)은 원본 저장소의 `OCR.md`에 기록되어 있습니다.

| | 내용 |
|---|---|
| 신규 파일 | `was/middleware/requirePermission.js`, `was/routes/ocr.js`, `was/routes/patients.js`, `was/routes/documents.js`, `frontend/admin.html`, `frontend/js/admin.js` |
| 수정 파일 | `db/init.sql`(`patients.role` 컬럼, `roles`/`permissions`/`role_permissions` 테이블, `scanned_documents` 테이블 추가), `was/seed.js`(admin 계정에 `role='admin'` 부여), `was/routes/auth.js`(로그인/`/api/me` 응답에 `role` 포함), `was/server.js`(라우트 등록), `was/package.json`(`multer`, `tesseract.js` 추가), `frontend/board.html`/`frontend/js/board.js`(관리자에게만 보이는 이동 버튼), `frontend/css/style.css` |
| 접근 권한 | RBAC 기반 — `admin` 역할에 `ocr:scan`/`documents:create`/`documents:view`/`patients:view` 권한이 매핑되어 있고, 라우트는 이 권한 이름만으로 접근을 검사함. 일반 환자 계정(`patient` 역할)은 권한이 없어 관련 API가 전부 403 |

### 동작 흐름

1. 로그인 후 `board.html`에서 "문서 스캔 페이지로 이동" 버튼 클릭 (이 버튼은 관리자 계정에게만 보임) → `admin.html`로 이동
2. 이미지 업로드 → `POST /api/ocr` — `tesseract.js`(`kor+eng`)로 텍스트 추출. 파일은 디스크에 쓰지 않고 메모리 버퍼로만 처리하며, 업로드된 파일의 매직 바이트를 검사해 실제 이미지 형식인지 확인 (`Content-Type`/확장자는 신뢰하지 않음)
3. 추출된 텍스트를 관리자가 확인/수정한 뒤, 환자와 문서종류(처방전/진단서/영수증)를 선택해 `POST /api/documents`로 저장
4. 저장 시 원문에서 날짜·금액·기타 "라벨: 값" 형태의 필드를 정규식으로 함께 파싱해 저장 (OCR 인식 오류가 그대로 이어질 수 있는 참고용 데이터 — best-effort)

### 이 저장소의 기존 보안 패턴에 맞춰 통합한 부분

```js
// was/routes/ocr.js, was/routes/documents.js
// 다른 상태 변경 POST(board.js)와 동일하게 CSRF 토큰 검증을 첫 게이트로 적용
router.post("/", verifyCsrfToken, requirePermission("ocr:scan"), ...);
```

- **역할(role) 기반 접근 제어**: 이 프로젝트에 원래 없던 개념이라 `patients.role ENUM('patient','admin')` 컬럼을 새로 추가
- **비밀번호/주민번호 처리(bcrypt, AES-256-GCM)는 그대로 유지** — OCR 관련 코드는 이 부분을 건드리지 않음
- **`express-rate-limit` 버전**: 이 저장소가 이미 쓰던 v7 방식(`const rateLimit = require(...)`)에 맞춰 작성

### RBAC (역할 기반 접근 제어)

처음에는 `requireAdmin` 미들웨어가 `req.session.role !== "admin"`을 직접 비교하는 방식이었다. 역할과 "할 수 있는 행위(권한)"가 분리되어 있지 않아 이름만 RBAC이지 사실상 역할 문자열 하드코딩 체크에 가까웠다. 이를 역할(Role)과 권한(Permission)을 분리한 구조로 바꿨다.

```sql
-- db/init.sql (2026-09-03 당시 스키마 — 권한 목록은 이후 계속 늘어남, 최신 목록은 "RBAC 확장" 섹션 참고)
roles(id, name)                                  -- 'patient', 'admin'
permissions(id, name)                            -- 'ocr:scan', 'documents:create', 'documents:view', 'patients:view'
role_permissions(role_id, permission_id)         -- 역할 <-> 권한 다대다 매핑
```

```js
// was/middleware/requirePermission.js
// 라우트는 "admin"이라는 역할 이름을 몰라도 되고, 자신에게 필요한 권한 이름만 선언한다.
router.post("/", verifyCsrfToken, requirePermission("ocr:scan"), ...);
router.get("/", requirePermission("documents:view"), ...);
```

- `role_permissions` 매핑만 바꾸면 코드 수정 없이 역할별 권한을 조정할 수 있음 (예: "조회만 가능한 역할"을 나중에 추가해도 라우트 코드는 그대로)
- 조회 비용을 줄이기 위해 역할→권한 매핑을 서버 프로세스 내 메모리에 캐싱 (`requirePermission.js`의 `permissionsByRole`) — 이 매핑은 배포 중 거의 바뀌지 않는 참조 데이터이므로 매 요청 DB 조회 대신 캐싱이 적절하다고 판단
- 현재는 계정당 역할 1개(`patients.role`)만 지원 — 여러 역할을 동시에 가지는 구조(`user_roles` 다대다)까지는 지금 범위에서 도입하지 않음
- ~~게시판(`board.js`) 등 기존 기능은 이 변경의 대상이 아님~~ — **2026-09-04 이후로는 사실이 아님.** 게시판도 포함해 프로젝트 전체에 RBAC을 적용했다. 아래 "RBAC 확장" 섹션 참고

### 보안 설계 포인트

- **파일 업로드**: `multer.memoryStorage()`로 디스크에 절대 쓰지 않음 — 경로 조작/웹쉘 업로드 같은 "저장된 파일" 계열 취약점이 애초에 성립하지 않는 구조
- **원문 비노출**: 저장된 문서 목록 조회(`GET /api/documents`)는 OCR 원문(`extracted_text`)과 파싱된 필드(`parsed_fields`)를 응답에 아예 포함하지 않음 — 화면에서 숨기는 게 아니라 서버가 애초에 내려주지 않는 방식
- **민감정보 차단**: 파싱 결과(`parsed_fields`)에서 주민등록번호/연락처/카드번호/계좌번호에 해당하는 라벨은 제외
- **환자 조회 라우트 없음**: 환자가 스캔 문서를 조회할 수 있는 라우트 자체를 아예 만들지 않음 (관리자만 조회 가능)
- **rate limit**: OCR은 CPU 비용이 크므로 로그인 사용자 단위로 분당 10회 제한

### 알려진 한계

- OCR 인식 오류는 구조적으로 피할 수 없음 (특히 라틴 문자와 한글 자모가 비슷하게 생겨 혼동되는 경우)
- 필드 파싱은 정규식 기반 best-effort이며 완벽한 정확도를 보장하지 않음 — 진료비 정산 등 중요한 판단에 그대로 쓰면 안 되고 참고용으로만 취급해야 함
- 저장된 문서의 원문을 나중에 다시 조회하는 상세보기 기능은 아직 없음

---

## RBAC 확장: 예약 · 문의 답변 · 환자 등록 · 진료기록 · 감사 로그 (2026-09-04)

위 OCR용으로 만든 RBAC 구조(`roles`/`permissions`/`role_permissions` + `requirePermission`)를 프로젝트 전체로 확장했다. 자세한 설계 배경·의사결정 과정은 원본 저장소의 `RBAC-Plan.md`에 있고, 여기서는 이 저장소에 실제로 반영된 내용만 요약한다.

### 신규 역할: `staff` (원무/접수)

`patients.role`이 `ENUM('patient', 'admin')`에서 `ENUM('patient', 'staff', 'admin')`으로 확장됐다. 테스트 계정은 `staff1`/`staff1234`.

### 역할별 권한 매핑 (전체, 2026-09-04 기준)

| 권한 | patient | staff | admin | 용도 |
|---|---|---|---|---|
| `board:read` / `board:write` | ✅ | | ✅ | 진료문의 게시판 (기존 기능) |
| `board:reply` | | ✅ | ✅ | 게시판 문의에 답변 |
| `reservations:create` / `reservations:view:own` | ✅ | | | 본인 예약 생성/조회 |
| `reservations:manage` | | ✅ | ✅ | 전체 예약 조회/확정/취소 |
| `patients:register` | | ✅ | ✅ | 환자 계정 대리 등록 |
| `records:view:own` | ✅ | | | 본인 진료기록 조회(원문) |
| `records:view:masked` | | ✅ | | 진료기록 조회(마스킹) |
| `records:view:full` / `records:write` | | | ✅ | 진료기록 조회(원문)/작성 |
| `accounts:manage` | | | ✅ | 계정 목록 조회, 역할 변경 |
| `audit:view` | | | ✅ | 감사 로그 조회 |
| `ocr:scan` / `documents:*` / `patients:view` | | | ✅ | 문서 스캔(OCR, 기존 기능) |

### 신규/수정 파일

| | 내용 |
|---|---|
| 신규 | `was/audit.js`(감사 로그 기록 헬퍼), `was/routes/reservations.js`, `was/routes/records.js`, `was/routes/auditLog.js` |
| 수정 | `db/init.sql`(`staff` 역할, 신규 권한 10개, `reservations`/`medical_records`/`audit_log` 테이블, `board_posts`에 `answer`/`answered_by`/`answered_at` 컬럼), `was/middleware/requirePermission.js`(미들웨어 없이도 직접 쓸 수 있는 `hasPermission()` 헬퍼 분리), `was/routes/board.js`(전체/본인 조회 분기, 답변 등록), `was/routes/accounts.js`(환자 대리 등록, 역할 변경 시 감사 로그), `was/routes/auth.js`(로그인 성공/실패 감사 로그), `was/seed.js`(`staff1` 계정 추가), `was/server.js`(라우트 3개 등록) |

### 기능별 요약

- **예약** (`POST/GET /api/reservations`, `PATCH /api/reservations/:id/status`) — patient는 본인 명의로만 생성(세션에서 `patient_id`를 가져와 IDOR 방지)하고 본인 것만 조회, staff/admin은 전체 조회 및 상태 변경(확정/취소) 가능. 같은 시간대 중복 예약을 막는 로직은 없음(알려진 한계 참고).
- **문의 답변** (`PATCH /api/board/:id/answer`) — staff/admin이 게시판 전체 문의를 보고 답변을 달면, 해당 환자가 자신의 문의 조회 시 답변을 함께 확인. 답변은 컬럼 하나라 수정 시 이전 답변을 덮어씀(이력 없음).
- **환자 등록** (`POST /api/accounts`) — staff/admin이 환자를 대신 등록. `role`은 서버에서 항상 `'patient'`로 고정되어, 요청 바디로 다른 role을 지정해도 무시됨(관리자 계정을 이 경로로 만들 수 없음).
- **진료기록** (`POST /api/records`, `GET /api/records`) — **admin만 작성**(진료기록 작성자를 별도 "의사" 역할로 분리할지는 미정, `RBAC-Plan.md` 참고). 조회 시 role별로 응답이 갈림: admin과 본인 환자는 `diagnosis`/`treatment` 원문 그대로, staff는 `진단명 앞 2글자+***`, 치료내용은 `***`로 마스킹.
- **계정 관리** (`GET/PATCH /api/accounts`) — admin이 전체 계정을 조회하고 역할을 변경. 마지막 admin이 자기 자신을 강등시켜 아무도 관리 못 하게 되는 상황은 서버에서 차단(400).
- **감사 로그** (`GET /api/audit-log`) — 로그인 성공/실패, 계정 역할 변경, 환자 등록을 자동 기록. admin만 조회 가능, 최신순 페이지네이션.

### 보안 설계 포인트

- **응답에 다른 역할이 볼 필요 없는 값은 안 넣음**: `GET /api/accounts`는 `password`/`rrn` 미포함, 진료기록 마스킹은 `staff`에게 원문 자체를 내려주지 않는 방식(가려서 숨기는 게 아니라 서버가 마스킹 처리 후 응답).
- **IDOR 방지**: 예약 생성 시 `patient_id`를 요청 바디가 아니라 세션에서만 가져옴 — 다른 환자 명의로 예약을 만들 수 없음.
- **자기 자신 권한 강등 방지**: `PATCH /api/accounts/:id/role`에서 admin이 스스로를 낮추는 요청은 400으로 차단.
- **감사 로그 실패가 원 요청을 막지 않음**: `logAudit()`은 내부에서 에러를 잡아 로그만 남기고, 감사 로그 기록이 실패해도 로그인/계정변경 같은 원래 동작 자체는 정상 처리됨.

### 알려진 한계

- 프론트엔드 화면(예약 관리, 답변 작성, 진료기록 조회, 감사 로그 조회, 환자 등록 UI)은 아직 없음 — API만 구현, 화면은 별도 담당자가 진행 예정
- 예약 시간대 중복/용량 제한 없음, 진료과(`department`)는 자유 텍스트 입력
- 문의 답변은 수정 이력이 안 남음(덮어쓰기)
- 감사 로그는 삭제/보관 기간 정책 없이 무기한 누적

---

## 챗봇 서비스 보안 강화 및 파이프라인 통합 (2026-09-08)

오늘 진행된 챗봇 모듈(`chatbot-service`) 통합 과정에서 적용된 주요 보안 강화 및 버그 수정 사항입니다.

### 작업 내용 요약

- **감사 로그(Audit Log) 데코레이터 전면 적용**:
  - 기존에 데모용으로 남아 사용되지 않던 `audit_decorator.py`의 `audit_log`를 `hospital_agent.py` 내의 모든 핵심 도구 함수(`tool_rag`, `tool_direct_answer`, `tool_book_appointment`, `tool_check_appointments`, `tool_check_medical_records`, `tool_list_documents`)에 일괄 적용했습니다.
  - **결과**: 챗봇이 수행하는 모든 주요 동작이 비동기적으로 PII 마스킹, KMS 암호화, 무결성 해시 체이닝을 거쳐 `audit-logs/audit_log.jsonl`에 안전하게 기록됩니다.
  - 추가로, 각 도구의 성격에 맞게 식별자(Action Name)를 명시적으로 부여하여 추후 로그 분석이 용이하도록 개선했습니다.

- **FastAPI 서버 크래시(Crash) 취약점 수정**:
  - `3-1-llm.py` 및 `2-embeddings.py` 내의 `require_gemini()` 함수에서 API 키가 누락되었거나 필수 패키지가 없을 때 `sys.exit(1)`을 호출하도록 하드코딩되어 있던 치명적인 문제를 발견했습니다.
  - **수정사항**: `sys.exit(1)` 로직을 `raise ValueError` 및 `raise ImportError` 형태의 예외 처리(Exception)로 교체했습니다.
  - **결과**: 환경변수 설정 누락 시 웹 서버(FastAPI) 전체 프로세스가 강제로 다운되는 현상을 방지하고, 에러를 안전하게 캐치하여 서버의 안정성을 대폭 향상시켰습니다.

### 확인된 추가 보안/구조적 보완점 (추후 과제)
- `app.py` 단의 SQLite 암호화 로그와 `audit_decorator.py`의 JSONL 로그가 중복 동작하는 파편화 현상이 존재하므로 통합이 필요합니다.
- `slowapi`를 이용한 Rate Limiting이 프록시 환경에서 클라이언트 IP가 아닌 서버 IP로 고정될 우려가 있어 우회 방지 검토가 필요합니다.
- 자연어 파싱(`tool_book_appointment`) 시 악의적인 특수문자 조합으로 인한 정규표현식(Regex) 과부하(ReDoS) 공격 방어 로직 추가가 고려되어야 합니다.

---

## 확정 필요 / 확인 필요 사항 (2026-09-04 기준)


**확정 필요**:
- 역할 세분화(의사/간호사 등 추가 역할 필요 여부), 예약 시간대 중복 제한, 진료과 고정 목록화, 답변 이력 관리, 감사 로그 보존 정책 — 전부 미정.

**확인 필요**:
- **`npm audit` 취약점 5건 미조치** (`moderate 3, high 1, critical 1`) — `express`→`qs`, `bcrypt`→`tar`의 전이 의존성 문제로 이 프로젝트 코드와는 무관하다고 판단해 남겨뒀던 것. 백엔드 라우트가 늘어난 지금 재검토할 가치가 있는지 확인 필요.
- 프론트 담당자에게 새 API 12개 엔드포인트 스펙을 이 문서/`RBAC-Plan.md`로 전달할지, 별도 API 문서가 필요한지.
- 이번 스키마 변경은 로컬 개발 DB에만 반영됨 — 스테이징/운영 DB가 따로 있다면 그쪽에도 `db/init.sql` 재적용 필요.
