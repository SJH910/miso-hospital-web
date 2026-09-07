const crypto = require("crypto");

// DB 접속 정보를 환경변수로 받는다. 기본값은 로컬 개발용.
module.exports = {
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: Number(process.env.DB_PORT || 3306),
  dbUser: process.env.DB_USER || "vulnuser",
  dbPassword: process.env.DB_PASSWORD || "vulnpass", // 실 배포 시 반드시 환경변수로 교체
  dbName: process.env.DB_NAME || "vulnapp",

  // [보안 강화] 세션 시크릿은 반드시 환경변수로 주입. 기본값은 로컬 개발 편의용이며
  // 운영 배포 시 SESSION_SECRET을 충분히 긴 무작위 값으로 반드시 설정해야 함.
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),

  // [보안 강화] 주민번호 등 대칭키 암호화용 32바이트(256비트) 키.
  // 운영 환경에서는 반드시 RRN_ENCRYPTION_KEY 환경변수로 고정된 키를 주입해야 함
  // (매 재시작마다 키가 바뀌면 기존 암호문을 복호화할 수 없게 됨).
  rrnEncryptionKey: process.env.RRN_ENCRYPTION_KEY
    ? Buffer.from(process.env.RRN_ENCRYPTION_KEY, "hex")
    : crypto.randomBytes(32),

  // [보안 강화] 신뢰하는 프론트엔드 오리진만 허용 (CSRF/CORS 오설정 방지).
  // FRONTEND_ORIGIN 환경변수가 있으면 그 값만 허용(운영 환경 권장 방식).
  // 없으면 localhost와 사설 네트워크 대역(192.168.x.x, 172.16~31.x.x, 10.x.x.x)의 5500 포트를
  // 자동으로 허용해, 같은 와이파이의 팀원이 IP로 접속해도 매번 환경변수를 안 붙여도 되게 함.
  // (사설 IP 대역으로 범위를 한정했기 때문에, 외부 공인 IP나 임의 도메인은 여전히 차단됨)
  allowedOrigin: process.env.FRONTEND_ORIGIN
    ? process.env.FRONTEND_ORIGIN
    : /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):5500$/,

  // [보안 강화] HTTPS 배포 여부 - true일 때만 쿠키에 secure 플래그 적용
  // (HTTP 로컬 개발 환경에서 secure:true를 걸면 쿠키 자체가 전송되지 않아 개발이 막히므로 플래그로 분리)
  useHttps: process.env.USE_HTTPS === "true",

  // [챗봇 통합] Python RAG 마이크로서비스 주소. Node는 질문+patient_id만 넘기고 답변만 받아온다.
  chatbotServiceUrl: process.env.CHATBOT_SERVICE_URL || "http://localhost:8000",

  port: Number(process.env.PORT || 3000),
};
