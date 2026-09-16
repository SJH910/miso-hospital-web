// [보안 강화] RRN_ENCRYPTION_KEY 등 시크릿을 was/.env에서 로드. config.js가 process.env를
// 읽기 전에 먼저 실행돼야 하므로 최상단에 위치. path를 명시하지 않으면 dotenv가
// process.cwd() 기준으로 .env를 찾는데, start.sh가 이 프로세스를 프로젝트 루트에서
// 띄우기 때문에(`node was/server.js`, cd was 없음) cwd가 was/가 아니라 루트가 되어
// was/.env를 못 찾는 문제가 생긴다 - __dirname 기준 절대경로로 고정해 이 문제를 피한다.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const config = require("./config");
const authRoutes = require("./routes/auth");
const boardRoutes = require("./routes/board");
const ocrRoutes = require("./routes/ocr");
const patientsRoutes = require("./routes/patients");
const documentsRoutes = require("./routes/documents");
const accountsRoutes = require("./routes/accounts");
const reservationsRoutes = require("./routes/reservations");
const recordsRoutes = require("./routes/records");
const auditLogRoutes = require("./routes/auditLog");
const chatRoutes = require("./routes/chat");
const holidaysRoutes = require("./routes/holidays");
const totpRoutes = require("./routes/totp");
const ipBlocklistRoutes = require("./routes/ipBlocklist");
const { ipBlocklistMiddleware } = require("./middleware/ipBlocklist");
const { logAudit } = require("./audit");

const app = express();

// [배포 2026-09-15] nginx 같은 리버스 프록시 뒤에서 돌 때, 이걸 안 하면 req.ip가 항상
// 프록시(127.0.0.1)로 잡혀서 was/routes/auth.js의 IP 기반 로그인 이상탐지(신규 IP/빈도)가
// 전부 무의미해지고, express-session의 secure 쿠키도 X-Forwarded-Proto를 못 믿어서
// Set-Cookie 자체가 누락된다(실제 배포 중 로그인은 200인데 세션이 안 생기는 증상으로 발견).
// "1"은 "가장 가까운 프록시 1홉만 신뢰"라는 뜻 - nginx 하나만 거치는 구조라 이 값이면
// 충분하고, 범위를 넓히면 클라이언트가 X-Forwarded-For를 위조해 IP를 속일 수 있어 위험하다.
// 로컬 개발(프록시 없음)에서는 X-Forwarded-For 헤더 자체가 없어서 영향 없음.
app.set("trust proxy", 1);

// [2026-09-16] IP 차단(was/routes/ipBlocklist.js) - CORS/세션/바디 파싱보다도 먼저 걸어서,
// 차단된 IP는 그 이후 어떤 처리 비용도 들이지 않고 바로 거절한다. req.ip가 정확해야 하므로
// trust proxy 설정 바로 다음이어야 한다.
app.use(ipBlocklistMiddleware);

// [안정성 강화] 라우트 코드에서 놓친 예외(예: 암호화 키 변경으로 인한 복호화 실패)가
// 서버 프로세스 전체를 죽이지 않도록 하는 최후의 안전망. Node 15+ 기본 동작은
// "처리되지 않은 Promise 거부 시 프로세스 종료"인데, 이 리스너를 달면 로그만 남기고 계속 실행된다.
// (근본 수정은 각 라우트에 try/catch를 제대로 두는 것이고, 이건 그걸 놓쳤을 때의 2차 방어선일 뿐.)
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection] 처리되지 않은 예외 발생 - 서버는 계속 실행됩니다:", err);
});

// [보안 강화 #5 CSRF/CORS] 신뢰하는 프론트엔드 오리진만 명시적으로 허용.
// origin: true(모든 오리진 반사) 대신 config.allowedOrigin 하나만 허용해
// 공격자 페이지의 credentialed 요청 자체가 브라우저 단에서 차단되도록 함.
app.use(cors({ origin: config.allowedOrigin, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      // [보안 강화 #4 세션 관리]
      httpOnly: true,               // JS의 document.cookie로 세션 쿠키 접근 차단
      secure: config.useHttps,      // HTTPS 배포 시에만 true (환경변수 USE_HTTPS로 제어)
      sameSite: "strict",           // 다른 사이트로부터의 요청에는 쿠키를 자동 첨부하지 않음 (CSRF 방어 보조)
      maxAge: 30 * 60 * 1000,       // 30분 유휴 시 자동 만료
    },
  })
);

app.use("/api", authRoutes);
app.use("/api/board", boardRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/patients", patientsRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/reservations", reservationsRoutes);
app.use("/api/records", recordsRoutes);
app.use("/api/audit-log", auditLogRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/holidays", holidaysRoutes);
app.use("/api/totp", totpRoutes);
app.use("/api/ip-blocklist", ipBlocklistRoutes);

// 안전망: 라우트에서 놓친 에러가 있어도 서버 프로세스 자체는 죽지 않고 500만 응답하게 함.
// [보안 강화 #7-b 정보 노출] 에러 상세는 서버 로그에만 남기고 클라이언트에는 일반 메시지만 반환.
//
// [보안 강화 2026-09-14] express.json()의 기본 크기 제한(100KB)을 넘는 요청은 body-parser가
// 라우트 핸들러(detectLongInput 등)에 도달하기도 전에 PayloadTooLargeError를 던진다 - 지금까지는
// 이게 그냥 아래 기본 분기로 떨어져서 "500 + 감사 로그 없음"으로 끝났다. 즉 "문자열을 아주 길게
// 주면 오히려 탐지가 안 되는" 미탐이었다 - login_anomaly_long_input(200자 초과 기준)이 잡으려던
// 것과 같은 종류의 신호인데, 그보다 훨씬 큰 페이로드는 그 코드에 도달하지도 못해 놓치고 있었다.
// body-parser 에러는 err.type === "entity.too.large"로 구분 가능하므로, 여기서 별도로 감사 로그를
// 남기고 상태 코드도 부정확한 500 대신 413(Payload Too Large)으로 정확히 응답한다. 이 미들웨어는
// 모든 라우트에 공통 적용되는 express.json() 다음에 걸리는 전역 에러 핸들러라 로그인뿐 아니라
// 어느 POST/PATCH 엔드포인트든 같은 문제를 겪고 있었다 - 그래서 action 이름도 로그인 전용이
// 아닌 범용(oversized_request_payload)으로 둔다.
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    logAudit(null, "oversized_request_payload", "request", null, {
      ip: req.ip, path: req.path, length: err.length, limit: err.limit,
    }).catch((e) => console.error("[audit log error]", e));
    return res.status(413).json({ message: "요청이 너무 큽니다." });
  }
  console.error(err);
  res.status(500).json({ message: "서버 오류가 발생했습니다." });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`WAS listening on http://localhost:${config.port}`);
});
