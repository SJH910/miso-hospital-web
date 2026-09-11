# 🏥 미소병원 프로젝트 통합 현황 보고서

> **이 문서에 대하여**: 이 문서는 `report_merge_final.md`(챗봇 병합 보고서) + [OCR.md](OCR.md)(OCR 기능 작업 기록) + [RBAC-Plan.md](RBAC-Plan.md)(RBAC 설계/구현 기록) 세 문서의 내용을 하나로 재구성한 통합본이다. **세 원본 문서는 수정하지 않고 그대로 남겨뒀다** — 시간순 작업 이력, 코드 스니펫, curl 검증 로그 등 세부 사항은 원본 문서를 참고할 것. 이 문서는 "지금 이 프로젝트가 전체적으로 어떤 상태인가"를 한눈에 보기 위한 통합·요약본이며, 기존 세 문서에 없던 **백엔드/프론트 존재 여부 재확인** 하나만 새로 추가했다(2. 기능 현황 총괄표).

---

## 1. 프로젝트 개요

3-Tier 구조에 Python 챗봇 서비스가 추가된 형태다.

```
frontend/ (정적 HTML/JS, 5500)
    │
was/ (Node/Express, 3000) ── MySQL(vulnapp)
    │
chatbot-service/ (FastAPI, 8000) ── SQLite(chatbot_logs.db, 감사용)
```

### 병합 히스토리

세 프로젝트를 하나로 병합했다: `miso-hospital-feature-ocr`(팀 최신 백엔드 — RBAC/예약/진료기록/OCR) + `Miso_chatbot-main`(실제 RAG 챗봇) + 기존 통합 작업물.

| 후보 | 특징 | 채택 여부 |
|---|---|---|
| `miso-hospital-feature-ocr.zip` (ocr1) | RBAC, `reservations`/`medical_records`/`audit_log`/`accounts` 등 팀의 최신 백엔드 | ✅ 베이스로 채택 |
| `miso-hospital-feature-ocr_2.zip` (ocr2) | 이전 버전. 챗봇 위젯은 있으나 신규 테이블/RBAC 없음 | 구버전으로 판단, 미채택 |
| `Miso_chatbot-main.zip` 내 사본 | 챗봇팀이 로컬에서 병합 시도한 흔적. 챗봇팀이 직접 "최신이 아니다"라고 명시 | 스키마 참고용으로만 사용 |

---

## 2. 기능 현황 총괄표 (프론트 × 백엔드 존재 여부)

실제 코드(`was/server.js`의 라우트 등록, `frontend/` 디렉토리, `was/routes/*.js`)를 직접 확인해서 만든 표다. **셋 문서 어디에도 이렇게 한 표로 정리된 적은 없었다.**

| 기능 | 프론트 화면 | 백엔드 API | 상태 |
|---|---|---|---|
| 진료문의 게시판 | `board.html`/`view.html` | `was/routes/board.js` | ✅ 정상 |
| 문서 스캔 OCR | `admin.html` (관리자 전용) | `was/routes/ocr.js`, `documents.js` | ✅ 정상 |
| 진료기록 조회 | `records.html` ("내 진료기록") | `was/routes/records.js` | ✅ 정상 (환자 본인 조회만 프론트 있음) |
| 챗봇 (RAG + 예약/진료기록 도구) | `frontend/js/chat-widget.js` | `was/routes/chat.js` + `chatbot-service/` | ✅ 정상 (Gemini 모델 단종 이슈는 해결됨 — 9번 체크리스트 참고) |
| 예약(reservations) | `reservation.html` (전체화면 챗봇 상담형) | `was/routes/reservations.js` | ✅ 정상 (2026-09-08 프론트 추가됨) — 운영시간·공휴일 검증 + 같은 시간대 정원(2명) 제한 둘 다 적용 |
| 휴진일 관리(holidays) | `admin-holidays.html` (관리자 전용) | `was/routes/holidays.js` | ✅ 정상 (2026-09-08 신규) — 조회는 로그인 사용자 누구나, 등록/삭제는 admin만 |
| 계정 관리(accounts) | `admin-accounts.html` | `was/routes/accounts.js` | ✅ 정상 (2026-09-09 프론트 추가됨) — "환자 등록"은 staff/admin 둘 다, "전체 계정 목록 + 역할 변경"은 admin 전용으로 화면 안에서 섹션을 나눠 표시. curl로 staff(등록 200/목록 403), admin(등록·목록·역할변경 200), 본인 강등 차단(400) 전부 재확인 |
| **감사 로그 조회(audit-log)** | ❌ 없음 | `was/routes/auditLog.js` | ⚠️ **백엔드만 존재.** 로그인 성공/실패, 역할 변경 등은 실제로 기록되고 있으나(`was/audit.js`) 조회 화면이 없어서 DB를 직접 봐야 함 |
| 문의 답변(board:reply) | `admin-board.html` (staff/admin), `view.html`/`board.html`에 답변 표시 | `was/routes/board.js`의 `PATCH /:id/answer` | ✅ 정상 (2026-09-08 프론트 추가됨, 팀원 `Sunjung Hwang` 커밋 `5bbf361`) — `view.js`가 `p.answer` 존재 시 "병원 답변" 박스로 렌더링 확인 |
| 예약 관리(reservations:manage) | `admin-reservations.html` (staff/admin) | `was/routes/reservations.js`의 `PATCH /:id/status` | ✅ 정상 (2026-09-08 프론트 추가됨, 동일 커밋) — 승인/취소 화면 |
| staff(원무/접수) 역할 전용 화면 | `admin-board.html`, `admin-reservations.html` | RBAC 권한 (`reservations:manage`, `board:reply`, `records:view:masked`, `patients:register`) | ✅ 정상 (2026-09-08 해결됨) — `home.js`/`board.js`가 이제 `role === 'staff'` 분기 추가, staff 로그인 시 이 두 화면으로 안내됨. `board.js` 주석에 "staff는 `board:write`/`board:read` 권한이 없어 문의 작성·상세보기는 못 쓴다"고 명시 — 실제 DB 권한(아래 7번 표)과 일치 |

**요약** (2026-09-09 재갱신): 화면 있는 기능이 9개(게시판·OCR·진료기록조회·챗봇·예약·휴진일관리·문의답변·예약관리·계정관리)로 늘었고, **staff 전용 화면도 생겨서 더 이상 UI에서 사라진 역할이 아니다.** 이제 API만 있고 화면이 없는 건 **감사로그(audit-log) 하나뿐**이다 (위 표 참고). 랜딩 페이지(`index.html`)에도 "내 진료기록" 링크가 실제로 클릭 가능하게 추가됨(이전엔 소개 문구만 있고 링크가 없었음).

---

## 3. 실행 방법

```bash
# 최초 1회
mysql -u root < db/init.sql
cd was && npm install && node seed.js && cd ..
pip install -r chatbot-service/requirements.txt --break-system-packages
chmod +x start.sh stop.sh

# 시작 / 종료 / 재시작
bash start.sh          # WAS(3000)·프론트(5500)·챗봇(8000) 백그라운드 실행, 로그: .run/*.log
bash stop.sh           # 종료
bash stop.sh && bash start.sh   # 재시작
```

- `GEMINI_API_KEY` 환경변수가 없어도 동작한다 (RAG 검색 결과를 그대로 안내하는 규칙 기반 폴백).
- 예약 생성은 챗봇에게 `YYYY-MM-DD HH:MM`과 "OO과" 형식이 질문에 명확히 포함되어야 정상 파싱된다 — 자연어 파싱이 완벽하지 않아 형식이 불명확하면 형식 안내 메시지로 답한다.
- OCR은 첫 실행 시 `tesseract.js`가 언어 데이터(`kor`/`eng`, 약 7MB)를 인터넷에서 자동으로 내려받는다. 오프라인 환경이면 `.traineddata`를 사전 배치해야 한다.

---

## 4. 챗봇 데이터 흐름

```
[환자] 챗봇 위젯에 "2026-09-10 14:00에 내과 예약해줘" 입력
        │
        ▼
[frontend/js/chat-widget.js] POST /api/chat { message }
        │
        ▼
[was/routes/chat.js]
        │  1) 원문을 AES-256-GCM 암호화해 chat_messages(MySQL)에 저장
        │  2) chatbot-service에 { question, patient_id: 세션값 } 전달  ← IDOR 방지 (클라이언트가 조작 불가)
        ▼
[chatbot-service/app.py]
        │  1) pii_masking.mask_pii()로 질문 마스킹 (LLM에는 마스킹된 질문만 전달)
        │  2) hospital_agent.run_agent(마스킹된 질문, patient_id)
        │       └─ 키워드 분류 → tools_db.book_appointment(patient_id, 날짜, 진료과)
        │            └─ MySQL reservations 테이블에 INSERT
        │  3) 감사로그(SQLite, patient_id+암호화된 원문) 별도 기록
        ▼
[chat.js] 답변도 암호화 저장 후, 마스킹된 텍스트만 프론트에 응답
        ▼
[chat-widget.js] 마크다운 링크(`[텍스트](/xxx.html)`)만 안전하게 <a>로 렌더링, 나머지는 텍스트로 표시
```

### 챗봇 병합 과정에서 발견·수정한 불일치 (요약)

| # | 문제 | 내용 |
|---|---|---|
| 1 | 존재하지 않는 테이블 조회 | `tools_db.py`가 가정한 `appointments` 테이블이 실제로는 `reservations`(컬럼명·상태값도 다름) — 실제 스키마에 맞춰 재작성 |
| 2 | **도구가 실제로 호출되지 않던 문제 (가장 중요)** | `hospital_agent.py`의 `choose_action()`이 RAG/일반답변 두 갈래로만 분기, 예약·진료기록 조회 함수는 어디서도 안 불리는 **죽은 코드**였음 — 이전 보고서엔 "3가지 신규 기능 추가"라고 적혀 있었지만 실제로는 미연결 상태. 키워드 기반 라우팅 추가로 실제 동작하게 수정 |
| 3 | 죽은 링크 | `check_medical_records()`가 반환하는 `/records.html`이 베이스에 없었음 → 페이지 복원, `medical_records`(의료진 작성)와 `scanned_documents`(OCR) 두 데이터 소스를 한 페이지에서 표시하도록 구성 |
| 4 | 과도하게 열린 CORS | `app.py`의 `allow_origins=["*"]` → WAS 오리진만 허용하도록 하드닝 기준에 맞춤 |
| 5 | 선택적 의존성이 필수처럼 동작 | `pii_masking.py`가 `spacy` 미설치 시 모듈 로드 자체가 죽던 문제 → `ImportError`를 방어적으로 처리해 미설치 시 정규식 마스킹만 동작하도록 수정 |
| 6 | 실행 스크립트 오류 | `start.sh`가 `uvicorn main:app`(오답)으로 되어 있었음, DB 접속 정보도 안 넘겨주고 있었음 → `app:app` + `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME`/`WAS_ORIGIN` 전달하도록 수정 |

---

## 5. 예약 · 휴진일 기능

### 진료 예약 화면
`frontend/reservation.html` + `js/reservation.js` — 팝업이 아니라 전체 화면 챗봇 상담형 페이지. 렌더링/통신 로직은 팝업 위젯(`chat-widget.js`)과 `frontend/js/chat-common.js`로 공유해서 중복 제거(마크다운 링크 안전 렌더링 같은 보안 코드를 두 곳에서 따로 관리하다 한쪽만 고치는 실수 방지).

### 휴진일 관리
`frontend/admin-holidays.html` + `js/admin-holidays.js`, `was/routes/holidays.js`, `holidays` 테이블 — 공휴일/병원 자체 휴진일을 관리자가 등록하면 예약 API와 챗봇 양쪽에서 즉시 반영됨. 외부 공휴일 API를 쓰지 않고 자체 테이블로 관리(외부 서비스 장애가 예약 가능 여부 판단을 막으면 안 된다는 원칙).

### 예약 시간대 검증
`was/routes/reservations.js`(API 직접 호출)와 `chatbot-service/hospital_agent.py`(챗봇 경유) 양쪽에 동일한 기준(평일 09:00~18:00, 토요일 09:00~13:00, 일요일·공휴일 휴진)을 적용 — 우회 경로가 없도록 두 곳 다 같은 규칙. 같은 시간대 정원 2명 제한과 함께 적용(운영시간 검증 → 정원 검증 순서).

### 챗봇 자연어 날짜 파싱
`hospital_agent.py`가 "2026-09-10 14:00" 같은 명확한 형식뿐 아니라 "9월 10일 오후 2시", "내일 14시", "모레 2시 30분" 같은 자연스러운 한국어 표현도 인식. 진료과명도 실제 진료과 목록(내과/외과/정형외과 등)과 우선 매칭 후 정규식으로 보완.

### 랜딩 페이지
예약/진료기록 조회를 실제 기능 카드로 반영 (아래 6번 섹션의 "2026-09-08 랜딩 페이지 기능 재확인" 항목과 일치하는 방향).

### DB 반영
전체 `db/init.sql` 재실행 대신, `holidays` 테이블·권한만 추가하는 최소 마이그레이션으로 진행해서 로컬에 쌓인 기존 테스트 데이터(예약/게시글 등)를 보존함.

### 검증 완료 (curl)
- 휴진일(신정) 예약 시도 → `400` 차단, 운영시간 외(새벽 3시) → `400` 차단, 정상 시간대 → `200` 성공
- 같은 시간대 3번째 예약 → `409`(정원 초과) — 운영시간 검증과 정원 검증이 함께 정상 동작
- 챗봇에게 "내일 오후 2시에 내과 예약해줘" → 자연어로 정확히 파싱해 예약 생성, 휴진일 요청 시 거부 메시지 정상 응답
- 신규 프론트 페이지(`reservation.html`, `admin-holidays.html`, `chat-common.js`, `admin-holidays.js`, `reservation.js`) 전부 `200`으로 정상 서빙 확인

### 참고
`chatbot-service/3-1-llm.py`/`2-embeddings.py`의 `require_gemini()` 에러 처리를 한때 `sys.exit(1)`로 되돌아갔다가 다시 `raise`로 복구했다 — 아래 9번 체크리스트 "require_gemini()의 sys.exit(1)" 항목 참고.

---

## 6. OCR 기능 (자세한 이력은 [OCR.md](OCR.md) 참고)

### 구현 완료
- `POST /api/ocr` — 이미지 → 텍스트 추출 (메모리 버퍼만 사용, 매직 바이트 검증, 5MB·1장 제한, 관리자 단위 분당 10회 rate limit)
- 관리자 전용 접근 제어 (`patients.role`, RBAC 이후 `requirePermission("ocr:scan")`으로 전환)
- 스캔 결과 저장 + 문서종류(처방전/진단서/영수증) + 날짜/금액 자동 파싱(`parsed_date`/`parsed_amount`)
- 범용 키-값 필드 추출(`parsed_fields` JSON) — 주민등록번호/연락처/카드번호/계좌번호는 자동 제외
- 목록 조회 API(`GET /api/documents`)는 원문(`extracted_text`)을 응답에서 아예 제외 — "숨김"이 아니라 "애초에 미전송"
- `miso-hospital-3tier-secure-ocr`(구 `-secure-master`)로 포팅 완료, CSRF 등 그 저장소의 보안 패턴에 맞춰 조정

### 2026-09-07 — 챗봇 API 키 / 암호화 키 관련 문제 (담당 외, 참고용)
- **Gemini 모델 단종**: `gemini-2.5-flash`/`gemini-1.5-flash` 모두 404로 응답 불가 상태였음(현재는 해결됨 — 9번 체크리스트 참고). `/chat`은 예외를 뭉뚱그려 잡아 항상 HTTP 200 + 동일한 안내 문구만 반환해서, 겉보기엔 정상 응답처럼 보이는 게 문제였음.
- `.env` 주석이 "DeepSeek API 키를 입력하라"고 안내하지만 실제 코드는 Gemini 전용 — 안내 문구 불일치.
- `.env`의 설명 줄에 `#`이 빠져있어 `python-dotenv`가 매 기동마다 파싱 경고 다수 출력.
- 감사 로그 암호화 키가 `secret.key`(app.py, 자동생성)와 `AUDIT_ENCRYPTION_KEY`(.env, audit_decorator.py) 두 군데로 이원화되어 있음. `secret.key`는 파일로만 존재하고 `.gitignore`돼있어 유실 시 복구 불가.

### 2026-09-08 — 랜딩 페이지 기능 재확인
- "예약·조회 같은 실제로 없는 메뉴는 랜딩에 넣지 않는다"던 기존 결정 재점검 결과: **"진료기록 조회"(`records.html`)는 그 사이 실제로 추가된 기능**이라 이제 넣어도 됨. **"예약"은 여전히 프론트가 없어 넣으면 안 됨** (2번 표 참고, 이후 5번 섹션에서 예약 프론트도 추가됨).

### 2026-09-09 — 챗봇 로그/키 파일 상대경로 문제 해결
- 위 2026-09-07 항목에서 지적된 `secret.key`(챗봇 SQLite 감사 로그 암호화 키) 유실 리스크의 근본 원인을 확인함: `chatbot-service/app.py`의 `DB_FILE`(`chatbot_logs.db`)·`KEY_FILE`(`secret.key`)이 **상대경로**라서, `start.sh`가 아닌 다른 방식(`chatbot-service/` 안에서 직접 `uvicorn` 실행 등)으로 띄우면 그 위치에 새 DB·새 키가 조용히 생성되고, 이후 로그는 원래 키로 영구히 복호화 불가능해지는 구조였음.
- `Path(__file__).resolve().parent.parent` 기준 절대경로로 고정해, 실행 위치(cwd)와 무관하게 항상 프로젝트 루트의 같은 `chatbot_logs.db`/`secret.key`를 보도록 수정. 이 문제로 실제로 생겨있던 `chatbot-service/chatbot_logs.db`(0바이트 스테일 파일)도 삭제함.
- 조사 배경(로그 파일 로테이션 확인, DB 실측값 등)은 `LogDB_plan.md` 3-2·3-3·7번(⑨) 참고. 코드 수정(`chatbot-service/app.py`)·README 반영은 커밋·푸시 완료(`8577933`). **이 문서(`report_merge_final.md`)에 대한 이번 기록은 로컬에만 남기고 커밋/푸시 안 함.**

### 2026-09-09 (15시경) — 팀원 커밋(TOTP 2차 인증) pull + 로컬 반영
- 팀원(`Sunjung Hwang`)이 `origin/main`에 푸시한 두 커밋을 fast-forward로 pull함: `6239e5c`(관리자 로그인 이상탐지 + TOTP 2차 인증), `28fe6c5`(nav 링크 정리). 로컬 미커밋 변경분(`LogDB_plan.md` 등)과 건드리는 파일이 겹치지 않아 충돌 없음.
- pull만으로 자동 반영 안 되는 두 가지를 확인해서 로컬에 별도 적용함:
  - `db/init.sql`에 추가된 `patients.totp_secret VARCHAR(64) NULL` 컬럼을 로컬 MySQL에 `ALTER TABLE`로 직접 추가(스키마 파일 수정은 자동 적용되는 게 아님 — 기존에도 반복되던 패턴, 확인 필요 사항의 "로컬 개발 DB에만 반영" 항목과 동일).
  - `was/package.json`에 추가된 `geoip-lite`(신규 위치 로그인 탐지용) 설치를 위해 `npm install` 재실행 — 정상 설치 확인(`require('geoip-lite')` 성공).
- **새로 발견 — `patients.totp_secret`이 평문으로 저장됨**: `was/routes/totp.js`를 확인한 결과 `UPDATE patients SET totp_secret = ?`로 그냥 저장하고 있어 암호화가 전혀 안 되어 있음. 같은 프로젝트에 `rrn`처럼 AES-256-GCM으로 암호화하는 기존 패턴(`crypto-utils.js`)이 이미 있는데 이건 그 패턴을 안 따름. TOTP 비밀키가 유출되면 공격자가 해당 계정의 2차 인증 코드를 무기한 생성할 수 있어(비밀번호 유출보다 조치가 더 어려움 — 비밀번호는 재설정하면 그만이지만 TOTP는 그 자체가 "추가 인증 수단"이라 우회 자체가 목적), **평문 저장 위험도는 `rrn`급으로 봐야 함**. 상세는 `LogDB_plan.md` 3-4에 반영함.
- `was/routes/auth.js`에 로그인 이상탐지·TOTP 검증 관련 신규 감사 로그 액션 7종이 추가됨(`login_anomaly_*` 5종, `totp_verify_success`/`totp_verify_fail`) — 아직 실제로 발생한 이력은 없음(신규 코드라 트리거된 적 없음). 상세는 `LogDB_plan.md` 3-2 참고.
- 문법 검증(`node --check`)만 하고 실제 로그인 흐름 재기동 테스트는 아직 안 함 — TOTP 등록·검증 화면(`admin-totp-setup.html`) 실동작 확인은 별도 필요.
- **팀원 작업 보고서(Notion, "비정상 요청 패턴 탐지 기준 정의 및 구현")로 확인된 정확한 판단 기준** — 코드(`was/routes/auth.js`, `was/totp-utils.js`)와 직접 대조해서 수치까지 확인함:
  - 반복 실패: **같은 계정** 5분 내 5회(`FAILURE_THRESHOLD`), 관리자 계정은 3회(`ADMIN_FAILURE_THRESHOLD`, 일반 계정보다 낮음 — 피해 범위가 크니까)
  - 이상 빈도: **같은 IP**에서 1분 내 10회(`FREQUENCY_THRESHOLD`, 성공/실패 무관) — 계정과 IP 기준이 서로 독립적으로 집계됨
  - 비정상 긴 입력값: 아이디/비밀번호가 200자 초과(`LONG_INPUT_MAX_LENGTH`) — 감사 로그엔 입력값 자체가 아니라 **길이(숫자)만** 남김(입력값이 악성 페이로드일 수 있어 로그에 그대로 옮기지 않는 의도적 설계)
  - TOTP 코드 검증: 30초 주기, 앞뒤 1윈도우(총 90초) 허용(`verifyTotpCode`의 `window=1`) — 기기 간 시계 오차 대비, 인증 앱들의 일반적 관례
  - 관리자 신규 위치 탐지는 **TOTP 등록된 관리자에게만** 추가 인증을 요구함 — 미등록 관리자는 계속 기록만 되고 로그인은 그대로 허용(의도적 범위 제한)
  - `geoip-lite`는 사설 IP(로컬 개발 환경 등)에서는 지역 추정이 안 돼 `null` 반환 — 이 경우 지역 기준 판단은 건너뛰고 IP 기준 판단만 적용
  - 전부 코드 상수(`FAILURE_THRESHOLD` 등)와 직접 대조해서 일치 확인함.
  - **알려진 한계(보고서에 명시)**: (1) 신규 IP/지역 목록이 메모리 저장이라 서버 재시작 시 초기화됨(재시작 직후 이미 알던 IP도 "신규"로 오탐 가능) — Redis 등 외부 저장소는 아직 미도입, (2) TOTP 등록/해제 시 별도 재인증 절차 없음(세션 탈취 상태면 공격자가 TOTP를 몰래 해제·재등록 가능한 이론적 허점), (3) User-Agent는 아직 비교 안 함(IP·지역만).
### 2026-09-09 — `audit-agent` 해시 체인이 서버 재시작마다 끊기던 문제 해결
- **해시 체인이 왜 있는지**: `audit-agent/hash_chain.py`의 `HashChain`은 각 감사 로그 레코드에 "바로 이전 레코드의 hash"를 포함시켜(블록체인과 동일한 원리), 파일 전체를 재계산해서 죽 이어지는지 확인하면 중간 레코드가 삭제·변조됐는지 사후 검증할 수 있게 하는 게 목적.
- **실제 위험**: `previous_hash`가 파이썬 인스턴스 변수라 서버 재시작마다 `None`으로 초기화되고 있었음 — "재시작 때문에 자연스럽게 끊긴 지점"과 "누가 레코드를 지워서 끊긴 지점"이 겉보기에 구분이 안 돼서, 해시 체인이 막으려던 시나리오(몰래 삭제)가 재시작으로 위장하면 발각 안 되고 넘어갈 수 있는 구조였음.
- **의도된 설계인지 검토** — 낮은 가능성으로 판단: 코드 주석("제네시스 블록 역할")이 "딱 한 번만 생성된다"는 전제로 쓰여있고, 재시작 시 이전 체인과의 관계를 표시/경고하는 로직이 전혀 없음. 같은 패키지의 다른 미완성 정황(디버그 print 유출, 약한 마스킹 정규식, 미구현 보존 삭제 로직)과 패턴이 겹쳐 "설계 트레이드오프"보다 "재시작을 고려 안 하고 짠 미완성 코드"에 가까움(단, 원작성자에게 직접 확인한 사실은 아니며 코드 정황 근거의 추론).
- **수정 내용**: `hash_chain.py`가 로그 파일 경로를 받아 마지막 레코드의 hash를 읽어 `previous_hash`로 복원하도록 변경. 오늘 파일이 비어있으면(자정 로테이션 직후) 가장 최근 로테이션 백업의 마지막 hash까지 이어받게 확장해, 재시작뿐 아니라 날짜 경계에서도 체인이 유지됨. `engine.py`·`audit_decorator.py`도 경로 전달을 위해 같이 수정(`LOG_FILE` 정의 순서 조정).
- **검증**: `python3 -m py_compile` 통과. 스크래치 디렉토리에서 격리 테스트로 (a) 오늘 파일 기준 마지막 hash 복원, (b) 오늘 파일이 비어있을 때 어제 백업(`audit_log.jsonl.2026-09-08`)의 마지막 hash로 fallback — 둘 다 실제 파일 값과 정확히 일치 확인. `AuditEngine`/`HashChain` 생성 지점이 `audit_decorator.py` 한 곳뿐임을 확인해 다른 호출부 영향 없음.
- **남은 한계(의도적으로 지금 안 함)**: 이번 수정은 체인이 안 끊기게 이어붙이는 것뿐, "파일이 실제로 위변조됐는지 검증하는 기능"은 아직 없음. 이는 `LogDB_plan.md` 6번 섹션에서 계획 중인 "사후 스캔 파서"의 일부이고 파서를 어디에 둘지도 미결정(결정 필요 ③)이라, 지금 별도로 만들면 중복 작업이 될 수 있어 착수 안 함. 상세는 `LogDB_plan.md` 3-3 나 참고. **코드 수정은 커밋·푸시 완료(`c8414ee`), 이 문서 기록은 로컬에만 남기고 커밋/푸시 안 함.**

### 2026-09-09 — `audit_log.jsonl` 접근 통제(파일 권한) 불일치 해결
- **문제**: MySQL `audit_log`는 `requirePermission("audit:view")`로 admin만 조회 가능(RBAC 적용)한데, `audit_log.jsonl`은 조회 API 자체가 없고 파일 권한(`-rw-r--r--`)에만 의존 — 이 컴퓨터의 다른 로컬 계정도 파일을 읽을 수 있는 상태였음(내용 자체는 Fernet 암호화라 키 없인 못 읽지만, "누가 접근 가능한가"의 통제 방식이 저장소마다 달랐음).
- **수정 내용(A안 — 파일 권한을 소유자 전용으로 좁힘)**: `audit_decorator.py`에 `TimedRotatingFileHandler`를 상속한 `SecureTimedRotatingFileHandler`를 추가하고 `_open()`을 오버라이드해 `os.chmod(self.baseFilename, 0o600)` 적용. `_open()`은 최초 파일 생성 시뿐 아니라 자정 로테이션으로 새 파일이 열릴 때도 호출되는 지점이라 앞으로 생기는 모든 로그 파일에 자동 적용됨. `audit-logs/` 디렉토리도 `0o700`으로 좁힘. 기존 파일 2개(`audit_log.jsonl`, `audit_log.jsonl.2026-09-08`)도 수동으로 권한 소급 적용.
- **검증**: 스크래치 디렉토리 격리 테스트로 (a) 최초 생성 시 `0o600` 확인, (b) 일부러 권한을 풀어놓고 `doRollover()`(로테이션)를 강제 실행해도 새 파일이 다시 `0o600`으로 열리는지 확인 — 둘 다 정상.
- **한계(B안, 지금 안 함)**: OS 파일 권한 강화는 "이 컴퓨터의 다른 로컬 계정"으로부터의 보호이지, MySQL `audit_log`처럼 "로그인한 admin만 조회 가능"한 애플리케이션 레벨 RBAC과 동급은 아님. RBAC 기반 조회 API 신설은 "사후 스캔 파서"(결정 필요 ③, 미결정)와 겹치는 더 큰 작업이라 보류. 상세는 `LogDB_plan.md` 3-3 나 참고. **코드 수정은 커밋·푸시 완료(`444bed7`), 이 문서 기록은 로컬에만 남기고 커밋/푸시 안 함.**

### 2026-09-09 (17시경) — 팀원 커밋(`aa30908`): 마스킹 3원화 해결 + 내부 URL/API 키 탐지 신규
- **마스킹 3원화(결정 필요 ④) B로 확정·구현**: `audit-agent/masking.py`가 자체 정규식(주민번호/전화번호/이메일, 구분자 변형 미지원)을 전부 걷어내고 `pii_masking.mask_pii()`를 그대로 import해서 쓰도록 재작성됨 — 이전에 저희가 지적했던 "`tool_check_medical_records` 등 세 경로에서 가장 약한 마스킹만 거침" 문제가 이걸로 해소됨(`LogDB_plan.md` 2번 섹션 항목 1 참고). `was/crypto-utils.js`(JS)는 예정대로 통합 대상에서 제외되고 별도 유지.
- **내부 URL/API 키 노출 탐지 신규**(`pii_masking.py`의 `mask_secrets()`): 사설 IP(RFC1918)/`localhost`/`.internal`·`.corp`·`.local`·`.intranet` 도메인, 알려진 서비스 API 키 시그니처(AWS/GitHub/Slack/Google/Anthropic/OpenAI/JWT), 키워드 문맥 기반 시크릿("api_key=" 등), 섀넌 엔트로피 기반 폴백 탐지까지 구현. `mask_pii()`가 다른 패턴보다 먼저 이 함수를 호출하도록 연결됨. JS(`crypto-utils.js`)에도 동일 규칙이 별도로 재구현됨(언어가 달라 공유 불가라는 걸 코드 주석에 명시).
- **크로스 검증 테스트 신설**: `shared_test_vectors.json`(12개 케이스) + Python/JS 양쪽 테스트 러너 — 저희가 이전에 "B로 가면 양쪽 동기화가 깨질 수 있으니 교차검증 테스트를 같이 만들자"고 제안했던 방향 그대로 구현됨. **직접 실행해서 재확인**: `python3 chatbot-service/test_shared_vectors.py`, `node was/test-shared-vectors.js` 둘 다 12/12 통과, 판정 일치 확인.
- **`.run/chatbot.log` 원문 유출도 같은 커밋에서 해결**: `audit-agent/engine.py`의 디버그 print(마스킹 전 원본 payload를 stdout에 출력하던 것)를 제거 — 저희가 "마스킹 3원화 작업과 겹칠 수 있다"고 표시해뒀던 항목이 실제로 그렇게 같이 처리됨(`LogDB_plan.md` 3-3 다 참고).
- **팀원 작업 보고서(Notion, "내부 URL·API Key 노출 탐지 기능 추가 — 작업 보고서 0909일")로 확인된 추가 내용**: 위 작업은 TDD(Red-Green-Refactor)로 진행됐고, 통합 과정에서 팀원이 스스로 발견·조치한 것 중 저희 기록에 없던 것:
  - `app.py`의 `mask_pii()` 호출부에 예외처리가 없던 것도 같이 발견해서 fail-closed(마스킹 실패 시 요청 자체를 500으로 막음, "일단 원문으로 진행" 안 함)로 수정 — 저희가 이전에 확인한 fail-closed 처리(`chatbot-service/app.py` 참고)가 이 보고서의 조치와 일치함.
  - **`secret.key` git 노출 — "개인 저장소"에서 발견, "공용 저장소"(이 저장소)는 이미 확인한 대로 깨끗함**: 팀원이 본인 개인 저장소에서는 `secret.key`가 커밋된 적 있었다는 걸 발견해 `.gitignore` 추가 + `git rm --cached`로 추적 해제함. **키 로테이션은 보류로 결정** — 실제 환자 데이터가 없는 실습 프로젝트라는 게 근거. 이건 저희가 예전에 "이 공용 저장소는 한 번도 커밋된 적 없다"고 여러 번 검증했던 것과 다른 저장소(개인용) 얘기라 서로 모순되지 않음 — 그때 계속 헷갈렸던 "왜 다른 데선 나온다고 하지" 의문이 이걸로 풀림.
  - 마스킹 3원화 결정(B)과 `secret.key` 로테이션 보류 둘 다 "요청받지 않았지만 스스로 판단해서 진행한 것"으로 보고서에 별도 표시돼 있음 — 나중에 되돌리고 싶으면 언제든 말해달라는 단서와 함께.
  - **엔트로피 임계값(3.5 bits/char)은 여전히 잠정치** — 실사용 데이터로 오탐/미탐 관찰 전까지 조정 가능하다고 명시. `LogDB_plan.md`에도 이미 "현재 시점 기준"이라고 적어뒀던 것과 일치.

### 2026-09-10 — `RRN_ENCRYPTION_KEY` 고정 + `log_audit_tool.py`(4개 저장소 리더) 구현
- **`RRN_ENCRYPTION_KEY` 미고정 문제 해결**: `was/config.js`가 이 값 없으면 매 재시작마다 랜덤 키를 생성해서, `chat_messages.content`가 재시작할 때마다 전부 복호화 불가능해지던 문제. `was/.env`(git 미추적)에 고정 키 저장, `dotenv` 추가, `server.js` 최상단에 `__dirname` 기준 절대경로로 로딩(`start.sh`가 프로젝트 루트에서 띄우는 구조라 cwd 기준 기본 경로로는 안 먹힘 — `app.py`의 `DB_FILE`/`KEY_FILE`과 같은 종류의 cwd 버그). `stop.sh`/`start.sh` 두 번 연속 재기동해서 매번 같은 키로 기존 암호문이 복호화되는지 검증 완료. 코드는 커밋·푸시 완료(`d341c8f`).
- **`log_audit_tool.py` 신규**(`LogDB_plan.md` 6번 섹션 1단계, 결정 필요 ③ A로 확정): 4개 저장소(`audit_log.jsonl`/`chatbot_logs.db`/MySQL `chat_messages`/MySQL `audit_log`)를 복호화해서 공통 스키마로 뽑아내는 배치 도구. 특히 MySQL `chat_messages`(AES-256-GCM 재구현, 가장 까다롭다고 미리 경고돼 있던 부분)는 실제 로그인→채팅 메시지 전송→Python으로 복호화까지 end-to-end로 검증해서 Node `crypto-utils.js`와 정확히 일치함을 증명함. 상세 검증 내역은 `LogDB_plan.md` 6번 섹션 1단계 참고. 커밋·푸시 완료(`bb73206`).
- **해시체인 실전 검증**: 이날 자정을 실제로 넘기면서 `audit_log.jsonl`이 `audit_log.jsonl.2026-09-09`로 로테이션됐는데, 어제 백업의 마지막 `hash`와 오늘 새 파일의 첫 `previous_hash`가 정확히 일치함을 확인 — `c8414ee`(해시체인 재시작 끊김 수정)가 시뮬레이션이 아니라 실제 운영 조건에서도 의도대로 동작함이 증명됨.

### 2026-09-10 — `log_audit_tool.py`에 3단계(탐지 결과 리포트) 추가, 실행 중 마스킹 오탐 발견
- **`scan_for_pii()`/`write_report()` 구현**: 1단계 리더가 뽑아낸 레코드의 `text_fields`마다 `pii_masking.mask_pii()`를 블랙박스로 호출해 원문과 마스킹 결과가 다르면 "발견"으로 기록, CSV로 저장(`chatbot-service/log_audit_report_*.csv`, 리포트에는 마스킹된 값만 담기고 원문은 안 남김). **"PII 종류(RRN/이메일 등) 분류"는 의도적으로 뺌** — 원래 목적(사후 감사)엔 "발견 여부+위치+안전한 미리보기"만으로 충분하고, 종류 분류는 `mask_pii()`의 치환 토큰 문자열에 의존하는 약한 결합이라 판단. 리포트 CSV는 실행할 때마다 생기는 산출물이라 `.gitignore`에 추가함.
- **실제 실행(총 186건 스캔) 결과 2건 발견 — 전부 마스킹 오탐으로 판명**: "저는 실시간 날씨 정보를..." 같은 일반 문장에서, `pii_masking.py`의 이름 탐지 정규식이 "저는" 바로 뒤 2~5글자 한글 단어를 전부 이름으로 취급해 "실시간"을 "실**간"으로 잘못 마스킹한 것 — 실제 PII 유출은 아니었음. `mask_pii()`를 직접 재현 호출해서 원인 확인. 도구가 원문/마스킹 차이를 정확히 잡아낸다는 검증이면서, 동시에 `pii_masking.py` 이름 탐지 규칙의 실전 오탐 사례를 처음으로 실측 데이터에서 발견한 것 — 마스킹 로직 자체 수정은 별도 사안(팀원 담당 영역)이라 코드는 안 건드림. 상세는 `LogDB_plan.md` 6번 섹션 3단계 참고.

### 2026-09-10 — 팀원 커밋(`50d86fd`+`b50818d`): 감사 로그 위험도 분류(상/중/하) + 아이디 마스킹
- **로그 위험도 분류 체계, 다른 축에서 구현됨**: `LogDB_plan.md` 4번 섹션의 초안(데이터 컬럼 기준 4단계)과는 별개로, **"감사 로그 이벤트(action)가 얼마나 위험한가"** 기준의 3단계(상/중/하) 체계를 WAS(`was/risk-classification.js`)와 챗봇(`chatbot-service/audit-agent/risk_classification.py`) 양쪽에 동일한 원칙으로 구현. 예: `login_anomaly_admin_new_ip`=상, `account_role_change`=중, `login_success`=하. 목록에 없는 신규 action은 "하"가 아니라 **"중"을 기본값**으로 둬서 조용히 저위험 취급되지 않게 함(WAS/챗봇 둘 다 동일 원칙).
- **악성 의도 탐지와 연동**: 챗봇 쪽은 `masking.py`가 `MALICIOUS_INTENT_DETECTED`를 탐지하면 action 종류와 무관하게 **무조건 "상"으로 승격** — 단순 조회(`rag` 등)에 프롬프트 인젝션이 섞여 있어도 "하" 등급에 묻히지 않게 함.
- **DB 반영**: `audit_log.risk_level ENUM('low','medium','high') NOT NULL DEFAULT 'low'` 컬럼 추가. `db/init.sql` 수정은 자동 반영 안 되므로 로컬 MySQL에 `ALTER TABLE`로 직접 적용함(이 프로젝트에서 반복되는 패턴 — TOTP `totp_secret` 때와 동일).
  - **[갱신 2026-09-10] 팀원 최종 가이드 문서의 "기존 행까지 백필 완료" 주장은 저희 DB엔 미적용**: 실제 조회 결과 기존 행 전부(`account_role_change` 포함) `risk_level='low'`로 남아있음 — `ALTER TABLE`이 컬럼 기본값만 채운 것이고, `action` 기준으로 재계산해서 `UPDATE`하는 백필 스크립트는 저장소에 커밋된 적 없음(팀원 로컬에서만 수동 실행된 것으로 추정). 필요시 직접 백필 가능(아직 안 함). 상세는 `LogDB_plan.md` 4번 섹션 참고.
- **`engine.py` 재수정 시 Step 0 print 재발 여부 확인**: `risk_level` 분류를 추가하는 작업이 Step 0 print가 남아있던 이전 버전을 베이스로 작성돼, 그대로 반영하면 `mask_payload()` 호출 전에 원본 payload를 다시 stdout에 찍는 상태로 되돌아갈 뻔했음. 최종 반영본은 Step 0 print 없이 마스킹 → 마스킹된 값으로 `classify_risk()` 호출 순서로 병합됨(코드 diff로 확인). 같은 파일에서 해시체인 복원(`hash_chain.py`)·파일 권한(`audit_decorator.py`)도 무변경으로 유지됨 확인 — `444bed7` 때(파일 권한이 병합 중 누락)와 달리 이번엔 유실 없음.
- **참고**: 코드 주석이 가리키는 `SECURITY_THREAT_MODEL.md`(분류 근거 상세)는 아직 저장소에 없음(Notion에 별도 정리 예정, 커밋 메시지에 명시) — 실체 없이 참조만 있는 상태.

### 2026-09-10 — 팀원 커밋(`24264fe`): `log_audit_tool.py`에 `known_exception` 플래그 추가
- **배경**: `log_audit_tool.py`의 3단계 스캔(위 2026-09-10 항목)이 `mysql_audit`(WAS 감사 로그) 레코드의 `ip` 필드를 매번 "마스킹 안 된 PII"로 잡아내고 있었음 — 실제로는 `mask_pii()`가 모르는 예외: IP는 침해 대응을 위해 의도적으로 마스킹하지 않기로 한 정책(코드 주석이 `SECURITY_THREAT_MODEL.md §6-4`를 근거로 인용하나, 위 항목에서 이미 확인했듯 이 문서는 저장소에 아직 없음 — 참조만 있고 실체 없는 상태 여전함).
- **수정**: `mask_pii()`의 치환 토큰 문자열을 들여다보고 PII 종류를 역추론하는 방식은 이 파일이 이미 피하기로 한 약한 결합이라(위 2026-09-10 항목 참고), 그 대신 `record["source"]`만으로 판단하는 `KNOWN_EXCEPTION_SOURCES = {"mysql_audit"}` 플래그를 추가 — findings/CSV/콘솔 요약에 `known_exception` 컬럼으로 노출. 탐지 자체(발견 여부)는 그대로 두고 "이미 알려진, 정책상 의도된 예외"라는 표시만 얹는 방식이라 실제 오탐(위 2026-09-10 항목의 이름 탐지 오탐 등)과 구분됨.

### 2026-09-10 — 팀원 커밋(`f728365`): `SECURITY_AUDIT_CRITERIA.md` + `log_audit_tool.py` 4단계(위험도 리포트) 추가
- **문서 신규**: `SECURITY_AUDIT_CRITERIA.md` — 5W1H(누가/언제/무엇을/어디서/왜/어떻게) 분류 기준과 4단계(Critical/High/Medium/Low) 위험도 매핑표. **등급 판정 자체는 이 문서가 하지 않는다고 명시** — `was/risk-classification.js`/`chatbot-service/audit-agent/risk_classification.py`(로그 **기록 시점**에 상/중/하 3단계로 분류해 `audit_log.risk_level`/JSONL 평문 필드에 저장, 위 2026-09-10 "팀원 커밋(`50d86fd`+`b50818d`)" 항목 참고)가 유일한 기준(source of truth)이고, 이 문서는 그 값을 4단계로 옮겨 적을 뿐 — 등급 기준이 두 군데 따로 관리되며 어긋나는 것을 구조적으로 방지.
- **`log_audit_tool.py` 4단계 확장**: 4개 리더가 `risk_level`을 그대로 읽어오도록 수정(재계산 없음), `evaluate_severity()`가 `low/medium/high`를 4단계로 매핑하면서 **관리자 계정 침해 정황 3종만**(`login_anomaly_admin_repeated_failure`/`_new_ip`/`_new_location` — 이미 로그인에 성공했거나 집중 공격받는 중인 이벤트) HIGH→CRITICAL로 승격. `totp_verify_fail`/`totp_disabled`(2026-09-10 15시경 팀원이 별도로 low→high 재분류, 위 항목과는 다른 커밋)는 HIGH 유지(승격 안 함) — "침해 정황"과 "이미 침해된 것으로 보이는 정황"을 구분한 설계.
- **PII 미마스킹 스캔·정적 점검(`STATIC_FINDINGS`)은 `risk_level` 체계와 완전히 분리된 별도 트랙**으로 유지 — 기존 `scan_for_pii()`/`known_exception`은 코드 변경 없이 그대로 재사용, `STATIC_FINDINGS`엔 `patients.totp_secret` 평문 저장(CRITICAL) 1건이 등록돼 있음.
- **검증(직접 실행)**: `python3 -m py_compile` 통과. 실제로 `python3 log_audit_tool.py` 실행 → 251건 읽음(mysql_audit 91/audit_jsonl 31/chatbot_sqlite 57/mysql_chat 72), `risk_level` 집계 CRITICAL 0 · HIGH 0 · MEDIUM 4 · LOW 97 · NONE 150(이번 실행 시점 실데이터엔 관리자 이상탐지/TOTP 이벤트가 없어서 CRITICAL/HIGH가 0인 게 정상). PII 스캔 2건(전부 기존에 이미 알려진 "저는" 이름 탐지 오탐, 신규 아님). 정적 점검에 `totp_secret` 평문 저장 CRITICAL 1건 — **코드로 실제 확인**: `db/init.sql:31`(암호화 컬럼 아님, `VARCHAR(64) NULL`) + `was/routes/totp.js`(`UPDATE patients SET totp_secret = ?`로 평문 그대로 저장) — 주장과 실제 코드 일치 확인.
- **[겸사겸사 발견·수정] `.gitignore` 누락**: 이 도구가 새로 만드는 `security_audit_report_*.csv`가 기존 `chatbot-service/log_audit_report_*.csv` 패턴에 안 걸려서(이름이 다름) `git status`에 추적 안 된 파일로 잡히는 것 확인 — `.gitignore`에 `chatbot-service/security_audit_report_*.csv` 추가.

### 2026-09-10 — PII 마스킹 우회(점 구분 주민번호/전화번호) 수정
- **문제**: `chatbot-service/pii_masking.py`의 RRN/전화번호 정규식이 숫자 사이 구분자로 `[\s\-\~_]`(공백/하이픈/물결/밑줄)만 허용하고 마침표(`.`)는 빠져있어서, `"900101.1234567"`/`"010.1234.5678"`처럼 점으로 구분한 형식이 마스킹 없이 그대로 통과됨(`BUG_REVIEW_2026-09-10.md`에서 발견). 실제 한국어 입력에서 흔한 표기라 실사용 유출 경로로 판단.
- **원인**: 이 구분자 문자 클래스가 `build_spaced_regex`(주민번호용)와 전화번호 패턴 조립부(`phone_part1`/`2`/`3`, 최종 컴파일)에 총 6번 따로 하드코딩돼 있었음 — 마침표 누락 자체가 이 중복 때문에 한 곳만 고치고 잊어버리기 쉬운 구조에서 비롯된 것으로 보임(전화번호 쪽엔 "3자리 또는 4자리 국번 지원"을 시도하다 바로 다음 줄에서 4자리로 덮어써버린 죽은 코드 흔적도 있음 — 이건 별도 버그로 아직 미해결, `BUG_REVIEW_2026-09-10.md` 참고).
- **수정**: `SEPARATOR = r'[\s\-\~_.]'` 상수 하나로 통합해서 6곳 전부 재사용하도록 리팩터링 — 구분자 종류가 또 바뀌어도 한 곳만 고치면 되게 함.
- **검증**: 버그였던 케이스(`900101.1234567`→`900101-[MASKED]`, `010.1234.5678`→`010-****-5678`) 정상 마스킹 확인, 기존 하이픈 케이스(`900101-1234567`, `010-1234-5678`) 회귀 없음 확인, 기존 테스트 스위트(`audit-agent/test_masking_secrets.py`, `mask_pii()` 재사용 모듈) 8개 전부 통과.

### 2026-09-10 — chatbot-service `/chat` 서비스 간 인증 추가
- **문제**: `chatbot-service`(:8000)의 `/chat`이 요청이 정말 `was`(:3000)에서 온 건지 전혀 확인 안 하고 `patient_id`를 body 그대로 신뢰(`BUG_REVIEW_2026-09-10.md`에서 발견). `was`는 세션에서 `patient_id`를 가져와 보내므로(`chat.js` 확인, 클라이언트 조작 불가) 정상 경로는 안전하지만, CORS는 브라우저 cross-origin만 막을 뿐이라 8000번 포트에 직접(curl 등) 접근 가능하면 임의 `patient_id`로 다른 환자의 예약/진료기록 존재여부를 조회할 수 있는 IDOR이었음.
- **수정**: `was`/`chatbot-service` 양쪽 `.env`에 같은 `CHATBOT_SERVICE_KEY`(공유 비밀키) 추가. `was/routes/chat.js`가 챗봇 호출 시 `X-Internal-Auth` 헤더로 이 값을 실어 보내고, `chatbot-service`는 `hmac.compare_digest`(상수 시간 비교)로 검증 후 불일치하면 `401`. 키가 `.env`에 없으면 `AUDIT_ENCRYPTION_KEY`와 같은 fail-fast 패턴으로 서비스 시작 자체를 막음.
- **범위 밖으로 남겨둠**: 배포 시 8000번 포트를 아예 외부에 안 열리게 하는 네트워크/방화벽 조치는 배포 설정 영역이라 이번엔 안 함 — 별도 배포 논의에서 이미 언급했던 항목.
- **검증**: 헤더 없이 직접 `curl` 호출 → `401`, 틀린 키로 호출 → `401`, `patient1`로 로그인 후 `POST /api/chat` 정상 요청 → WAS가 올바른 키를 실어 보내 `200` 정상 응답(챗봇 답변 정상 수신) 확인.

### 2026-09-11 — 챗봇 일반 답변에 주제 제한 추가 (`feature/ocr`)
- **발견 경위**: 사용자가 직접 챗봇에 "오늘 저녁 뭐 먹을까요?"를 물어봤더니 병원과 무관하게 식사 메뉴를 추천해주는 걸 확인 — 병원 챗봇인데 왜 다른 주제에 답하냐는 지적.
- **원인**: 예약/진료기록처럼 특정 도구로 안 걸리는 질문은 `tool_direct_answer`(`3-1-llm.py`의 `generate_direct_answer`)로 빠지는데, 이 경로의 시스템 지시문엔 "병원 관련 질문만 답해라"는 규칙이 전혀 없었음(이름 마스킹·프롬프트 인젝션 거부 지침만 있었음). 페르소나 설명도 "간단한 학습용 에이전트"인데 거절 메시지는 "저는 미소병원 안내 챗봇입니다"라고 자칭하게 시켜놔서 서로 안 맞는 상태였음.
- **수정**: 지시문에 "병원 이용과 무관한 질문에는 답변하지 말고 안내만 하라" 규칙 추가(기존 프롬프트 인젝션 거절 문구를 그대로 재사용해 같은 톤 유지). 페르소나도 "미소병원 안내 챗봇"으로 통일.
- **검증**: 수정 전 "저녁 뭐 먹을까요?" → 된장찌개/비빔밥 추천(문제 재현) → 수정 후 같은 질문 + "아이돌 누구야?" → 둘 다 "저는 미소병원 안내 챗봇입니다..." 거절 메시지로 변경. 병원 관련 질문("진료 시간")과 프롬프트 인젝션 거부는 기존대로 정상 동작(회귀 없음) 확인.

### 2026-09-11 — 챗봇 `/chat`의 동기 블로킹 호출이 이벤트 루프를 막던 문제 수정 (`feature/ocr`)
- **문제**: `chat_endpoint`가 `async def`인데 내부에서 pymysql DB 쿼리(`tools_db.py`), Gemini 호출(`3-1-llm.py`), `sqlite3.connect`(로그 저장)를 스레드풀 오프로드 없이 동기로 그대로 실행 — 느린 요청 하나가 이벤트 루프를 통째로 막아서 동시에 들어온 다른 요청을 전부 대기시킴(`BUG_REVIEW_2026-09-10.md`에서 발견).
- **원인 확인**: `grep`으로 확인해보니 `chat_endpoint` 안에 `await`가 단 하나도 없었음 — "async라고 선언만 해놓고 실제로는 전부 동기로 도는" 함수였음.
- **수정**: `async def` → `def`로 한 단어만 변경. FastAPI/Starlette는 sync `def` 라우트를 자동으로 별도 스레드풀에서 실행해주므로, 내부 코드(DB 쿼리·Gemini 호출·로깅)는 하나도 안 고치고 이벤트 루프 블로킹만 해소됨.
- **검증**: 기능 회귀 없음(정상 질문 응답, 인증 `401`, 주제 제한 전부 정상). 동시성 개선 실측 — 순차 3회 28.8초(요청당 평균 ~9.6초) vs 동시 3회(병렬 전송) 10.8초. 수정 전이었다면 이벤트 루프가 막혀 동시 전송도 순차와 비슷한 시간이 나왔을 것 — 실제로 병렬 처리되고 있음을 확인.

### 2026-09-11 — 문의 게시판 UI를 표 스타일로 개편 (`feature/ocr`)
- **요청**: 다른 병원 사이트의 공지사항 게시판 스크린샷(번호/공지/제목/작성자/작성일/조회수 컬럼, 검색+카테고리 드롭다운, 글쓰기 버튼, 페이지네이션)을 보여주며 우리 게시판도 그런 느낌으로 바꿔달라는 요청.
- **범위 조율**: 스크린샷은 "병원이 공지 올리고 누구나 보는" 게시판인데, 우리 "진료문의 게시판"은 환자가 각자 자기 문의만 쓰고 보는 구조라 작성자·조회수·공지(고정)·카테고리 개념 자체가 DB에 없음. 사용자와 조율해서 **스타일만** 적용하기로 확정 — 조회수/공지/카테고리 필터/페이지네이션 같은 새 기능(DB 스키마 변경 필요)은 구현 안 함, 컬럼도 기존 그대로(번호/제목/작성일/답변 상태) 유지.
- **적용 대상**: `board.html`(환자 본인 문의 목록)과 `admin-board.html`(관리자 전체 문의 목록) 둘 다.
  - `board.html`: 툴바를 왼쪽(카테고리 고정 드롭다운 + 검색)/오른쪽(글쓰기 버튼, 클릭 시 작성 폼으로 스크롤) 배치로 재구성. 표 구조 자체는 원래 있던 것 그대로.
  - `admin-board.html`: 기존 카드형(`.inquiry-card`, 클릭하면 카드 안에서 펼쳐지는 구조) 목록을 표(번호/제목/작성일/답변 상태) + 행 클릭 시 아래 공용 상세 패널(환자명/내용/기존 답변 이력/새 답변 입력)로 전면 개편 — 오늘 관리자 문서 목록(`admin.html`)에 적용했던 것과 같은 패턴. **답변완료/답변대기 배지는 그대로 유지**(사용자가 "없는 거 만든다고 원래 있던 거 빼지 말라"고 명시적으로 당부함).
  - `.board-toolbar`/`.btn-write` CSS 신규 — `.board-table`은 여러 화면이 공유하는 클래스라 자연스럽게 같이 스타일이 통일됨.
- **네비게이션 정리**: "문의 답변"(`admin-board.html`) 상단 네비 링크를 제거하고, `board.html` 툴바에 "문의 답변" 버튼을 추가(admin/staff에게만 노출). staff는 `board.html` 진입 시 이미 `admin-board.html`로 자동 리다이렉트되므로 이 버튼은 사실상 admin 전용 — 사용자가 명시적으로 요청한 구조("게시판 들어가면 옆에 따로 답변 페이지 누를 수 있게, 네비의 답변은 없애고").
- **버그 하나 자체 발견·수정**: `admin-board.js`에서 답변 등록 후 방금 답변한 행의 배지를 갱신하려고 처음엔 "목록 배열 인덱스와 표 행 인덱스가 같은 순서일 것"이라고 가정하는 코드를 짰는데, 검색 필터가 걸려있는 등 순서가 어긋날 수 있는 취약한 방식이라 바로 수정 — 각 `<tr>`에 `data-post-id`를 심어서 `querySelector`로 정확히 찾도록 변경.
- **검증**: API는 전혀 안 건드려서(응답 형태 동일) 기존 curl 검증이 그대로 유효. 정적 파일 서빙(`200`) + `node --check` 문법 검사 + HTML 태그 짝(`<div>`/`<section>`/`<table>`) 정합성 확인. 브라우저 자동화 도구가 없어 실제 렌더링은 육안 확인 필요(사용자에게 안내함).
- **[추가 2026-09-11] 표 아래 페이지 번호도 추가**: 스크린샷의 페이지네이션(«‹1 2 3›»)을 실제로 구현 — 서버는 여전히 전체 목록을 한 번에 내려주고(문의 게시판 규모상 서버 페이징까지는 불필요), 클라이언트에서 `PAGE_SIZE=10`씩 잘라서 보여주는 방식. 현재 페이지 버튼은 강조 표시, 첫/마지막 페이지에서 이전/처음 버튼은 비활성화. `board.js`/`admin-board.js` 둘 다 동일 패턴 적용, 검색 시 1페이지로 리셋. `.pagination` CSS 신규.

---

## 7. RBAC (자세한 설계는 [RBAC-Plan.md](RBAC-Plan.md) 참고)

### AS-IS → TO-BE
기존에는 `requireAdmin` 미들웨어가 `role === 'admin'` 문자열을 직접 비교하는 방식(역할과 권한이 분리 안 됨)이었다. `roles`/`permissions`/`role_permissions` 3개 테이블로 역할-권한을 다대다로 분리하고, 라우트는 권한 이름만 선언하는 `requirePermission("문서형태:행위")` 패턴으로 전환했다.

### 최종 권한 매핑

| 권한 | patient | staff | admin |
|---|---|---|---|
| `board:read` | ✅ | ✅ | ✅ |
| `board:write` | ✅ | ❌ | ✅ |
| `board:reply` | ❌ | ✅ | ✅ |
| `ocr:scan` / `documents:create` / `documents:view` / `patients:view` | ❌ | ❌ | ✅ |
| `reservations:create` | ✅ | ❌ | ❌ |
| `reservations:view:own` | ✅ | ❌ | ❌ |
| `reservations:manage` | ❌ | ✅ | ✅ |
| `patients:register` | ❌ | ✅ | ✅ |
| `accounts:manage` | ❌ | ❌ | ✅ |
| `records:view:own` | ✅ | ❌ | ❌ |
| `records:view:masked` | ❌ | ✅ | ❌ |
| `records:view:full` / `records:write` | ❌ | ❌ | ✅ |
| `audit:view` | ❌ | ❌ | ✅ |
| `holidays:manage` | ❌ | ❌ | ✅ |

### 전체 권한 표 재테스트 (2026-09-08)

위 표의 모든 권한을 patient1/staff1/admin 세 계정으로 curl 재검증했다 (단순 200/403뿐 아니라 응답 내용도 확인).

- **불일치 1건 발견 및 표 수정**: `board:write`는 표에 staff도 ✅였지만, 실제로는 `db/init.sql`이 `WHERE r.name IN ('patient', 'admin')`로만 부여해서 staff는 `403`. staff는 `board:reply`(답변)만 있고 `board:write`(문의 작성)는 없는 게 실제 동작 — 위 표를 이에 맞춰 수정함. (staff가 환자 대신 문의를 작성할 이유가 없다는 점에서, 표보다 실제 구현 쪽이 합리적으로 보임 — 표가 잘못 기재됐던 것으로 판단)
- **나머지는 전부 표와 일치** — 아래는 200/403 여부뿐 아니라 응답 내용까지 확인한 것들:
  - `records:view:*`: 같은 `GET /api/records?patient_id=1` 요청에 patient/admin은 원문(`diagnosis`/`treatment`) 그대로, staff는 `"테스***"`/`"***"`로 마스킹된 값 반환 확인
  - `records:view:own`의 소유자 스코핑: patient가 `?patient_id=2`로 요청해도 쿼리 파라미터를 무시하고 세션의 본인 id(1)만 반환 — 클라이언트 입력을 신뢰하지 않는 IDOR 방지 구조 확인
  - `reservations:view:own` vs `reservations:manage`: patient는 본인 예약만(6건, 전부 `patient_id=1`), staff는 전체(8건, 2명분) 반환 확인

### 구현 완료 항목 (2026-09-04)
- `staff` 역할 신규 추가(`staff1`/`staff1234`), 신규 권한 10개 + `role_permissions` 매핑
- `reservations`/`medical_records`/`audit_log` 3개 테이블 신규, `board_posts`에 `answer`/`answered_by`/`answered_at` 컬럼 추가
- `was/audit.js`(공용 로깅 헬퍼) 신규 — 로그인 성공/실패, 계정 역할 변경을 실제로 기록 중
- 진료기록은 역할별로 다른 응답(patient=본인 전체, staff=마스킹, admin=전체)을 서버가 직접 분기해서 내려줌
- curl 기준 검증 전부 완료 (권한별 200/403, IDOR 차단, 마스킹 동작 등 — 자세한 로그는 RBAC-Plan.md 참고)

**단, 이 구현은 전부 백엔드 API 기준이었다 — 이후 5번 섹션에서 예약/문의답변/예약관리/staff 전용 화면의 프론트가 추가됐고, 지금 남은 건 계정관리·감사로그뿐이다 (2번 표 참고).**

---

## 8. 검증 완료 항목 (통합)

- **JS/Python 정적 검사**: `node --check`(chat.js, documents.js, crypto-utils.js, config.js, server.js, chat-widget.js, board.js, home.js, records.js), Python 문법 검사(app.py, hospital_agent.py, tools_db.py, pii_masking.py) 모두 통과
- **HTML 태그 짝 확인**: board.html, index.html, records.html
- **역할 분리 확인**: `admin.html`에 챗봇 위젯 미노출, 환자 화면(`board.html`)에 OCR UI 없음
- **RBAC curl 검증**: 예약/문의답변/환자등록/진료기록/감사로그 전부 권한별 200/403 확인, IDOR 차단(타 환자 데이터 접근 403) 확인
- **OCR 브라우저 검증**: 실제 이미지로 추출→저장→목록 표시(원문 미노출) 흐름 확인
- **CSRF 검증**: 토큰 미포함 시 403, 포함 시 200

---

## 9. 확인 사항 / 체크리스트

### 🔴 즉시 확인 필요 (다음 작업을 막는 것)

- [x] **챗봇 응답 불가 — 해결됨 (2026-09-08)** — `chatbot-service/3-1-llm.py`의 답변 생성 모델을 아래처럼 변경(단종된 모델 → 사용 가능한 모델로 하드코딩):
  ```python
  # 변경 전
  CHAT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
  # 변경 후
  CHAT_MODEL = "gemini-3.6-flash"
  ```
  `chatbot-service/2-embeddings.py`도 함께 변경(`EMBED_MODEL`을 환경변수 오버라이드 없이 `"models/gemini-embedding-001"`로 고정, `load_dotenv()` 호출 추가). 두 파일 반영 후 챗봇 재시작 → curl 재검증: `{"answer":"안녕하세요! 미소병원 안내 챗봇입니다..."}` (HTTP 200) 정상 응답 확인.
- [x] **`require_gemini()`의 `sys.exit(1)` — 해결됨 (2026-09-08)** — `3-1-llm.py`/`2-embeddings.py`의 `require_gemini()` 에러 처리를 `sys.exit(1)`(프로세스 강제 종료) → `raise ValueError`/`raise ImportError`(예외로 던짐, 잡을 수 있음)로 복구. 모델명(`gemini-3.6-flash`)은 그대로 유지. `python3 -m py_compile`로 문법 확인, 챗봇 재시작 후 curl로 정상 응답 재확인.
- [x] **staff 역할의 프론트 진입점 부재 — 해결됨 (2026-09-08)** — 팀원(`Sunjung Hwang`) 커밋 `5bbf361`("예약 관리·문의 답변 화면 추가")로 `admin-reservations.html`(예약 승인/취소), `admin-board.html`(문의 답변)이 추가되고 둘 다 `role !== 'staff' && role !== 'admin'`이면 차단하도록 프론트 가드가 들어감. `home.js`/`board.js`도 `role === 'staff'` 분기 추가로 로그인 시 이 화면들로 안내됨. `pull` 후 재기동, 신규 페이지 전부 `200` 서빙 확인. **남은 갭**: `records:view:masked`(진료기록 마스킹 열람)는 여전히 프론트 진입점이 없음 — `board.js` 확인 결과 staff는 로그인하자마자 `admin-board.html`로 강제 리다이렉트되고 `board.html`의 다른 링크(`recordsLink` 포함)는 patient 전용 `else` 분기에만 있어서 staff는 볼 수도 없음.
- [x] **admin이 게시판 문의 상세 조회 시 403 — 해결됨 (2026-09-08)** — `was/routes/board.js`의 `GET /:patientId`가 `board:reply`(staff/admin) 권한 여부와 무관하게 `patientId !== 세션 patientId`면 무조건 403이었음. 목록(`GET /`)은 `board:reply` 보유자에게 전체 문의를 보여주는 분기가 있는데, 상세조회에는 같은 분기가 빠져있던 게 원인 — admin이 게시판 목록은 다 보이는데 클릭해서 들어가면 막히는 증상으로 나타남. `hasPermission(role, "board:reply")`면 소유자 검증을 건너뛰도록 수정. curl 검증: admin이 타 환자(patient_id=1) 상세 조회 → `200`, 일반 환자(patient1)가 타 환자(patient_id=2) 상세 조회 시도 → 여전히 `403`(IDOR 방지 유지 확인).
- [ ] **HTTP 보안 헤더 전무 (2026-09-08 발견)** — `was/server.js`에 `helmet` 등 보안 헤더 미들웨어가 없음(`grep` 확인). CSP(Content-Security-Policy)·`X-Frame-Options`·`X-Content-Type-Options`가 전부 안 걸려있어서, 클릭재킹 방어와 MIME 스니핑 방어가 없고, 혹시 XSS가 하나라도 뚫리면(현재는 `sanitizeHtml`/`textContent`로 막고 있음) 이를 완화할 2차 방어선이 없는 상태. `helmet` npm 패키지 추가로 대부분 기본값 해결 가능한 저비용 개선. **미수정.**

### 🟡 결정 필요 (설계 판단)

- [x] **역할 세분화 로드맵 (결정됨, 2026-09-08)** — `admin`/`staff`/`patient` 이상으로 더 세분화하지 않기로 결정. "의사"/"간호사" 등 별도 역할은 추가하지 않으며, 진료기록은 계속 `admin`이 작성하는 것으로 확정(`medical_records.written_by`는 계속 admin 계정을 가리킴). **이미 이 3개 역할만 존재하는 구조라 별도 코드 변경은 불필요** — "더 안 늘리기로 확정"이라는 결정 자체가 반영 완료.
- [x] **예약 시간대 중복/용량 제한 (구현 완료, 2026-09-08)** — 같은 시간대(`reserved_at`, 진료과 무관) 최대 2명까지로 제한. `was/routes/reservations.js`의 `POST /`에 취소되지 않은(`status != 'cancelled'`) 예약 수를 세어 2건 이상이면 `409`로 거부하는 로직 추가. curl로 검증: 같은 슬롯에 환자 2명 예약 성공(`200`) → 3번째 환자는 `409 "해당 시간대는 예약이 마감되었습니다."` 확인.
  - **[재점검 2026-09-10] 경쟁 조건 남아있음** — 전체 프로젝트 점검(`BUG_REVIEW_2026-09-10.md`) 결과, COUNT와 INSERT가 트랜잭션/락 없이 분리된 별개 쿼리라는 게 확인됨(`reservations.js:82-94`). 위 검증은 순차 요청 기준이라 문제가 안 드러났을 뿐 — 거의 동시에 두 요청이 오면 둘 다 `count < 2`를 통과해 정원을 넘겨 예약될 수 있음. 아직 미수정.
- [ ] **진료과(`department`) 자유 입력 여부** — `reservations.department`는 지금 그냥 문자열(최대 50자)이라, 프론트나 챗봇을 통해 사용자가 "내과"/"내 과"(공백)/"Internal Medicine" 등 뭐든 입력한 그대로 저장됨 — 오타·표기 차이가 그대로 쌓일 수 있는 구조. **[근거 추가 2026-09-10]** `hospital_agent.py`의 `DEPARTMENT_PATTERN`(`[가-힣]{2,6}과` 형태면 다 통과)이 실제로 검증 없이 그대로 저장한다는 것을 전체 점검에서 재확인 — 이 결정이 미뤄질수록 실사용 데이터에 오타/표기차이가 계속 쌓이는 중.
  - **"고정 목록으로 바꾼다"의 의미**: 미리 정해둔 값들(예: 내과/외과/소아과/정형외과/피부과 등) 중 하나만 저장되도록 강제하는 것. 구현 방법은 ① DB 컬럼을 `ENUM('내과','외과',...)`로 제한하거나 ② 별도 `departments` 테이블을 만들고 `reservations.department_id`로 외래키 연결하는 방식 중 하나.
  - **트레이드오프**: 고정 목록으로 바꾸면 나중에 진료과별로 예약을 집계/필터링할 때 표기 차이 때문에 데이터가 누락되는 일이 없어짐. 대신 새 진료과가 생기면 코드/DB를 고쳐야 해서 자유 입력보다 유연성은 떨어짐.
  - 아직 어느 쪽으로 갈지 결정 안 됨.
- [x] **문의 답변 수정/이력 관리 — 결정 및 구현 완료(2026-09-10)** — `answer` 컬럼 하나뿐이라 재답변 시 이전 답변이 덮어써지고 이력이 안 남던 문제.
  - **결정**: 답변은 한번 쓰면 수정 불가, 대신 추가 답변을 계속 달 수 있게(수정 UI 자체를 없애고 항상 새로 추가).
  - **구현**: `board_posts.answer/answered_by/answered_at` 컬럼을 없애고 `board_answers(id, post_id, answered_by, answer, created_at)` 테이블을 신설 — UPDATE/DELETE를 아예 쓰지 않고 항상 INSERT만 해서 구조적으로 수정이 불가능하게 함. 기존 답변 4건은 새 테이블로 백필 후 컬럼 드롭(로컬 MySQL에 직접 적용, 데이터 유실 없음 확인). `was/routes/board.js`의 `PATCH /:id/answer`(UPDATE)를 `POST /:id/answer`(항상 INSERT)로 변경, 목록/상세 API가 단일 `answer` 대신 `answers`(이력 전체 배열) 필드를 반환하도록 변경. 프론트(`admin-board.js`/`board.js`/`view.js`) 모두 배열 기준으로 수정 — staff 화면은 기존 답변을 읽기 전용으로 나열하고 새로 쓸 빈 textarea만 제공("답변 수정" 버튼 제거).
  - **검증**: staff 계정으로 같은 문의에 답변을 연속 두 번 POST → 백필된 기존 답변까지 총 3건이 전부 순서대로 유지됨을 확인. 존재하지 않는 문의 id로 POST → 404. patient 계정으로 답변 POST 시도 → 403(RBAC 정상). 환자 본인 목록/상세 조회에서도 전체 이력이 동일하게 노출됨을 확인. 상세는 `RBAC-Plan.md` "2단계 — 문의 답변" 참고.
- [x] **감사 로그 보존 정책 — 결정 및 구현 완료(2026-09-10)** — `audit_log`가 삭제/보관 기간 없이 무기한 적재되던 문제.
  - **결정**: 감사 로그(행위 기록)는 2년, 환자 진료/상담 데이터(`chat_messages`, `medical_records`)는 10년으로 정책 분리. 후자는 감사 로그가 아니라 별도 정책 대상이라 이번 구현 범위에서 제외(삭제 기능 미구현 — 필요해지면 별도 설계).
  - **실제로는 4곳에 로그가 나뉘어 있었음**: MySQL `audit_log`, `chatbot_logs.db`(SQLite) `logs` 테이블, `audit-logs/audit_log.jsonl`(+로테이션 백업), MySQL `chat_messages`. 이 중 앞의 셋만 "감사 로그"라 2년 정책 대상.
  - **발견한 실제 버그**: `chatbot-service/audit_decorator.py`가 `TimedRotatingFileHandler`를 `backupCount=30`으로 쓰고 있어서, 의도한 보존 기간(이번에 2년으로 확정)과 무관하게 **로테이션 백업 파일이 30일만 지나면 자동으로 삭제되고 있었음** — 보존 정책이 있으나 마나였던 상황. `backupCount=0`으로 바꿔 자동 삭제를 끄고(로테이션 자체는 계속됨), 실제 삭제는 아래 도구를 관리자가 직접 실행할 때만 일어나도록 함. `AuditEngine`의 `retention_days`도 90 → 730(2년)으로 변경(현재는 레코드별 `expiry_date` 메타데이터 계산에만 쓰이고 자동 삭제엔 관여하지 않음).
  - **구현**: 자동 스케줄러(cron 등)는 이 프로젝트에 배포 인프라 자체가 없어 새로 안 만들고, 관리자가 직접 실행하는 정리 스크립트로 결정(장단점 비교 후 확정) — `chatbot-service/log_retention_tool.py` 신규 추가. 기본은 dry-run(삭제 없이 대상 건수/파일만 출력)이고 `--execute`를 줘야 실제 삭제. JSONL은 레코드 단위가 아니라 **로테이션 백업 파일(하루치) 단위로만** 삭제 — 각 레코드 hash가 직전 레코드 hash를 포함하는 해시체인이라 파일 중간 레코드만 지우면 그 이후 체인이 깨지는데, 오래된 날짜의 백업 파일 전체를 통째로 지우는 건 남은 파일들의 체인 내부 무결성과 무관해서 안전함(재시작 시 이어받는 `previous_hash`도 "가장 최근" 백업 기준).
  - **검증 완료**: MySQL `audit_log`/`chatbot_logs.db`/`audit-logs/*.jsonl.*`에 각각 2년(800일) 전 타임스탬프의 테스트 레코드·파일을 심어두고 dry-run → 정확히 1건/1건/1개만 대상으로 잡히는 것 확인 → `--execute` 실행 → 오래된 것만 삭제되고 같이 넣어둔 최근 레코드는 그대로 남는 것 확인 → 재실행 시 대상 0건으로 확인. 테스트로 심었던 최근 레코드는 이후 수동으로 정리.
- [x] **감사 로그 암호화 키 이원화 정리 — 결정 및 조치 완료(2026-09-10)** — `secret.key`(챗봇 SQLite 감사 로그)와 `AUDIT_ENCRYPTION_KEY`(.env, audit-agent JSONL) 두 체계가 왜 따로 있는지 불명확했던 문제.
  - **확인한 사실**: 둘 다 알고리즘은 같음(`Fernet`, 대칭키) — 목적과 대상 데이터가 다름. `secret.key`는 `chatbot_logs.db`(SQLite `logs`, `original_encrypted` — 마스킹 전 원문 채팅)를 암호화해 "LLM에 마스킹된 텍스트만 전달됐는지" 검증하는 좁은 목적. `AUDIT_ENCRYPTION_KEY`는 `audit_log.jsonl`(해시체인·risk_level·보존기한 포함한 도구 호출 입출력 전체)을 암호화하는 더 포괄적인 행위 감사 목적.
  - **결정: 통합하지 않고 분리 유지 + 이 문서로 이유 기록.** 이유: (1) Fernet은 키를 바꾸면 기존 암호문을 그 키로 못 읽어서, 통합하려면 기존 `chatbot_logs.db`/`audit_log.jsonl` 데이터를 옛 키로 복호화 → 새 키로 재암호화하는 마이그레이션이 필요함(데이터 있는 상태에서 리스크 있는 작업). (2) 지금처럼 나뉘어 있으면 한쪽 키가 뚫려도 다른 쪽 저장소는 안전한데, 합치면 블라스트 반경이 두 저장소로 같이 커짐. (3) 목적 자체가 다른 두 감사 체계라 키를 억지로 합칠 실익이 적음.
  - **[겸사겸사 발견·수정한 관련 버그] `secret.key`/`chatbot_logs.db` 파일 권한 미설정** — `chatbot-service/app.py`가 두 파일을 만들 때 `chmod`를 전혀 안 해서 기본 umask대로 `0644`(그룹/전체 읽기 가능)로 생성되고 있었음(`ls -la`로 실측 확인). `audit_decorator.py`는 같은 문제를 이미 `0600`으로 고쳐뒀는데(`SecureTimedRotatingFileHandler`) 이쪽엔 그 조치가 빠져있었음 — **이 컴퓨터/서버의 다른 로컬 계정이 두 파일을 다 읽으면 키+암호문을 같이 확보해서 마스킹 전 원본 채팅(PII 포함 가능)을 복호화할 수 있는 상태**였음(이전에 고친 `audit_log.jsonl` 건은 로그만 새고 키는 `.env`에 따로 있어서 이 정도로 심각하진 않았음 — 이번 건은 키·암호문이 같은 코드로 같이 노출되는 조합이라 더 나쁨).
    - **수정**: `app.py`에서 `secret.key`/`chatbot_logs.db` 생성·오픈 직후 `os.chmod(경로, 0o600)` 추가(매 시작마다 재적용 — 멱등). 기존에 이미 있던 두 파일도 수동으로 `chmod 600` 소급 적용.
    - **검증**: 수정 전 `ls -la` → `-rw-r--r--`(0644) 확인 → 수정 후 재시작 → `-rw-------`(0600) 확인. 재시작 후에도 챗봇 정상 응답(`POST /chat` 200) 및 `chatbot_logs.db`에 새 행 정상 기록되는 것 확인(권한을 좁혀도 소유자 프로세스의 읽기/쓰기는 문제없음).
- [x] **파싱 실패/부정확 시 UX — 결정 및 구현 완료(2026-09-10)** — OCR 날짜·금액·기타 필드 파싱이 실패/오인식해도 관리자가 알아챌 방법이 없던 문제.
  - **원래 상태**: 환자는 `records.html`에서 `parsed_date`/`parsed_amount`(목록)와 `extracted_text`(상세)를 다 볼 수 있어서 원문과 대조하면 오인식을 알아챌 수 있었는데, **정작 admin(입력한 사람)은 목록에 이름/날짜시간/문서종류만 나오고 파싱 결과·원문이 전부 빠져있어서 확인 수단이 아예 없었음** — 진짜 문제는 이 비대칭이었음. `parsed_fields`(라벨:값 범용 필드)는 API 응답에도 없고 어느 화면도 렌더링 안 해서 완전히 죽은 데이터였음.
  - **1단계(같은 날 앞서 진행)**: "텍스트 스캔 사이즈 줄이고 왼편에, 원본 이미지 오른편에" 작업 때 `GET /api/documents`에 `extracted_text` 추가 → admin도 원문은 보게 됨. 다만 `parsed_date`/`parsed_amount`는 여전히 안 내려가서 "원문은 보이는데 파싱 결과와 대조할 게 없는" 상태로 반쯤만 해결돼 있었음.
  - **2단계(이번 조치) — 나머지 마저 해결 + 수정 기능까지 추가**:
    - `GET /api/documents`(admin 목록) SELECT에 `parsed_date`/`parsed_amount` 추가 — 환자 쪽과 동등하게 맞춤.
    - **`PATCH /api/documents/:id` 신규(admin 전용, `documents:create` 권한 재사용)**: 저장 후에도 오인식을 발견하면 그냥 다시 볼 수만 있는 게 아니라 **직접 고칠 수 있게** 함. 텍스트만 받아서 저장 시(`POST /`)와 똑같은 파싱 함수(`parseDate`/`parseAmount`/`parseLabeledFields`)를 서버에서 재실행 — 원문 하나만 진짜 값이고 나머지(날짜/금액/parsed_fields)는 전부 거기서 파생된다는 원칙을 유지해서, 날짜/금액을 텍스트와 별도로 고치는 UI를 안 만들어도 됨.
    - **UI 전면 개편**: "저장된 문서" 목록을 카드(클릭하면 펼쳐지는 `<li>`) 방식에서 환자용 `records.html`과 같은 **표(환자명/종류/날짜/금액) + 클릭 시 아래 공용 상세 패널** 구조로 변경. 상세 패널엔 텍스트를 고칠 수 있는 `<textarea>` + "수정 저장" 버튼 + 인식된 날짜/금액 표시(수정 저장하면 바로 갱신) + 원본 이미지(왼쪽 텍스트/오른쪽 이미지 2단 그리드, 기존 패턴 재사용)가 같이 들어감. "문서 스캔"(작성 폼)과 "저장된 문서"(목록/상세) 사이에 여백+구분선을 넣어 시각적으로도 분리.
    - **겸사겸사 수정한 버그**: 상세 패널을 공용 하나로 바꾸면서, `records.js`에서 이미 찾아뒀던 "문서를 빠르게 연속 클릭하면 늦게 도착한 fetch가 엉뚱한 문서의 blob URL을 덮어쓰는" 경쟁 조건(`BUG_REVIEW_2026-09-10.md`)과 같은 유형의 버그가 새로 만드는 코드에도 생길 뻔해서, `currentDetailId`를 기록해두고 응답이 늦게 와도 현재 보고 있는 문서가 맞는지 확인하는 가드를 처음부터 넣음. 겸사겸사 `records.js` 쪽의 원래 버그도 같은 방식으로 고침(선제 수정 완료).
    - **`parsed_fields` 결정: 화면에 노출하지 않고 죽은 데이터로 그대로 둠.** 실제로 채워지는 값이 "문서 종류"/"환자명" 정도뿐인데 이 둘은 이미 목록/상세에 따로 표시되고 있어서 굳이 또 보여줄 실익이 적다고 판단 — UI 설계(임의 키-값을 어떻게 표로 보여줄지)까지 새로 해야 하는 것에 비해 가치가 낮음. 필요해지면 그때 다시 검토.
  - **검증**: 날짜/금액이 안 뽑히는 텍스트로 문서 저장(`parsed_date`/`parsed_amount` 둘 다 `null`) → `PATCH`로 날짜·금액이 인식되는 형태로 텍스트 수정 → 응답에 `parsed_date`/`parsed_amount` 정상 반영 확인 → `GET /api/documents`(admin) 재조회 시 갱신값 확인 → **환자용 `GET /api/documents/mine`에도 자동으로 같은 갱신값이 반영됨을 확인**(별도 동기화 코드 없이 같은 컬럼을 읽으므로 당연히 그렇지만 실제로 재검증함). 빈 텍스트 `400`, 존재하지 않는 문서 `404`, CSRF 토큰 없이 `403`, patient 계정으로 시도 `403` 전부 확인.
- [x] **OCR 원문 재조회 필요성 — 원본 이미지 저장 구현 완료(2026-09-10)** — "업로드한 원본 이미지를 따로 저장해두면 되지 않나?"라는 질문에서 시작해, 결정부터 구현·검증까지 완료.
  - **검토**: 기존 `was/routes/ocr.js`는 `multer.memoryStorage()`로 이미지를 디스크에 전혀 안 쓰고 메모리에서만 처리 — 이는 "유출 시 텍스트보다 정보량이 많은 원본 이미지를 아예 안 남긴다"는 의도된 보안 결정이었음. 저장하기로 하면 이 결정을 뒤집는 것이므로 접근 제어(RBAC)·저장소 암호화를 반드시 같이 챙기기로 함. 저장 위치는 디스크 파일(vs DB BLOB) 선택.
  - **구조적 문제 발견**: 기존 흐름은 `POST /api/ocr`(텍스트 추출)과 `POST /api/documents`(저장)가 분리돼 있고, 이미지 버퍼는 `POST /api/ocr` 응답 후 폐기됨 — 두 요청 사이 어디에도 이미지가 살아남는 지점이 없어서, 그대로면 "원본 이미지 저장"을 걸 자리가 없었음. **해결**: `#scanImage` 파일 인풋을 OCR 이후에도 리셋하지 않는 걸 이용해, 최종 저장(`POST /api/documents`) 시점에 이미지를 다시 첨부해 함께 전송하는 방식(Option B)으로 확정.
  - **구현**:
    - `was/crypto-utils.js`: 기존 `encryptRrn`/`decryptRrn`은 마지막에 `.toString("utf8")`로 변환해 문자열 전용이라 임의 바이너리(이미지)에 쓰면 바이트가 깨짐 — 같은 AES-256-GCM·같은 키를 쓰되 Buffer를 그대로 주고받는 `encryptBuffer`/`decryptBuffer` 신규 추가.
    - `db/init.sql` + 로컬 MySQL: `scanned_documents`에 `image_path VARCHAR(64) NULL` 추가(암호화 파일명, NULL이면 이미지 없는 기존/구버전 레코드).
    - `was/routes/documents.js`: `POST /`를 `multer.memoryStorage()` 기반 multipart 처리로 변경(이미지는 선택 항목, 없어도 기존처럼 텍스트만 저장 — 하위호환 유지). 이미지가 있으면 서버가 `crypto.randomBytes(16).toString("hex") + ".enc"`로 랜덤 파일명을 생성(클라이언트가 파일명을 지정 못하게 함)해 `encryptBuffer`로 암호화 후 `scanned-images/`에 저장. 신규 라우트 `GET /:id/image`(`requirePermission("documents:view")`로 admin 전용)가 파일명을 정규식(`/^[0-9a-f]{32}\.enc$/`)으로 재검증(경로 조작 방지, 값은 항상 서버 생성이라 이중 방어 성격) 후 복호화해서 반환. `GET /`(목록) 응답에 `hasImage` boolean 추가.
    - `frontend/js/admin.js`: 저장 요청을 JSON → `FormData`로 변경(파일을 같이 보내야 하므로). 목록에 `hasImage`인 문서만 "원본 이미지 보기" 링크 표시 — `<a href>` 직접 노출 대신 `fetch(...credentials:'include')`로 받아 Blob URL을 새 탭에 열도록 해서 평문 URL로 권한 체크 없이 접근되는 경로가 생기지 않게 함.
    - `.gitignore`에 `scanned-images/` 추가 — 암호화해서 저장하지만 민감한 의료 이미지라 git에는 안 올림.
  - **검증 완료** (실제 PNG 업로드로 end-to-end): ① `encryptBuffer`/`decryptBuffer` 라운드트립 테스트(0x00~0xFF 전 바이트 포함한 256바이트 버퍼)로 정확히 원복되는 것 확인. ② `POST /api/documents`에 이미지 첨부 저장 → `{"hasImage":true}` 응답, DB `image_path` 기록 확인. ③ 디스크의 `.enc` 파일을 직접 열어 PNG 매직바이트가 전혀 안 보이는 것 확인(평문 저장 아님). ④ `GET /:id/image`로 재조회한 이미지가 원본과 **바이트 단위로 완전 일치**(`diff` 무출력), `Content-Type: image/png` 정확. ⑤ 목록 조회(`GET /api/documents`)에 `hasImage: true` 정상 포함. ⑥ 권한 없는 계정(`patient1`)으로 `GET /:id/image` 접근 시 `403` 확인 — RBAC 정상 동작.
  - **[확장 2026-09-10] 환자 본인 원본 이미지 열람 추가**: 위 구현까지는 admin만 원본 이미지를 볼 수 있었는데("환자도 본인 거 볼 수 있게끔" 요청), 환자 자신의 문서 원본도 볼 수 있어야 한다는 요구가 추가됨.
    - **왜 `documents:view` 권한을 그대로 주지 않았는가**: `documents:view`는 "전체 환자의 문서 목록/이미지를 볼 수 있다"는 admin 전용 권한이라, 이걸 환자에게 주면 다른 환자 문서까지 다 보이게 됨. 대신 기존 `GET /api/documents/mine`, `GET /api/documents/mine/:id`(로그인만 확인 + `WHERE patient_id = 세션 사용자`로 소유권 직접 스코핑, `requirePermission` 미사용)와 같은 패턴으로 `GET /api/documents/mine/:id/image` 신규 추가 — 권한을 넓히는 대신 "내 것만" 필터링으로 해결.
    - `GET /:id/image`(admin용)와 새 라우트가 "복호화해서 이미지로 응답"하는 로직이 동일해서, 그 부분을 `sendImage(res, imagePath)` 공용 함수로 뽑아 중복 제거 — 둘의 차이는 어떤 문서에 접근 가능한지(권한 vs 소유권)뿐, 파일 읽기·복호화·Content-Type 판별·경로 조작 방지 정규식 검증은 동일하게 공유.
    - `GET /mine/:id` 응답에 `hasImage` 필드 추가(admin 목록과 동일한 boolean 플래그). `frontend/js/records.js`(환자 "내 진료기록" 상세)에 `admin.js`와 같은 패턴(`<a href>` 대신 fetch+blob URL)으로 "원본 이미지 보기" 링크 추가.
    - **검증**: admin이 patient1 앞으로 이미지 첨부 저장 → patient1 로그인으로 `GET /mine/:id`에 `hasImage:true` 확인 → `GET /mine/:id/image`로 받은 이미지가 원본과 바이트 단위 일치, `Content-Type: image/png` 확인. **IDOR 확인**: 같은 문서를 patient2(다른 환자) 계정으로 조회 시 `404`(자기 소유가 아니므로 애초에 쿼리 결과 없음), 비로그인은 `401`. 기존 admin 라우트(`GET /:id/image`)도 리팩터 이후 동일하게 정상 동작하는지 회귀 확인.
  - **[UI 개선 2026-09-10] "텍스트 스캔 사이즈 줄이고 왼편에, 원본 이미지는 링크 말고 오른편에 이미지로"**: 3개 화면 모두 텍스트(왼쪽, 폰트 작게)/원본 이미지(오른쪽, 클릭 없이 바로 렌더링) 2단 그리드(`.record-detail__grid`/`__text-col`/`__image-col`, `frontend/css/style.css`)로 통일.
    - `records.html`(환자 상세): 기존 "원본 이미지 보기" 링크를 없애고, `hasImage`면 fetch+blob으로 받은 이미지를 페이지 로드 시 바로 `<img>`로 렌더링.
    - `admin.html` 저장된 문서 목록: 이전엔 서버가 `extracted_text`를 아예 안 내려주고(의도적 결정이었음, 위 항목 참고) 이미지도 클릭해야 여는 링크였음 — `GET /api/documents` 응답에 `extracted_text` 포함하도록 변경(admin 본인이 OCR 오인식을 바로 확인 가능해짐 — report_merge_final.md에 계속 남아있던 "파싱 실패/부정확 시 UX" 문제의 일부 해결), 이미지도 클릭 없이 바로 렌더링.
    - `admin.html` 스캔 작성 화면: 파일 선택 즉시(스캔/저장 전) `URL.createObjectURL(file)`로 오른쪽에 원본 미리보기 표시(서버 왕복 불필요, 로컬 파일 그대로 사용). `resultText` textarea는 10행→8행, 폰트 13px로 축소해 왼쪽 칼럼에 배치.
    - **한계**: 브라우저 자동화 도구가 없어 실제 렌더링(레이아웃 깨짐 여부, 반응형 줄바꿈 등)은 육안 확인을 못 했음 — API 응답 필드(`extracted_text` 포함 여부)와 HTML 태그 짝(`<div>`/`</div>` 개수) 정합성만 확인. 실제 화면은 사용자가 브라우저로 확인 필요.
    - **[수정 2026-09-10] 사용자 육안 확인 후 피드백 반영**: 실제로 열어보니 두 가지 문제가 있었음.
      1. **관리자 저장 문서 목록이 항목마다 자동으로 다 펼쳐져 있었음** — 목록에 문서가 많으면 열자마자 이미지를 전부(항목 수만큼) fetch하게 되는 구조라 비효율적이고, "선택해야 보이던" 이전 동작과도 다름. `renderDocument()`를 다시 고쳐 각 항목을 클릭 가능한 `<button class="document-item__summary">`로 감싸고, 텍스트/이미지 그리드는 기본 `hidden`으로 시작 — 클릭해서 펼칠 때만 보이게(다시 클릭하면 접힘) 하고, 이미지는 **처음 펼칠 때 딱 한 번만** fetch해서 이후 토글은 재요청 없이 보이기/숨기기만 함(`imageLoaded` 플래그).
      2. **2단 그리드가 실제로 안 나뉘고 세로로 쌓여 있었음** — 원인은 `admin.html`이 쓰는 `.board-container`가 `max-width:600px`(다른 관리자 폼들과 공용)라서, 안쪽 패딩을 빼면 ~520px인데 텍스트 칼럼(320px)+이미지 칼럼(280px)+gap(20px)=620px가 안 들어가 `flex-wrap`으로 무조건 줄바꿈되던 것. 로그인/휴진일 관리 등 다른 `.board-container` 페이지는 좁아야 정상이라 그 기본값은 그대로 두고, `admin.html`에만 `board-container--wide`(900px, `records.html`/`board.html`이 쓰는 `.page-body`와 같은 폭) 클래스를 추가로 얹어 이 페이지만 넓힘.
    - **[기능 추가 2026-09-10] 이미지 확대/축소**: 원본 이미지를 작게만 보여주고 더 자세히 볼 방법이 없다는 요청 — `frontend/js/image-zoom.js` 신규(`admin.html`/`records.html`에 공통 스크립트로 추가). `.record-detail__image` 클래스가 붙은 이미지(records.js 환자 상세, admin.js 목록 펼침, admin.html 스캔 미리보기 전부 이 클래스를 공유)를 클릭하면 어두운 배경의 라이트박스가 뜨고, `+`/`−`/`100%` 버튼과 마우스 휠, 키보드(`+`/`-`/`Esc`)로 확대·축소·닫기가 가능. 이미지가 나중에 동적으로 생기는 화면이 대부분이라 개별 요소가 아니라 `document`에 클릭을 위임해서 스크립트 로드 시점과 무관하게 항상 동작하게 구현.
      - **버그 1 (수정·커밋 완료, `d572559`)**: `.image-zoom-overlay`가 `display:flex`를 조건 없이 선언해서, 우선순위가 같은 브라우저 기본 `[hidden]{display:none}`을 author 스타일시트가 덮어씀 — 페이지 들어가자마자 어두운 배경이 떠 있고 X를 눌러도(내부적으로 `hidden=true`는 되지만) 안 닫히던 원인. `.image-zoom-overlay[hidden]{display:none}` 추가로 해결.
      - **버그 2**: 관리자 저장 문서 목록에서 "선택해야(클릭해야) 텍스트/이미지가 보이게" 만든 것과 같은 원인의 같은 버그가 `.record-detail__grid`에도 있었음 — admin.js가 이 grid 요소 자체에 `hidden`을 토글하는데, `.record-detail__grid { display:flex }`도 똑같이 조건 없이 선언돼 있어서 `hidden`이 안 먹혀 선택 안 해도 텍스트가 계속 보이던 것(이미지는 JS에서 클릭 시점에만 fetch하므로 안 보였음 — 텍스트만 새는 비대칭적인 증상이었던 이유). `.record-detail__grid[hidden]{display:none}` 추가로 해결. `records.html`의 `recordDetail`(`.panel`)은 `display`를 따로 선언 안 해서 이 버그의 영향을 안 받음(확인함).
      - **[추가 점검 2026-09-10] "더 버그 없나 확인해라" 지시로 전수 조사** — 모든 프론트 JS의 `.hidden =` 토글 대상(총 17곳)과 그 요소가 실제로 쓰는 CSS class/id를 하나씩 대조. `emptyState`/`medicalRecordEmpty`(`.empty-state`, 무클래스 `<p>`), TOTP 설정 화면 4곳(`#enrollSection`/`#secretBox`/`#enabledSection`은 CSS 규칙 자체가 없음, `#totpGroup`은 `.input-group`인데 `display` 미선언), 로그인 화면 `#totpGroup`은 전부 안전(해당 selector가 `display`를 선언 안 해서 버그 1·2와 같은 패턴이 아님). 대신 같은 패턴의 **버그 3**을 하나 더 발견:
        - **버그 3**: `admin.html`의 `#scanImagePreview`(스캔할 이미지 로컬 미리보기)가 `class="record-detail__image"`를 쓰면서 마크업상 `hidden`으로 시작하는데, `.record-detail__image { display:block }`도 조건 없이 선언돼 있어서 버그 1·2와 똑같은 이유로 파일을 고르기도 전에 빈 이미지 아이콘이 보일 뻔했음. `.record-detail__image[hidden]{display:none}` 추가로 해결.
        - **추가로 발견한 별개의 작은 버그(메모리 누수)**: `records.js`의 `loadDetail()`과 `admin.js`의 `loadDocuments()`가 새로 그릴 때마다 이전에 fetch해서 만든 `<img>`의 `URL.createObjectURL()` blob URL을 회수(`revokeObjectURL`)하지 않고 `innerHTML=''`로 그냥 버리고 있었음 — 문서를 여러 번 열어볼수록/저장을 반복할수록 브라우저 메모리에 계속 쌓이는 누수. 둘 다 직전에 만든 blob URL을 기억해뒀다가 다음 렌더링 시작 시 `revokeObjectURL`하도록 수정(`records.js`는 변수 하나, `admin.js`는 목록 전체가 갈아끼워지므로 배열에 모아뒀다가 일괄 해제).
        - `img.src = ''`로 닫는 코드(`image-zoom.js`의 close())도 점검 — 일부 브라우저에서 빈 문자열 src가 현재 문서 URL로 재요청되는 것으로 취급되는 알려진 함정이라 `removeAttribute('src')`로 변경.
        - **결론**: 이번에 새로 추가한 화면 요소들(`image-zoom-overlay`, `record-detail__grid`, `record-detail__image`) 3곳 모두에서 "class에 조건 없는 `display` 선언 + `hidden` 속성 토글" 조합이 반복돼서 생긴 같은 유형의 버그였음. 기존 코드(다른 팀원 코드 포함)에는 이 패턴이 없었고 전부 오늘 새로 만든 CSS에서만 발생 — 새 hidden-토글 요소를 추가할 때는 항상 `[hidden]{display:none}`을 같이 넣는 습관이 필요.
        - **커밋 대기**: 위 3개 CSS 버그 + blob URL 누수 수정 전부 사용자 지시로 아직 커밋/푸시 안 함 — 사용자가 직접 확인 후 지시할 때까지 대기.
- [ ] **프록시 뒤에서 rate limit이 우회될 위험 (2026-09-08)** — 챗봇 서비스가 `slowapi`로 rate limit을 거는데, 리버스 프록시(nginx 등) 뒤에 배포하면 클라이언트 IP 대신 프록시 서버 IP로 고정될 수 있음 — 그러면 로그인/OCR/챗봇 rate limit이 사실상 전원에게 공유되거나 무력화될 위험. `X-Forwarded-For` 신뢰 설정을 실제 배포 환경(프록시 유무)에 맞게 검토 필요.
  - **[재점검 2026-09-10] 챗봇 쪽은 프록시 유무와 무관하게 지금 이미 이 상태임** — 전체 프로젝트 점검(`BUG_REVIEW_2026-09-10.md`) 결과, `chatbot-service/app.py`의 `Limiter(key_func=get_remote_address)`는 이 서비스가 WAS를 거쳐서만 호출되는 구조라(브라우저가 직접 못 침) 애초에 모든 요청이 항상 같은 소스 IP(WAS)로 옴 — 리버스 프록시를 두기 전, 지금 로컬 개발 구조에서도 `20/분` 제한이 이미 개별 환자가 아니라 병원 전체 트래픽에 공용으로 걸리고 있다는 뜻. 프록시 문제와는 별개의, 더 근본적인 원인.
- [ ] **자연어 예약 파싱의 ReDoS 위험 (2026-09-08)** — `hospital_agent.py`의 `parse_datetime_kr()`이 정규식 여러 개(`ISO_DATETIME_PATTERN`, `MONTH_DAY_PATTERN`, `HOUR_MINUTE_PATTERN` 등)를 조합해서 판단하는데, 악의적으로 조작된 긴 입력 문자열을 넣었을 때 정규식 백트래킹으로 서버가 멈추는지 아직 검증 안 됨.
- [ ] **프롬프트 인젝션 방어가 소프트(LLM 지시문) 수준 (2026-09-08)** — `3-1-llm.py`의 `SYSTEM_INSTRUCTION`이 "이전 지시를 무시하라는 요청에 응하지 말라"고 안내하지만, 이건 LLM에게 부탁하는 것일 뿐 기술적으로 강제되는 방어가 아님 — LLM이 우회당하면 그대로 뚫림. 코드 레벨의 입력 필터링이나 출력 검증 같은 보강책이 필요한지 검토 필요.

### 🟢 사실관계 재확인 (이미 답이 있을 수도 있음)

- [x] **npm audit 취약점 5건 — 재검토 완료, 지금은 고칠 방법 없음 (확인함, 2026-09-08)** — `npm audit fix`와 `npm audit fix --force` 둘 다 실행해봤으나 **아무것도 바뀌지 않음**(`package.json`/`package-lock.json` 변경 없음 확인). 원인:
  - **갱신(2026-09-09 15시경)**: TOTP 기능(`6239e5c`) pull 후 `geoip-lite` 설치를 위해 `npm install` 재실행 → **5건(moderate 3, high 1, critical 1) → 7건(moderate 4, high 2, critical 1)로 증가.** `npm audit` 상세 확인 결과 `geoip-lite`가 원인이 아니라(감사 결과에 등장 안 함) 기존에 알려진 동일한 `qs`(→`body-parser`/`express`)·`tar`(→`@mapbox/node-pre-gyp`) 체인에 새 advisory가 더 추가된 것 — 근본 원인·조치 불가 상태는 아래 내용과 동일, 건수만 최신화.
  - `qs`: 설치된 6.15.3이 취약 범위(`2.2.5-6.15.3`)의 최상단. 패치판 `6.16.0`이 npm에 있지만 `body-parser`/`express`가 아직 그 버전을 요구하도록 안 올라옴 — npm이 부모 패키지의 선언된 범위를 벗어나는 버전은 자동으로 못 넣음.
  - `tar`(critical): 설치된 6.2.1은 메이저 6, 패치는 7.x 계열에만 있음. `bcrypt`가 쓰는 `@mapbox/node-pre-gyp`가 `tar ^6.x`만 허용해서 메이저를 뛰어넘는 업데이트는 `--force`로도 계산이 안 됨.
  - **결론**: 지금은 upstream(express/body-parser, 또는 @mapbox/node-pre-gyp)이 새 버전을 내야 해결 가능. `package.json`에 `overrides`로 강제 지정하는 방법도 있으나, 특히 `tar` 7.x가 `@mapbox/node-pre-gyp`와 실제 호환되는지 검증이 안 돼 있어 `bcrypt` 네이티브 설치 자체가 깨질 위험이 있음 — 권장하지 않음. 주기적으로 `npm audit` 재확인하며 upstream 패치를 기다리는 것을 권장.
- [ ] **운영 환경 인터넷 접근 여부** — `tesseract.js`가 첫 실행 시 언어 데이터를 인터넷에서 받는데, 병원 내부망처럼 폐쇄망이면 사전 배포 필요
- [x] **세션 쿠키 보안 설정 재확인** — 현재 `httpOnly: true`, `sameSite: strict`로 확인됨(과거 OCR.md 기록엔 `httpOnly: false`로 남아있던 부분이 이후 수정된 것으로 보임 — 문서 간 불일치이니 참고). 취약점 보완하는 과정에서 HTTPS로 배포되면 `secure: true`가 즉시 활성화되도록 수정하였음 — 로컬 개발(HTTP)에서는 `USE_HTTPS`를 설정하지 않으면 기존처럼 동작해 개발 편의성을 해치지 않으면서, 운영 배포 시 환경변수 하나로 전환 가능하도록 함. 실제 운영 반영 시에는 Nginx/Caddy 등 리버스 프록시로 TLS 종단을 구성하고 `USE_HTTPS=true`로 배포 예정.
- [ ] **로컬 개발 DB에만 반영된 상태** — `staff` 역할, 신규 테이블 3개, `board_posts` 컬럼 추가가 로컬 MySQL에만 적용됨. 스테이징/운영 DB가 별도로 있다면 그쪽 `db/init.sql` 재적용 필요 여부 확인
- [x] **`audit_decorator.py` — 해결됨 (2026-09-08)** — 누락됐던 `chatbot-service/audit-agent/` 패키지(`AuditEngine` 등 7개 파일)를 추가하고, `import_module("audit-agent")` 재시도 → 성공 확인. `hospital_agent.py`의 6개 도구 함수(`tool_list_documents`, `tool_rag`, `tool_direct_answer`, `tool_book_appointment`, `tool_check_appointments`, `tool_check_medical_records`)에 `@audit_log(...)` 데코레이터를 적용.
  - **검증 완료**: `python3 -m py_compile` 통과, `hospital_agent.run_agent()` 직접 호출 + FastAPI 챗봇 재시작 후 curl로 재검증 — 일반 인사·자연어 예약·휴진일 차단 전부 정상 응답, `audit-logs/audit_log.jsonl`에 마스킹→AES 암호화→해시체인 거친 로그가 실제로 기록되는 것 확인(`action` 필드에 `direct_answer`/`book_appointment` 등 정확히 남음).
- [x] **`.env`/`secret.key`가 git 히스토리에 커밋된 적 있는지 확인 (2026-09-08)** — `git log --all --full-history`로 전체 커밋을 뒤져봤으나 `.env`/`secret.key` 둘 다 한 번도 커밋된 적 없음. 오늘 여러 차례 지저분한 커밋 사고(프로젝트 전체 중복 커밋 등)가 있었던 걸 감안하면 다행 — `.gitignore` 규칙이 실제로 잘 지켜지고 있음을 확인.
