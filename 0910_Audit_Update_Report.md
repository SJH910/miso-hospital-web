# 2026-09-10 보안 감사 기능 업데이트 보고서

요구사항 7번(모니터링 대시보드/리포트)과 8번(감사 기준 정의) 구현 결과 정리 — **팀원의 위험도 분류 시스템과 병합한 최종본**

---

## 1. 개요 및 작업 목표

### 무엇이 문제였나

로그인 이상 탐지(`login_anomaly_*`)와 TOTP 2차 인증 로그(`totp_*`)가 `audit_log` 테이블에 남도록 되어 있었고, 챗봇 쪽에는 프롬프트 인젝션 탐지 시 `MALICIOUS_INTENT_DETECTED` 플래그가 있었다. 즉 "위험한 일이 벌어지면 로그는 남는다"까지는 되어 있었지만, 그 로그 중 뭐가 진짜 위험한지 구분할 **기준**과, 그 기준을 실제로 적용해서 보여주는 **도구**가 없었다.

### 작업 과정 (이번 라운드에서 중요했던 부분)

처음엔 감사 기준 문서와 위험도 판정 코드를 처음부터 새로 만들었다. 그런데 GitHub에 업로드하기 직전, **팀원(Sunjung Hwang)이 같은 날 이미 유사한 기능을 별도로 만들어뒀다는 사실을 발견했다** — `was/risk-classification.js`/`chatbot-service/audit-agent/risk_classification.py`로, 로그를 **기록하는 시점**에 상/중/하 3단계로 분류해서 `audit_log.risk_level` 컬럼과 JSONL 로그의 평문 필드에 바로 저장해두는 방식이었다.

그래서 무작정 업로드하지 않고 **두 방식을 항목별로 비교**했다. 대부분 등급 판단이 일치했고, `totp_disabled`(TOTP 해제) 하나만 정반대였는데(나: High, 팀원: low), 마침 팀원이 같은 이유로 직접 재검토해서 low → high로 고쳐줬다. 최종적으로 다음 원칙으로 **병합**했다.

- **저장 위치는 팀원 방식 그대로**: 위험도 판정 자체는 다시 계산하지 않고, 팀원 코드가 로그 기록 시점에 이미 계산해서 저장해둔 값(`risk_level`)을 그대로 읽는다.
- **출력은 이번에 만든 CLI/CSV 리포트 도구**로 한다.
- 이 둘 사이에 있던 "3단계 vs 4단계", "관리자 이벤트를 더 세분화할지" 같은 나머지 설계 차이는 방향을 제안하고 승인받아 확정했다.

### 오늘 만든 것

| 산출물 | 역할 |
|---|---|
| `SECURITY_AUDIT_CRITERIA.md` | 팀원의 `risk_level`(상/중/하)을 4단계(Critical/High/Medium/Low)로 옮기는 규칙 + 등급별 대응 가이드 |
| `chatbot-service/log_audit_tool.py`에 추가된 기능 | 그 규칙을 실제로 적용해 CLI 대시보드 + CSV로 뽑아주는 도구 |

---

## 2. `SECURITY_AUDIT_CRITERIA.md` — 최종 구조

### 2-1. 등급 판정의 유일한 기준(source of truth)이 바뀌었다

이 문서와 `log_audit_tool.py`는 **더 이상 위험도를 직접 계산하지 않는다.** `was/risk-classification.js`와 `chatbot-service/audit-agent/risk_classification.py`가 로그를 **쓰는 시점**에 이미 상/중/하로 분류해서 저장해둔 값을 그대로 읽어올 뿐이다. 등급 기준을 바꾸고 싶으면 이 문서가 아니라 저 두 파일을 먼저 고쳐야 하고, 그러면 이 리포트에도 자동으로 반영된다 — 등급 기준이 두 곳에서 따로 관리되며 어긋나는 사고를 막기 위함이다.

### 2-2. 5W1H 분류 기준

| 축 | 의미 | 실제 위치 |
|---|---|---|
| **Who** | 행위 주체 | `actor_id` |
| **When** | 발생 시각 | `timestamp` |
| **What** | 어떤 이벤트 | `text_fields["action"]` (로그인/TOTP/챗봇 도구 호출) |
| **Where** | 어느 시스템 | `source` (mysql_audit/audit_jsonl/chatbot_sqlite/mysql_chat) |
| **Why** | 보호 대상 | 계정 보호 / 시스템 보호 / 데이터 보호 |
| **How** | 탐지 방식 | **기록 시점**: 팀원의 `risk-classification.js`/`.py`가 action 기준으로 분류. **조회 시점**: 이 도구가 그 값을 읽어 4단계로 재표시 |

### 2-3. 위험도 매핑 표 (risk_level → 최종 4단계)

| 카테고리 | 이벤트 | `risk_level`(팀원 기록값) | 최종 등급 | 비고 |
|---|---|---|---|---|
| 관리자 계정 반복 실패 | `login_anomaly_admin_repeated_failure` | high | **Critical** (승격) | 고권한 계정 집중 공격 |
| 관리자 신규 IP 로그인 | `login_anomaly_admin_new_ip` | high | **Critical** (승격) | 이미 로그인 성공 — 탈취 가능성 |
| 관리자 신규 지역 로그인 | `login_anomaly_admin_new_location` | high | **Critical** (승격) | 위와 동일 + 지리적 이상 |
| 프롬프트 인젝션 탐지 | 챗봇 도구 호출 시 악성 의도 override | high | **High** | 이미 자체적으로 최고 등급 |
| TOTP 인증 실패 | `totp_verify_fail` | high | **High** | 2차인증 관문에서 막힌 정황 |
| TOTP 해제 | `totp_disabled` | high *(팀원이 이번에 low→high로 재분류)* | **High** | 2차인증 자체를 제거하는 조작 |
| 일반 계정 반복 실패 | `login_anomaly_repeated_failure` | medium | **Medium** *(팀원 값 채택)* | 특정 고위험 계정 한정 아님 |
| 이상 빈도(IP) | `login_anomaly_high_frequency` | medium | **Medium** *(팀원 값 채택)* | 위와 동일 사유 |
| 긴 입력값 | `login_anomaly_long_input` | medium | **Medium** | 길이만 기록, 별도 차단 없음 |
| TOTP 등록/인증 성공 | `totp_enrolled`/`totp_verify_success` | low | **Low** | 정상 흐름 |

**관리자 이상탐지 3종만 Critical로 한 단계 더 승격**하고 나머지는 팀원 값을 그대로 존중한다 — "이미 성공/진행 중인 침해 정황"과 "침해 가능성이 있는 정황"을 구분하기 위한 것이 승격 규칙의 유일한 역할이다.

### 2-4. 별도 트랙 — PII 미마스킹 / DB 평문 시크릿

`risk_level` 체계에는 없는, 이 도구만의 고유 발견이다. 등급 집계에 섞지 않고 리포트에서 별도 섹션으로 보여준다.

| 항목 | 등급 | 비고 |
|---|---|---|
| PII 미마스킹 발견 | High | `known_exception=True`(mysql_audit의 `ip` 필드 등, 의도된 예외)는 제외하고 집계 |
| DB 평문 시크릿(`totp_secret`) | Critical | 정적 코드/스키마 점검, 로그로는 안 잡힘 |

### 2-5. 등급별 대응 가이드

| 등급 | 조치 시한 | 행동 |
|---|---|---|
| Critical | 즉시 | 계정 잠금/세션 무효화 검토, 담당자 즉시 공유 |
| High | 당일 내 | 같은 계정/IP 로그를 이어 붙여 공격 여부 판단 |
| Medium | 주간 리뷰 | 빈도 늘면 팀원 코드의 등급 자체를 상향할지 검토 |
| Low | 기록만 | 별도 조치 불필요 |

---

## 3. `chatbot-service/log_audit_tool.py` — 최종 코드 변경 분석

### 3-1. 처음 접근 방식을 버린 이유

처음에는 `read_audit_jsonl()`이 프롬프트 인젝션 플래그를 직접 추출하고(`malicious_intent_detected`), `SEVERITY_RULES`라는 별도 딕셔너리로 위험도를 처음부터 다시 계산하는 방식으로 만들었다. 그런데 팀원의 `engine.py`를 보니, `risk_level`이라는 값을 **이미 암호화되지 않은 평문 필드로 JSONL에 남기도록 설계**해뒀고, 주석에 "복호화 없이도 등급으로 필터링/스캔 가능"이라고 의도까지 적어뒀다. 즉 처음 만든 방식은 팀원이 이미 만들어둔 걸 모르고 중복 재구현한 것이었다. 그래서 이 방식은 전부 버리고 `risk_level`을 읽어오는 방식으로 다시 만들었다.

### 3-2. 리더 함수들 — `risk_level`을 그대로 읽어오기만 함

```python
# read_mysql_audit_log(): SELECT에 risk_level 컬럼 추가
cur.execute(
    "SELECT id, actor_id, action, target_type, target_id, detail, risk_level, created_at "
    "FROM audit_log"
)
...
records.append({
    ...
    "risk_level": row["risk_level"],   # 팀원 코드가 기록 시점에 계산해둔 값, 재계산 안 함
    "text_fields": {...},
})
```

```python
# read_audit_jsonl(): raw(암호화 밖의 평문 부분)에서 risk_level을 바로 읽음
records.append({
    ...
    "risk_level": raw.get("risk_level"),  # 복호화 없이도 읽히는 평문 필드
    "text_fields": {...},
})
```

`read_chatbot_logs_db()`/`read_mysql_chat_messages()`는 애초에 `risk_level`을 기록하지 않는 저장소라 `None`으로 채워 스키마만 맞춰줬다.

### 3-3. 위험도 판별 엔진 `evaluate_severity(log_record)` — 재설계됨

더 이상 등급을 계산하지 않고, **읽어온 `risk_level`을 4단계로 옮기고 관리자 이상탐지 3종만 승격**시키는 아주 단순한 함수가 됐다.

```python
_RISK_LEVEL_TO_SEVERITY = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH"}

ADMIN_ANOMALY_ACTIONS = {
    "login_anomaly_admin_repeated_failure",
    "login_anomaly_admin_new_ip",
    "login_anomaly_admin_new_location",
}

def evaluate_severity(log_record):
    risk_level = log_record.get("risk_level")
    severity = _RISK_LEVEL_TO_SEVERITY.get(risk_level, "NONE")

    action = log_record.get("text_fields", {}).get("action")
    escalated = severity == "HIGH" and action in ADMIN_ANOMALY_ACTIONS
    if escalated:
        severity = "CRITICAL"

    return {"source": ..., "severity": severity, "escalated": escalated, ...}
```

### 3-4. PII 스캔은 팀원 코드를 그대로 재사용

팀원이 `scan_for_pii()`에 이미 만들어둔 `known_exception` 로직(mysql_audit의 `ip` 필드처럼 의도적으로 마스킹 안 하는 예외를 표시)은 **손대지 않고 그대로 재사용**한다. `generate_audit_report()`가 이 함수를 호출해서 결과를 가져다 쓸 뿐이다.

### 3-5. CLI 대시보드 — 3개 섹션으로 분리 출력

```
==== ① risk_level 기반 감사 리포트 요약 (총 123건) ====
CRITICAL : 3건
HIGH     : 6건
MEDIUM   : 12건
LOW      : 40건
NONE     : 62건

---- CRITICAL / HIGH 상세 (9건) ----
[CRITICAL] mysql_audit#482 ... action=login_anomaly_admin_new_ip [관리자 침해 정황으로 승격]
[HIGH] mysql_audit#490 ... action=totp_disabled

==== ② PII 미마스킹 스캔 (risk_level과 별도 트랙, 총 5건) ====
그중 3건은 known_exception=True — 실제 이슈 아님 (제외하고 표시)
[HIGH] mysql_chat#12 field=content preview=...

==== ③ 정적 점검 항목 (1건) ====
[CRITICAL] TOTP 비밀키(base32)가 평문으로 저장됨 (db/init.sql)
```

**①(risk_level 기반)과 ②·③(이 도구 고유 발견)을 등급 집계에서 분리**한 이유는, 팀원의 `risk_level` 체계와 이 도구의 자체 판단이 섞여서 "어느 쪽 기준으로 몇 건"인지 헷갈리는 걸 막기 위해서다. `output_csv`를 주면 `section` 컬럼(`risk_level`/`pii_scan`/`static`)으로 구분된 CSV도 저장된다.

### 3-6. 팀원 코드와의 관계 — 실제로 지워진 건 origin 대비 딱 2줄

병합 전/후 diff를 팀원의 최신 원격 코드와 직접 대조했다. **삭제된 건 SELECT문 1줄(컬럼 추가 위해 교체)과 `return` 문 1줄(반환값 추가)뿐**이고, 나머지 192줄은 전부 추가다. `scan_for_pii()`, `write_report()`, `KNOWN_EXCEPTION_SOURCES`, 콘솔의 `known_exception_count` 안내 문구 등 팀원이 작성한 코드는 전부 원본 그대로 남아있다.

---

## 4. 기대 효과

- **등급 기준이 한 곳(팀원의 `risk-classification.js`/`.py`)에서만 관리된다.** 이 리포트 도구는 그 값을 읽기만 하므로, 등급 기준이 코드베이스 안에서 두 갈래로 갈라져 어긋날 위험이 없다.
- **운영자는 `python3 log_audit_tool.py` 한 번으로 팀 전체의 위험도 판단 기준이 반영된 리포트를 본다** — 어느 팀원이 로그를 기록했는지와 무관하게 동일한 기준으로 집계된다.
- **PII 노출·DB 평문 시크릿처럼 `risk_level`에 없는 위험도 이 도구에서만 추가로 잡아낸다** — 팀원 체계를 대체하는 게 아니라 보완한다.
- **팀원 작업(known_exception, totp_disabled 재분류 등)을 하나도 훼손하지 않고 병합했다** — 실제 diff로 검증 완료.

---

## 5. 파일 변경 내역 & GitHub 업로드

### 5-1. 새롭게 추가된 파일

| 파일 경로 | 내용 |
|---|---|
| `SECURITY_AUDIT_CRITERIA.md` | 5W1H 분류 + `risk_level`→4단계 매핑 + 대응 가이드 |
| `0910_Audit_Update_Report.md` | 본 보고서 (마크다운) |
| `0910_Audit_Update_Report.html` | 본 보고서 (HTML) |

### 5-2. 기존 파일에서 변경된 파일

| 파일 경로 | 변경 내용 |
|---|---|
| `chatbot-service/log_audit_tool.py` | `risk_level` 컬럼/필드를 읽어오도록 리더 함수 수정, `evaluate_severity()`/`generate_audit_report()` 추가(팀원 코드는 무변경) |

### 5-3. GitHub 업로드 완료

`https://github.com/yysong1249/miso-hospital` main 브랜치에 커밋 `f728365`로 푸시 완료 (`5d30966..f728365`). 업로드 전 팀원의 최신 커밋(`totp_disabled` 재분류, `app.py` 권한 수정 등)을 먼저 로컬에 반영한 뒤, 그 위에 이번 변경사항만 얹어서 올라갔다 — 팀원 작업을 덮어쓰지 않았다.

### 실행 방법

```bash
cd chatbot-service
python3 log_audit_tool.py
```
