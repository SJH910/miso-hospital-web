# 🏥 미소병원 최종 통합 보고서

세 프로젝트를 하나로 병합했습니다: `miso-hospital-feature-ocr`(팀 최신 백엔드, RBAC/예약/진료기록/OCR) + `Miso_chatbot-main`(실제 RAG 챗봇) + 기존 통합 작업물.

## 1. 베이스 선정

업로드하신 3개 zip 중 `miso-hospital-feature-ocr.zip`(이하 ocr1)을 최종 베이스로 삼았습니다.

| 후보 | 특징 | 채택 여부 |
|---|---|---|
| `miso-hospital-feature-ocr.zip` (ocr1) | RBAC, `reservations`/`medical_records`/`audit_log`/`accounts` 등 팀의 최신 백엔드 | ✅ 베이스로 채택 |
| `miso-hospital-feature-ocr_2.zip` (ocr2) | 제가 이전에 드린 버전. 챗봇 위젯은 있으나 위 신규 테이블/RBAC 없음 | 구버전으로 판단, 미채택 |
| `Miso_chatbot-main.zip` 내 사본 | 챗봇팀이 로컬에서 병합 시도한 흔적. `request_for_merge.md`에 "이 사본은 최신이 아니다"라고 챗봇팀이 직접 명시 | 스키마 참고용으로만 사용 |

## 2. 발견 및 수정한 불일치

챗봇팀이 남긴 `report_merge.md`/`request_for_merge.md`와 실제 ocr1 스키마를 대조한 결과, 그대로 병합하면 동작하지 않았을 지점들입니다.

### 2.1 존재하지 않는 테이블을 조회하던 문제
`tools_db.py`가 `appointments` 테이블(컬럼 `appointment_date`, status: `scheduled`/`completed`/`cancelled`)을 가정하고 있었으나, 실제 ocr1 스키마는 `reservations` 테이블(컬럼 `reserved_at`, status: `requested`/`confirmed`/`cancelled`)입니다. 테이블명·컬럼명·상태값 전부 실제 스키마에 맞춰 다시 작성했습니다.

### 2.2 도구가 실제로 호출되지 않던 문제 (가장 중요한 결함)
`hospital_agent.py`의 `choose_action()`은 "RAG 검색" 또는 "일반 답변" 두 갈래로만 분기했고, `tools_db.py`에 정의된 예약 생성/조회, 진료기록 조회 함수는 **어디에서도 호출되지 않는 죽은 코드**였습니다. 보고서(`report_merge.md`)에는 "3가지 신규 기능이 추가되었다"고 적혀 있었지만, 실제로는 연결이 안 되어 있던 상태입니다.

키워드 기반 라우팅을 추가하고 `patient_id`를 `run_agent()` → 각 도구까지 관통시켜 실제로 동작하게 만들었습니다.

```python
def choose_action(question: str) -> tuple[str, str]:
    if any(k in question for k in ["예약해줘", "예약 신청", ...]):
        return ("...", "book_appointment")
    if any(k in question for k in ["내 예약", "예약 확인", ...]):
        return ("...", "check_appointments")
    if any(k in question for k in ["진료기록", "진료 기록", ...]):
        return ("...", "check_medical_records")
    ...
```

### 2.3 죽은 링크
`check_medical_records()`는 `[진료 기록 바로가기](/records.html)`를 반환하는데, ocr1 베이스에는 `records.html` 자체가 없었습니다. 페이지를 복원했고, `medical_records`(의료진 작성 기록)와 `scanned_documents`(OCR 스캔 문서) **두 데이터 소스를 한 페이지에서** 보여주도록 구성했습니다 — 이름은 같은 "진료기록"이지만 실제로는 서로 다른 테이블입니다.

### 2.4 과도하게 열린 CORS
`app.py`의 `allow_origins=["*"]`는 이 프로젝트 전반의 CORS 하드닝 기준(WAS 오리진만 허용)과 어긋나서, WAS 오리진만 허용하도록 좁혔습니다.

### 2.5 선택적 의존성이 필수 의존성처럼 동작하던 문제
`pii_masking.py`가 최상위에서 `import spacy`를 하는데, `spacy.load()` 실패(`OSError`)만 잡고 `import` 자체의 실패(`ModuleNotFoundError`)는 잡지 않아서, `spacy` 미설치 환경에서는 모듈 로드 자체가 죽는 구조였습니다. `import` 문 자체를 `try/except ImportError`로 감싸, 없으면 정규식 마스킹만 동작(NER 마스킹은 생략)하도록 방어적으로 고쳤습니다.

### 2.6 실행 스크립트 오류
`start.sh`가 `uvicorn main:app`을 실행하도록 되어 있었는데, 실제 진입점은 `app.py`(`app:app`)입니다. 또한 `tools_db.py`가 WAS와 같은 MySQL에 접속해야 하는데 `start.sh`가 DB 접속 정보를 넘겨주지 않고 있어서, `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME`/`WAS_ORIGIN`을 `config.js`의 기본값과 동일하게 전달하도록 고쳤습니다.

---

## 3. 데이터 흐름 (최종)

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

## 4. 실행 방법

```bash
mysql -u root < db/init.sql
cd was && npm install && node seed.js && cd ..
pip install -r chatbot-service/requirements.txt --break-system-packages
chmod +x start.sh stop.sh
bash start.sh
```

`GEMINI_API_KEY` 환경변수가 없어도 동작합니다 (RAG 검색 결과를 그대로 안내하는 규칙 기반 폴백). 예약 생성은 `YYYY-MM-DD HH:MM`과 "OO과" 형식이 질문에 명확히 포함되어 있어야 정상 파싱됩니다 — 자연어 예약 파싱은 완벽하지 않으므로, 형식이 불명확하면 챗봇이 형식을 안내하는 메시지로 답합니다.

## 5. 검증

- 모든 JS(`chat.js`, `documents.js`, `crypto-utils.js`, `config.js`, `server.js`, `chat-widget.js`, `board.js`, `home.js`, `records.js`) `node --check` 통과
- 모든 Python(`app.py`, `hospital_agent.py`, `tools_db.py`, `pii_masking.py`) 문법 검사 통과
- HTML 태그 짝 확인 (`board.html`, `index.html`, `records.html`)
- `admin.html`에 챗봇 위젯이 노출되지 않음을 확인 (환자 전용 기능 분리 유지)

## 6. 이번 범위에서 다루지 않은 것 (알려진 갭)

- `was/routes/accounts.js`, `auditLog.js`, `reservations.js`(예약 관리)는 **API만 존재하고 프론트 화면이 없습니다.** 이번 요청은 챗봇 통합이 핵심이라 손대지 않았고, 백엔드 자체는 이미 RBAC까지 갖춰진 상태이니 프론트 페이지만 추가하면 됩니다.
- 챗봇의 자연어 예약 파싱은 정규식 기반이라 형식이 자유로운 문장은 처리하지 못합니다. 정교한 날짜/시간 파싱이 필요하면 별도 NLP 라이브러리 도입을 검토해야 합니다.
- `audit_decorator.py`는 포함은 했지만 현재 `app.py` 플로우에서 실제로 호출되지 않는 상태로 가져왔습니다(원본 RAG 데모의 잔재). 필요 시 `hospital_agent.py`의 도구 호출부에 데코레이터로 적용하는 추가 작업이 필요합니다.
