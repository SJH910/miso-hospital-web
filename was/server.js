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

const app = express();

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

// 안전망: 라우트에서 놓친 에러가 있어도 서버 프로세스 자체는 죽지 않고 500만 응답하게 함.
// [보안 강화 #7-b 정보 노출] 에러 상세는 서버 로그에만 남기고 클라이언트에는 일반 메시지만 반환.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "서버 오류가 발생했습니다." });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`WAS listening on http://localhost:${config.port}`);
});
