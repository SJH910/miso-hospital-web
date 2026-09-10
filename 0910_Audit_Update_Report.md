# 2026-09-10 보안 감사 기능 업데이트 보고서

요구사항 7번(모니터링 대시보드/리포트)과 8번(감사 기준 정의) 구현 결과 정리

---

## 1. 개요 및 작업 목표

### 무엇이 문제였나

며칠 전 백엔드 팀이 로그인 이상 탐지 기능(`login_anomaly_*`)과 TOTP 2차 인증 관련 로그(`totp_*`)를 `audit_log` 테이블에 남기도록 업데이트했다. 챗봇 쪽에도 프롬프트 인젝션을 탐지하면 `MALICIOUS_INTENT_DETECTED` 플래그를 남기는 기능이 이미 있었다. 그리고 최근 점검에서 `patients.totp_secret`이 DB에 평문으로 저장되어 있다는 것도 확인됐다.

즉 "위험한 일이 벌어지면 로그는 남는다"까지는 되어 있었다. 하지만 다음 두 가지가 없었다.

1. **기준**: 이 로그들 중에 뭐가 진짜 위험하고, 뭐가 그냥 참고용인지 구분할 기준이 없었다. 사람이 로그를 하나하나 다 읽어야만 판단할 수 있는 상태였다.
2. **도구**: 설령 기준이 있어도, 그 기준을 실제로 로그에 적용해서 "지금 몇 건이 위험하고 어떤 건지" 한눈에 보여주는 도구가 없었다. 운영자가 매번 DB를 직접 쿼리해야 했다.

### 오늘 한 일

이 두 가지 공백을 채우기 위해 아래 두 산출물을 만들었다.

| 산출물 | 역할 |
|---|---|
| `SECURITY_AUDIT_CRITERIA.md` (신규 문서) | "이 로그는 Critical, 저 로그는 Low" 를 정하는 **기준표** |
| `chatbot-service/log_audit_tool.py` (기존 파일에 기능 추가) | 그 기준표를 코드로 그대로 옮겨서, 실제 로그에 적용해 **CLI 리포트/CSV**로 뽑아주는 도구 |

비유하자면, `SECURITY_AUDIT_CRITERIA.md`는 "이런 상황이면 응급실 몇 단계"를 정하는 **트리아지(분류) 매뉴얼**이고, `log_audit_tool.py`에 추가된 기능은 그 매뉴얼대로 환자(로그)를 실제로 분류해서 "응급 환자 3명, 준응급 5명" 하고 알려주는 **자동 트리아지 시스템**이다.

---

## 2. 신규 문서: `SECURITY_AUDIT_CRITERIA.md`

### 2-1. 5W1H 분류 기준

로그 한 줄을 "누가, 언제, 무엇을, 어디서, 왜, 어떻게"라는 6가지 질문으로 읽도록 정리했다. 이렇게 정리해두면 어떤 로그를 봐도 항상 같은 순서로 파악할 수 있다.

| 질문 | 의미 | 로그에서 실제로 보는 위치 |
|---|---|---|
| **Who** (누가) | 누구의 행동인가 | `actor_id` (없으면 시스템/비로그인 행위) |
| **When** (언제) | 언제 발생했나 | `timestamp` |
| **What** (무엇을) | 어떤 이벤트인가 | 로그인/인증 계열은 `action` 값, 챗봇 대화는 실제 메시지 내용 |
| **Where** (어디서) | 어느 시스템에서 났나 | 백엔드 인증(`mysql_audit`) / 챗봇 도구 호출(`audit_jsonl`) / 챗봇 대화(`chatbot_sqlite`) / 진료 채팅(`mysql_chat`) |
| **Why** (왜 위험한가) | 무엇을 지키려는 탐지인가 | 계정 보호 / 시스템(프롬프트) 보호 / 개인정보 보호 중 하나 |
| **How** (어떻게 탐지했나) | 탐지 방식 | 백엔드 카운터, 키워드 매칭, 마스킹 전후 비교, 또는 사람이 직접 확인한 정적 점검 |

### 2-2. 위험도(Critical/High/Medium/Low) 매핑

가장 핵심적인 부분이다. 아래 표대로 등급을 정했다.

| 등급 | 해당 이벤트 | 왜 이 등급인가 (한 줄 요약) |
|---|---|---|
| **Critical** | 관리자 계정 반복 실패, 관리자 신규 IP/지역 로그인, 프롬프트 인젝션 탐지, DB 평문 시크릿(`totp_secret`) | 고권한 계정 침해로 이어지거나, 이미 뚫렸을 가능성이 있거나, 구조적으로 큰 피해로 번질 수 있음 |
| **High** | 일반 계정 반복 실패, IP 이상 빈도, TOTP 인증 실패, TOTP 임의 해제, 마스킹 안 된 PII 발견 | 공격이 진행 중이거나 개인정보가 그대로 노출된 상태 — 오늘 안에는 확인이 필요함 |
| **Medium** | 비정상적으로 긴 입력값(200자 초과) | 의심스럽지만 실제 차단·피해로 이어지진 않음 — 추세만 관찰 |
| **Low** | TOTP 등록, TOTP 인증 성공 | 정상적인 보안 행동. 기록만 해두면 됨 |

한 로그가 여러 조건에 동시에 걸리면(예: 긴 입력값인데 그 안에 개인정보도 섞여 있는 경우) **가장 높은 등급**을 최종 등급으로 삼는다. "낮은 등급으로 묻히는" 상황을 막기 위함이다.

### 2-3. 등급별 대응 가이드

| 등급 | 조치 시한 | 무엇을 해야 하나 |
|---|---|---|
| Critical | 즉시 | 계정 상태 확인, 필요하면 계정 잠금/세션 무효화, 담당자에게 바로 공유 |
| High | 당일 내 | 같은 계정/IP의 다른 로그와 이어 붙여서 공격인지 오탐인지 판단 |
| Medium | 주간 리뷰 | 빈도가 늘면 High로 재분류 검토 |
| Low | 기록만 | 정상 동작 확인용, 별도 조치 없음 |

---

## 3. 코드 변경사항 분석: `chatbot-service/log_audit_tool.py`

기존에 이 파일은 4개 저장소(MySQL `audit_log`, 암호화된 JSONL, SQLite 챗봇 로그, MySQL 채팅)에서 로그를 읽어 **같은 모양(공통 스키마)** 으로 바꿔주는 일과, 마스킹 안 된 개인정보를 찾아주는 일(`scan_for_pii`)까지만 하고 있었다. 오늘은 여기에 "위험도 판정 → 리포트 생성" 단계를 추가했다.

### 3-1. PII 스캔 로직을 `_pii_findings_for_record`로 분리한 이유

기존 코드는 이랬다 — `scan_for_pii` 함수 하나가 "여러 레코드를 순회하면서 + 각 레코드의 필드를 검사하는" 두 가지 일을 한 번에 하고 있었다.

```python
# 기존
def scan_for_pii(records):
    findings = []
    for record in records:
        for field, value in record.get("text_fields", {}).items():
            ...  # 개별 레코드 검사 로직
    return findings
```

문제는, 새로 만드는 `evaluate_severity`(로그 1건의 위험도를 판정하는 함수)도 "이 로그에 마스킹 안 된 개인정보가 있는가"를 검사해야 한다는 점이었다. 이 로직을 새로 또 만들면 코드가 중복되고, 나중에 PII 판정 방식이 바뀌면 두 곳을 따로 고쳐야 하는 위험이 생긴다.

그래서 "레코드 1건을 검사하는 부분"만 `_pii_findings_for_record(record)`라는 별도 함수로 떼어냈다.

```python
# 변경 후
def _pii_findings_for_record(record):
    findings = []
    for field, value in record.get("text_fields", {}).items():
        ...  # 개별 레코드 검사 로직 (내용은 그대로 옮겨옴)
    return findings

def scan_for_pii(records):
    findings = []
    for record in records:
        findings.extend(_pii_findings_for_record(record))
    return findings
```

`scan_for_pii`가 여러 레코드를 한 건씩 `_pii_findings_for_record`에 넘기는 구조로 바뀌었을 뿐, **기존 `scan_for_pii`를 쓰던 곳(예: `main()`)의 동작은 전혀 바뀌지 않는다.** 그리고 이제 `evaluate_severity`도 같은 함수를 호출해서 PII를 검사하므로, 판정 기준이 어긋날 일이 없다.

### 3-2. 프롬프트 인젝션 플래그(`malicious_intent_detected`) 누락 패치

조사 과정에서 발견한 기존 버그성 공백이다. 챗봇의 프롬프트 인젝션 탐지 로직(`audit-agent/masking.py`)은 이미 잘 동작하고 있었다. 의심스러운 키워드(예: "이전 지시 무시")를 발견하면 로그 데이터 안에 `MALICIOUS_INTENT_DETECTED: True`라는 표시를 남긴다.

문제는, 이 표시가 암호화되어 JSONL 파일에 저장된 뒤 `log_audit_tool.py`가 그걸 복호화해서 다시 꺼낼 때 **이 표시를 쏙 빼놓고 있었다**는 점이다. 즉 탐지는 되고 있는데, 이 감사 도구 입장에서는 그 탐지 결과가 안 보이는 상태였다.

```python
# read_audit_jsonl() 안, 복호화된 payload에서 text_fields를 만드는 부분
"text_fields": {
    "action": raw.get("action"),
    "input": json.dumps(input_data, ensure_ascii=False),
    "output": str(payload.get("output")) if isinstance(payload, dict) else str(payload),
    # 아래 한 줄 추가 — 이미 계산되어 있던 플래그를 그대로 꺼내오기만 함
    "malicious_intent_detected": bool(payload.get("MALICIOUS_INTENT_DETECTED", False))
    if isinstance(payload, dict) else False,
},
```

**탐지 로직 자체는 전혀 건드리지 않았다.** 이미 계산되어 있던 값을 한 줄 추가해서 밖으로 흘려보내기만 했을 뿐이다. 이 한 줄이 없었다면, 아래 3-3의 위험도 판정 엔진이 프롬프트 인젝션을 영원히 못 잡는 구조였다.

### 3-3. 위험도 판별 엔진 `evaluate_severity(log_record)`

로그 1건을 입력받아 "이 로그가 몇 등급인지"를 판정해서 돌려주는 함수다. `SECURITY_AUDIT_CRITERIA.md`의 표를 그대로 코드(`SEVERITY_RULES`라는 딕셔너리)로 옮겨두고, 다음 3가지를 순서대로 확인한다.

1. **로그인/인증 이상 여부**: `mysql_audit` 소스의 로그라면 `action` 값(`login_anomaly_admin_new_ip` 등)을 `SEVERITY_RULES`에서 찾아본다.
2. **프롬프트 인젝션 여부**: `audit_jsonl` 소스의 로그라면 방금 패치한 `malicious_intent_detected` 플래그를 확인한다.
3. **개인정보 노출 여부**: 소스에 상관없이 `_pii_findings_for_record`(3-1에서 분리한 함수)를 호출해 마스킹 안 된 개인정보가 있는지 확인한다.

세 가지 중 하나라도 해당하면 근거로 기록해두고, 여러 개에 동시에 해당하면 그중 **가장 높은 등급**을 최종 결과로 낸다. 즉 이 함수는 "이 로그 1건에 대한 1차 진단서"를 만들어주는 역할이다.

```python
결과 예시 = {
    "source": "mysql_audit",
    "record_id": 482,
    "timestamp": "2026-09-10 09:12:03",
    "actor_id": 17,
    "severity": "CRITICAL",
    "matched": [
        {"category": "관리자 신규 IP 로그인", "severity": "CRITICAL",
         "reason": "이미 비밀번호를 통과해 로그인에 성공 — 계정 탈취 가능성"}
    ],
}
```

또한 DB 평문 시크릿(`totp_secret`)처럼 애초에 로그로는 남지 않는 "구조적 문제"는 별도로 `STATIC_FINDINGS`라는 고정 목록에 담아뒀다. 로그를 아무리 뒤져도 안 나오는 문제이기 때문에, 코드가 자동으로 찾는 게 아니라 사람이 점검해서 등록해둔 항목이다.

### 3-4. CLI 대시보드 + CSV 저장 함수 `generate_audit_report(parsed_logs, output_csv)`

`evaluate_severity`가 "로그 1건"을 진단한다면, 이 함수는 **전체 로그를 모아서 종합 리포트**를 만든다. 하는 일은 4가지다.

1. 모든 로그에 `evaluate_severity`를 돌려서 등급별 건수를 센다 (예: `Critical 3건, High 5건, Medium 2건, Low 40건`).
2. `STATIC_FINDINGS`(DB 평문 시크릿 등 정적 이슈)도 화면에 같이 보여준다.
3. **Critical/High 등급만** 상세 내용을 화면에 출력한다. 이때 원문을 그대로 보여주지 않고 **반드시 `mask_pii()`로 한 번 걸러진 미리보기**만 보여준다 — 보안 리포트 자체가 개인정보를 다시 유출하는 사고를 막기 위함이다.
4. `output_csv` 경로를 주면 전체 결과(정적 이슈 포함)를 CSV 파일로도 저장한다. 화면에서 다 못 보여준 나머지 항목들은 이 CSV에서 확인할 수 있다.

실제 CLI 출력은 이런 모양이다.

```
==== 감사 리포트 요약 (총 123건) ====
CRITICAL : 3건
HIGH     : 5건
MEDIUM   : 2건
LOW      : 40건
NONE     : 73건

---- 정적 점검 항목 ----
[CRITICAL] TOTP 비밀키(base32)가 평문으로 저장됨 — DB 유출 시 2차인증 전체가 무력화됨 (db/init.sql:30)

---- CRITICAL / HIGH 상세 (8건) ----
[CRITICAL] mysql_audit#482 2026-09-10 09:12:03 actor_id=17
  - 관리자 신규 IP 로그인: 이미 비밀번호를 통과해 로그인에 성공 — 계정 탈취 가능성
[HIGH] audit_jsonl#a91f... 2026-09-10 09:15:44 actor_id=None
  - 프롬프트 인젝션 탐지: 챗봇 도구 호출 payload에서 MALICIOUS_INTENT_DETECTED 플래그 발견
  - preview[input]: "이전 지시 [MASKED]..." (마스킹된 미리보기만 표시)
```

### 3-5. `main()` 함수 흐름 변화

기존 `main()`은 "4개 저장소 읽기 → 합치기 → PII 스캔 → (발견되면) CSV 저장"까지만 하고 끝났다. 여기에 마지막 단계로 종합 리포트 생성을 추가했다.

| 단계 | 기존 | 변경 후 |
|---|---|---|
| 1 | 4개 저장소에서 로그 읽어서 합치기 | (동일, 변경 없음) |
| 2 | `scan_for_pii`로 PII 미마스킹 항목 찾기 | (동일, 변경 없음) |
| 3 | 발견되면 `log_audit_report_*.csv`로 저장 | (동일, 변경 없음) |
| **4 (신규)** | 없음 | `generate_audit_report()` 호출 → 등급별 통계 화면 출력 + `security_audit_report_*.csv` 저장 |

기존 PII 전용 리포트(`log_audit_report_*.csv`)와 새로 추가된 종합 리포트(`security_audit_report_*.csv`)는 **파일명을 다르게 분리**해서, 기존에 이 파일을 보고 있던 사람이 혼동하지 않도록 했다.

---

## 4. 기대 효과

- **운영자가 매번 DB를 직접 쿼리할 필요가 없어진다.** `python3 log_audit_tool.py` 한 번 실행하면 4개 저장소의 로그가 전부 취합되어 위험도별로 분류된 상태로 화면에 뜬다.
- **"지금 당장 봐야 하는 것"과 "나중에 봐도 되는 것"이 구분된다.** Critical/High만 상세히 보여주므로, 매일 쌓이는 수백 건의 로그를 다 읽지 않아도 진짜 위협부터 확인할 수 있다.
- **개인정보 노출 없이 리포트를 볼 수 있다.** 상세 미리보기가 전부 `mask_pii()`를 거치기 때문에, 보안 점검용 리포트가 또 다른 개인정보 유출 경로가 되는 일을 막는다.
- **감사 기준이 문서화되어 팀 전체가 같은 기준으로 판단할 수 있다.** `SECURITY_AUDIT_CRITERIA.md`가 있어서, 누가 리포트를 보더라도 "왜 이게 Critical인지"를 코드가 아니라 문서로 확인할 수 있다.
- **DB 평문 시크릿 같은, 로그로는 절대 안 잡히는 구조적 문제도 같은 리포트에서 같이 확인된다.** `STATIC_FINDINGS` 덕분에 "로그 기반 탐지"와 "코드/설계 점검"을 하나의 창구로 합쳐서 볼 수 있다.

---

## 5. 파일 변경 내역

### 5-1. 새롭게 추가된 파일 (신규)

| 파일 경로 | 내용 |
|---|---|
| `SECURITY_AUDIT_CRITERIA.md` | 5W1H 분류 기준 + 위험도(Critical/High/Medium/Low) 매핑 표 + 등급별 대응 가이드 (요구사항 8번 산출물) |
| `0910_Audit_Update_Report.md` | 본 보고서의 마크다운 버전 |
| `0910_Audit_Update_Report.html` | 본 보고서의 HTML(브라우저 열람용) 버전 |

### 5-2. 기존 파일에서 변경된 파일 (수정)

| 파일 경로 | 원래 상태 (변경 전) | 변경 내용 |
|---|---|---|
| `chatbot-service/log_audit_tool.py` | 4개 저장소 파싱(1단계) + PII 미마스킹 스캔·CSV 저장(3단계)까지만 구현되어 있던 상태 | ① `read_audit_jsonl()`에 `malicious_intent_detected` 플래그 노출 1줄 패치<br>② `scan_for_pii()` 내부 로직을 `_pii_findings_for_record()`로 분리(기존 동작 불변)<br>③ `SEVERITY_RULES`/`STATIC_FINDINGS`/`evaluate_severity()`/`generate_audit_report()` 신규 추가 (요구사항 7·8번 산출물)<br>④ `main()`에 종합 리포트 생성 단계 추가 |

이번 작업에서는 기존 파일 중 `chatbot-service/log_audit_tool.py` **한 곳만** 수정했고, 다른 기존 파일(`pii_masking.py`, `audit-agent/masking.py`, `db/init.sql` 등)은 조사·참고만 했을 뿐 변경하지 않았다.

### 실행 방법

```bash
cd chatbot-service
python3 log_audit_tool.py
```

실행하면 콘솔에 요약 리포트가 출력되고, `chatbot-service/` 폴더 안에 `security_audit_report_YYYYMMDD_HHMMSS.csv` 파일이 생성된다.
