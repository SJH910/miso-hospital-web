# 로그 데이터 파싱·전처리 + PII/민감정보 탐지 계획

이 문서는 "로그 데이터 파싱 및 전처리, PII·민감정보 탐지 로직"을 어떻게 시작할지 정리한 초안이다. RBAC-Plan.md와 마찬가지로 설계 배경과 결정 필요 사항을 같이 남긴다.

## 0. 지금 뭐부터 시작할지 (우선순위)

받은 피드백 6개(로그 저장 구조 파악/테이블-로그 매핑/DB 정리 문서/팀 공유/위험도 분류/블랙리스트 검토)를 순서대로 하면 이렇게 된다 — **뒤 단계가 앞 단계 결과물 위에서 결정되는 구조**라 순서를 건너뛰면 다시 돌아와야 한다.

1. **전체 DB 구조 정리 (3번 섹션)** — 이미 실제 스키마·데이터로 채워서 이번에 완성함. 다음 단계들이 전부 이 위에서 진행됨.
2. **팀 리뷰 (3-5)** — 3번 섹션 내용이 맞는지, 특히 "의료 정보 5개 컬럼이 암호화 안 되어 있다"는 발견을 팀이 인지하고 있는지 공유·확인. **여기가 사실상 첫 실행 항목** — 문서는 다 됐으니 이제 사람에게 보여주는 일만 남음.
3. **로그 위험도 분류 체계 확정 (4번 섹션)** — 초안은 만들어뒀으니, 팀 리뷰 때 같이 확정 짓는 게 효율적(2번과 묶어서 진행 권장).
4. **파서/탐지 로직 착수 (6번 섹션)** — ③④⑥ 결정 후 시작. 위험도 분류가 있어야 "Critical 등급부터 먼저 스캔한다"는 식으로 우선순위를 매길 수 있어서, 3번 다음이 자연스러움. **(2026-09-10 갱신: 1·2·3단계 전부 완료.** 1단계 파서 4개 구현·검증, 2단계 탐지 로직(팀원이 B로 통합), 3단계 리포트(`scan_for_pii`/`write_report`)까지 연결돼서 실제로 186건 스캔·2건 발견(단, PII 유출이 아니라 마스킹 오탐으로 판명 — 6번 섹션 3단계 참고)까지 실행해봄. 4단계(재발 방지)만 선택 사항으로 남음.)**
5. **접근 블랙리스트 설계 (5번 섹션)** — 질문 목록만 잡아둔 단계라 가장 나중. `MALICIOUS_INTENT_DETECTED` 탐지 신호를 실제 차단으로 연결하려면 먼저 그 신호가 로그에 얼마나 쌓이는지(1~4단계 결과)부터 봐야 판단 근거가 생김.

**요약하면: 지금 당장 할 일은 "2번 — 이 문서(3번 섹션)를 팀과 리뷰하는 것"이다.** 코드를 짜는 건 그다음이다.

---

## 1. 현재 상태 — 이미 존재하는 것부터 파악

작업을 시작하기 전에, 지금 이 프로젝트에 **PII 마스킹/탐지 로직이 이미 3군데 따로 존재**한다는 걸 먼저 짚어야 한다. 새로 만들기 전에 이걸 어떻게 할지부터 정해야 중복 작업을 피할 수 있다.

### 1-1. `chatbot-service/pii_masking.py` — 실시간 입력 마스킹 (가장 정교함)

- **용도**: 챗봇이 질문을 LLM에 보내기 전에 실시간으로 호출(`app.py`의 `/chat` 핸들러 첫 단계).
- **탐지 대상**: 주민등록번호, 전화번호, 이름(문맥 기반 정규식 + 선택적 spaCy NER), 이메일, 8자리 차트번호.
- **강점**: 주민번호/전화번호 정규식이 공백·하이픈·물결(`~`) 등 구분자 변형까지 허용(`build_spaced_regex`). 이름 마스킹은 "저는 OO입니다" 같은 문맥 패턴 + spaCy `PERSON` 엔티티 이중 탐지.
- **약점**: `spacy`+한국어 모델(`ko_core_news_sm`)이 설치 안 되어 있으면 문맥 없는 이름(예: "김구 취소해줘")은 못 잡음 — 정규식만으로는 문맥 단서가 있는 이름만 탐지 가능. 현재 로컬 환경에 spaCy 모델이 설치돼 있는지부터 확인 필요.
- **확장됨(2026-09-09, 팀원 커밋 `aa30908`)**: `mask_secrets()` 신규 추가 — 내부 URL/사설 IP(RFC1918 대역+localhost+`.internal`/`.corp`/`.local`/`.intranet` 도메인), 알려진 서비스 API 키 시그니처(AWS/GitHub/Slack/Google/Anthropic/OpenAI/JWT), 키워드 문맥 기반 시크릿("api_key=", "secret:" 등), 섀넌 엔트로피 기반 폴백 탐지(위 셋에 안 걸린 고엔트로피 토큰)까지 탐지. `mask_pii()`가 다른 패턴보다 먼저 이 함수를 호출하도록 연결됨. 실제 실행해서 확인함(`python3 chatbot-service/test_shared_vectors.py` 통과).
  - **팀원 작업 보고서(Notion, "내부 URL·API Key 노출 탐지 기능 추가")로 확인**: TDD(Red-Green-Refactor)로 진행됨(16개 테스트 작성 → 전부 통과 확인 후 리팩토링). **엔트로피 임계값(3.5 bits/char)은 여전히 잠정치**라고 보고서에 명시돼 있음 — 실사용 데이터로 오탐/미탐을 관찰하며 조정 필요, 지금 값은 "일단 기본값으로 진행 후 조정" 단계.

### 1-2. `chatbot-service/audit-agent/masking.py` — 감사 로그용 마스킹

- **용도**: `audit_decorator.py`가 도구 호출 결과를 `audit-logs/audit_log.jsonl`에 암호화해서 남기기 전에, payload(dict)를 재귀적으로 순회하며 마스킹.
- **[x] 해결됨(2026-09-09, `aa30908`) — 더 이상 "더 약한 독자 구현"이 아님**: 자체 정규식(주민번호/전화번호/이메일, 구분자 변형 미지원)을 전부 걷어내고, `sys.path`로 `chatbot-service/`를 잡아 **`pii_masking.mask_pii()`를 그대로 import해서 사용**하도록 재작성됨 — 결정 필요 ④가 **B(공용 모듈로 통합)로 확정·구현 완료**된 것. 이제 1-1의 모든 탐지 능력(구분자 변형 허용, 이름, 차트번호, 그리고 위에서 추가된 `mask_secrets()`)을 감사 로그도 동일하게 적용받음.
  - **이전에 2번 섹션에서 지적했던 문제(`tool_check_medical_records` 등 세 경로가 가장 약한 마스킹만 거침)가 이걸로 해소됨** — 이제 그 경로들도 `pii_masking.py`의 전체 탐지 능력을 그대로 받음.
- **덤으로 하는 일**: 프롬프트 인젝션 의심 키워드("지시사항 무시" 등) 탐지해서 `MALICIOUS_INTENT_DETECTED` 플래그 남김. 이건 PII 탐지와는 다른 기능이라 분리해서 생각해야 함(그대로 유지됨).

### 1-3. `was/crypto-utils.js` — 채팅 이력 표시용 마스킹 (2026-09-09 확인, 문서에 누락돼 있었음)

- **용도**: WAS(Node) 쪽. 환자가 본인 채팅 이력을 다시 조회할 때(`GET /api/chat/history`)와 챗봇 응답을 프론트로 돌려줄 때(`chat.js`) 호출. 코드 내 주석("챗봇 Python 쪽 `pii_masking.py`는 LLM 전송용, 이 함수는 조회 화면 표시용이라 역할이 다르다")에 **의도된 목적 차이가 명시**돼 있음 — 이건 실제로 타당한 구분(외부 API로 나가는 것 vs 본인에게 다시 보여주는 것).
- **탐지 대상**: 주민등록번호(`\d{6}-\d{7}` 고정 형식만), 전화번호(`010-\d{4}-\d{4}` 고정 형식만), 이메일.
- **약점**: 구분자 변형(공백/물결 등) 처리 안 됨, 이름·차트번호 탐지 없음. (JS는 Python `pii_masking.py`를 import할 수 없어서 1-2처럼 "그냥 갖다 쓰기"가 불가능 — 구조적 한계, 아래 참고.)
- **확장됨(2026-09-09, `aa30908`)**: 1-1과 같은 `mask_secrets` 규칙(내부 URL/사설 IP, API 키 시그니처, 키워드 문맥, 엔트로피 폴백)이 **Python과 별개로 JS에 그대로 재구현**됨. 코드 주석에 "언어가 달라 import는 못 해도 규칙 자체는 반드시 같이 업데이트할 것"이라고 명시 — 유지보수 부담(양쪽에 따로 반영해야 함)은 여전히 인지하고 있는 상태.
- **크로스 검증 테스트 신설**: `shared_test_vectors.json`(테스트 케이스 12개, 내부 URL/API 키 판정 기대값 포함) + `chatbot-service/test_shared_vectors.py` + `was/test-shared-vectors.js` — 같은 입력을 Python·JS 양쪽에 돌려서 판정이 일치하는지 확인하는 구조. **직접 실행해서 확인함**: 둘 다 12/12 통과, "모두 통과 (Python과 판정 일치)". 이전에 "B로 합치면 JS는 언어가 달라 이식 불가피, 대신 교차검증 테스트를 만들자"고 제안했던 방향이 실제로 구현됨.
- 이전 버전 문서는 "PII 마스킹/탐지 로직이 3군데 존재"라고 써놓고 실제로는 이 파일을 안 넣고 대신 1-4(현재 `app.py`, 마스킹이 아니라 암호화+보관 담당)를 넣어서 숫자만 맞고 실체가 틀려있었음 — 이번에 바로잡음.

### 1-4. `chatbot-service/app.py` — 마스킹은 안 하고 "암호화 + 원문 별도 보관"만

- `chat_messages`/`chatbot_logs.db`에는 **원문(`original_encrypted`)과 마스킹된 텍스트(`masked_text`)를 둘 다 저장**한다(암호화 대상은 원문). 마스킹 자체는 1-1의 `pii_masking.py`를 그대로 갖다 쓴 것.
- 즉 "로그에 원문이 안전하게 보관되고 있는가"와 "마스킹이 잘 됐는가"는 별개 문제 — 원문은 암호화돼서 안전하지만, **애초에 마스킹이 부실하면 LLM한테는 원문이 그대로 새나간 뒤였다는 뜻**이라 사후에 로그를 봐도 소용없음. 이 부분이 이번 작업의 핵심 동기가 될 수 있음(아래 2번 참고).

### 1-5. 로그 저장소 목록

**주의**: 아래 "가"(전체 저장소)와 "나"(PII 탐지 목적 저장소)는 범위가 다르다. "나"는 지난 세션에 스캔 대상으로 추린 4개뿐이라, 이것만 보고 "저장소가 4개가 전부"라고 오해하면 안 됨 — 실제로 존재하는 로그 저장소는 아래 "가" 기준 총 7개(파일 단위로 셀 경우)다. 착오 발견 경위는 3-3의 "새로 발견한 저장소 — `.run/chatbot.log`" 항목 참고.

#### 가. 전체 로그 저장소 (실제 시스템에 존재하는 것 전부, 2026-09-09 재조사)

| 저장소 | 형식 | 원문 보관 여부 | 비고 |
|---|---|---|---|
| `audit-logs/audit_log.jsonl` | JSONL, Fernet 암호화(`AUDIT_ENCRYPTION_KEY`) | O(payload 안에 마스킹 시도된 값) | `audit-agent`가 관리, 도구 호출 단위 |
| `chatbot_logs.db` (SQLite) | 암호화 컬럼 1개 + 평문 컬럼 2개 | O(`original_encrypted`, `secret.key`) | `app.py`가 관리, 질문 단위 |
| MySQL `chat_messages` | AES-256-GCM 암호화 | O | WAS(`chat.js`)가 관리, 환자가 재조회하는 용도 |
| MySQL `audit_log` | `detail` JSON 컬럼, 평문 | 로그인/역할변경 등 메타데이터 위주라 원문 텍스트는 없음 | `was/audit.js`가 관리 |
| `.run/was.log` | 텍스트, 평문 | 사실상 없음 | `node was/server.js` stdout/stderr. 실제 내용은 시작 메시지 한 줄뿐 |
| `.run/frontend.log` | 텍스트, 평문 | 없음(경로만) | `serve.py` 접근 로그 — 정적 파일 GET 요청 경로만 찍힘(요청 바디 없음) |
| `.run/chatbot.log` | 텍스트, 평문 | **O — 마스킹 전 원문 그대로** | uvicorn(챗봇) stdout/stderr. **문제**: `audit-agent/engine.py:17-18`의 디버그 `print(f"원본 페이로드: {payload}")`가 마스킹·암호화되기 전 원본을 그대로 출력해서, 결국 이 파일에 평문으로 누적됨 — 상세는 3-3 참고 |

전부 `nohup ... > .run/*.log`(start.sh)로 생기며, `*.log`는 `.gitignore`에 포함되어 git에는 안 올라감. 로테이션/삭제 로직 없이 서버가 켜져있는 동안 계속 누적됨.

#### 나. PII 탐지 목적 저장소 (스캔 대상으로 선정한 것)

| 저장소 | 형식 | 원문 보관 여부 | 비고 |
|---|---|---|---|
| `audit-logs/audit_log.jsonl` | JSONL, Fernet 암호화(`AUDIT_ENCRYPTION_KEY`) | O(payload 안에 마스킹 시도된 값) | `audit-agent`가 관리, 도구 호출 단위 |
| `chatbot_logs.db` (SQLite) | 암호화 컬럼 1개 + 평문 컬럼 2개 | O(`original_encrypted`, `secret.key`) | `app.py`가 관리, 질문 단위 |
| MySQL `chat_messages` | AES-256-GCM 암호화 | O | WAS(`chat.js`)가 관리, 환자가 재조회하는 용도 |
| MySQL `audit_log` | `detail` JSON 컬럼, 평문 | 로그인/역할변경 등 메타데이터 위주라 원문 텍스트는 없음 | `was/audit.js`가 관리 |

**결정됨 ① (2026-09-09)**: 4개 저장소(`audit-logs/audit_log.jsonl`, `chatbot_logs.db`, MySQL `chat_messages`, MySQL `audit_log`) 전부 포함. 이 4개는 "구조화된 감사·대화 로그"라는 기준으로 추린 것이었고, `.run/*.log`(프로세스 표준출력)는 "메타데이터 위주"라고 보고 애초에 스캔 대상에서 제외했었음.

**재검토 필요(2026-09-09) — 결정 ①은 재논의 대상**: `.run/chatbot.log`가 실제로는 마스킹 전 원문을 그대로 담고 있는 게 확인돼서, 이 파일을 "제외"로 둔 근거(메타데이터 위주)가 깨졌음. 다만 이건 "파서로 스캔해서 찾아낼" 문제가 아니라 **애초에 그렇게 안 찍히도록 소스(`engine.py`의 디버그 print)를 고쳐야 하는 문제**라, 4번째 저장소들과 같은 방식(파서+탐지)으로 다룰지, 아니면 원천 차단(코드 수정)으로 끝낼지 판단 필요 — 아래 결정 필요 ⑩ 참고.

---

## 2. 이 작업이 필요한 이유 (확인됨)

1. **[x] 해결됨(2026-09-09, `aa30908`) — `audit-agent/masking.py`가 일부 경로에서 유일한 방어선인데, 셋 중 가장 약한 마스킹 구현이었다** — `hospital_agent.py`의 `tool_check_medical_records(patient_id)`/`tool_check_appointments(patient_id)`/`tool_check_scanned_documents(patient_id)`는 인자로 `patient_id`만 받고, **리턴값(진료기록·예약·문서 내용)은 DB에서 직접 읽어온 텍스트**를 그대로 돌려준다. 이 텍스트는 `pii_masking.py`(사용자가 입력한 질문에만 적용됨)를 **거치지 않고** `@audit_log(...)` 데코레이터를 통해 곧바로 `audit-agent/masking.py`로 들어간다. ~~그런데 `audit-agent/masking.py`는 주민번호·전화번호가 고정 포맷일 때만 잡고(공백·물결 등 구분자 변형 처리 안 됨), 이름·차트번호는 아예 탐지하지 않는다~~ — **팀원이 `audit-agent/masking.py`를 `pii_masking.mask_pii()`에 위임하도록 재작성해서(1-2 참고) 이 경로들도 이제 전체 탐지 능력을 그대로 받음.** 발견 당시엔 실제 위험이었으나 현재는 해소됨.
2. **[△ 절반 해결됨, 2026-09-10] 이미 쌓인 로그를 복호화해서 볼 수단이 없었다** — `chatbot-service/log_audit_tool.py`(6번 섹션 1단계)로 4개 저장소를 복호화해서 공통 스키마로 뽑아내는 것까지는 완료. 다만 "PII가 실제로 남아있는지 자동으로 판별·리포트"하는 부분(2·3단계)은 아직 이 도구에 연결 안 됨 — 지금은 사람이 `text_fields`를 눈으로 훑어봐야 함. 지금까지 쌓인 로그(2026-09-10 기준 MySQL `chat_messages` 52건·`audit-logs/audit_log.jsonl` 오늘자+로테이션 백업 2개 합산 20건·SQLite `chatbot_logs.db` 46건·MySQL `audit_log` 63건)를 이 도구로 전부 복호화할 수 있는 상태.

**결정됨 ② (2026-09-09)**: 둘 다 — (a) 이미 쌓인 로그에 PII가 새고 있었는지 사후 감사 + (b) 탐지 로직 자체의 성능/정확도 개선을 함께 진행. 순서상 (a) 사후 감사를 먼저 돌려서 실제로 얼마나 문제가 있는지 파악한 뒤, 그 결과를 근거로 (b) 어느 부분을 얼마나 개선할지 우선순위를 정하는 흐름이 자연스러움.

---

## 3. 0단계 — 로그/DB 인벤토리 (파싱 전에 먼저 할 것)

> 피드백: "로그 어떻게 저장되는지?", "어떤 테이블이 어떤 로그 수집하는지", "DB에 대한 정리 필요". 파서(4단계) 설계는 이 인벤토리가 끝나야 정확해지므로, 실제 스키마와 실제 쌓인 데이터를 기준으로 먼저 정리한다.

### 3-1. 저장소별 정확한 스키마 (코드가 아니라 실제 DB에서 직접 확인함, 2026-09-09)

| 저장소 | 스키마 | 암호화 | 비고 |
|---|---|---|---|
| MySQL `audit_log` | `id, actor_id→patients.id, action, target_type, target_id, detail(JSON), created_at` | **평문** (detail 포함) | `was/audit.js`의 `logAudit()`이 씀. 로그인/역할변경처럼 "메타데이터성" 이벤트 위주라 원문 텍스트는 안 들어감 |
| MySQL `chat_messages` | `id, patient_id→patients.id, sender ENUM(patient,bot), content TEXT, created_at` | **AES-256-GCM** (`content`) | `was/routes/chat.js`가 씀. 환자가 본인 대화 이력을 다시 볼 때 씀(`GET /api/chat/history`) |
| SQLite `chatbot_logs.db`(루트) | `id, timestamp, patient_id, original_encrypted BLOB, masked_text TEXT, response TEXT` | **Fernet**(`secret.key`, `original_encrypted`만) | `chatbot-service/app.py`가 씀. "마스킹이 실제로 적용됐는지" 사후 확인 목적 — `masked_text`는 평문으로 같이 저장됨 |
| `audit-logs/audit_log.jsonl` | 한 줄당 JSON: `event_id, timestamp, action, payload_encrypted, expiry_date, previous_hash, hash` | **Fernet**(`AUDIT_ENCRYPTION_KEY`, `payload_encrypted`만) | `audit-agent/engine.py`(`AuditEngine.process_event`)가 씀. `hospital_agent.py`의 `@audit_log(...)` 데코레이터가 도구 호출마다 트리거 |

### 3-2. "어떤 로그가 실제로 수집되고 있는지" — 실제 값 기준 확인

코드가 "이걸 기록하기로 되어 있다"와 실제로 기록된 값은 다를 수 있어서, 직접 조회해서 확인함:

**확인 방법** (개발자가 직접 재현하려면):
- MySQL `audit_log`: `mysql -h localhost -P 3306 -u vulnuser -p vulnapp` 접속(비밀번호는 `was/config.js`의 `dbPassword` 기본값 참고) 후 `SELECT id, actor_id, action, target_type, target_id, detail, created_at FROM audit_log ORDER BY created_at DESC;` (특정 action만 보려면 `WHERE action='...'` 추가)
- SQLite `chatbot_logs.db`: 프로젝트 루트에서 `sqlite3 chatbot_logs.db "SELECT id, timestamp, patient_id, masked_text, response FROM logs ORDER BY timestamp DESC;"` (테이블명은 `logs`, `original_encrypted`는 Fernet 암호화라 그대로는 못 읽음)
- `audit-logs/audit_log.jsonl`: 파일 자체는 한 줄당 JSON이라 `cat`/`tail -f`로 라인 수·타임스탬프는 바로 보이지만, `payload_encrypted` 필드는 Fernet 암호화돼 있어 원문은 못 봄. 실제 payload를 보려면 `chatbot-service/.env`의 `AUDIT_ENCRYPTION_KEY`로 `audit-agent/crypto.py`의 `AuditCrypto.decrypt_payload()`를 호출해 복호화해야 함.

- MySQL `audit_log`의 `account_role_change` 기록 여부 — 확인 시점별 정리:
  - 2026-09-09 오전(총 47건 시점): `login_success` 44건, `login_fail` 2건, `patient_register` 1건, `account_role_change` 0건.
  - 2026-09-09 계정 관리 프론트(`admin-accounts.html`) 구현 후(총 60건 시점): `login_success` 53건, `login_fail` 3건, `patient_register` 3건, `account_role_change` 1건 — 정상 기록 확인.
  - 2026-09-09 13:18(총 62건 시점): `account_role_change` 2건 — 재실행 후에도 정상 기록됨(`id=62`, `actor_id=5`, `target_id=8`, `detail={"from":"patient","to":"staff"}`, `created_at=2026-09-09 13:18:19`).
  - **2026-09-09 15시경(pull 후) — `action` 종류 자체가 늘어남**: 팀원 커밋(`6239e5c`)으로 `was/routes/auth.js`에 신규 `action` 7종이 추가됨 — `login_anomaly_long_input`(비정상적으로 긴 입력값), `login_anomaly_high_frequency`(짧은 시간 반복 시도), `login_anomaly_repeated_failure`/`login_anomaly_admin_repeated_failure`(반복 로그인 실패), `login_anomaly_admin_new_ip`/`login_anomaly_admin_new_location`(관리자 신규 IP·지역 로그인), `totp_verify_success`/`totp_verify_fail`(TOTP 2차 인증 검증). 재확인 시점(총 62건, `login_success` 54·`login_fail` 3·`patient_register` 3·`account_role_change` 2) 기준 **위 7종은 아직 0건** — 신규 코드라 아직 트리거된 이력 없음. 4번 섹션 위험도표의 🔴 Critical(로그인 반복 실패 등)과 직접 연결되는 항목들이라, 실제로 쌓이기 시작하면 위험도 분류 적용 대상에 포함해야 함.
- SQLite `chatbot_logs.db`: 45건(최신 재확인, 2026-09-09 13시경) — `patient_id=1` 36건, `patient_id=2` 2건, `patient_id=3` 1건, `patient_id` 비어있음(NULL) 6건. **더 이상 "전부 patient_id=1"이 아님** — 여러 테스트 계정으로 시험하면서 분산됨. `patient_id`가 비어있는 6건은 세션에 로그인 정보가 없는 상태로 챗봇을 호출한 케이스로 추정되며, 원인 확인은 별도 필요.
- `audit-logs/audit_log.jsonl`: 처음 확인 시점(9건)엔 `direct_answer`/`book_appointment` 두 종류만 관찰됐었음. **재확인(2026-09-09) 결과, 이유가 두 가지로 나뉜다는 걸 발견**:
  - `rag`/`check_appointments`/`check_medical_records`는 실제로 도달 가능한 정상 경로였고, 그날 테스트한 문장("안녕하세요", 예약 문구)이 그 키워드("내 예약", "진료기록", "위치" 등)에 우연히 하나도 안 걸렸을 뿐 — 지금 각각 트리거해서 3개 다 정상 동작 및 감사 로그 기록까지 확인함.
  - `list_documents`는 사정이 다르다. `hospital_agent.py`의 `choose_action()`을 전체 검토한 결과, 반환 가능한 `action_key`는 `check_appointments`/`check_medical_records`/`book_appointment`/`rag`/`direct` 5개뿐이고 **`list_documents`로 가는 분기 자체가 없었다.** 원인은 이름과 구현이 안 맞았던 것 — 함수 이름은 "문서 목록"인데 실제로는 RAG 데모용 FAQ 문서(`hospital_docs.json`)를 통째로 나열하는 코드였다.
  - **최신화(2026-09-09 11:43 기준) — 원인 확인함**: `audit-logs/audit_log.jsonl`가 현재 파일 하나만 봐서는 "9건, direct_answer/book_appointment"와 안 맞아 보이는데, 원인은 `audit_decorator.py`의 `TimedRotatingFileHandler(when="midnight", ...)` 로테이션이었다 — 자정 지난 뒤 첫 로그 기록 시점에 이전 파일을 `audit_log.jsonl.YYYY-MM-DD`로 백업하고 새 파일을 시작하는 정상 동작. 실제로 `audit-logs/audit_log.jsonl.2026-09-08`(어제 백업, 9건)을 열어보면 `direct_answer` 5건 + `book_appointment` 4건으로 위에서 설명한 "처음 확인 시점(9건)" 내용과 정확히 일치함. 오늘(9/9) 새로 시작된 `audit_log.jsonl`에는 그 이후 진행한 재확인·재구현 검증 로그만 쌓여 총 10건(`check_scanned_documents` 4, `rag` 3, `check_medical_records` 2, `check_appointments` 1) — 파일이 유실된 게 아니라 날짜별로 정상 로테이션된 것이었음.

**정정(2026-09-09) — 죽은 코드가 아니라 미구현 기능이었음**: 원래 의도를 확인한 결과, "본인(다른 환자 열람 불가)의 스캔 문서(OCR로 admin이 등록한 처방전/진단서/영수증) 조회"가 목적이었다. `check_medical_records`(같은 파일에 이미 있던 함수)와 동일한 보안 원칙 — **원문은 챗봇 응답에 직접 노출하지 않고 존재 여부/건수만 안내 + `/records.html`로 유도, `patient_id`는 세션값만 사용(IDOR 방지)** — 을 그대로 따라서 재구현함:
  - `tools_db.py`에 `check_scanned_documents(patient_id)` 신규 — `scanned_documents` 테이블을 `patient_id`로 필터링, 문서종류별 건수만 반환
  - `hospital_agent.py`: `tool_list_documents()` → `tool_check_scanned_documents(patient_id)`로 교체, `@audit_log("check_scanned_documents")`로 액션명도 갱신. 더 이상 안 쓰는 `DOCUMENTS = load_module(...)` 로딩 줄도 같이 제거(RAG는 `3-2-Rag.py` 자체 fallback으로 문서를 로드해서 영향 없음 — 제거 후 RAG 정상 동작 재확인함)
  - `choose_action()`에 라우팅 추가: "영수증"/"처방전"/"진단서"/"스캔 문서"/"내역서" 키워드
  - **검증 완료**: patient_id=1(영수증 보유)·3(진단서 보유)·2(문서 없음) 세 계정으로 각각 실제 챗봇 API 호출 → 본인 문서 종류·건수만 정확히 응답, 다른 환자 문서 유출 없음 확인. `records.html`이 이미 `scanned_documents`를 표시하고 있어서(OCR.md 참고) 링크 안내도 실제로 유효함.

### 3-3. DB 정리가 필요한 부분 (실제로 찾아낸 것)

**담당 구분(2026-09-09 정리)**: 아래 "가"(저장소 구조)·"나"(무결성·보존)는 마스킹 로직과 무관 — 저장 위치·보관기간·변조검증의 문제라 마스킹 3원화(팀원 담당) 작업과 별개로 진행 가능. "다"(`.run/chatbot.log` 유출)는 마스킹 파이프라인 코드(`audit-agent/engine.py`) 자체의 문제라 3원화 작업과 **겹칠 수 있음** — 진행 전 담당자와 확인 필요.

#### 가. 저장소 구조

- [x] **`chatbot-service/chatbot_logs.db`는 테이블도 없는 빈 스테일 파일 — 삭제함(2026-09-09)**. 진짜로 쓰이는 건 프로젝트 루트의 `chatbot_logs.db`. 근본 원인이었던 `app.py`의 `DB_FILE`(상대경로)도 절대경로로 고쳐서 재발 방지까지 완료함(7번 섹션 ⑨ 참고).
- [ ] **로그/감사 시스템이 사실상 4개로 파편화** — 위 표의 4개 저장소가 서로 겹치는 목적(챗봇 대화 원문 보관: `chat_messages`와 `chatbot_logs.db` 둘 다 / 도구 호출 감사: `audit_log.jsonl`)을 각자 다른 방식으로 하고 있음. 다만 실제로 확인해보니 "그냥 두면 시스템이 고장 나는" 문제는 아니고, 서비스 경계(Python 챗봇 / Node WAS)에 따른 구조적 분리에 가까움 — 대신 **나**(무결성·보존)에 적은 두 항목이 이 파편화 때문에 저장소마다 일관성 없이 적용되고 있다는 게 실질적 리스크. (참고: 이 항목은 마스킹 로직 통합인 결정 필요 ④와는 별개 — 저장소 자체를 통합하자는 결정은 따로 없음, 3-5 팀 리뷰 때 확인 필요 정도로 남겨둠)

#### 나. 무결성·보존 (파편화로 인해 저장소마다 다르게/누락되어 적용됨)

- [x] **`audit-agent`의 해시 체인이 서버 재시작마다 끊기던 문제 — 수정함(2026-09-09)**

  **해시 체인이 왜 있는지**: `audit-agent/hash_chain.py`의 `HashChain`은 각 레코드가 "바로 이전 레코드의 hash"를 자기 안에 포함하게 만든다(블록체인과 동일한 원리). 이렇게 하면 파일 전체를 순회하며 hash가 처음부터 끝까지 끊김없이 이어지는지 재계산해서, **누군가 중간 레코드를 지우거나 값을 바꿨는지(위변조 여부)를 사후에 검증**할 수 있다 — 클래스 docstring에도 "위변조를 방지합니다"라고 목적이 명시돼 있음.

  **정확히 어떤 위험이 생겼는지**: `HashChain.previous_hash`가 파이썬 인스턴스 변수라, 서버가 재시작될 때마다(또는 자정에 로그 파일이 로테이션될 때마다) `None`으로 초기화되며 새 체인이 시작됐다. 문제는 **"재시작 때문에 자연스럽게 끊긴 지점"과 "누군가 레코드를 통째로 삭제해서 끊긴 지점"이 겉보기에 구분이 안 된다**는 것 — 공격자가 로그 구간을 지우고 싶다면 "재시작 지점처럼 보이게" 만들기만 하면 되고, 검증하는 사람은 그게 정상 재시작인지 실제 삭제인지 알 방법이 없었다. 해시 체인이 막으려던 바로 그 시나리오(몰래 삭제)가 발각되지 않고 넘어갈 수 있는 구조였음.

  **어떻게 수정했는지**: 재시작·자정 로테이션 두 경우 모두 기존 로그의 마지막 hash를 이어받도록 고침.
  - `hash_chain.py`: `HashChain(log_file_path)`로 파일 경로를 받아, 그 파일의 마지막 줄에서 `hash`를 읽어 `previous_hash`로 복원(`_read_last_hash`). 오늘 파일이 비어있거나 없으면(자정 로테이션 직후 등) 같은 디렉토리의 가장 최근 로테이션 백업(`audit_log.jsonl.YYYY-MM-DD`)에서 마저 이어받음(`_read_last_hash_from_latest_backup`) — 날짜 경계에서도 체인이 끊기지 않게 확장.
  - `engine.py`: `AuditEngine.__init__`에 `log_file_path` 파라미터 추가, `HashChain`에 그대로 전달(기본값 `None`이라 기존 호출부는 하위호환됨).
  - `audit_decorator.py`: `LOG_FILE` 정의를 `AuditEngine` 생성보다 앞으로 옮기고(원래는 뒤에 있어서 경로를 못 넘겼음) `log_file_path=str(LOG_FILE)`로 전달.
  - **검증**: `python3 -m py_compile` 통과. 오늘 파일 기준 마지막 hash를 정확히 이어받는지, 오늘 파일이 비어있을 때 어제 백업(`audit_log.jsonl.2026-09-08`)의 마지막 hash로 정확히 fallback하는지 스크래치 디렉토리에서 격리 테스트로 확인(둘 다 실제 파일의 마지막 줄 hash와 정확히 일치).
  - **영향 범위**: `AuditEngine`/`HashChain`을 생성하는 곳은 `audit_decorator.py` 한 곳뿐(`generate_validation_logs.py`는 별개의 더미 생성기라 무관함을 확인) — 다른 호출부가 깨질 위험 없음. 이미 써진 로그 줄은 전혀 재작성하지 않음(읽기만 함).
  - **아직 남은 한계**: 이 수정은 "체인이 끊기지 않게 이어붙이는 것"이지 "파일이 실제로 위변조됐는지 검증하는 기능"이 아님 — 이건 별개 작업이므로 지금 만들지 않음, 아래 "다" 항목 참고.
  - **실전 검증(2026-09-10)**: 스크래치 디렉토리 시뮬레이션이 아니라, 실제 자정이 지나면서 `audit_log.jsonl`이 `audit_log.jsonl.2026-09-09`로 로테이션되는 걸 그대로 확인함 — 어제 백업 파일의 마지막 줄 `hash`와 오늘 새 파일의 첫 줄 `previous_hash`를 대조한 결과 `8af218d3...`로 정확히 일치. 실제 운영 조건에서도 의도대로 동작함을 확인.
- [ ] **보존 기한(`expiry_date`)이 저장소마다 다르게 적용됨** — `audit_log.jsonl`은 `RetentionPolicy.calculate_expiry()`로 만료일을 필드에 적어주기라도 하는데(실제 삭제·아카이빙 로직은 없음), MySQL `audit_log`는 보존 기한 개념 자체가 없음. 4개 저장소가 각자 관리되다 보니 "보관 정책을 정하자"고 결정해도 일부에만 반영되고 빠뜨리기 쉬운 구조(`report_merge_final.md` 체크리스트의 "감사 로그 보존 정책" 항목과 동일한 문제).
  - **재평가(2026-09-10) — 착수 조건이 풀림**: 이전엔 "등급별 보존기간(며칠)을 정하려면 위험도 분류가 먼저 필요"해서 결정 필요 ⑦ 확정을 대기했는데, ⑦이 `risk_classification.py`/`.js`(action 기준 상/중/하)로 사실상 대체 구현되면서 이 등급을 그대로 갖다 쓸 수 있게 됨 — 예: "상 등급은 N일, 하 등급은 M일" 식으로 `risk_level` 값을 기준 삼아 바로 설계 가능. 다만 여전히 정해야 할 건 남음: 등급별 정확한 보관 일수(며칠씩 둘지), 그리고 `audit_log.jsonl`의 `RetentionPolicy`처럼 "만료일 계산"만 하고 "실제 삭제"는 안 하는 구현 공백을 채울지 — 이건 코드가 아니라 정책 결정이 먼저 필요해서 여전히 미착수.
- [x] **같은 "감사 로그"인데 접근 통제 수준이 저장소마다 다름 — 파일 권한 부분 수정함(2026-09-09)**: MySQL `audit_log`는 `requirePermission("audit:view")`로 admin만 조회 가능(RBAC 적용, `was/routes/auditLog.js:8`). 반면 `audit_log.jsonl`은 조회용 API 자체가 없고 파일 권한(`-rw-r--r--`, 이 컴퓨터의 다른 로컬 계정도 읽을 수 있음)으로만 통제되고 있었음.
  - **수정한 것(A안 — 파일 권한을 소유자 전용으로 좁힘)**: `audit_decorator.py`에 `SecureTimedRotatingFileHandler`(`TimedRotatingFileHandler` 상속)를 추가, `_open()`을 오버라이드해서 `os.chmod(self.baseFilename, 0o600)`을 적용. `_open()`은 최초 파일 생성 시뿐 아니라 자정 로테이션으로 새 파일이 열릴 때도 호출되는 지점이라, 여기 한 곳만 고치면 앞으로 생기는 모든 로그 파일에 자동 적용됨. `audit-logs/` 디렉토리 자체도 `os.chmod(LOG_DIR, 0o700)`으로 좁혀서 다른 로컬 계정이 파일 목록조차 못 보게 함. 기존에 이미 있던 파일 2개(`audit_log.jsonl`, `audit_log.jsonl.2026-09-08`)도 수동으로 `chmod 600`/디렉토리 `700` 적용함.
  - **검증**: 스크래치 디렉토리에서 격리 테스트 — (a) 최초 파일 생성 시 `0o600`으로 생성되는지, (b) 일부러 권한을 풀어놓은 뒤 `doRollover()`(로테이션)를 강제 실행했을 때도 새로 열리는 파일이 다시 `0o600`으로 돌아오는지 — 둘 다 확인됨.
  - **한계(B안, 지금 안 함)**: 이건 "이 컴퓨터의 다른 로컬 계정"으로부터 보호하는 OS 레벨 조치이지, MySQL `audit_log`처럼 "로그인한 admin만 조회 가능"한 애플리케이션 레벨 RBAC과 동급은 아님. RBAC 기반 조회 API를 새로 만드는 건 "사후 스캔 파서"(`chatbot-service/log_audit_tool.py`, 결정 필요 ③ A로 확정됨 — 6번 섹션 참고)와 겹치는 더 큰 작업이라 지금 하지 않음.
- [ ] **해시 체인이 실제로 위변조 안 됐는지 검증하는 기능이 없음** — 위 해시체인 항목에서 고친 건 "체인이 끊기지 않게 이어붙이는 것"뿐이고, "파일을 처음부터 끝까지 순회하며 각 레코드의 hash를 재계산해서 실제로 이어지는지 확인하는 검증 도구"는 여전히 없음. **결정 필요 ③이 A로 확정되면서 이제 위치는 정해짐**(`chatbot-service/log_audit_tool.py`) — `read_audit_jsonl()`이 이미 이 파일을 줄 단위로 읽고 있어서 검증 로직을 추가할 자리는 생겼지만, **아직 구현은 안 함**(2단계 이후 범위로 남겨둠).

#### 다. 마스킹 파이프라인 관련 유출 — [x] 해결됨 (예상대로 마스킹 3원화 작업과 같이 처리됨)

- [x] **`.run/chatbot.log`에 마스킹 전 원문이 평문으로 누적되던 문제 — 해결됨(2026-09-09, `aa30908`, 팀원 작업)**: "로그 저장소가 4개뿐이냐"는 질문을 계기로 `.run/*.log`(1-5-가 참고)를 직접 열어본 결과 확인함.
  - 원인: `audit-agent/engine.py:17-18`
    ```python
    print(f"\n🔍 --- [디버깅] 이벤트 ID: {event_id} 파이프라인 진입 ---")
    print(f"👉 [Step 0] 원본 페이로드: {payload}")   # 마스킹(20행) 되기 전 원본
    ```
    이 디버그 `print()`가 `self.masking.mask_payload(payload)` 호출(20행)보다 먼저 실행되면서 마스킹 전 원본 payload를 그대로 stdout에 찍음. `start.sh`가 챗봇 서비스를 `nohup uvicorn ... > .run/chatbot.log`로 띄우기 때문에, 이 출력이 그대로 `.run/chatbot.log`에 평문으로 영구 누적됨.
  - 실제 확인된 예시(`.run/chatbot.log`): `👉 [Step 0] 원본 페이로드: {'input': {'func_name': 'tool_check_scanned_documents', 'args': ['1'], ...}, 'output': '보관 중인 문서 현황입니다...'}`
  - **의미**: `audit_log.jsonl`(암호화)·`chatbot_logs.db`(암호화)로 애써 안전하게 저장해도, 같은 데이터가 이 디버그 출력을 통해 평문 파일로 별도 유출되고 있었던 것 — PII 탐지 대상 4개 저장소만 스캔해서는 못 잡는 구멍이었음.
  - **왜 마스킹 3원화 작업과 겹치는지**: 이 파일(`audit-agent/engine.py`)은 3원화 논의의 대상인 `audit-agent/masking.py`를 호출하는 바로 그 파이프라인이라, 마스킹 로직을 손보는 김에 이 디버그 print도 같이 정리하게 될 가능성이 높음 — **실제로 그렇게 됨.**
  - **수정 확인(2026-09-10)**: 문제의 print문(`Step 0: 원본 페이로드`)이 제거됨. `.run/chatbot.log`를 다시 열어본 결과 "[디버깅]" 다음 줄이 곧바로 "[Step 1] 마스킹 완료"로 넘어가고, 원본 payload 출력이 더 이상 없음을 확인. 4번 섹션 위험도표도 갱신함.
  - **이후 재발할 뻔했다가 다시 막힌 경위(`50d86fd`+`b50818d`)**: 위험도 분류(`risk_level`) 기능을 `engine.py`에 추가하는 작업이 "Step 0 원본 페이로드" print가 아직 남아있던 이전 버전의 `engine.py`를 베이스로 작성됨 — 그 버전을 그대로 반영하면 `masked_payload = self.masking.mask_payload(payload)`(24행) **호출 전**에 `print(f"...원본 페이로드: {payload}")`가 다시 실행되는 상태로 되돌아갈 뻔했음(코드 diff 기준으로 확인).
    - **최종적으로 반영된 로직**(현재 코드): payload 수신 → (Step 0 print 없이 곧바로) `mask_payload()`로 마스킹 → **마스킹 완료된 값**을 넣어 `classify_risk(action, masked_payload)`로 `risk_level` 계산(29행 주석: "마스킹 결과의 악성 의도 플래그까지 반영해 판단해야 하므로 마스킹 다음에 수행") → 암호화 → 만료일 산출 → 해시체인 생성. `risk_level`은 `payload_encrypted` 안이 아니라 레코드 최상위 평문 필드로 남아서, 복호화 없이도 등급으로 필터링/스캔 가능(45행).
    - 즉 "Step 0 print 제거"(2026-09-09 수정)와 "해시체인 재시작 복원을 위한 `log_file_path` 연결"(저희 수정)이 둘 다 살아있는 상태에서, 그 위에 `risk_level` 계산 한 줄(29-30행)만 추가된 게 지금 버전 — 재시작 시뮬레이션으로 해시체인이 정상 이어지는지까지 재검증됨. `444bed7`(파일 권한 수정이 병합 중 누락됐던 사례)와 달리 이번엔 유실 없이 반영됨.

### 3-4. DB 구조 전반 (MySQL `vulnapp`, 로그 테이블 포함 전체 11개) — `INFORMATION_SCHEMA`로 직접 확인함

"로그" 테이블(`audit_log`, `chat_messages`)만 봐서는 전체 그림이 안 나온다. 나머지 9개 테이블에도 개인정보/민감정보가 들어있어서, "DB 구조 전반 정리"는 로그 테이블만이 아니라 이 전체를 대상으로 해야 한다.

| 테이블 | 민감 컬럼 | 비고 |
|---|---|---|
| `patients` | `password`(bcrypt 해시), `rrn`(주민번호, AES 암호화), `name`, **`totp_secret`(2026-09-09 신규, 평문 — 아래 참고)** | 계정 원본. 모든 다른 테이블이 `patient_id`로 여기를 참조 |
| `board_posts` | `content`(증상 내용, 평문), `answer`(평문) | 진료문의 — 의료 정보지만 암호화 안 됨 |
| `medical_records` | `diagnosis`, `treatment`(둘 다 평문) | 의료진 작성 진료기록 — **가장 민감한데 암호화 없이 평문 저장** |
| `scanned_documents` | `extracted_text`, `parsed_fields`(JSON, 둘 다 평문) | OCR 원문 — 처방전/진단서 내용, 평문 |
| `reservations` | `department`(민감도 낮음) | |
| `holidays` | 없음 | |
| `chat_messages` | `content`(AES-256-GCM 암호화) | 위 3-1 참고 |
| `audit_log` | `detail`(JSON, 평문이지만 대개 메타데이터) | 위 3-1 참고 |
| `roles`/`permissions`/`role_permissions` | 없음(참조 데이터) | |

**새로 눈에 띈 것**: `board_posts.content`/`answer`, `medical_records.diagnosis`/`treatment`, `scanned_documents.extracted_text` — 이 다섯 컬럼은 전부 **의료 정보인데 암호화가 안 되어 있다.** `chat_messages`(챗봇 대화)와 `patients.rrn`(주민번호)만 암호화 대상이었고, "진짜 의료 내용"이 담기는 이 컬럼들은 애초에 암호화 범위 밖이었다는 뜻 — 이번 정리에서 반드시 팀에 공유해야 할 사실.

**관련 발견(2026-09-09) — `board_posts` 열람 시 마스킹 정책이 `medical_records`와 다름, 팀 결정으로 현행 유지**: `was/routes/board.js`(진료문의 게시판)를 확인한 결과, `board:reply` 권한(staff/admin)이 있으면 `bp.title`/`bp.content`/`bp.answer`를 목록(`GET /`)·상세(`GET /:patientId`) 둘 다 **마스킹 없이 원문 그대로** 응답함. 반면 같은 프로젝트의 `records.js`는 이미 `maskRecord()`로 `records:view:masked`(staff, 마스킹)와 `records:view:full`(admin, 원문)을 구분해서 내려주는 정책이 있음 — 같은 "직원이 환자 민감정보를 볼 때 마스킹할지"의 문제인데 라우트마다 정책이 다름. 환자가 문의 내용에 실수로 주민번호 등을 남기면 그대로 노출될 위험.
- **결정됨(2026-09-09)**: `board.js`는 상담 업무 특성상 담당 직원에게 원문이 필요하다고 보고, **현행(마스킹 없음)대로 유지**하기로 결정. `records.js`처럼 고치지 않음.
- `ocr.js`/`documents.js`는 같은 종류의 문제가 아님을 코드로 확인함 — `ocr.js`의 스캔 라우트는 `ocr:scan`(admin 전용) 권한으로 막혀있어 애초에 admin 외 노출 대상이 없고, `documents.js`의 admin용 목록(`GET /`)은 쿼리 자체에서 `extracted_text`/`parsed_fields`를 제외함(주석에 명시). 환자 본인의 `extracted_text`를 포함하는 라우트(`GET /mine/:id`)는 `WHERE id=? AND patient_id=?`로 본인 것만 조회되어 타인 노출 시나리오가 성립 안 함.

**새로 발견(2026-09-09) — `patients.totp_secret`도 평문 저장**: 팀원이 pull해온 TOTP 2차 인증 기능(`6239e5c`)이 추가한 컬럼. `was/routes/totp.js`를 확인한 결과 `UPDATE patients SET totp_secret = ?`로 그냥 저장하며 암호화가 전혀 없음. 같은 프로젝트에 `rrn`을 AES-256-GCM으로 암호화하는 기존 패턴(`crypto-utils.js`)이 있는데 이 컬럼은 그 패턴을 따르지 않음. TOTP 비밀키가 유출되면 공격자가 해당 계정의 2차 인증 코드를 무기한 생성할 수 있어(비밀번호와 달리 "재설정"으로 간단히 막을 수 있는 성격이 아니라, 애초에 2차 인증 자체를 무력화하는 셈) **`rrn`급으로 다뤄야 하는 위험도인데 암호화가 빠져있음.** 위험도 분류표(4번 섹션, 🟠 High)에 반영함. 암호화 적용 여부는 별도 조치 검토 대상(아직 코드 수정 안 함).

### 3-5. 이 인벤토리를 팀이 공유해야 하는 이유

피드백의 "수집하는 정보/로그 항목을 팀이 명확히 알고 있어야 함"은, 이 문서(3-1~3-4)가 **개인이 참고하는 메모가 아니라 팀 전체가 합의하고 아는 기준 문서**가 되어야 한다는 뜻으로 이해했다. 그래서:
- 이 섹션(3)을 완성한 뒤엔 팀 리뷰를 거쳐 "이게 맞다"는 합의를 받는 절차가 필요함 (구현 시작 전에)
- 이후 스키마가 바뀔 때마다(새 테이블/컬럼 추가) 이 문서도 같이 갱신한다는 규칙이 있어야 시간이 지나도 안 틀어짐

---

## 4. 로그 위험도 분류 체계 (설계 초안 — [x] 원래 목적은 다른 구현으로 대체 충족됨, 2026-09-10)

피드백에서 요구한 "심각도별 등급화"를 위 인벤토리(3번)를 기반으로 초안만 잡는다. 정확한 기준은 팀 논의로 확정 필요.

**이 섹션 전체를 어떻게 볼지**: 아래 4단계 표(데이터 컬럼 기준)는 팀 논의를 거쳐 공식 채택된 적이 없고, 지금도 여전히 "초안" 상태 그대로다. 다만 이 초안이 있던 이유(피드백의 "심각도별 등급화" 요구)는 `risk_classification.py`/`.js`(action 기준 상/중/하, 아래 참고)로 이미 실제 구현·배포돼서 별도 경로로 충족됨 — 그래서 **이 표를 계속 미확정 상태로 남겨두고 채택 여부를 결정해야 할 급함은 없어졌다.** 표 자체는 "데이터가 얼마나 민감한지"를 정리한 참고 자료로는 여전히 유효하니 지우지 않고 남겨둠.

| 등급 | 기준 | 해당하는 것 |
|---|---|---|
| 🔴 Critical | 보안 사고 신호 — 즉시 확인 필요 | 로그인 반복 실패(brute force 의심, 2026-09-09부터 `login_anomaly_repeated_failure`/`login_anomaly_admin_repeated_failure`로 실제 기록됨, 3-2 참고), `login_anomaly_admin_new_ip`/`login_anomaly_admin_new_location`(관리자 계정 탈취 의심 신호), `totp_verify_fail`(2차 인증 우회 시도 의심), `audit-agent/masking.py`가 이미 탐지하는 `MALICIOUS_INTENT_DETECTED`(프롬프트 인젝션 시도), `account_role_change`(권한 상승) |
| ~~🔴 Critical~~ → 해결됨 | ~~`.run/chatbot.log`(2026-09-09 재분류 — 마스킹 전 원문이 평문으로 그대로 남는 게 확인됨)~~ | **[x] 해결됨(2026-09-09, `aa30908`)** — 원인이었던 디버그 print(`engine.py`의 "Step 0: 원본 페이로드")가 제거됨. 실제 `.run/chatbot.log`를 다시 확인한 결과 "[디버깅]" 다음 줄이 곧바로 "[Step 1] 마스킹 완료"로 넘어가고 원본 payload 출력이 더 이상 없음 — 재확인 완료. 이제 다시 🟢 Low(서버 프로세스 로그)로 봐도 됨 |
| 🟠 High | 원문 자체가 민감(암호화 여부와 무관하게) | `medical_records.diagnosis/treatment`, `scanned_documents.extracted_text`, `chat_messages.content`, `patients.rrn`, **`patients.totp_secret`(2026-09-09 추가, 평문 — 3-4 참고)** |
| 🟡 Medium | 간접적으로 민감하거나 암호화된 상태로만 존재 | `board_posts.content/answer`(의료 정보지만 게시판 성격), `chatbot_logs.db`/`audit_log.jsonl`의 암호화된 필드(키가 안전하면 노출 안 됨) |
| 🟢 Low | 메타데이터 위주, 원문 노출 없음 | `audit_log.detail`(역할명/ID 등), `reservations`, `holidays`, `.run/was.log`·`.run/frontend.log`(실측 결과 원문 없음 확인, 3-3 참고) |

**결정 필요 ⑦ — [x] 재평가: 사실상 대체 구현됨(2026-09-10)**: 피드백이 요구했던 "심각도별 등급화" 자체는 아래(`risk_classification.py`/`.js`, action 기준 상/중/하)로 이미 실제 구현·배포됐음. 이 문서가 원래 그려둔 4단계 표(데이터 컬럼 기준)를 "그대로 채택할지" 계속 미결정으로 묶어둘 실익이 낮아짐 — 원래 목적은 충족됐으므로 이 표는 참고 자료로만 남기고 공식 결정 대상에서 내림. 등급 수·대응 매뉴얼까지 다듬고 싶으면 이미 구현된 `risk_classification.py`/`.js` 쪽에 등급을 추가/조정하는 방향이 더 실질적(예: `RISK_LEVELS`에 항목 추가).

**⑦과 다른 방향에서 실제로 구현됨(2026-09-10, `50d86fd`+`b50818d`, 팀원 작업)**: 위 표는 "어떤 **데이터(컬럼)**가 민감한가" 기준인데, 팀원은 "어떤 **감사 로그 이벤트(action)**가 위험한가" 기준으로 별도의 3단계(상/중/하) 체계를 실제로 구현·배포함 — 둘은 서로 다른 축이라 대체 관계가 아니라 보완 관계로 보임.
- `was/risk-classification.js` + `chatbot-service/audit-agent/risk_classification.py` — 두 파이프라인(WAS/챗봇)에 각각 동일한 원칙으로 구현. 목록에 없는 신규 action은 "하"가 아니라 **"중"을 기본값**으로 둬서 새 이벤트가 조용히 저위험 취급되는 걸 방지(두 구현 다 동일 원칙). 실제 매핑 전체(코드 원문 대조 완료):

**WAS — `was/risk-classification.js`**

| action | 등급 | 근거 |
|---|---|---|
| `login_anomaly_admin_repeated_failure` | 상 | 관리자 계정 대상 반복 실패 |
| `login_anomaly_admin_new_ip` | 상 | 관리자 계정 신규 IP 로그인 성공 |
| `login_anomaly_admin_new_location` | 상 | 관리자 계정 신규 지역 로그인 성공 |
| `login_anomaly_sqli_pattern` | 상 *(2026-09-14 팀원 추가)* | 로그인 아이디/비밀번호에 SQL 인젝션 패턴(`' OR '1'='1'`, `UNION SELECT`, `;DROP` 등) — 쿼리는 파라미터화되어 실행은 안 되지만 침해 시도 신호 |
| `totp_verify_fail` | 상 | 관리자 신규 위치 추가 인증 실패 |
| `login_anomaly_repeated_failure` | 중 | 일반 계정 반복 실패 |
| `login_anomaly_high_frequency` | 중 | 동일 IP 고빈도 시도 |
| `login_anomaly_long_input` | 중 | 비정상적으로 긴 입력값 |
| `oversized_request_payload` | 중 *(2026-09-14 추가)* | 요청 본문이 100KB(`express.json()` 기본 제한) 초과 — `login_anomaly_long_input`(200자 기준)조차 못 받고 사라지던 미탐을 메우려고 신설 |
| `account_role_change` | 중 | 권한 상승 가능한 민감 조작 |
| `login_success` / `login_fail` | 하 | 정상 흐름 / 임계값 미달 단발 실패 |
| `totp_verify_success` / `totp_enrolled` / `totp_disabled` | 하 | 정상 보안설정 동작 |
| `patient_register` | 하 | 정상 운영 행위 |
| *(매핑 없음)* | **중** | 신규 이벤트 안전측 기본값 |

**챗봇 — `chatbot-service/audit-agent/risk_classification.py`**

| 조건 | 등급 | 근거 |
|---|---|---|
| `masking.py`가 악성 의도(`MALICIOUS_INTENT_DETECTED`) 탐지 | **상** (action 무관 최우선 승격) | 조회성 호출이라도 프롬프트 인젝션 시도면 최우선 노출 |
| `book_appointment` | 중 | 상태를 변경하는 도구 호출 |
| `check_scanned_documents` / `check_appointments` / `check_medical_records` / `rag` / `direct_answer` | 하 | 조회성 도구 호출 |
| *(매핑 없음)* | **중** | WAS와 동일한 안전측 기본값 |
- 챗봇 쪽은 `masking.py`가 `MALICIOUS_INTENT_DETECTED`를 탐지하면 action이 뭐든 **무조건 "상"으로 승격** — 단순 조회(`rag` 등)라도 그 안에 프롬프트 인젝션 시도가 섞여 있으면 "하" 등급에 묻히지 않게 함.
- MySQL `audit_log`에 `risk_level ENUM('low','medium','high')` 컬럼 추가됨(`db/init.sql`) — 로컬 DB에는 `ALTER TABLE`로 수동 반영함(마이그레이션 자동 적용 안 됨, 이 프로젝트의 반복되는 패턴). `was/routes/auditLog.js`에 `?risk=` 필터도 추가됨.
- `was/risk-classification.js`에 `maskUsername()`/`maskAuditDetail()`도 같이 들어옴 — `audit_log.detail`의 `username`을 이메일 마스킹 규칙과 동일하게 부분 마스킹(앞 3글자만 노출). **IP는 의도적으로 마스킹 안 함** — 침해 대응 시 접근 경로 추적에 필요하고, 이 로그 자체가 `audit:view`(admin 전용)로 이미 접근 제한돼있다는 근거.
  - **마스킹 방식의 한계(코드로 확인, 2026-09-10)**: `maskAuditDetail()`은 `detail` 객체 안의 **`username`이라는 필드명 하나만** 골라서 마스킹함(코드 그대로: `if ("username" in masked)`). 즉 필드 이름 기반이지, `pii_masking.py`처럼 텍스트 내용을 정규식으로 훑어서 PII를 찾는 방식이 아님 — `detail`에 `username` 말고 다른 자유 텍스트가 들어가는 action이 생기면(예: 나중에 상세 메시지를 담는 필드가 추가되는 경우), 그 안의 PII는 이 마스킹으로 못 잡음. 지금 당장 문제가 되는 구체적 사례는 없지만 구조적 한계로 기록.
- 자세한 분류 근거는 코드 주석이 `SECURITY_THREAT_MODEL.md`를 가리키는데, **이 파일은 아직 없음**(커밋 메시지에 "Notion 예정, 이 커밋엔 미포함"이라고 명시돼 있음) — 참조는 있지만 실체가 아직 없는 상태, 나중에 생기면 참고.
- **팀원 작업 보고서(Notion, "[최종 산출물] 탐지 기준 및 운영 가이드")의 "백필 완료" 주장 — 저희 로컬 DB에서는 사실이 아님을 확인(2026-09-10)**: 보고서엔 "WAS(MySQL)는 `risk_level`만 기존 행까지 백필했다"고 적혀있는데, 실제로 조회해보니 **저희 DB의 기존 행은 전부 `risk_level='low'`**임(`account_role_change`처럼 원래 "중"으로 분류돼야 하는 action도 `low`로 남아있음, `id=55`/`62` 확인). 원인: `ALTER TABLE`로 컬럼만 추가했을 뿐(스키마 기본값 `DEFAULT 'low'`가 그대로 채워진 것), 과거 행의 `action`을 보고 `risk_level`을 재계산해서 `UPDATE`하는 백필 스크립트는 저장소 어디에도 커밋돼 있지 않음(`find`로 확인, `backfill` 관련 파일 없음) — 팀원 본인 로컬 환경에서 수동으로 돌린 작업이라 git에는 안 남은 것으로 보임. **필요하면 `risk_classification.py`/`.js`의 `RISK_LEVELS` 매핑을 그대로 가져와 직접 백필 스크립트를 만들 수 있음(아직 안 함).**
- **팀원 작업 보고서(Notion, "비정상 요청 패턴 탐지 기준 정의 및 구현")로 확인된 정확한 임계값** — `login_anomaly_*` 액션들이 실제로 트리거되는 기준을 코드(`was/routes/auth.js`, `was/totp-utils.js`)와 대조해서 확인함:
  - `login_anomaly_repeated_failure`: 같은 계정 5분 내 5회 실패(`FAILURE_THRESHOLD`), 관리자는 3회(`ADMIN_FAILURE_THRESHOLD`, `login_anomaly_admin_repeated_failure`)
  - `login_anomaly_high_frequency`: 같은 IP에서 1분 내 10회 시도(`FREQUENCY_THRESHOLD`, 성공/실패 무관)
  - `login_anomaly_long_input`: 아이디/비밀번호 200자 초과(`LONG_INPUT_MAX_LENGTH`) — 감사 로그엔 입력값 자체가 아니라 길이(숫자)만 남김
  - 계정 기준(반복실패)과 IP 기준(빈도)은 서로 독립적으로 집계됨
  - 관리자 신규 위치 탐지(`login_anomaly_admin_new_ip`/`new_location`)에 따른 TOTP 추가 인증은 **TOTP를 등록한 관리자에게만** 적용됨 — 미등록 관리자는 계속 기록만 되고 로그인은 그대로 허용(의도적 범위 제한)
  - **[버그 발견·수정, 2026-09-14]** 위 반복실패/신규IP/신규지역 3개 탐지가 전부 사용자명을 그대로 Map 키로 써서, MySQL이 대소문자를 구분 안 하는 것과 어긋나(`admin`/`Admin`/`ADMIN` 전부 같은 계정으로 로그인됨, 직접 확인) 케이스만 바꾸면 무제한 우회 가능했음 — 신규 위치 판정도 "키 없음=새로움 아님"으로 오판해 TOTP 추가인증까지 건너뛸 수 있는 문제였음. `normalizeUsernameKey()`(소문자 정규화)로 3개 Map 키 통일해서 수정, 재현 검증 완료(`was/routes/auth.js`). 상세는 `INCIDENT_RESPONSE.md` 5번 섹션 참고.
  - `geoip-lite`는 사설 IP(로컬 개발 환경 등)에서 지역 추정이 안 돼 `null` 반환 — 이 경우 지역 판단은 건너뛰고 IP 판단만 적용
  - **알려진 한계(보고서에 명시)**: 신규 IP/지역 목록이 메모리 저장이라 서버 재시작 시 초기화됨(재시작 직후엔 이미 알던 IP도 "신규"로 오탐 가능, Redis 등 외부 저장소 미도입), TOTP 등록/해제에 별도 재인증 절차 없음, User-Agent는 아직 비교 안 함

---

## 5. 접근 블랙리스트 관리 방안 (검토 항목)

### 지금 있는 것 (블랙리스트는 아니고 "속도 제한"만 있음)
- 로그인: IP당 15분에 5회 (`express-rate-limit`)
- OCR: 로그인 사용자당 분당 10회
- 챗봇: `slowapi`로 분당 20회
- 전부 **일정 시간 지나면 자동으로 풀리는 임시 제한**이지, "이 계정/IP는 계속 차단한다"는 블랙리스트 개념은 어디에도 없음

### 이미 있는데 활용을 안 하고 있는 신호
`audit-agent/masking.py`가 프롬프트 인젝션 의심 키워드를 탐지해서 `MALICIOUS_INTENT_DETECTED` 플래그를 payload에 남기는 것까진 하는데, **그 이후 아무 조치가 없음**(로그에 기록만 되고 끝). 이게 블랙리스트 판단의 첫 입력값으로 쓰기 가장 자연스러운 기존 자원.

### 검토해야 할 질문들 (아직 미정)
- **차단 기준이 IP인가 계정인가**: 계정 기반이 로그인된 사용자에겐 더 정확하지만, 비로그인 상태의 악의적 접근(로그인 시도 자체를 반복하는 경우)은 IP 기준이 아니면 못 막음 — 아마 둘 다 필요
- **저장 위치**: 새 DB 테이블(`blacklist` 같은)로 영구 저장할지, 아니면 메모리(재시작하면 풀림, 지금 rate limit과 같은 방식)로 충분한지
- **자동 차단 vs 관리자 승인**: `MALICIOUS_INTENT_DETECTED`가 뜨자마자 자동으로 차단할지, 아니면 감사 로그에 쌓아뒀다가 admin이 검토 후 수동으로 차단할지 — 자동 차단은 오탐(정상 사용자가 우연히 키워드에 걸리는 경우) 위험이 있음
- **해제 정책**: 영구 차단인지, 일정 기간 후 자동 해제인지
- **차단됐을 때 사용자에게 보여줄 메시지**: 너무 구체적으로 알려주면 우회 방법을 알려주는 셈이라, 일반적인 "일시적으로 이용이 제한되었습니다" 수준으로 뭉뚱그릴지

**결정 필요 ⑧**: 위 질문들에 대한 답 — 이건 설계를 더 진행하기 전에 팀 논의가 필요한 부분이라 이번 문서에서는 질문만 정리하고 답은 비워둔다.

---

## 6. 제안하는 작업 단계

### 1단계 — 로그 파싱·정규화 (파일별 리더 작성) — [x] 완료 (2026-09-10)

**결정 필요 ③은 A(별도 신규 스크립트)로 확정** — `chatbot-service/log_audit_tool.py` 신규 작성, 4개 리더(`read_mysql_audit_log`, `read_audit_jsonl`, `read_chatbot_logs_db`, `read_mysql_chat_messages`) + `main()` 진입점 구현 완료.

**검증 결과**:
| 리더 | 결과 | 검증 방법 |
|---|---|---|
| `mysql_audit` | 63건 | 실제 값 스팟체크(`login_success`/`account_role_change` 등 기존에 직접 확인한 값과 일치) |
| `audit_jsonl` | 20건(오늘자+어제 로테이션 백업 `audit_log.jsonl.2026-09-08` 합산) | 복호화된 내용이 이전에 확인한 값과 일치. **버그 발견·수정**: `actor_id` 추정 시 `tool_rag(question)`처럼 `patient_id`를 안 받는 도구는 `args[0]`이 질문 텍스트인데 이를 `patient_id`로 오인식하던 문제 — 숫자로만 이뤄진 경우만 `actor_id`로 간주하도록 수정 |
| `chatbot_sqlite` | 46건 | 복호화 실패 0건, 실제 질문 텍스트로 확인 |
| `mysql_chat` | 52건(신규 2건 성공, 기존 50건은 예상대로 실패) | **실제 로그인 → 채팅 메시지 전송(`파서검증용테스트메시지12345`) → 이 리더로 복호화까지 end-to-end 라운드트립 검증** — 보낸 내용이 정확히 일치해서, `crypto-utils.js`와 동일한 AES-256-GCM 재구현이 맞다는 걸 증명함. 기존 50건은 `RRN_ENCRYPTION_KEY` 고정(위 항목) 이전 데이터라 여전히 `InvalidTag`로 실패 — 예상된 결과, 복구 대상 아님 |

**아직 안 한 것(2단계 이후)**: PII 탐지 로직 연결, 리포트 생성. `python3 -m py_compile` 통과, 실행은 `python3 chatbot-service/log_audit_tool.py`(어느 디렉토리에서 실행해도 `__file__` 기준 절대경로라 무관).

각 저장소마다 포맷·암호화 방식이 다르므로, "복호화 + 공통 스키마로 변환"하는 파서를 저장소별로 하나씩 만든다.

```python
# 공통 출력 스키마 (제안)
{
    "source": "audit_jsonl" | "chatbot_sqlite" | "mysql_chat" | "mysql_audit",
    "record_id": ...,
    "timestamp": ...,
    "actor_id": ...,       # patient_id 등
    "text_fields": {...},  # 검사 대상이 될 원문 텍스트들 (필드명: 값)
}
```

- `audit-logs/audit_log.jsonl` 리더: 각 줄 JSON 파싱 → `AuditCrypto`(기존 `audit-agent/crypto.py`)로 `payload_encrypted` 복호화 → `input`/`output` 텍스트 추출
- `chatbot_logs.db` 리더: `sqlite3`로 조회 → `Fernet(secret.key)`로 `original_encrypted` 복호화
- MySQL `chat_messages` 리더: `crypto-utils.js`와 동일한 AES-256-GCM 키/방식으로 복호화(파이썬 쪽에서 재구현 필요 — Node와 Python 간 암호화 파라미터가 정확히 일치해야 함, 여기서 실수하기 쉬움)
- MySQL `audit_log` 리더: `detail` JSON은 이미 평문이라 파싱만 하면 됨

**"파서"가 정확히 뭘 말하는지**: 위 4개 저장소는 형식도(JSONL/SQLite/MySQL) 암호화 방식도(Fernet 두 종류·AES-256-GCM·평문) 전부 다르다. "파서"는 이 각각을 읽어서 **"복호화 → 검사할 텍스트만 뽑아낸 공통 구조(1단계에서 제시한 스키마)"로 바꿔주는 작은 함수/모듈**을 말한다 — PII 탐지 로직이 저장 형식을 몰라도 되게 만들어주는 어댑터 역할이다. 예를 들어 `chatbot_logs.db`용 파서는 "SQLite 쿼리 → `secret.key`로 Fernet 복호화 → `original_encrypted` 필드를 텍스트로 반환"까지만 하고, 그 텍스트를 실제로 검사하는 건 2단계의 탐지 로직이 담당한다. 저장소가 4개면 최소 파서도 4개(또는 형식이 겹치는 것끼리 묶어서 그보다 적게) 필요하다.

**결정 필요 ③ — [x] A로 확정(2026-09-10)**: `chatbot-service/log_audit_tool.py`로 구현 완료(위 참고). 아래는 결정 당시 비교했던 두 옵션의 장단점(기록용):

| | A. 별도 신규 스크립트(예: `log_audit_tool.py`) | B. `audit-agent/` 패키지 확장(예: `audit-agent/readers/` 추가) |
|---|---|---|
| **장점** | 기존 운영 코드(`app.py`, `audit_decorator.py`)를 전혀 안 건드려서 실수로 운영 흐름을 깨뜨릴 위험이 없음. "필요할 때 돌리는 배치성 도구"라는 성격에 맞음(사후 감사가 목적 ②-a이므로). 4개 저장소를 한 곳에서 관장하는 구조라 "로그 전체를 스캔한다"는 목적이 코드 구조에 그대로 드러남 | 이미 `audit-agent`가 크립토(`crypto.py`)·마스킹(`masking.py`)·해시체인·보존정책을 모아둔 "감사 전담" 패키지이므로, `AuditCrypto`/`AuditMasking`을 바로 import해서 재사용 가능(코드 중복 감소). "감사 관련 로직은 다 여기 있다"는 일관성 유지 |
| **단점** | `audit-agent/crypto.py` 등 일부 로직을 재사용하더라도 결국 import해서 쓰게 되므로, 완전히 독립적이진 않음. 나중에 목적 ②-b(탐지 로직 개선)를 실시간 마스킹에도 반영하려면 이 스크립트와 실시간 경로가 또 분리된 채 유지보수 부담이 생길 수 있음 | `audit-agent`는 원래 "로그를 실시간으로 남길 때" 쓰는 목적으로 설계된 패키지인데, "이미 쌓인 로그를 나중에 훑어보는" 배치성 기능을 넣으면 생성 시점 로직과 사후 분석 로직이 한 패키지에 섞여 책임 범위가 애매해짐. 이 패키지는 최근에야(어제) 겨우 다시 살아난 지 얼마 안 됐는데 바로 비대해질 위험 |

MySQL `chat_messages`(AES-256-GCM, Node 쪽 구현)용 파서는 어느 옵션을 택하든 Python으로 새로 구현해야 하는 부분이라 이 결정과는 무관하게 공통으로 필요하다.

### 2단계 — PII/민감정보 탐지 로직 통합 또는 강화

옵션이 두 가지다:

| 옵션 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 기존 `pii_masking.py` 재사용 | 이미 있는 더 강한 정규식+NER 로직을 로그 파서가 그대로 호출 | 로직 중복 안 만듦, 검증된 패턴 재사용 | `audit-agent/masking.py`와 별개로 유지보수해야 함(당장은) |
| B. 탐지 로직을 공용 모듈로 통합 | `pii_masking.py`와 `audit-agent/masking.py`를 하나의 공용 탐지기로 합침 | 이중 관리 문제 근본 해결 | 기존 두 곳의 호출부(`app.py`, `audit_decorator.py`)를 다 고쳐야 해서 범위가 커짐 |

**결정 필요 ④ — [x] B로 확정·구현 완료(2026-09-09, `aa30908`, 팀원 작업)**: `audit-agent/masking.py`가 자체 정규식을 버리고 `pii_masking.mask_pii()`를 그대로 import해서 씀(1-2 참고). "기존 두 곳의 호출부를 다 고쳐야 해서 범위가 커짐"이라던 단점을 실제로 감수하고 진행한 것으로 보임. 아래 B 관련 논의는 결정 당시 근거로 남겨둠.

**B 관련 추가 논의(2026-09-09) — "합치면 전부 똑같이 마스킹된다"는 오해 정리**:
- B(통합)를 하더라도 모든 경로가 반드시 동일하게 마스킹돼야 하는 건 아님. "PII를 찾는 기준(정규식 패턴)"만 하나로 공유하고, "찾은 걸 얼마나 지울지(완전 삭제 vs 일부 노출)"는 호출하는 쪽이 파라미터로 선택하게 만들 수 있음(예: `mask_pii(text, email_mode="full"|"partial")`). 탐지와 치환(redaction) 방식을 분리하는 구조가 더 깔끔하지만, 지금 `pii_masking.py`는 한 함수 안에 탐지+치환이 붙어있어서 이렇게 하려면 약간의 리팩토링이 필요함.
- `was/crypto-utils.js`(1-3)는 코드에 "목적이 달라서 의도적으로 별개(LLM 전송용 vs 조회 화면 표시용)"라는 주석이 있어 **B 대상에서 제외하는 게 맞음** — JS는 어차피 런타임이 달라 이식이 불가피하기도 함.
- 반면 `pii_masking.py`(1-1)와 `audit-agent/masking.py`(1-2) 사이에는 "왜 다르게 마스킹해야 하는지" 설명하는 근거가 코드 어디에도 없음 — 의도된 차별화라기보다 중복 구현에 가까워 보임. 다만 "감사 로그는 조사 목적으로 이메일 등 식별정보를 완전 삭제하지 않고 일부 남기는 게 나을 수 있다"는 반론도 가능해서, **통합 전 이 부분에 대한 팀 확인이 필요함** (파라미터화로 유연성을 남겨두면 이 논의와 무관하게 진행 가능).
- **위 2번 섹션 항목 1의 정정 내용과 연결**: `tool_check_medical_records`/`tool_check_appointments`/`tool_check_scanned_documents`의 리턴값(DB 원문)은 `pii_masking.py`를 아예 거치지 않고 `audit-agent/masking.py`가 유일한 방어선이므로, A(현행 유지)를 택하더라도 **이 세 경로만큼은 `audit-agent/masking.py`의 탐지 범위(이름·차트번호 추가, 구분자 변형 처리)를 최소한 보강해야 함** — B로 가지 않더라도 이 부분은 별도로 시급함.

### 3단계 — 탐지 결과 리포트 — [x] 완료 (2026-09-10)

이미 쌓인 로그를 스캔한 결과를 어떻게 남길지 정해야 한다:
- 콘솔 출력/CSV로 "어느 로그(source, record_id)에서 어떤 종류의 PII가 마스킹 안 된 채로 발견됐는지" 나열
- 발견된 항목 자체를 다시 화면에 출력하면 그 리포트 파일 자체가 새로운 민감정보 유출 경로가 되므로, **리포트에는 "PII 종류 + 위치"만 남기고 실제 값은 마스킹해서 보여주는 방식** 권장 (예: "record #37, field=input, type=RRN, 미리보기=90****-*******")

**결정(2026-09-10) — "PII 종류(type)" 분류는 뺌**: 원래 목적(사후 감사 — 마스킹 안 된 PII가 남아있는지 확인)은 "발견 여부 + 위치 + 안전한 미리보기"만으로 충분하고, 종류 분류는 `mask_pii()`가 남기는 치환 토큰(`[MASKED_EMAIL]` 등) 문자열에 의존하게 돼서 `pii_masking.py`가 바뀔 때마다 같이 깨질 수 있는 약한 결합이라 판단해 제외함. 위험도 등급(4번 섹션)과 자동 연결하고 싶어지면 그때 추가하는 것도 가능.

**구현**: `log_audit_tool.py`에 `scan_for_pii(records)` + `write_report(findings, path)` 추가.
- `scan_for_pii`: 1단계 레코드의 `text_fields` 문자열 값마다 `pii_masking.mask_pii()`를 블랙박스로 호출 — 원문과 마스킹 결과가 다르면 "발견"으로 기록. 탐지 로직 자체(2단계, 팀원이 이미 `pii_masking.py`/`audit-agent/masking.py`에 구현·통합함)는 재구현하지 않고 그대로 재사용.
- `write_report`: `{source, record_id, timestamp, actor_id, field, masked_preview}`를 CSV로 저장 — `masked_preview`는 `mask_pii()`가 리턴한 **마스킹된 값**이라 원문은 리포트 어디에도 안 남음.
- `main()`에 연결: 4개 리더로 레코드를 모은 뒤 `scan_for_pii()` 호출, 발견 건수 출력 + `chatbot-service/log_audit_report_YYYYMMDD_HHMMSS.csv`로 저장. 이 리포트 파일은 실행할 때마다 생기는 결과물이라 `.gitignore`에 추가함(소스 아님).

**실행 결과 (2026-09-10, 총 186건 스캔)**: 2건 발견 — 그런데 실제로는 **PII 유출이 아니라 `pii_masking.py` 이름 탐지 정규식의 오탐**이었음. "저는 실시간 날씨 정보를..." 같은 일반 문장에서 "저는" 뒤에 오는 2~5글자 한글 단어("실시간")를 전부 이름으로 취급해서 "실**간**"으로 잘못 마스킹함(`저는 X` 패턴이 "제 이름은 X" 류 문맥과 구분이 안 됨). `mask_pii()`로 직접 재현해서 확인함. **이건 도구가 정상 동작한다는 증거**(원문↔마스킹 결과 차이를 정확히 잡아냄)이면서 동시에, `pii_masking.py`의 이름 탐지 규칙에 실전 오탐 여지가 있다는 걸 처음으로 실측 데이터에서 확인한 사례 — 마스킹 로직 자체 개선은 별도 사안(팀원 담당 영역)이라 코드는 안 건드림.

**추가 오탐 재확인 (2026-09-14, 총 347건 스캔)**: `log_audit_tool.py`를 다시 실행해보니 HIGH 10건 발견 — 위와 **같은 근본 원인(`저는 X` 패턴)의 새 변종**임. 이번 세션에서 "챗봇이 병원과 무관한 질문에는 답하지 말라"는 주제 제한 기능을 추가하면서 거절 메시지를 "저는 미소병원 안내 챗봇입니다..."로 바꿨는데, 이 문구 자체가 `저는 X` 이름 탐지 정규식에 걸려서 **"미소병원"이 사람 이름으로 오인식**돼 "미**원"으로 마스킹됨(`chatbot_sqlite#68/69/71/72/74/81`, `mysql_chat#88/90`, `audit_jsonl#11cc6abb...` 등 10건 전부 동일 문구). 이전 사례("실시간"→"실**간")와 **정확히 같은 규칙의 부작용이 별개 위치에서 다시 발생**한 것 — 탐지 로직이 고정돼 있어도, 마스킹 대상이 되는 애플리케이션 코드가 바뀌면(이번엔 거절 메시지 문구 변경) 새 오탐이 계속 생길 수 있다는 걸 보여주는 사례. 마스킹 로직 자체는 여전히 안 건드림(팀원 담당 영역).

### 4단계 — (선택) 재발 방지

탐지 로직 자체를 개선했다면, 앞으로 새로 쌓이는 로그에는 그 개선된 로직이 적용되도록:
- `audit-agent/masking.py`를 A안이든 B안이든 개선된 걸로 교체
- 필요하면 주기적 재스캔(cron 등)까지 갈지는 별도 논의

---

## 7. 결정해야 할 것 (요약)

- [x] ① 스캔 대상 저장소 범위 — **4개 다 포함으로 결정** (단, 2026-09-09 `.run/chatbot.log` 문제 발견으로 이 범위 자체가 재논의 대상이 됨 — 1-5-나, 아래 ⑩ 참고)
- [x] ② 작업 목적 — **사후 감사 + 탐지 로직 개선 둘 다로 결정** (순서: 사후 감사 먼저 → 결과 보고 개선 우선순위 결정)
- [x] ③ 파서 코드를 어디에 둘지 — **A(별도 신규 스크립트)로 확정(2026-09-10)**, `chatbot-service/log_audit_tool.py`로 구현·검증 완료(6번 섹션 1단계 참고)
- [x] ④ 탐지 로직 통합 범위 — **B(공용 모듈로 통합)로 확정, 팀원이 구현 완료(2026-09-09, `aa30908`)** — 6번 섹션 2단계 참고
- [ ] ⑤ MySQL `chat_messages`의 AES-256-GCM을 Python에서 재구현할지 (Node의 `crypto-utils.js`와 파라미터 일치 필요, 까다로운 부분이라 범위에서 뺄지 먼저 검토할 가치 있음)
- [x] ⑥ spaCy 한국어 모델이 로컬에 실제로 설치되어 있는지 확인 — **8번 섹션에서 이미 확인 완료(미설치, NER 비활성 상태), 체크 표시만 안 돼있던 것을 바로잡음**
- [x] ⑦ 로그 위험도 분류 체계 — **재평가: 원래 목적(심각도별 등급화)은 `risk_classification.py`/`.js`(action 기준 상/중/하)로 이미 대체 구현됨(2026-09-10)**. 이 문서 4번 섹션의 4단계 표(데이터 컬럼 기준)는 공식 채택 여부를 더 미룰 필요 없이 참고 자료로 남김
- [ ] ⑧ 접근 블랙리스트 관리 방안(5번 섹션의 질문들) 전부 — **아직 미결정**
- [x] ⑨ `chatbot-service/app.py`의 `DB_FILE`/`KEY_FILE`(상대경로)를 절대경로로 수정함(2026-09-09) — `Path(__file__).resolve().parent.parent` 기준으로 `DB_FILE`(`chatbot_logs.db`)·`KEY_FILE`(`secret.key`) 둘 다 고정해, 실행 위치(cwd)와 무관하게 항상 프로젝트 루트 파일을 보도록 변경. `python3 -m py_compile` 통과 및 경로 계산이 기존 파일을 정확히 가리키는지 확인함. 커밋·푸시 완료(`8577933`).
- [x] ⑩ `.run/chatbot.log`에 마스킹 전 원문이 새는 문제 — **A(디버그 print문 제거)로 해결됨(2026-09-09, `aa30908`, 팀원 작업)**. 검증은 3-3 다 참고.
  - **정정**: `start.sh`가 `> .run/chatbot.log`(덮어쓰기, `>>` 아님)로 리다이렉트하기 때문에 재시작할 때마다 파일이 통째로 새로 시작됨 — 이 문제를 고친 뒤로 이미 여러 번 재시작(RRN_ENCRYPTION_KEY 작업 등)했으므로, **지금 파일에는 과거 유출분이 남아있지 않음**(의도적 정리는 아니고 재시작으로 우연히 덮어써진 것). 단, 파일을 어딘가에 백업/복사해뒀다면 그 사본에는 유출분이 그대로 남아있을 수 있음 — 그건 확인 안 됨.

## 8. 확인해야 할 것 (사실관계)

- [x] **spaCy(`ko_core_news_sm`) 설치 여부 — 확인함(2026-09-09), 모델 없음** — `python3 -c "import spacy; spacy.load('ko_core_news_sm')"` 실행 결과 `OSError: [E050] Can't find model 'ko_core_news_sm'`. `spacy` 패키지 자체는 설치돼 있지만 한국어 모델이 없어서 `pii_masking.py`의 `nlp`가 `None`으로 떨어짐 — **즉 지금은 NER 기반 "문맥 없는 이름" 탐지가 아예 꺼진 채로 운영 중**이었다("김구 취소해줘"처럼 문맥 단서 없는 이름은 현재 코드로는 못 잡음). `pip install ko_core_news_sm` 상당의 spaCy 한국어 모델 설치가 이번 작업의 실질적인 첫 개선 포인트가 될 수 있음.
- [x] 1단계 파서(`log_audit_tool.py`) 완성됨(2026-09-10) — 이제 4개 저장소(2026-09-10 기준 MySQL `chat_messages` 52건·`audit-logs/audit_log.jsonl` 20건·SQLite `chatbot_logs.db` 46건·MySQL `audit_log` 63건, 계속 늘어나는 중) 전체를 복호화해서 볼 수 있음. **다만 실제로 마스킹 안 된 PII가 있는지 자동 판별·리포트하는 2·3단계는 아직 안 함** — 우선순위 판단을 위해 수동으로 몇 건 훑어보는 것도 여전히 가능/유효
