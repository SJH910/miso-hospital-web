# 🔒 미소 병원 3-Tier 웹 프로젝트

이 저장소는 취약점 실습용 원본 프로젝트의 보안 강화 버전입니다. 이 문서는 그 위에 **새로 추가/수정된 사항**만 기록합니다.

계정 정보
username	password	role
patient1	pass1234	patient
patient2	pw5678	patient
patient3	qwerty1	patient
staff1	staff1234	staff
admin	admin_test_123!	admin
admin2	admin_test_456!	admin
admin3	admin_test_789!	admin
newpatient1	newpass123	patient


## 실행 방법

### 최초 1회 (의존성 설치 + 더미 데이터 생성)

```bash
cd was
npm install
node seed.js      # 더미 계정/게시글 생성 (비밀번호 해시·주민번호 암호화·역할(role) 부여를 이 스크립트가 처리)
cd ..
```

### 서버 시작 / 종료

WAS(3000) · 프론트(5500) · 챗봇 서비스(8000)를 한 번에 백그라운드로 띄우고 내리는 스크립트가 프로젝트 루트에 있습니다.

```bash
bash start.sh   # 시작: 세 프로세스를 백그라운드로 실행, PID는 .run/*.pid, 로그는 .run/*.log
bash stop.sh    # 종료: .run/*.pid에 저장된 PID로 세 프로세스를 종료
```

- 재시작(reboot)은 `bash stop.sh && bash start.sh`를 순서대로 실행하면 됩니다.
- 로그 실시간 보기: `tail -f .run/was.log .run/frontend.log .run/chatbot.log`
- 프로세스가 살아있는지 확인: `ps -p "$(cat .run/was.pid)"` (frontend/chatbot도 동일한 방식)
- `start.sh`는 이미 실행 중인지 확인하지 않고 그냥 새로 띄우므로, 먼저 `stop.sh`를 실행하지 않은 채로 다시 `start.sh`를 실행하면 같은 포트를 중복으로 점유하려다 실패할 수 있습니다 — 항상 종료 후 시작하는 순서를 지켜야 합니다.

환경변수(선택, 운영 배포 시 필수): `SESSION_SECRET`, `RRN_ENCRYPTION_KEY`(32바이트 hex), `FRONTEND_ORIGIN`, `USE_HTTPS=true`

테스트 계정 (`was/seed.js` 참고): `patient1`/`pass1234`, `patient2`/`pw5678`, `patient3`/`qwerty1`(모두 일반 환자), `staff1`/`staff1234`(원무/접수), `admin`/`admin_test_123!`, `admin2`/`admin_test_456!`, `admin3`/`admin_test_789!`(관리자 — 문서 스캔·계정 관리·진료기록 작성·감사 로그 조회 가능. 신규 IP 로그인 이상탐지가 아이디 단위라 팀원마다 별도 계정 사용 권장)

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

### 챗봇 로그/키 파일 경로 고정 (2026-09-09)

`chatbot-service/app.py`의 `DB_FILE`(`chatbot_logs.db`)·`KEY_FILE`(`secret.key`)이 상대경로라, 실행 위치(cwd)에 따라 다른 파일을 보는 문제가 있었습니다(`start.sh`로 정상 실행하면 우연히 프로젝트 루트를 봤지만, `chatbot-service/` 안에서 직접 `uvicorn`을 띄우면 그 안에 새 DB·새 키가 생성됨). `Path(__file__).resolve().parent.parent` 기준 절대경로로 고정해, 실행 위치와 무관하게 항상 프로젝트 루트의 같은 파일을 보도록 수정했습니다.

**주의사항**:
- `chatbot-service/`는 항상 프로젝트 루트의 바로 아래(1단계)에 있어야 합니다 — 디렉토리 구조를 재배치하면 `parent.parent` 계산이 틀어집니다.
- `secret.key`는 프로젝트 루트에 있는 파일이 유일한 정본입니다. 이 파일을 잃어버리면 기존에 암호화 저장된 `chatbot_logs.db` 로그를 영구히 복호화할 수 없습니다(백업 없음, `.gitignore`에 포함되어 git 히스토리로도 복구 불가).

**참고사항**:
- 이전에 실수로 `chatbot-service/` 안에 생성됐던 스테일 `chatbot_logs.db`(빈 파일)는 삭제했습니다.
- 자세한 조사 배경(로그 파일 로테이션 확인, 실제 DB 값 검증 등)은 `LogDB_plan.md` 3-2·3-3 섹션 참고.

---

## 위험 로그 등급 분류 · 마스킹 (2026-09-10)

로그인 이상탐지(`ANOMALY_DETECTION.md`)와 챗봇 도구 호출 감사 로그, 두 파이프라인이 남기는 이벤트에 위험도(상/중/하) 등급을 매기고, 로그 안의 아이디(username)를 부분 마스킹 처리했습니다. 설계 배경·위협 모델은 `SECURITY_THREAT_MODEL.md`, 등급 기준표·마스킹 정책·재현 절차는 `RISK_DETECTION_GUIDE.md`에 정리되어 있습니다.

| | 내용 |
|---|---|
| 신규 파일 | `was/risk-classification.js`, `chatbot-service/audit-agent/risk_classification.py`, `SECURITY_THREAT_MODEL.md`, `RISK_DETECTION_GUIDE.md` |
| 수정 파일 | `was/audit.js`(기록 시점에 등급 분류·마스킹 적용), `was/routes/auditLog.js`(`risk_level` 응답 포함, `?risk=` 필터), `db/init.sql`(`audit_log.risk_level` 컬럼 추가 — **재시딩 필요**), `chatbot-service/audit-agent/engine.py`(마스킹 다음 단계로 등급 분류 수행) |
| 핵심 설계 | 등급은 **탐지 시점에** 확정해 저장(사후 재분류 아님). 챗봇 쪽은 악성 의도(프롬프트 인젝션 등)가 탐지되면 원래 action의 등급과 무관하게 "상"으로 강제 승격. 매핑에 없는 신규 이벤트는 기본값을 "하"가 아니라 "중"으로 두어 조용히 저위험 취급되는 것을 방지 |
| 마스킹 범위 | 아이디만 부분 마스킹(`admin` → `adm**`), IP는 침해 대응에 필요해 그대로 유지. 기존 로그는 소급 마스킹하지 않음(챗봇 JSONL은 해시체인 구조상 과거 레코드 수정이 원천적으로 불가) |

---

## 로그인 이상탐지 강화 + PII 마스킹 오탐 수정 (2026-09-14~15)

`ANOMALY_DETECTION.md`(로그인 이상탐지)와 챗봇 PII 마스킹(`pii_masking.py`) 양쪽에서 실제
발생한 우회/오탐 버그를 수정했다. 전체 사례와 재현 방법은 `[ final ] SECURITY_DETECTION_REPORT.md`
3장에 정리되어 있다.

| | 내용 |
|---|---|
| 로그인 이상탐지 | 관리자 계정 대소문자 변형(`admin`/`Admin`/`ADMIN`)으로 반복실패·신규 IP/지역 탐지가 무제한 우회되던 버그 수정(Map 키 소문자 정규화). 100KB 넘는 요청이 body-parser에 막혀 긴 입력값 탐지(200자 기준)조차 못 받고 조용히 500으로 끝나던 미탐 수정(`oversized_request_payload` 이벤트 추가, 413 응답). SQL 인젝션 서명 탐지(`login_anomaly_sqli_pattern`) 추가 |
| PII 마스킹 | "저는 서울에 살아요"/"나는 강남역 근처에 있어요"처럼 지명·음식명이 성씨와 같은 글자로 시작할 때 통째로 이름으로 오마스킹되던 문제를 2단계로 해결 — 1차: 성씨 화이트리스트 + 조사 경계 negative lookahead. 2차: 이름 뒤 경계 판정에 쓰던 `\b`(단어 경계)가 "공백 다음 아무 글자"에서 항상 통과해버리는 근본 원인을 찾아 제거. spaCy 모델을 `ko_core_news_sm`에서 `ko_core_news_md`로 교체해 NER 정확도 향상 |
| 신규 문서 | `INCIDENT_RESPONSE.md`(탐지 이후 대응 절차) |
| 알려진 gap | 트리거 단어("저는" 등) 없이 문장 맨 앞에 단독으로 오는 단어는 여전히 spaCy NER이 사람 이름으로 오인식할 수 있음(예: "김치볶음밥") — NER 경로는 화이트리스트를 거치지 않고 모델 라벨을 그대로 신뢰하도록 설계되어 있어, 희귀 성씨를 놓치지 않는 대신 이런 유형의 오탐 여지가 구조적으로 남아있음. 미해결 |

---

## 회원가입 실명 인증 + 예약 확인 절차 + 프롬프트 인젝션 방어 강화 (2026-09-16~17)

챗봇 브랜치에서 작업된 4가지 기능을 병합했다.

| | 내용 |
|---|---|
| 실명 인증(모의 PASS) | 회원가입이 이름/주민번호를 검증 없이 그대로 받아 가짜 이름으로도 가입되던 문제 수정. `chatbot-service/human.csv`(모의 등록부)와 대조하는 `POST /internal/verify-identity`를 WAS가 호출 — 챗봇 서비스 장애 시 가입을 거부하는 fail-closed 설계. **미해결 gap**: 동일 신원으로 여러 계정 생성 가능, `/api/signup`에 rate limit 없음 |
| 예약 확인 2단계 | 챗봇이 자유 텍스트에서 파싱한 예약을 곧바로 DB에 쓰지 않고 "OO과/일시로 예약할까요?" 확인 메시지 + 예/아니요 버튼을 먼저 제시. 예약 내용은 WAS 세션에만 저장되어 클라이언트가 왕복 중 변조 불가. 챗봇 경로에 없던 시간대별 정원 체크(WAS와 동일 기준)도 추가 |
| 프롬프트 인젝션 방어 강화 | 키워드 매칭(시도 탐지) 외에, LLM 응답에 시스템 지시문 원문이 그대로 포함됐는지 결정론적으로 검사해 유출을 확정 차단. 또한 `patient_id`가 LLM을 절대 거치지 않고 항상 호출자(세션)가 넘긴 값만 쓰도록 구조화해, 인젝션이 탐지를 우회해도 다른 환자 데이터 접근으로는 이어지지 않음 |
| 챗봇 rate limit 분리 | 챗봇이 WAS를 거쳐서만 호출돼 소스 IP가 항상 WAS 서버 하나로 고정되어 rate limit이 병원 전체 공용 버킷이 되던 문제 — `X-Patient-Id` 헤더 기준으로 환자별 분리 |

---

## 관리자 계정 보호 강화: 위치 판단 영속화 + IP 수동 차단 + Discord 실시간 알림 (2026-09-16~17)

| | 내용 |
|---|---|
| 관리자 신규 위치 판단 DB 영속화 | 관리자 계정의 "알고 있는 IP/지역" 목록이 메모리(Map)에만 있어 WAS 재시작 시 초기화되고, 재시작 직후 "기록 없음"이 "새로움 아님"으로 오판돼 TOTP 추가 인증이 통째로 건너뛰어지던 실제 보안 결함 수정(실사용 중 발견). `admin_known_locations` 테이블로 영속화 |
| IP 수동 차단 기능 (신규) | 탐지는 되지만 즉시 막을 수단이 없던 문제 — `ip_blocklist` 테이블 + `security:manage` 권한으로 관리자가 IP를 영구/기간제로 차단·해제. 자기 자신의 접속 IP는 차단 불가(자기잠금 방지). 감사 대시보드에서 이벤트의 IP 옆 버튼 하나로 탐지→차단 연결 |
| Discord 실시간 알림 (신규) | 위험도가 "상"인 이벤트를 감사 대시보드를 열어보지 않아도 즉시 알 수 있도록 Discord 웹훅 알림 추가 — 등급/사유/행위자/IP/경로/발생시각 + 대시보드 바로가기 링크. 클릭하면 대시보드의 해당 행이 자동 하이라이트됨 |
| 세션 견고화 | 로그인 없이 보호된 페이지에 진입 후 브라우저 "뒤로가기"를 누르면 bfcache가 인증 체크를 재실행하지 않아 미인증 상태에서도 이전 화면(챗봇 위젯 등)이 그대로 보이던 문제 수정 — `pageshow`/`event.persisted` 감지로 재검증 |
| 신규 문서 | `[ final ] SECURITY_DETECTION_REPORT.md`(위협모델링·운영가이드·오탐미탐보고서 통합), `[ final ] SECURITY_MONITORING_DASHBOARD.md`, `DETECTION_MASKING_IMPLEMENTATION.md` |

---

## 배포

운영 서버(iwinv VM, Rocky Linux)에 `miso-was`/`miso-chatbot` systemd 서비스로 배포되어
`https://miso-hospital.xyz`로 접근 가능하다. 배포 시 `.env` 파일과 systemd 유닛 파일의
`Environment=` 값이 서로 어긋나지 않도록 주의 — 실제로 DB 비밀번호를 `.env`만 갱신하고
유닛 파일은 그대로 둬서 서비스 장애가 난 적이 있다(`[ final ] SECURITY_DETECTION_REPORT.md`
2장 ① 참고).

---

## 확정 필요 / 확인 필요 사항 (2026-09-18 기준)

**확정 필요**:
- 역할 세분화(의사/간호사 등 추가 역할 필요 여부), 예약 시간대 중복 제한(정원 체크는 있으나 트랜잭션 락은 없어 동시 요청 시 초과 예약 가능한 경쟁조건이 이론상 남아있음), 진료과 고정 목록화, 답변 이력 관리, 감사 로그 보존 정책 — 전부 미정.
- 챗봇 서비스(`0.0.0.0:8000`)가 VM 방화벽에 의해 실제로 외부 차단되어 있는지 미확인.

**확인 필요**:
- **`npm audit` 취약점 미조치 여부 재점검** — 백엔드 라우트가 그 뒤로도 계속 늘어나 재검토 필요.
- `SESSION_SECRET`/`RRN_ENCRYPTION_KEY`가 환경변수 미설정 시 프로세스 시작마다 새 랜덤 키를 생성하는 구조라, 운영 배포 시 반드시 `.env`에 고정값을 넣어야 함 — 실제로 이걸 빠뜨려 채팅 로그 복호화 불가 장애가 난 적 있음.
- 동일 신원(이름+주민번호)으로 여러 계정 생성 가능, 회원가입 API에 rate limit 없음 — 실사용 전 확정 필요.
