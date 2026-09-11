# RBAC 전환 계획

현재 "관리자 전용 OCR 기능"은 `patients.role`(ENUM: patient/admin) 컬럼 하나를 `requireAdmin` 미들웨어가 문자열로 비교하는 방식이다. 역할(Role)이라는 속성은 있지만 권한(Permission)이 역할과 분리되어 있지 않아, 엄밀히는 "역할 기반 접근 제어"보다 "역할 문자열 하드코딩 체크"에 가깝다. 이 문서는 이를 이름 그대로 RBAC이라 부를 수 있는 구조로 바꾸는 설계안이다.

**이 문서의 범위 (2026-09-04 확정)**:
- **프론트엔드는 이 문서/작업 범위 밖.** 이 문서에서 다루는 건 백엔드 API(`was/routes/*`)와 권한 스키마(`db/init.sql`)뿐이고, 그 위에 올라갈 화면(예약 관리, 답변 작성, 진료기록 조회, 감사 로그 조회, 환자 등록 UI 등)은 별도 담당자가 진행한다.
- **챗봇은 이 문서와 별개 트랙.** `Plan.md` 3번 항목("챗봇 입력 시 항상 PII 마스킹")으로 계획만 잡혀 있고 아직 미착수(코드 없음, `secure/miso-hospital-3tier/PROGRESS.md` 확인) — 다른 엔지니어가 구현해서 이후 이 프로젝트에 통합될 예정이다. 챗봇이 특정 역할 전용 기능(예: 환자만 사용 가능)이 되어야 한다면, 그때 이 문서의 패턴(권한 이름 하나 추가 + `requirePermission`)을 그대로 재사용하면 된다 — 지금 미리 권한을 만들어두지는 않는다(다른 항목들과 마찬가지로 "실제 라우트 없는 권한"을 만들지 않는다는 원칙).

## AS-IS

```
patients.role ('patient' | 'admin')
        │
        ▼
requireAdmin 미들웨어: req.session.role !== "admin" 이면 403
        │
        ▼
ocr.js / documents.js / patients.js 라우트에 직접 적용
```

문제점: 라우트가 "역할 이름"에 직접 결합되어 있음. 예를 들어 나중에 "간호사는 환자 목록 조회는 가능하지만 OCR 스캔은 불가"처럼 세분화하려면 미들웨어와 라우트 코드를 다시 짜야 한다. 역할과 권한이 1:1로 묶여 있어 확장이 안 된다.

## TO-BE

```sql
-- 역할
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(30) UNIQUE NOT NULL   -- 'patient', 'admin'
);

-- 권한 (역할이 아니라 "할 수 있는 행위" 단위)
CREATE TABLE permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL   -- 'ocr:scan', 'documents:create', ...
);

-- 역할 <-> 권한 매핑 (다대다)
CREATE TABLE role_permissions (
  role_id INT NOT NULL REFERENCES roles(id),
  permission_id INT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
```

라우트는 더 이상 `role === 'admin'`을 보지 않고, 자신에게 필요한 **권한 이름**만 선언한다.

```js
// requirePermission.js
function requirePermission(permissionName) {
  return async function (req, res, next) {
    if (!req.session.patientId) return res.status(401).json({ message: "로그인이 필요합니다." });
    const allowed = await hasPermission(req.session.role, permissionName); // roles/permissions/role_permissions 조인
    if (!allowed) return res.status(403).json({ message: "권한이 없습니다." });
    next();
  };
}

// ocr.js
router.post("/", requirePermission("ocr:scan"), ...);
// documents.js
router.post("/", requirePermission("documents:create"), ...);
router.get("/", requirePermission("documents:view"), ...);
// patients.js
router.get("/", requirePermission("patients:view"), ...);
```

역할-권한 매핑(`role_permissions`)은 서버 시작 시 한 번 메모리에 캐싱해 매 요청마다 DB를 조회하지 않는다 (역할/권한 구성은 자주 바뀌지 않으므로). 세션에는 지금처럼 `role` 이름만 저장.

## 역할별 권한 매핑 (최종)

| 권한 | `patient` | `admin` | 적용 라우트 |
|---|---|---|---|
| `board:read` | ✅ | ✅ | `GET /api/board`, `GET /api/board/:patientId` |
| `board:write` | ✅ | ✅ | `POST /api/board` |
| `ocr:scan` | ❌ | ✅ | `POST /api/ocr` |
| `documents:create` | ❌ | ✅ | `POST /api/documents` |
| `documents:view` | ❌ | ✅ | `GET /api/documents` |
| `patients:view` | ❌ | ✅ | `GET /api/patients` |

admin은 patient의 게시판 권한을 포함해 전체 권한을 가진다.

## 결정 사항 (확정)

- **적용 범위**: `miso-hospital-3tier-secure-ocr`(구 `-secure-master`, 2026-09-04에 폴더명 변경)에만 적용. 이 폴더가 본체(main copy)이며, 앞으로 모든 push는 `https://github.com/yysong1249/miso-hospital.git`로 간다. 기존 `origin`(`miso-hospital-ocr.git`)이나 취약점 실습용 원본 저장소(`miso-hospital-3tier`)는 건드리지 않는다 — 이 저장소는 변경하지 않음(기존 `requireAdmin` 유지).
- **권한 단위**: 세분화 — `ocr:scan`, `documents:create`, `documents:view`, `patients:view`, `board:read`, `board:write`.
- **역할 다중 보유**: 지원하지 않음. 계정당 역할 1개, `patients.role` 컬럼 유지.
- **RBAC 적용 범위는 "최대한 전부"**: 게시판(`board.js`)도 예외 없이 `requirePermission`으로 통일한다 (아래 "적용 결과" 참고). "이미 다 로그인한 사람만 쓰는 기능이라 권한 분리 실익이 적다"는 이유로 표(설계)와 실제 구현을 다르게 두지 않는다.

## 적용 결과

- `db/init.sql`: `roles`/`permissions`/`role_permissions` 테이블 추가, admin 역할에 위 4개 권한 매핑을 스키마와 함께 시딩 (bcrypt/AES처럼 앱 코드가 가공할 값이 없는 순수 참조 데이터라 seed.js가 아닌 SQL에서 직접 삽입)
- `was/middleware/requireAdmin.js` 삭제 → `was/middleware/requirePermission.js` 신규 (역할→권한 매핑을 메모리에 캐싱 후 조회)
- `was/routes/ocr.js`, `documents.js`, `patients.js`: `requireAdmin` → `requirePermission("<권한명>")`으로 교체
- `README.md`에 RBAC 섹션 추가
- curl로 admin 계정(4개 권한 모두 200) / patient1 계정(전부 403) 동작 검증 완료

## 결정해야 할 것 (미정)

- [ ] **역할 세분화 로드맵 여부** — AS-IS 섹션의 "간호사는 조회만 가능, 스캔은 불가" 같은 예시가 실제로 곧 필요한 요구사항인지, 아니면 설계 취지를 설명하기 위한 가상의 예시일 뿐인지 불명확. 실제로 role/permission을 추가할 계획이 있다면 `role_permissions` 매핑만 늘리면 되므로 코드 변경은 필요 없지만, 그 시점/우선순위는 아직 논의된 바 없음.

(아래 2개는 결정 완료 — "결정 사항(확정)"과 "역할별 권한 매핑" 표에 반영함: ① `board:read`/`board:write`도 표대로 실제 구현한다, ② 적용 범위는 `miso-hospital-3tier-secure-ocr` 본체 기준으로 확정, 앞으로 모든 push는 `https://github.com/yysong1249/miso-hospital.git`로.)

## board RBAC 적용 결과 (2026-09-04, 구현 완료)

위 결정에 따라 게시판에도 RBAC을 적용했다.

- `db/init.sql`: `permissions`에 `board:read`/`board:write` 추가, `role_permissions`에 `patient`·`admin` 둘 다에게 부여
- `was/routes/board.js`: `requirePermission` 도입
  - `GET /` → `requirePermission("board:read")`
  - `POST /` → 기존 `verifyCsrfToken` 뒤에 `requirePermission("board:write")` 추가 (순서는 `ocr.js`/`documents.js`와 동일)
  - `GET /:patientId` → `requirePermission("board:read")` 추가. 기존 IDOR 소유자 검증(`patientId` 일치 여부)은 `requirePermission`이 대신하는 부분이 아니므로 그대로 유지
  - 핸들러 안에 남아있던 수동 `if (!req.session.patientId)` 체크는 `requirePermission`이 동일하게 처리해서 중복이 되므로 제거
- 로컬 반영: `db/init.sql` 재실행 + `seed.js` 재시딩 + WAS 재시작(권한 매핑이 메모리 캐시라 재시작 필요) 완료
- **검증 완료**:
  - curl: 비로그인 `GET /api/board` → 401, 로그인 후 200
  - curl: CSRF 토큰 없이 `POST /api/board` → 403, 토큰 포함 시 200으로 정상 등록
  - curl: patient1 세션으로 다른 환자(id=2) 상세 조회 `GET /api/board/2` → 403(IDOR 차단 유지), 본인(id=1) 조회는 200
  - Playwright: `admin` 계정으로 로그인 → `board.html`에서 문의 작성/목록 반영까지 콘솔 에러 없이 정상 동작
- `feature/ocr`에 커밋 후 `git push` (`target` = `https://github.com/yysong1249/miso-hospital.git`)로 반영

---

## 신규 역할 제안 검토 — "RBAC만으로 끝나는 것"만 우선 설계

사용자가 제안한 역할 확장 후보(환자/원무·접수(staff)/관리자, 접근 범위: 예약·진료기록·게시판·계정관리·감사로그 등)를 검토한 결과, **이번에 실제로 설계·구현할 것은 "계정 관리(`accounts:manage`)" 하나뿐이다.**

- **게시판** — 이미 완료됨 (바로 위 섹션).
- **계정 관리** — 아래 "계정 관리(`accounts:manage`) 설계" 참고. 필요한 데이터(계정 목록, `role`)가 이미 `patients` 테이블에 있어서 새 스키마 없이 권한 게이트 + 라우트만 추가하면 됨 → **RBAC만으로 끝남.**
- **감사 로그 조회 — 정정.** 이전 답변에서 "RBAC만으로 끝나는 것"에 잘못 포함시켰었다. 실제로는 로그를 남기는 테이블/기록 메커니즘 자체가 지금 하나도 없어서, `audit:view` 권한만 만들어봐야 조회할 데이터가 없다. 이건 RBAC이 아니라 "감사 로그 기능"을 먼저 새로 만들어야 하는 항목이라 **이번 설계에서 제외**한다 (필요하면 별도로 설계 요청).
- **`staff`(원무/접수) 역할 자체는 이번에 추가하지 않음.** 표에 적힌 staff의 항목(환자 등록, 예약 관리, 진료기록 마스킹 열람, 문의 답변) 전부가 아직 없는 기능(예약 시스템, 진료기록 마스킹 로직, 게시글 답변 컬럼)에 걸려 있어서, `staff`에게 지금 당장 줄 수 있는 권한이 하나도 없다. 아무 권한도 없는 역할을 먼저 만들어두면 "이름만 있고 아무것도 못 하는 역할"이 되므로, 위 기능 중 하나라도 실제로 만들 때 그 권한과 함께 `staff` 역할을 추가하는 걸 권장.
- **예약, 진료기록(마스킹 열람), 문의 답변**은 전부 RBAC 이전에 기능/스키마 자체가 필요해서 이번 배치에서 제외.

## 계정 관리(`accounts:manage`) 설계

**권한**: `accounts:manage` 1개 신규 추가, `admin`에게만 부여.

**제안 API** (기존 `patients` 테이블만으로 구현 가능, 새 테이블 불필요):

| 메서드 | 경로 | 설명 | 미들웨어 |
|---|---|---|---|
| `GET` | `/api/accounts` | 전체 계정 목록 (`id`, `username`, `name`, `role`) 반환 | `requirePermission("accounts:manage")` |
| `PATCH` | `/api/accounts/:id/role` | 특정 계정의 `role` 변경 (`patient` ↔ `admin`, 추후 `staff` 추가 시 포함) | `verifyCsrfToken`, `requirePermission("accounts:manage")` |

**설계 시 가정 (범위가 명시되지 않아 최소 범위로 제안)**: "계정 관리"를 "계정 목록 조회 + 역할(role) 변경"으로 한정했다. 계정 비활성화/삭제/비밀번호 초기화 같은 기능까지 포함할지는 별도 확인 필요 — 필요하면 이 표에 행을 추가하는 방식으로 확장 가능(라우트 구조 자체는 동일 패턴 재사용).

**보안 고려사항**:
- `PATCH /:id/role`에서 **admin이 자기 자신의 role을 낮추는 것을 막아야 함** — 마지막 admin 계정이 실수로 스스로 강등되면 아무도 계정 관리를 못 하게 되는 상황 방지 (`req.params.id === req.session.patientId`이고 새 role이 `admin`이 아니면 400 처리).
- 응답에 `password`(bcrypt 해시)·`rrn`(암호화된 주민번호)은 포함하지 않음 (`documents.js`가 `extracted_text`를 안 내려주는 것과 같은 원칙).
- 상태 변경(`PATCH`)이므로 다른 POST/PATCH 라우트와 동일하게 `verifyCsrfToken` 적용.

**구현 순서 (제안, 아직 미착수)**:
1. `db/init.sql`: `permissions`에 `accounts:manage` 추가, `role_permissions`에 `admin`만 부여
2. `was/routes/accounts.js` 신규: 위 표의 2개 라우트 구현
3. `was/server.js`에 라우트 등록
4. (프론트) 관리자 전용 계정 관리 화면 — 이번 설계엔 API만 포함, 화면 설계는 별도 필요 여부 확인 후 진행

### 구현 완료 (2026-09-04)

위 설계 그대로 백엔드 API를 구현했다 (프론트 화면은 아직 없음 — 설계 4번 항목대로 API만).

- **수정한 파일**:
  - `db/init.sql` — `permissions`에 `accounts:manage` 추가, admin 권한 시딩 목록에 포함
  - `was/routes/accounts.js` (신규) — `GET /`(계정 목록), `PATCH /:id/role`(역할 변경) 구현. 자기 자신 강등 방지(`targetId === req.session.patientId && role !== "admin"` → 400), 허용된 role 값(`patient`/`admin`)만 통과, 응답에 `password`/`rrn` 미포함
  - `was/server.js` — `app.use("/api/accounts", accountsRoutes)` 등록
- **로컬 반영**: `db/init.sql` 재실행 + `seed.js` 재시딩 + WAS 재시작 완료
- **검증 완료 (curl)**:
  - admin 로그인 후 `GET /api/accounts` → 200, 계정 4개 목록에 `password`/`rrn` 없음 확인
  - admin이 자기 자신을 `patient`로 낮추려는 `PATCH /api/accounts/4/role` → 400 (자기 강등 방지 동작 확인)
  - `PATCH /api/accounts/1/role`로 patient1 → admin 승격 후 재조회로 반영 확인, 다시 patient로 원복
  - patient1 로그인 상태로 `GET /api/accounts` → 403 (권한 없음 정상 차단)
- `feature/ocr`에 커밋 후 `git push` (`target` = `https://github.com/yysong1249/miso-hospital.git`)로 반영

---

## 별도 로직이 필요한 것 (RBAC만으로는 불충분)

`requirePermission` 권한 게이트 하나로 끝나지 않고, 각각 스키마 변경·응답 가공·신규 라우트가 추가로 필요한 항목들이다. **아직 설계 확정 전 — "어떤 걸 실제로 만들지"가 정해지지 않아 API 스펙까지는 안 잡았고, 왜 RBAC만으로 부족한지와 무엇이 더 필요한지만 정리했다.** 실제로 만들기로 하면 그때 `계정 관리(accounts:manage) 설계`와 같은 수준으로 상세 설계.

| 항목 | 관련 역할 | RBAC만으로 부족한 이유 | 추가로 필요한 것 |
|---|---|---|---|
| 본인 진료기록/예약만 조회 | patient | 권한은 "볼 수 있다/없다"만 판단하고, "그중에서도 내 것만"이라는 소유자 필터링은 하지 않음 | 라우트 쿼리에 소유자 스코핑 추가 (`WHERE patient_id = 세션 사용자`) — `board.js`에 이미 있는 패턴 재사용 가능 |
| 진료기록 마스킹 열람(수정 불가) | staff | 같은 권한이라도 역할에 따라 응답에 포함되는 필드 자체가 달라야 함(마스킹) — RBAC은 허용/거부만 판단하고 필드 단위 가공은 하지 않음 | 역할별로 다른 SELECT/응답 가공 로직 필요. `documents.js`가 모든 역할에 `extracted_text`를 안 내려주는 것과 같은 원칙을 "역할별로 다르게" 분기해야 함 |
| 예약 생성/확정/변경 | patient, staff | 예약이라는 기능·데이터 자체가 지금 없음 | 새 테이블(예: `reservations`), 새 라우트 전체를 신규 구현한 뒤에야 그 위에 권한 게이트를 얹을 수 있음 |
| 문의 답변 | staff | 게시글에 답변을 다는 기능/컬럼이 없음 (`board_posts`는 `title`/`content`만 있고 답변자·답변내용 컬럼 없음) | `board_posts`에 답변 컬럼 추가(또는 별도 답변 테이블) + 답변 등록/조회 라우트 신규 |
| 감사 로그 기록·조회 | admin | 로그를 남기는 메커니즘 자체가 지금 없음 (이전 "계정 관리" 섹션에서 `audit:view`를 RBAC만으로 끝나는 것에서 제외한 것과 같은 이유) | 새 `audit_log` 테이블 + 로그인·계정 변경 등 민감 동작이 일어날 때마다 기록을 남기는 코드를 각 라우트에 추가한 뒤에야 조회 권한을 의미 있게 걸 수 있음 |
| 환자 등록(staff가 대신 등록) | staff | 지금 있는 건 본인 셀프 가입(`POST /api/signup`)뿐 — "직원이 다른 사람을 대신 등록"하는 라우트가 없음 | 신규 라우트 필요. 비밀번호 해시(bcrypt)·주민번호 암호화(AES) 로직은 `signup.js`에서 재사용 가능하지만, 호출 주체(로그인한 staff)와 입력값 검증 규칙이 셀프 가입과 다름 |
| 진료기록(의료 차트) 자체 | (전체) | "진료기록"이라는 개념이 지금 프로젝트에 아예 없음 — 있는 건 환자가 남기는 진료문의 게시판과 관리자 전용 OCR 스캔 문서뿐, 의사가 작성하는 실제 진료 차트는 없음 | 위 "마스킹 열람" 이전에 진료기록 스키마(누가 작성하고 누가 열람 가능한지 포함) 자체를 새로 설계해야 함 — RBAC-Plan 범위를 넘는 별도 기능 설계 |

**우선순위 관련 참고**: "진료기록 마스킹 열람"은 "진료기록(의료 차트) 자체"가 먼저 있어야 의미가 있다 — 즉 이 표의 마지막 두 항목은 순서상 종속 관계.

---

## 별도 로직 필요 기능 — 구현 계획

위 6개 항목(진료기록 자체까지 포함하면 7개)의 구현 계획. 서로 의존하는 순서가 있어서 **번호 순서대로 진행**하는 걸 권장한다. 아직 코드는 건드리지 않았고, 계획만 기재한다.

### 새로 필요한 권한 (전체 미리보기)

| 권한 | 대상 | 설명 |
|---|---|---|
| `reservations:create` | patient | 본인 예약 생성 |
| `reservations:view:own` | patient | 본인 예약만 조회 |
| `reservations:manage` | staff, admin | 전체 예약 조회/확정/취소 |
| `board:reply` | staff, admin | 문의 답변 등록 |
| `patients:register` | staff, admin | 환자 계정 대리 등록 (`accounts:manage`와 분리 — staff는 역할 변경까진 못 하고 등록만 가능) |
| `records:view:own` | patient | 본인 진료기록 조회 |
| `records:view:masked` | staff | 진료기록 마스킹 열람 |
| `records:view:full`, `records:write` | admin(잠정) | 진료기록 전체 열람/작성 |
| `audit:view` | admin | 감사 로그 조회 |

### 1단계 — 예약(reservation)

다른 항목에 의존하지 않는 독립 기능이라 가장 먼저 진행.

**스키마**:
```sql
CREATE TABLE reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    department VARCHAR(50) NOT NULL,       -- 진료과 (자유 입력 or 목록, 우선 자유 입력으로)
    reserved_at DATETIME NOT NULL,
    status ENUM('requested', 'confirmed', 'cancelled') NOT NULL DEFAULT 'requested',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
```

**API** (`was/routes/reservations.js` 신규):
| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `POST` | `/api/reservations` | `verifyCsrfToken`, `reservations:create` | 본인 명의로 예약 생성 (`patient_id`는 세션에서, body로 안 받음 — IDOR 방지) |
| `GET` | `/api/reservations` | `reservations:view:own` 또는 `reservations:manage` | patient는 `WHERE patient_id = 세션` 자동 필터, staff/admin은 전체 반환 (권한에 따라 쿼리 분기) |
| `PATCH` | `/api/reservations/:id/status` | `verifyCsrfToken`, `reservations:manage` | staff/admin이 확정(`confirmed`)/취소(`cancelled`)로 상태 변경 |

**patient의 소유자 스코핑**은 `board.js`의 `WHERE patient_id = ?` 패턴을 그대로 재사용.

### 2단계 — 문의 답변 (board 확장) — 구현 완료, 이후 이력 관리로 재설계됨(2026-09-10)

기존 `board_posts`를 확장하는 형태라 board RBAC 작업 위에 바로 이어서 진행 가능.

**최초 구현**: 아래 스키마(`board_posts.answer` 컬럼 하나 + `PATCH`로 덮어쓰기)로 실제 구현·적용됨.

```sql
ALTER TABLE board_posts
  ADD COLUMN answer TEXT NULL,
  ADD COLUMN answered_by INT NULL,
  ADD COLUMN answered_at TIMESTAMP NULL,
  ADD FOREIGN KEY (answered_by) REFERENCES patients(id);
```

- `PATCH /api/board/:id/answer` — `verifyCsrfToken`, `requirePermission("board:reply")`. body `{ answer }`을 sanitizeHtml로 정제 후 `UPDATE`로 저장.
- `GET /api/board`, `GET /api/board/:patientId` 응답에 `answer`/`answered_at` 포함.

**[재설계 2026-09-10] "문의 답변 수정/이력 관리" 항목 해결 — 답변은 수정 불가, 추가만 가능**: 위 방식은 `PATCH`(UPDATE)라 재답변할 때마다 이전 답변이 그대로 덮어써져 이력이 안 남는 문제가 report_merge_final.md에 계속 남아있었음. 결정: 답변 컬럼 하나를 재사용하는 대신 답변 전용 테이블 `board_answers(id, post_id, answered_by, answer, created_at)`로 분리하고, **UPDATE/DELETE를 아예 쓰지 않고 항상 INSERT만** 하도록 바꿔서 구조적으로 수정이 불가능하게 함(같은 문의에 여러 번 호출하면 답변이 계속 쌓임).

- 스키마: `board_posts`에서 `answer`/`answered_by`/`answered_at` 컬럼 제거, `board_answers` 테이블 신규(위 구조). 기존 답변 4건은 `board_answers`로 백필 후 컬럼 드롭(로컬 MySQL에서 직접 확인·적용, 유실 없음).
- API: `PATCH /api/board/:id/answer` → `POST /api/board/:id/answer`로 변경(항상 새 행 INSERT, 대상 문의 없으면 404). `GET /api/board`, `GET /api/board/:patientId` 응답은 `answer`/`answered_at` 단일 필드 대신 `answers`(해당 문의의 답변 전체, 오래된 순 배열 — 각 항목에 `answer`/`answered_by_name`/`created_at`) 필드로 변경.
- 프론트: `admin-board.js`(staff/admin 답변 화면) — 기존 "답변 수정" 버튼/로직 제거, 기존 답변들은 읽기 전용으로 나열하고 새 답변을 쓸 빈 textarea + "답변 등록/추가" 버튼만 제공. `board.js`(환자 목록 배지)·`view.js`(환자 상세)도 `answers` 배열 기준으로 수정.
- 검증: staff 계정으로 같은 문의에 답변을 두 번 연속 POST → 기존 답변(백필된 것 포함 총 3건)이 전부 순서대로 남아있음을 API 응답으로 확인. 존재하지 않는 문의 id로 POST → 404 확인. patient 계정으로 답변 POST 시도 → 403(권한 없음) 확인. 환자 본인 목록/상세 조회에서도 전체 이력이 동일하게 보임을 확인.

### 3단계 — 환자 등록 (staff 대리 등록)

`signup.js`의 검증/해시/암호화 로직을 재사용하는 형태라 상대적으로 가볍다.

**API** (`was/routes/patients.js`에 추가 또는 `accounts.js`에 통합 — 후자 권장, "계정 생성"이라는 결이 같음):
- `POST /api/accounts` — `verifyCsrfToken`, `requirePermission("patients:register")`. body는 `signup.js`와 동일(`username`, `password`, `name`, `rrn`) + `role`은 항상 `'patient'`로 고정(staff가 admin 계정을 만들 수는 없어야 함 — `accounts:manage`와 권한을 분리한 이유)
- 비밀번호 해시(bcrypt)·주민번호 암호화(AES)는 `was/routes/auth.js`의 로직을 공용 함수로 뽑아서 `signup`과 `accounts.js`가 같이 쓰도록 리팩터링 (중복 방지)

### 4단계 — 진료기록(의료 차트) 자체

**⚠️ 진행 전 확인 필요한 것**: 최종 3역할 표(환자/staff/admin)에는 "누가 진료기록을 작성하는가"가 없다. admin 행에 "진료 기록"이라고만 적혀있어 admin이 작성까지 겸하는 건지, 별도 의사 역할이 필요한 건지 불명확 — **이 질문에 대한 답이 있어야 스키마의 `written_by` 제약과 작성 권한을 확정할 수 있다.**

**스키마 (잠정, admin이 작성한다고 가정)**:
```sql
CREATE TABLE medical_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    written_by INT NOT NULL,        -- 작성자 (patients.id, admin 또는 향후 의사 역할)
    diagnosis TEXT NOT NULL,
    treatment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (written_by) REFERENCES patients(id)
);
```

**API** (`was/routes/records.js` 신규):
- `POST /api/records` — `verifyCsrfToken`, `records:write` (admin)
- `GET /api/records?patient_id=` — 권한별 분기: patient는 `records:view:own` + 본인 것만, staff는 `records:view:masked` + 5단계의 마스킹 처리, admin은 `records:view:full` + 전체 필드

### 5단계 — 진료기록 마스킹 열람 (4단계에 의존)

4단계 라우트의 응답 조립 부분에 역할 분기 추가:
```js
function maskRecord(record) {
  return { ...record, diagnosis: record.diagnosis.slice(0, 2) + "***", treatment: "***" };
}
// GET /api/records 핸들러 안에서:
const isStaff = req.session.role === "staff";
res.json(rows.map(r => isStaff ? maskRecord(r) : r));
```
정확히 어떤 필드를 얼마나 마스킹할지는 실제 진료기록 필드가 확정된 뒤 다시 논의.

### 6단계 — 감사 로그

가장 손이 많이 가는 항목(기존 라우트 여러 곳을 건드림)이라 마지막으로 진행. 처음부터 모든 동작을 다 기록하기보다, **로그인·계정 역할 변경처럼 민감도가 높은 동작부터 우선 기록**하고 점차 확장하는 걸 권장.

**스키마**:
```sql
CREATE TABLE audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,              -- 로그인 실패 등 행위자를 특정 못 하는 경우 NULL
    action VARCHAR(50) NOT NULL,    -- 'login_success', 'login_fail', 'account_role_change', ...
    target_type VARCHAR(50) NULL,   -- 'patients', 'board_posts' 등
    target_id INT NULL,
    detail JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES patients(id)
);
```

**공용 헬퍼** (`was/audit.js` 신규): `logAudit(actorId, action, targetType, targetId, detail)` — 각 라우트에서 호출.

**우선 기록 대상** (1차 범위):
- `auth.js`: 로그인 성공/실패
- `accounts.js`: `PATCH /:id/role` 역할 변경 (이전 role → 새 role을 `detail`에 기록)

**API**: `GET /api/audit-log` — `requirePermission("audit:view")`, 최신순 페이지네이션(`limit`/`offset`)

### 순서 요약

```
1단계 예약 ──┐
2단계 문의 답변 ──┼── (서로 독립, 순서 무관, 병행 가능)
3단계 환자 등록 ──┘
        │
4단계 진료기록 자체 (⚠️ 작성자 역할 확정 필요)
        │
5단계 진료기록 마스킹 (4단계 완료 후)

6단계 감사 로그 (다른 모든 것과 독립, 손이 많이 가서 마지막 권장)
```

---

## 전체 구현 완료 (2026-09-04)

위 1~6단계 전부 구현 완료 (진료기록은 "admin이 작성"으로 확정된 뒤 진행). `staff`(원무/접수) 역할을 실제로 추가한 것도 이번이 처음 — `patients.role` ENUM에 `'staff'` 추가, 시드 계정 `staff1`/`staff1234` 신규.

**수정/신규 파일**:
- `db/init.sql` — `patients.role` ENUM에 `staff` 추가, 신규 권한 10개(`reservations:*`, `board:reply`, `patients:register`, `records:*`, `audit:view`) + `role_permissions` 매핑, `board_posts`에 `answer`/`answered_by`/`answered_at` 컬럼 추가, 신규 테이블 3개(`reservations`, `medical_records`, `audit_log`)
- `was/middleware/requirePermission.js` — 미들웨어와 별개로 직접 호출 가능한 `hasPermission(role, permission)` 헬퍼를 분리 (같은 라우트가 권한에 따라 다른 응답을 줘야 하는 경우에 사용)
- `was/audit.js` (신규) — `logAudit(actorId, action, targetType, targetId, detail)` 공용 헬퍼. 실패해도 원래 요청을 막지 않도록 에러를 던지지 않고 로그만 남김
- `was/routes/reservations.js` (신규) — `GET /`(patient는 본인 것만·staff/admin은 전체로 분기), `POST /`(patient, patient_id는 세션에서만), `PATCH /:id/status`(staff/admin)
- `was/routes/records.js` (신규) — `GET /`(patient=본인 전체 필드·staff=전체 마스킹·admin=전체 필드로 3분기), `POST /`(admin만 작성)
- `was/routes/auditLog.js` (신규) — `GET /`(admin 전용, 최신순 페이지네이션)
- `was/routes/board.js` — `GET /`을 `board:reply` 보유 여부로 분기(staff/admin은 전체 문의를, patient는 본인 것만), `PATCH /:id/answer`(staff/admin 답변 등록) 추가, 상세/목록 응답에 `answer`/`answered_at` 포함
- `was/routes/accounts.js` — `POST /`(staff/admin이 환자 대리 등록, role은 항상 `patient` 고정, `accounts:manage`와 분리된 `patients:register` 사용), `PATCH /:id/role` 허용값에 `staff` 추가, 역할 변경 시 `logAudit` 호출 추가
- `was/routes/auth.js` — 로그인 성공/실패를 `logAudit`으로 기록
- `was/seed.js` — `staff1`/`staff1234`(역할 `staff`) 계정 추가
- `was/server.js` — `/api/reservations`, `/api/records`, `/api/audit-log` 라우트 등록

**검증 완료 (curl)**:
- 예약: patient1 생성 → 본인 GET엔 1건, staff1 GET엔 전체(환자명 포함) 보임 → staff1이 `confirmed`로 변경 → patient2가 같은 라우트 접근 시 403
- 문의 답변: staff1 GET `/api/board`에 전체 문의(`content` 포함)가 보이고, `PATCH /:id/answer`로 답변 등록 → patient1 GET에 답변이 포함되어 보임 → patient2가 답변 등록 시도 시 403
- 환자 등록: staff1이 `POST /api/accounts`로 신규 환자 생성(자동으로 `role=patient`) → patient1이 같은 라우트 호출 시 403
- 진료기록: admin이 patient1 진료기록 작성 → admin/patient1(본인)은 원문 그대로, staff1은 `진단명 앞 2글자+***`/`치료 내용 ***`로 마스킹되어 보임 → staff1이 작성 시도 시 403
- 감사 로그: `login_success`/`login_fail`/`account_role_change`/`patient_register`가 실제로 기록됨, `GET /api/audit-log`는 admin만 200(patient는 403)
- Playwright로 `board.html` 회귀 확인 — 응답에 필드가 늘었어도 기존 화면이 깨지지 않는 것 확인 (콘솔 에러 없음)

**미포함(이 문서 범위 밖 — 위 "이 문서의 범위" 참고)**: staff/admin용 프론트 화면(예약 관리, 답변 작성, 진료기록 조회, 감사 로그 조회, 환자 등록 UI)은 API만 구현했고, 화면은 별도 담당자가 진행. 각 API의 요청/응답 형식은 위 라우트별 설명과 실제 코드(`was/routes/*.js`) 참고.

---

## 지금 확인·확정해야 할 것

### 확정 필요 (결정 안 나면 다음 작업이 막히는 것)

- [ ] **Git 병합 전략** — 직접 확인해보니 `https://github.com/yysong1249/miso-hospital.git`에는 아직 `main` 브랜치가 없고, `feature/ocr`가 저장소의 기본(default) 브랜치로 잡혀 있다(처음 push한 브랜치가 그대로 default가 된 것). 이대로 `feature/ocr`를 계속 기본 브랜치로 쓸지, 아니면 `main`을 새로 만들고 `feature/ocr`를 PR로 병합하는 정식 흐름으로 바꿀지 확정 필요 — 프론트 담당자가 이 저장소를 clone/fork할 때 어느 브랜치를 기준으로 삼아야 하는지와 직결됨.
- [ ] **역할 세분화 로드맵** (기존 미정 항목, 아직 미해결) — `staff`는 이번에 실제로 추가했지만, AS-IS에서 언급했던 "의사"/"간호사"처럼 `admin`/`staff`보다 더 세분화된 역할이 실제로 필요한지는 여전히 미정. 특히 지금 진료기록은 전부 `admin`이 작성하는데(사용자 확정 사항), 실제 운영에서도 계속 admin이 작성할지, 아니면 이후 "의사" 역할을 분리할지에 따라 `medical_records.written_by`의 의미가 달라짐.
- [ ] **예약 시간대 중복/용량 제한** — 지금 `reservations` 스키마와 API는 같은 시간대에 여러 명이 동시에 예약해도 막지 않는다. 실제로 병원 예약 시스템처럼 쓰려면 시간대별 정원/중복 방지 로직이 필요한지 결정 필요.
- [ ] **진료과(`department`) 자유 입력 여부** — 지금은 `reservations.department`가 자유 텍스트라 오타·표기 불일치가 생길 수 있다. 고정 목록(ENUM 또는 별도 `departments` 테이블)으로 바꿀지 결정 필요.
- [ ] **문의 답변 수정/이력 관리** — `board_posts.answer`는 컬럼 하나라 답변을 다시 달면 이전 답변을 덮어쓰고 이력이 안 남는다. 이대로 둘지, 답변 이력을 남길지 결정 필요.
- [ ] **감사 로그 보존 정책** — `audit_log`가 삭제/보관 기간 없이 무기한 쌓이는 구조다. 실제 운영 전에 보존 기간이나 아카이빙 정책이 필요한지 결정 필요.

### 확인 필요 (사실관계 재확인 — 답이 이미 있을 수도 있음)

- [ ] **npm audit 취약점 5건, 여전히 미조치** — 방금 재확인함: `moderate 3, high 1, critical 1` (OCR.md에 처음 기록된 것과 동일). `express`→`qs`, `bcrypt`→`tar`의 전이 의존성 문제로 OCR 작업과는 무관하다고 남겨뒀던 항목인데, 이번에 백엔드 라우트가 6개나 늘어난 지금 시점에 한 번 더 검토할 가치가 있는지 확인 필요.
- [ ] **프론트 담당자에게 API 스펙을 어떻게 전달할지** — 이번에 늘어난 API(예약/문의답변/환자등록/진료기록/감사로그, 총 12개 엔드포인트)를 이 문서(`RBAC-Plan.md`)를 참고하게 할지, 아니면 별도 API 레퍼런스 문서로 정리해서 넘길지.
- [ ] **로컬 개발 DB에만 반영된 상태** — 이번 스키마 변경(`staff` 역할, 신규 테이블 3개, `board_posts` 컬럼 추가)은 로컬 MySQL에만 적용했다. 스테이징/운영 DB가 별도로 있다면 그쪽에도 `db/init.sql` 재적용이 필요한지 확인.


