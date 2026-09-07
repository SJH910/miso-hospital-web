// Synchronizer Token Pattern: 로그인 시 세션에 저장해둔 토큰과
// 요청 헤더(x-csrf-token)의 값이 일치하는지 검증. 불일치/누락 시 요청 거부.
// CSRF 공격자는 피해자의 세션 쿠키는 자동 전송받을 수 있어도, 세션 서버에만 저장된
// 이 토큰 값은 알 수 없으므로 위조 요청을 만들 수 없다.
function verifyCsrfToken(req, res, next) {
  const headerToken = req.headers["x-csrf-token"];
  if (!headerToken || headerToken !== req.session.csrfToken) {
    return res.status(403).json({ message: "유효하지 않은 CSRF 토큰입니다." });
  }
  next();
}

module.exports = { verifyCsrfToken };
