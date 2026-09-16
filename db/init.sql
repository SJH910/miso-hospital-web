-- 스키마만 정의. 더미 데이터는 was/seed.js에서 비밀번호 해시/주민번호 암호화 후 삽입한다.
-- (비밀번호 해시, 주민번호 암호화는 SQL이 아닌 애플리케이션 코드에서 수행되어야 하므로
--  평문 INSERT문을 여기 두지 않는다.)
CREATE DATABASE IF NOT EXISTS vulnapp CHARACTER SET utf8mb4;
USE vulnapp;

-- 재실행 시 이전 스키마(예: 취약점 버전의 짧은 rrn 컬럼)가 남아있지 않도록 항상 깨끗하게 초기화.
-- scanned_documents/board_posts가 patients를 외래키로 참조하고, role_permissions가 roles/permissions를
-- 참조하므로 참조하는 쪽을 먼저 삭제.
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS holidays;
DROP TABLE IF EXISTS admin_known_locations;
DROP TABLE IF EXISTS ip_blocklist;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS medical_records;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS scanned_documents;
DROP TABLE IF EXISTS board_answers;
DROP TABLE IF EXISTS board_posts;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;

CREATE TABLE patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,       -- [보안 강화] bcrypt 해시 저장 (60자 고정 길이, 평문 저장 금지)
    name VARCHAR(20) NOT NULL,
    rrn VARCHAR(100) NOT NULL,            -- [보안 강화] AES-256-GCM 암호문(base64) 저장. 평문보다 길어져 컬럼 확장
    role ENUM('patient', 'staff', 'admin') NOT NULL DEFAULT 'patient',  -- RBAC의 역할(role). 이 값 자체가 권한을 뜻하지 않고,
                                                               -- 실제 권한은 아래 roles/permissions/role_permissions로 조회한다.
    totp_secret VARCHAR(64) NULL  -- [관리자 신규 위치 인증] TOTP 비밀키(base32). NULL이면 미등록 상태.
                                   -- 관리자가 이 값을 등록해야 새 IP/지역 로그인 시 추가 인증이 활성화됨.
);

-- RBAC: 역할(Role). patients.role의 값과 이름이 대응된다.
CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(30) UNIQUE NOT NULL
);

-- RBAC: 권한(Permission). "역할 이름"이 아니라 "할 수 있는 행위" 단위로 정의해,
-- 라우트가 특정 역할 문자열이 아니라 권한 이름에만 의존하도록 한다 (routes/*.js의 requirePermission 참고).
CREATE TABLE permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);

-- RBAC: 역할 <-> 권한 매핑 (다대다). 이 테이블만 바꾸면 코드 수정 없이 역할별 권한을 조정할 수 있다.
CREATE TABLE role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

-- 역할/권한은 비밀번호·주민번호처럼 애플리케이션 코드에서 가공할 값이 없는 순수 참조 데이터이므로
-- (seed.js가 아니라) 스키마와 함께 여기서 직접 시딩한다.
INSERT INTO roles (name) VALUES ('patient'), ('staff'), ('admin');

INSERT INTO permissions (name) VALUES
    ('ocr:scan'),
    ('documents:create'),
    ('documents:view'),
    ('patients:view'),
    ('board:read'),
    ('board:write'),
    ('accounts:manage'),
    ('reservations:create'),
    ('reservations:view:own'),
    ('reservations:manage'),
    ('board:reply'),
    ('patients:register'),
    ('records:view:own'),
    ('records:view:masked'),
    ('records:view:full'),
    ('records:write'),
    ('audit:view'),
    ('holidays:manage'),
    ('security:manage');

-- admin: 문서 스캔(OCR)·계정 관리·예약 관리·문의 답변·환자 등록·진료기록 전체·감사 로그.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.name IN (
    'ocr:scan', 'documents:create', 'documents:view', 'patients:view', 'accounts:manage',
    'reservations:manage', 'board:reply', 'patients:register', 'records:view:full', 'records:write', 'audit:view',
    'holidays:manage', 'security:manage'
);

-- 게시판(진료문의) 권한은 patient/admin 둘 다 부여 (RBAC-Plan.md "역할별 권한 매핑" 참고).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('patient', 'admin') AND p.name IN ('board:read', 'board:write');

-- patient: 본인 예약 생성/조회, 본인 진료기록 조회.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'patient' AND p.name IN ('reservations:create', 'reservations:view:own', 'records:view:own');

-- staff(원무/접수): 예약 관리, 문의 답변, 환자 등록, 진료기록 마스킹 열람.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'staff' AND p.name IN ('reservations:manage', 'board:reply', 'patients:register', 'records:view:masked');

-- board.html/view.html이 참조하는 "진료 문의 게시글" 테이블
CREATE TABLE board_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- 문의 답변 (RBAC-Plan.md "2단계 - 문의 답변" 참고). [결정 2026-09-10] 답변을 board_posts에
-- 컬럼 하나로 두면 재답변 시 UPDATE로 이전 답변이 덮어써져 이력이 안 남는 문제가 있어서,
-- 답변 하나당 한 행으로 분리 — 한번 쓴 답변은 절대 UPDATE/DELETE하지 않고 항상 INSERT만
-- 한다(수정 불가, 추가 답변만 가능). post_id 하나에 여러 행(=답변 여러 개)이 쌓이는 구조.
CREATE TABLE board_answers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    answered_by INT NOT NULL,        -- 답변한 계정 (patients.id, role='staff'|'admin')
    answer TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES board_posts(id),
    FOREIGN KEY (answered_by) REFERENCES patients(id)
);

-- 예약 (RBAC-Plan.md "1단계 - 예약" 참고)
CREATE TABLE reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    department VARCHAR(50) NOT NULL,
    reserved_at DATETIME NOT NULL,
    status ENUM('requested', 'confirmed', 'cancelled') NOT NULL DEFAULT 'requested',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- 휴진일 (공공 공휴일 + 병원 자체 휴진일 통합 관리).
-- 외부 공휴일 API를 쓰지 않는 이유: 그 서비스가 장애/요청제한에 걸리면 예약 가능 여부 판단
-- 자체가 막혀버리기 때문 (이 프로젝트 전반의 "외부 의존성 장애가 핵심 기능을 막으면 안 된다" 원칙과
-- 동일). 관리자가 holidays:manage 권한으로 등록/삭제하며, 아래는 2026년 초기 시드 데이터.
CREATE TABLE holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    reason VARCHAR(100) NOT NULL
);

INSERT INTO holidays (holiday_date, reason) VALUES
    ('2026-01-01', '신정'),
    ('2026-02-16', '설날 연휴'),
    ('2026-02-17', '설날'),
    ('2026-02-18', '설날 연휴'),
    ('2026-03-01', '삼일절'),
    ('2026-05-05', '어린이날'),
    ('2026-05-24', '부처님오신날'),
    ('2026-06-06', '현충일'),
    ('2026-08-15', '광복절'),
    ('2026-09-24', '추석 연휴'),
    ('2026-09-25', '추석'),
    ('2026-09-26', '추석 연휴'),
    ('2026-10-03', '개천절'),
    ('2026-10-09', '한글날'),
    ('2026-12-25', '크리스마스');

-- 진료기록(의료 차트). admin만 작성, patient는 본인 것만/staff는 마스킹해서 열람 (RBAC-Plan.md "4~5단계" 참고)
CREATE TABLE medical_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    written_by INT NOT NULL,
    diagnosis TEXT NOT NULL,
    treatment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (written_by) REFERENCES patients(id)
);

-- 감사 로그 (RBAC-Plan.md "6단계" 참고). actor_id는 로그인 실패처럼 행위자를 특정 못 하면 NULL 허용.
-- risk_level: was/risk-classification.js가 기록 시점에 분류해 채움 (재분류 아님 - 탐지 당시 판단을 보존).
-- 자세한 분류 기준은 SECURITY_THREAT_MODEL.md 참고.
CREATE TABLE audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) NULL,
    target_id INT NULL,
    detail JSON NULL,
    risk_level ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES patients(id)
);

-- [2026-09-16] 관리자 신규 IP/지역 로그인 탐지(was/routes/auth.js의 isNewAdminLocation)가
-- 지금까지 인메모리 Map으로만 "known" IP/지역을 기억해서, WAS 프로세스가 재시작될 때마다
-- (배포마다 자주 발생) 그 기록이 통째로 사라졌다 - 재시작 직후엔 "아직 아무도 로그인한 적
-- 없음"으로 취급되어, TOTP를 등록해둔 admin이어도 누구든 재시작 후 첫 로그인은 TOTP 없이
-- 통과되는 실제 보안 공백으로 이어졌음(운영 중 발견). DB에 영속화해 재시작과 무관하게 유지한다.
-- location_type+value로 IP/지역을 한 테이블에 같이 두는 이유는 "이 관리자 계정이 알고 있는
-- 위치 전체"라는 같은 개념이라 조회/삭제 로직을 하나로 통일하기 위함.
CREATE TABLE admin_known_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,        -- normalizeUsernameKey()로 소문자 정규화된 값 (DB 콜레이션과 일치)
    location_type ENUM('ip', 'region') NOT NULL,
    value VARCHAR(100) NOT NULL,          -- location_type='ip'면 IP 문자열, 'region'이면 "국가-지역코드"(예: KR-11)
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_admin_location (username, location_type, value)
);

-- [2026-09-16] INCIDENT_RESPONSE.md 3-4번 섹션에 명시돼 있던 공백("IP 차단/블랙리스트
-- 없음")을 메운다. 설계 질문 5개(문서 참고) 결론:
--   - 차단 기준: IP만(계정 차단은 이미 accounts.js의 role 변경/비밀번호 재설정으로 대체 가능,
--     비로그인 상태 접근을 막으려면 애초에 IP 기준이 필수라 IP를 먼저 구현 - 계정 차단이
--     필요해지면 이 테이블에 새로운 값이 아니라 별도 메커니즘으로 다룬다, 섞으면 "차단 대상이
--     IP인지 계정인지"를 매 조회마다 분기해야 해서 오히려 복잡해짐).
--   - 저장 위치: DB 테이블(영구). admin_known_locations와 같은 이유 - 인메모리였다면 재시작마다
--     차단이 풀려서, 정작 공격이 계속되는 동안 서버 배포 한 번으로 방어가 무력화될 수 있음.
--   - 자동 차단: 이 테이블 자체는 수동 차단 기능만 다룬다(관리자가 명시적으로 등록). 자동 차단은
--     오탐 위험 때문에 별도 검토 대상으로 남겨둠(문서 참고) - 나중에 자동 차단을 붙이더라도
--     "차단 목록"이라는 개념 자체는 이 테이블을 그대로 재사용하면 된다.
--   - 해제 정책: expires_at을 두어 기간제 차단을 기본으로 하고(NULL이면 영구) 관리자가 직접 삭제도
--     가능 - 오늘 낮에 확인한 것처럼 같은 공인 IP를 여러 사람이 공유하는 경우(사무실 와이파이 등)
--     영구 차단이 무고한 사용자까지 막을 위험이 있어, 기본을 "영구"가 아니라 "기간제 + 수동 해제"로 둠.
--   - 차단 메시지: 이 테이블엔 안 남기고 응답 문구 자체를 코드에서 고정값("일시적으로 이용이
--     제한되었습니다")으로 - 차단 사유를 노출하면 공격자에게 우회 힌트를 주게 됨.
CREATE TABLE ip_blocklist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL UNIQUE,       -- IPv4/IPv6 문자열 그대로 저장(정규화 없음 - req.ip와 직접 비교)
    reason VARCHAR(255) NULL,             -- 관리자가 남기는 메모 (예: "SQLi 반복 시도, audit_log #123")
    blocked_by INT NULL,                  -- 차단한 관리자 (patients.id) - 계정 삭제 시에도 이력은 남도록 NULL 허용
    blocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,            -- NULL이면 영구 차단, 아니면 이 시각 이후 자동 해제
    FOREIGN KEY (blocked_by) REFERENCES patients(id) ON DELETE SET NULL
);

-- 관리자가 admin.html에서 스캔한 문서(OCR 결과)를 환자와 연결해 저장하는 테이블.
-- 조회는 관리자 전용(GET /api/documents) — 환자용 조회 라우트는 만들지 않는다.
CREATE TABLE scanned_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,            -- 이 스캔 결과가 속한 환자
    scanned_by INT NOT NULL,            -- 스캔을 수행한 관리자(patients.id, role='admin')
    document_type ENUM('prescription', 'diagnosis', 'receipt') NOT NULL,
    extracted_text TEXT,                 -- OCR 원문. 목록 조회 API는 이 컬럼을 응답에 포함하지 않음
    parsed_date DATE NULL,               -- extracted_text에서 정규식으로 뽑아낸 날짜 (best-effort)
    parsed_amount INT NULL,              -- extracted_text에서 정규식으로 뽑아낸 금액(원) (best-effort)
    parsed_fields JSON NULL,             -- "라벨:값" 형태 줄에서 뽑아낸 나머지 필드. 주민등록번호 등 민감 라벨은 제외
    image_path VARCHAR(64) NULL,         -- scanned-images/ 안의 암호화된 원본 이미지 파일명(랜덤, 원본 파일명 아님).
                                          -- NULL이면 원본 이미지 없이 텍스트만 저장된 기존/구버전 레코드.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (scanned_by) REFERENCES patients(id)
);

-- 환자-챗봇 상담 기록 (위젯 재접속 시 이전 대화를 이어보기 위한 용도).
-- "원문은 암호화 보관, 화면 표시는 마스킹" 원칙에 따라 content는 AES-256-GCM 암호문(base64)만 저장한다.
-- 챗봇(Python) 자체도 별도로 감사 로그(chatbot-service/chatbot_logs.db)를 남기는데, 그건 PII를
-- LLM에 보내기 전에 마스킹했는지 감사하는 용도이고, 이 테이블은 "환자가 본인 대화를 다시 보는" 용도로 역할이 다르다.
CREATE TABLE chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    sender ENUM('patient', 'bot') NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
