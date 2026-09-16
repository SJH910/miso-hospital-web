// Synchronizer Token Pattern: 로그인 시 세션에 저장해둔 토큰과
// 요청 헤더(x-csrf-token)의 값이 일치하는지 검증. 불일치/누락 시 요청 거부.
// CSRF 공격자는 피해자의 세션 쿠키는 자동 전송받을 수 있어도, 세션 서버에만 저장된
// 이 토큰 값은 알 수 없으므로 위조 요청을 만들 수 없다.
// [버그 수정 2026-09-16] 세션 자체가 없는 상태(로그인 안 됨/만료됨/브라우저 뒤로가기로
// 복원된 stale 페이지 등)에서도 항상 "유효하지 않은 CSRF 토큰입니다"만 떠서, 진짜 CSRF
// 불일치인지 그냥 로그인이 안 된 것뿐인지 구분이 안 됐다(실사용 중 발견 - reservation.html을
// 로그인 없이 열었다가 뒤로가기로 돌아온 뒤 예약 시도 시 이 메시지만 뜸). 세션 없음은
// 별도 401로 분리 - 프론트가 "로그인이 필요합니다"로 명확히 보여줄 수 있게 함.
function verifyCsrfToken(req, res, next) {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const headerToken = req.headers["x-csrf-token"];
  if (!headerToken || headerToken !== req.session.csrfToken) {
    return res.status(403).json({ message: "유효하지 않은 CSRF 토큰입니다." });
  }
  next();
}

module.exports = { verifyCsrfToken };
