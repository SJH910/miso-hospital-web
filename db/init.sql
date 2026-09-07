-- 스키마만 정의. 더미 데이터는 was/seed.js에서 비밀번호 해시/주민번호 암호화 후 삽입한다.
-- (비밀번호 해시, 주민번호 암호화는 SQL이 아닌 애플리케이션 코드에서 수행되어야 하므로
--  평문 INSERT문을 여기 두지 않는다.)
CREATE DATABASE IF NOT EXISTS vulnapp CHARACTER SET utf8mb4;
USE vulnapp;

-- 재실행 시 이전 스키마(예: 취약점 버전의 짧은 rrn 컬럼)가 남아있지 않도록 항상 깨끗하게 초기화.
-- scanned_documents/board_posts가 patients를 외래키로 참조하고, role_permissions가 roles/permissions를
-- 참조하므로 참조하는 쪽을 먼저 삭제.
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS medical_records;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS scanned_documents;
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
    role ENUM('patient', 'staff', 'admin') NOT NULL DEFAULT 'patient'  -- RBAC의 역할(role). 이 값 자체가 권한을 뜻하지 않고,
                                                               -- 실제 권한은 아래 roles/permissions/role_permissions로 조회한다.
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
    ('audit:view');

-- admin: 문서 스캔(OCR)·계정 관리·예약 관리·문의 답변·환자 등록·진료기록 전체·감사 로그.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.name IN (
    'ocr:scan', 'documents:create', 'documents:view', 'patients:view', 'accounts:manage',
    'reservations:manage', 'board:reply', 'patients:register', 'records:view:full', 'records:write', 'audit:view'
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
    answer TEXT NULL,               -- staff/admin이 다는 답변 (RBAC-Plan.md "2단계 - 문의 답변" 참고)
    answered_by INT NULL,           -- 답변한 계정 (patients.id, role='staff'|'admin')
    answered_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
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
CREATE TABLE audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) NULL,
    target_id INT NULL,
    detail JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES patients(id)
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
