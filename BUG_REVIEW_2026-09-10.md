# 🐛 프로젝트 전체 버그 점검 (2026-09-10)

> "더 버그 없나 확인해라" → "프로젝트 전체적으로 검토" 지시에 따라, 프론트(`frontend/`)/`was/`(Node)/`chatbot-service/`(Python) 세 영역을 각각 별도 에이전트로 병렬 전수 검토했다(각 파일 직접 읽고 grep/교차대조, **코드 수정은 안 함 — 리뷰 전용**). 아래는 그 결과. **아직 아무것도 고치지 않았고, 이 문서 작성 시점까지 커밋된 코드 기준이다.**

---

## 🔴 High

- [x] **chatbot-service `/chat`에 서비스 간 인증이 없음 — 수정 완료(2026-09-10)** (`chatbot-service/app.py`) — WAS(Node)와 챗봇(Python) 사이에 공유 시크릿/API 키 검증이 전혀 없었음. `ChatRequest.patient_id`를 body 그대로 신뢰. CORS(`app.py:25-31`)는 브라우저 cross-origin만 막을 뿐 서버 간 직접 호출은 못 막아서, 8000번 포트가 외부에 노출되면 임의 `patient_id`로 다른 환자의 예약/진료기록 존재여부·스캔문서 개수 조회 가능(`tools_db.py:70-153`)했던 IDOR.
  - **수정**: `was`/`chatbot-service` 양쪽 `.env`에 같은 `CHATBOT_SERVICE_KEY` 추가(공유 비밀키). `was/routes/chat.js`가 챗봇 호출 시 `X-Internal-Auth` 헤더로 이 값을 실어 보내고, `chatbot-service`는 `/chat` 진입 시 `hmac.compare_digest`(상수 시간 비교, 타이밍 사이드채널 방지)로 검증 후 불일치하면 `401`. 키가 `.env`에 없으면 `AUDIT_ENCRYPTION_KEY`와 같은 fail-fast 패턴으로 서비스 시작 자체를 막음(설정을 깜빡한 채 무방비로 뜨는 상황 방지).
  - **범위 밖으로 남겨둔 것**: 배포 시 8000번 포트를 아예 외부에 안 열리게 하는 네트워크/방화벽 수준 조치는 코드 수정이 아니라 배포 설정 영역이라 이번엔 안 함 — 배포 시점에 별도로 챙길 항목.
  - **검증**: 헤더 없이 직접 `curl` 호출 → `401`, 틀린 키로 호출 → `401`, WAS 로그인 후 정상 채팅 요청(`POST /api/chat`) → WAS가 올바른 키를 실어 보내 `200` 정상 응답 확인.
- [x] **PII 마스킹 우회 — 점(`.`)으로 구분한 주민번호/전화번호 — 수정 완료(2026-09-10)** (`chatbot-service/pii_masking.py`) — RRN·전화번호 정규식의 구분자 문자 클래스가 `[\s\-\~_]*`라 `.`이 빠져있었음. 검증: `"900101.1234567"`, `"010.1234.5678"` 둘 다 마스킹 안 되고 그대로 통과되던 것 확인. 이 문자 클래스가 `build_spaced_regex`/전화번호 패턴 조립부에 총 6번 중복 하드코딩돼 있어서(마침표 누락 자체가 이 중복 때문으로 보임) `SEPARATOR = r'[\s\-\~_.]'` 상수로 통합, 6곳 전부 재사용하도록 리팩터링. 버그 케이스(점 구분) 마스킹 정상화 + 기존 하이픈 케이스 회귀 없음 확인, 기존 테스트 스위트(`audit-agent/test_masking_secrets.py`) 8개 전부 통과.
- [x] **동기 블로킹 호출이 `async def` 핸들러 안에 그대로 있음 — 수정 완료(2026-09-11, `feature/ocr`)** (`chatbot-service/app.py` `chat_endpoint`) — pymysql DB 쿼리(`tools_db.py`), Gemini 호출(`3-1-llm.py`), `sqlite3.connect`가 스레드풀 오프로드 없이 이벤트루프에서 그대로 실행됨. `async def`는 FastAPI가 자동으로 스레딩 안 해주므로, 느린 요청 하나가 동시 요청 전체를 막음(운영 규모 병목).
  - **수정**: 확인해보니 `chat_endpoint` 안에 `await`가 단 하나도 없었음("async인 척하는 sync 함수") — `async def` → `def`로 한 단어만 변경. FastAPI는 sync `def` 라우트를 자동으로 별도 스레드풀에서 돌려주므로, 내부 코드는 전혀 안 건드리고 이벤트 루프 블로킹만 해소됨.
  - **검증**: 기능 회귀 없음(정상 질문 응답, 인증 401, 주제 제한 전부 정상). 동시성 개선 실측: 순차 3회 28.8초(요청당 평균 ~9.6초) vs 동시 3회(병렬 전송) 10.8초 — 수정 전이었다면 이벤트 루프가 막혀 순차와 비슷한 시간이 나왔을 것, 실제로 세 요청이 병렬 처리됨을 확인.
- [ ] **`admin-totp-setup.js` TOTP 등록 시작 버튼에 CSRF 토큰 누락** (`frontend/js/admin-totp-setup.js` `startEnrollButton`, `POST /api/totp/setup`) — 같은 파일의 나머지 두 버튼(확인/해제)엔 `X-CSRF-Token`이 붙어있는데 이것만 빠짐. 프로젝트 전체에서 CSRF 토큰이 빠진 유일한 상태변경 POST/PATCH/DELETE 호출(다른 파일 전수 대조 확인).

## 🟡 Medium

- [ ] **예약 슬롯 정원 체크 경쟁 조건** (`was/routes/reservations.js:82-94`) — 같은 시간대 COUNT와 INSERT가 트랜잭션/락 없이 분리된 별개 쿼리라, 거의 동시에 두 요청이 오면 둘 다 `count < 2`를 통과해 정원(2명)을 넘겨 예약될 수 있음.
- [ ] **`board.js` RBAC 불일치로 staff가 문의 상세를 못 봄** (`was/routes/board.js:108`) — `GET /:patientId`가 `board:read`를 요구하는데, `db/init.sql`상 `board:read`는 patient/admin에게만 있고 staff는 `board:reply`만 있음. 코드 주석("staff도 답변하려면 상세를 봐야 함")과 실제 권한 매핑이 안 맞아서, staff가 이 라우트를 치면 미들웨어 단계에서 그냥 403 — 목록(`GET /`)에서는 보이니 데이터 유출은 아니고 기능 불일치.
- [ ] **비동기 라우트에서 DB 에러 시 요청이 응답 없이 멈춤** — Express 4는 async 핸들러의 reject를 에러 미들웨어로 자동 전달 안 함(`server.js`의 전역 `unhandledRejection` 로거는 응답을 안 보냄). try/catch 없는 라우트 다수: `records.js`(`POST /api/records`, `patient_id` 존재 검증도 없어서 FK 에러 나면 그대로 걸림), `reservations.js`(3개 라우트), `patients.js`, `accounts.js`(2개), `totp.js`(`/status`, `/verify-setup`, `DELETE /`), `chat.js`(`GET /history`, `POST /`) — DB 에러 시 타임아웃날 때까지 클라이언트가 그냥 멈춤.
- [ ] **TOTP 코드 재사용(리플레이) 방지 없음** (`was/totp-utils.js:66-73`) — 한 번 쓴 코드를 소모 처리 안 해서 유효 시간(±90초) 내 같은 코드로 재로그인 가능. 비교도 `===`(비상수시간)라 타이밍 사이드채널 여지도 소폭 있음.
- [ ] **PII 마스킹 우회 — 3자리 국번 구형 전화번호** (`chatbot-service/pii_masking.py:158-161`) — `phone_part2`가 4자리 고정이라 011/016/017/018/019의 3자리 국번 10자리 번호(예: `011-234-5678`)는 마스킹 정규식을 그냥 통과함(검증: 11자리 신형은 정상 마스킹, 10자리 구형은 원문 그대로 노출).
- [ ] **챗봇 레이트리밋이 사실상 병원 전체 공용** (`chatbot-service/app.py:19,80`) — `Limiter(key_func=get_remote_address)`인데 이 서비스는 WAS를 거쳐서만 호출되므로 모든 요청이 같은 소스 IP로 옴 — `20/분` 제한이 개별 환자가 아니라 전체 트래픽에 걸려서, 한 명이 몰아치면 다른 환자들 챗봇이 막힘.
- [x] **`secret.key`/`chatbot_logs.db` 파일 권한 미설정 — 수정 완료(2026-09-10)** (`chatbot-service/app.py:39-67`) — 원문(마스킹 전) 채팅이 담긴 SQLite DB와 그걸 여는 Fernet 키가 `chmod` 없이 기본 OS 권한(0644)으로 생성되고 있었음(실측 확인). 감사로그 쪽(`audit_decorator.py:36,64`)은 과거 사고 이후 이미 0700/0600으로 굳혀놨는데 이쪽엔 같은 조치가 빠져있었음. 두 파일 생성/오픈 직후 `os.chmod(경로, 0o600)` 추가, 기존 파일도 소급 적용. 재시작 후 챗봇 정상 응답·로그 정상 기록 확인. 상세는 `report_merge_final.md`의 "감사 로그 암호화 키 이원화 정리" 항목 참고.
- [x] **`records.js` 이미지 로딩 경쟁 조건 — 수정 완료(2026-09-10)** (`frontend/js/records.js` `loadDetail`) — `currentImageObjectUrl`이 호출 전체가 공유하는 변수 하나라, 문서를 빠르게 연속 클릭하면 나중에 도착하는 fetch가 이 변수를 덮어씀 — 화면엔 A 문서 이미지가 보이는데 내부적으로는 B의 blob URL을 "현재 것"으로 기억해서, 화면에 실제로 보이는 blob은 못 지우고(누수) 이미 안 보이는 blob만 지우는 상태가 됨. `currentDetailId`를 기록해두고 API 응답/이미지 fetch가 끝났을 때 여전히 그 문서를 보고 있는 게 맞는지 확인하는 가드 추가(`admin.js`에 새로 만든 문서 상세 패널에도 같은 가드를 처음부터 적용).

## 🟢 Low

- [ ] **로그아웃·TOTP setup 시작에 CSRF 토큰 검증 누락** (`was/routes/auth.js:281` `POST /api/logout`, `was/routes/totp.js:30` `POST /setup`) — "모든 상태변경 요청에 CSRF" 원칙과 불일치. 로그아웃은 타 사이트가 강제로 로그아웃시킬 수 있는 정도(피해 제한적), totp/setup은 아무것도 영구 저장 안 하는 단계라 더 경미.
- [ ] **로그인 실패 추적 Map들이 무한정 쌓임** (`was/routes/auth.js:53-56`) — `attemptsByIp`/`failuresByUsername`/`knownIpsByAdminUsername`/`knownRegionsByAdminUsername`가 IP·계정명을 키로 하는데 바깥쪽 키 자체는 안 지워짐 — IP/계정명을 계속 바꿔가며 로그인 시도하면 메모리가 계속 늘어나는 완만한 DoS 벡터. (재시작 시 초기화되는 기존 한계와는 별개의 문제.)
- [ ] **DB 접속정보 하드코딩 fallback** (`chatbot-service/tools_db.py:14-16`, `log_audit_tool.py:49-53`, `log_retention_tool.py:35-39`) — env 변수 없으면 조용히 `vulnuser`/`vulnpass`로 폴백. 실패를 크게 내는 대신 짐작 가능한 자격증명으로 조용히 넘어감.
- [ ] **`log_retention_tool.py` 시간대 불일치** (`chatbot-service/log_retention_tool.py:115`) — cutoff는 `datetime.now(timezone.utc)` 기준인데 MySQL `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` 컬럼들은 서버 세션 시간대(보통 KST) 기준이라 약 9시간 오차 — 2년(730일) 보존 기준에선 반올림 오차 수준이라 실질 영향은 작음.
- [ ] **예약 진료과 문자열 검증 없음** (`chatbot-service/hospital_agent.py:55,62-63`) — `DEPARTMENT_PATTERN`이 `[가-힣]{2,6}과` 형태면 다 받아서 `reservations.department`(단순 VARCHAR, ENUM/FK 없음)에 그대로 저장 — 인젝션은 아니고(쿼리 파라미터화됨) 존재하지 않는 진료과명으로도 예약이 생길 수 있는 데이터 품질 문제. `report_merge_final.md`의 "진료과 자유 입력 여부" 결정 대기 항목과 같은 맥락.

## 점검 안 한 범위

`db/` 스키마 자체의 설계 재검토, `frontend`/`was`/`chatbot-service` 외 최상위 스크립트(`start.sh`/`stop.sh` 등), 배포/인프라 설정. 세 에이전트 모두 코드 수정은 하지 않았고 리뷰만 함 — 위 항목은 전부 아직 미해결 상태로 남아있다.
