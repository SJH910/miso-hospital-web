# 감사 기준 정의 (5W1H + 위험도 매핑)

로그를 "누가, 언제, 무엇을, 어떻게 했는지"로 분류하고, 그 각각에 위험도(Critical/High/Medium/Low)를 매겨 운영자가 무엇부터 봐야 할지 판단할 수 있게 하는 기준 문서다.

> **2026-09-10 개정**: 팀원이 만든 `was/risk-classification.js`/`chatbot-service/audit-agent/risk_classification.py`(로그 **기록 시점**에 상/중/하 3단계로 분류해 `audit_log.risk_level` 컬럼·JSONL 평문 필드에 저장)와 이 문서의 4단계 체계를 병합했다. **등급 판정 자체(무엇을 상/중/하로 볼지)는 저 두 파일이 유일한 기준(source of truth)이다.** 이 문서와 `chatbot-service/log_audit_tool.py`는 그 값을 다시 계산하지 않고 그대로 읽어서, 4단계로 옮겨 쓰고 CLI/CSV로 보여주기만 한다 — 등급이 바뀌면 저 두 파일만 고치면 여기까지 자동으로 반영된다.

## 1. 5W1H 분류 기준

공통 스키마(`chatbot-service/log_audit_tool.py`의 4개 리더가 반환하는 레코드)를 다음 축으로 읽는다.

| 축 | 의미 | 공통 스키마상 위치 |
|---|---|---|
| **Who** (누가) | 행위 주체 | `actor_id` (없으면 `None` — 비로그인/시스템 행위 또는 파싱 한계) |
| **When** (언제) | 발생 시각 | `timestamp` |
| **What** (무엇을) | 어떤 행위/이벤트 | `mysql_audit`·`audit_jsonl`은 `text_fields["action"]`, 그 외 소스는 메시지 내용 자체(`original`/`content` 등) |
| **Where** (어디서) | 어느 시스템/저장소에서 발생 | `source` (`mysql_audit`=백엔드 인증/관리 이벤트, `audit_jsonl`=챗봇 도구 호출, `chatbot_sqlite`=챗봇 대화, `mysql_chat`=진료 채팅) — IP/지역은 `mysql_audit`의 `text_fields["detail"]` JSON 안에 있을 때만 확인 가능 |
| **Why** (왜 탐지 대상인가) | 보호하려는 대상 | 계정 보호(로그인 이상), 시스템 보호(프롬프트 인젝션), 데이터 보호(PII/시크릿 노출) 중 하나로 분류 |
| **How** (어떻게 탐지했는가) | 탐지 메커니즘 | **기록 시점**: `was/risk-classification.js`/`risk_classification.py`가 action 기준으로 상/중/하 분류(로그인·TOTP·챗봇 도구 호출). **조회 시점**: 이 도구가 그 값을 읽어 4단계로 재표시 + 문자열 비교(`pii_masking.mask_pii()` 전/후 비교) + 정적 코드·스키마 점검(수동) |

## 2. 위험도 매핑 표

레코드의 `risk_level`(팀원 쪽이 기록 시점에 저장한 low/medium/high)을 기본 등급으로 삼고, 관리자 계정 침해 정황 3종만 한 단계 더 높여 **Critical로 승격**한다. PII 미마스킹·DB 평문 시크릿은 `risk_level` 체계에 없는 이 도구만의 별도 발견이라 등급 집계에 섞지 않고 분리해서 다룬다(3번 표 참고).

| 카테고리 | 이벤트/조건 | `risk_level` (기록 시점, 팀원 코드) | 최종 등급 (조회 시점, 4단계) | 근거 |
|---|---|---|---|---|
| 관리자 계정 반복 실패 | `login_anomaly_admin_repeated_failure` | high | **Critical** (승격) | 고권한 계정이 집중 공격받는 중 (5분 내 3회) — 이미 성공/침해 정황 수준이라 한 단계 더 높임 |
| 관리자 신규 IP 로그인 | `login_anomaly_admin_new_ip` | high | **Critical** (승격) | 이미 비밀번호를 통과해 로그인에 **성공**한 이벤트 — 계정 탈취 가능성 |
| 관리자 신규 지역 로그인 | `login_anomaly_admin_new_location` | high | **Critical** (승격) | 위와 동일 + 지리적으로도 이상 |
| 프롬프트 인젝션 탐지 | 챗봇 도구 호출 시 악성 의도 탐지(`risk_classification.py`의 `MALICIOUS_OVERRIDE_LEVEL`) | high | **High** | action과 무관하게 무조건 최상위로 override됨 — 관리자 이벤트가 아니라 승격 대상은 아니지만 이미 자체적으로 최고 등급 |
| TOTP 인증 실패 | `totp_verify_fail` | high | **High** | 비밀번호는 이미 통과한 상태에서 2차인증 실패 — 계정 탈취 후 마지막 관문에서 막힌 정황(승격 없음, 아직 "성공한 침해"는 아님) |
| TOTP 해제 | `totp_disabled` | high (2026-09-10 15:51, 팀원이 low→high로 재분류) | **High** | 재인증 절차 없이 해제 가능 — 세션 탈취 시 공격자가 2차인증 자체를 제거할 수 있음 |
| 일반 계정 반복 실패 | `login_anomaly_repeated_failure` | medium | **Medium** | 5분 내 5회 실패 — 자동화 공격 가능성은 있으나 특정 고위험 계정으로 한정되지 않음(팀 기준 채택) |
| 이상 빈도 (IP) | `login_anomaly_high_frequency` | medium | **Medium** | 1분 내 10회 — 위와 동일 사유(팀 기준 채택) |
| 비정상적으로 긴 입력값 | `login_anomaly_long_input` | medium | **Medium** | 입력값 자체는 로그에 남지 않고 길이만 기록되며 별도 차단도 없음 — 추세 관찰 대상 |
| TOTP 등록 | `totp_enrolled` | low | **Low** | 관리자의 정상적인 보안 강화 행동 |
| TOTP 인증 성공 | `totp_verify_success` | low | **Low** | 정상적으로 완료된 2차 인증 |

### 별도 트랙 (risk_level에 없는, 이 도구 고유의 발견)

| 카테고리 | 조건 | 등급 | 근거 |
|---|---|---|---|
| PII 미마스킹 발견 | `scan_for_pii()` finding (마스킹 전/후 문자열이 다름 = 원본에 PII가 그대로 있었음). `known_exception=True`(mysql_audit의 `ip` 필드 등, 의도된 예외)는 실제 이슈에서 제외 | **High** | 개인정보가 로그/DB에 평문으로 남아있는 데이터 보호 실패 |
| DB 평문 시크릿 저장 (정적 점검) | `patients.totp_secret`이 평문(base32)으로 저장 (`db/init.sql`) | **Critical** | 2차 인증의 근간이 되는 비밀키. DB 유출 시 TOTP 보호 전체가 무력화되는 구조적 결함 |

## 3. 등급별 대응 가이드

| 등급 | 조치 시한 | 관제자/운영자 행동 |
|---|---|---|
| **Critical** | 즉시 | 해당 계정 상태 확인, 필요 시 계정 잠금·세션 무효화, 담당자(보안/개발 리드)에게 즉시 공유. DB 평문 시크릿 같은 구조적 결함은 별도 개선 작업으로 티켓화 |
| **High** | 당일 내 | 관련 로그(같은 `actor_id`/IP)를 시계열로 이어서 확인, 공격 패턴인지 오탐인지 판단. PII 노출 건은 해당 필드의 마스킹 로직 적용 여부 재확인 |
| **Medium** | 주간 리뷰 | 빈도·추세 위주로 관찰. 특정 계정/IP에서 반복되면 팀 코드(`risk-classification.js`)의 등급 자체를 High로 올릴지 검토 |
| **Low** | 기록만 | 정상 동작 확인 용도. 별도 조치 불필요, 통계성 참고 자료로만 사용 |

## 4. 참고

- 등급 판정의 유일한 기준(source of truth)은 `was/risk-classification.js`/`chatbot-service/audit-agent/risk_classification.py`다. 등급을 바꾸려면 **이 문서가 아니라 저 두 파일을 먼저 고치고**, 이 문서는 그 결과를 옮겨 적는다.
- 위 매핑을 코드로 구현한 `_RISK_LEVEL_TO_SEVERITY`/`ADMIN_ANOMALY_ACTIONS`/`STATIC_FINDINGS`/`evaluate_severity()`/`generate_audit_report()`는 `chatbot-service/log_audit_tool.py` 하단에 있다
- `login_anomaly_*`/`totp_*` 이벤트의 상세 탐지 조건과 `detail` JSON 예시는 `ANOMALY_DETECTION.md` 참고
- `ADMIN_ANOMALY_ACTIONS`(Critical 승격 대상)나 별도 트랙(PII/정적 이슈)의 등급이 바뀌면 이 문서도 함께 갱신해야 한다 (자동 동기화 아님)
