# 병합 작업 리뷰 및 취약점/보안 분석 리포트

본 리포트는 2026-09-08에 수행된 `audit_decorator.py` 통합 작업 및 시스템 개선 사항을 팀원들과 공유하기 위해 작성되었습니다.

---

## 🚀 1. 오늘 작업 내용 및 결과 요약 (2026-09-08)

### 1-1. 주요 작업 내용 (Task Details)
* **감사 로그(Audit Log) 데코레이터 전면 적용:** 기존에 사용되지 않던 `audit_decorator.py`의 비동기 감사 로그 파이프라인을 챗봇의 모든 핵심 도구 함수(`tool_rag`, `tool_book_appointment` 등)에 일괄 적용했습니다.
* **타 작업자와의 코드 병합 (Merge):** 타 백엔드 팀원분이 업데이트한 "자연어 기반 휴무일 체크 및 예약 파싱 로직"을 유실 없이 보존하면서, 데코레이터 로직만 안전하게 덧붙이는 병합 작업을 완료했습니다.
* **서버 크래시(Crash) 취약점 디버깅:** 환경변수(`.env`) 또는 패키지 누락 시 챗봇 서버(FastAPI) 프로세스 자체가 강제로 죽어버리는 현상을 발견하고 이를 핫픽스(Hotfix)했습니다.
* **단종된 모델 404 에러 픽스:** 타 작업자분이 병합한 코드에 남아있던 구버전 모델(`gemini-2.5-flash`)로 인해 404 에러가 발생하는 문제를 디버깅하여 최신 모델로 변경했습니다.

### 1-2. 변경 사항 및 결과 (Changes & Results)
* **웹 서버 안정성 확보:** `require_gemini()` 내부의 하드코딩된 `sys.exit(1)`을 모두 제거하고, `raise ValueError` 및 `raise ImportError`로 교체하여 에러 발생 시 서버가 죽지 않고 HTTP 500 예외 처리가 가능해졌습니다.
* **모델 버전 최신화:** `3-1-llm.py`의 `CHAT_MODEL` 폴백을 `gemini-3.6-flash`로 갱신하여 챗봇 응답이 정상 작동합니다.
* **로깅 파이프라인 검증 완료:** 테스트 결과, 챗봇 동작 시 원본 페이로드가 PII 마스킹 ➡️ KMS 암호화 ➡️ 무결성 해시 체이닝을 거쳐 `audit-logs/audit_log.jsonl`에 에러 없이 비동기 기록되는 것을 확인했습니다.

### 1-3. 수정된 파일 목록 (Changed Files)
* `chatbot-service/hospital_agent.py`: 휴무일 파싱 로직 병합 및 `@audit_log` 데코레이터 전면 적용
* `chatbot-service/3-1-llm.py`: `sys.exit(1)` 제거(예외 처리 개선) 및 모델명 `gemini-3.6-flash`로 수정
* `chatbot-service/2-embeddings.py`: `sys.exit(1)` 제거 및 예외 처리(`raise ValueError`) 개선
* `README.md`: 작업 내역 및 신규 보안 강화 내역 문서화

---

## 🛡 2. 취약점 및 보완점 (Vulnerabilities & Improvements)

해당 작업을 진행하며 파악된 잠재적 취약점과 구조적 보완점입니다. 추후 스프린트에서 논의가 필요합니다.

### 2-1. 중복된 감사 로그(Audit Logging) 시스템의 파편화
현재 챗봇 서비스 내부에는 두 가지 서로 다른 감사 로그 파이프라인이 병존하고 있습니다.
* **`app.py` 내부 로깅:** SQLite DB (`chatbot_logs.db`)에 `secret.key`로 암호화하여 저장.
* **`audit_decorator.py` 로깅:** 외부 엔진을 통해 JSONL에 `.env` 키로 암호화하여 저장.
* **보완점:** 로깅 방식과 암호화 키가 파편화되어 있으므로, `app.py` 단의 SQLite 로깅을 제거하고 데코레이터 방식으로 일원화하는 것을 권장합니다.

### 2-2. 비동기 로그 저장 방식의 에러 사각지대
* `audit_decorator.py`는 메인 스레드 지연을 막기 위해 `ThreadPoolExecutor`를 통한 비동기 저장(Fire-and-forget)을 사용합니다.
* **취약점:** 백그라운드 스레드에서 파일 I/O 에러가 발생해도 메인 애플리케이션이 이를 감지하지 못해 로그가 유실될 수 있습니다.
* **보완점:** 재시도(Retry) 로직이나 Dead Letter Queue(DLQ) 도입 검토가 필요합니다.

### 2-3. Rate Limiting 기준점의 잠재적 우회 가능성
* `app.py`의 `slowapi` Rate Limit은 `get_remote_address` (IP 기반)를 사용합니다.
* **취약점:** Node(WAS)나 Nginx 같은 리버스 프록시를 거칠 경우, 모든 요청이 단일 IP로 식별되어 한 명의 악성 요청으로 전체 서비스가 차단(DoS)될 위험이 있습니다.
* **보완점:** `X-Forwarded-For` 헤더를 신뢰하도록 변경하거나, 클라이언트 세션 토큰 / `patient_id` 기반으로 Rate Limit을 관리해야 합니다.

### 2-4. 자연어 내 정규표현식 파싱 로직 (Regex) 안정성
* **취약점:** `hospital_agent.py`의 예약 일시 파싱 시 사용되는 정규식(`re.compile`)에 악의적으로 복잡한 문자열을 주입할 경우, 정규식 엔진 과부하로 인한 **ReDoS(Regular Expression Denial of Service)** 공격에 노출될 수 있습니다.

---

## 🛠 3. 임의로 수행한 작업 내용 (Unrequested Arbitrary Actions)

`plan.md`의 요구사항("도구 호출부에 데코레이터 적용") 이상으로, 시스템 안정성을 위해 자체적으로 판단하여 추가 반영한 내용입니다.

1. **도구별 식별자(Action Name) 명시적 할당 및 하위 Tool 함수 전면 전파:**
   * 메인 라우터(`run_agent`) 한 곳이 아닌, 내부의 개별 Tool 함수(`tool_rag`, `tool_book_appointment` 등) 선언부 전체에 데코레이터를 덧씌워 입출력 단위를 촘촘하게 감시망(Audit)에 넣었습니다.
   * 또한 단순히 일괄 적용하지 않고, 각 도구의 성격에 맞춰 명시적인 인자값을 부여하여 추후 JSONL 로그 분석 시 어떤 비즈니스 로직이 실행되었는지 한눈에 파악할 수 있도록 조치했습니다.
   
   **[적용 예시 - `chatbot-service/hospital_agent.py`]**
   ```python
   # 수정 전 (팀원 공용 코드)
   def tool_rag(question: str) -> str:
       return RAG.run_rag(question, top_k=2)
   
   def tool_book_appointment(question: str, patient_id: Optional[int]) -> str:
       ...
   
   # 수정 후 (임의로 추가 반영한 부분)
   from audit_decorator import audit_log
   
   @audit_log("rag")  # 식별자 명시 및 하위 툴 단위 촘촘한 적용
   def tool_rag(question: str) -> str:
       return RAG.run_rag(question, top_k=2)
   
   @audit_log("book_appointment")
   def tool_book_appointment(question: str, patient_id: Optional[int]) -> str:
       ...
   ```
