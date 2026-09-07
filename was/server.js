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

const app = express();

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

// 안전망: 라우트에서 놓친 에러가 있어도 서버 프로세스 자체는 죽지 않고 500만 응답하게 함.
// [보안 강화 #7-b 정보 노출] 에러 상세는 서버 로그에만 남기고 클라이언트에는 일반 메시지만 반환.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "서버 오류가 발생했습니다." });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`WAS listening on http://localhost:${config.port}`);
});
