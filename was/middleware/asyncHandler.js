// [보안 강화 2026-09-15] Express 4는 async 라우트 핸들러 안에서 await한 Promise가 reject돼도
// 이를 에러 미들웨어로 자동 전달하지 않는다. try/catch 없는 async 라우트가 많아서(BUG_REVIEW_
// 2026-09-10.md "비동기 라우트에서 DB 에러 시 요청이 응답 없이 멈춤" 참고), DB 에러가 나면
// 응답을 아예 안 보내고 클라이언트가 무한정 기다리는 상태가 됨 - server.js의 전역
// unhandledRejection 로거는 콘솔에 로그만 남길 뿐 req/res에 접근할 수 없어 응답을 못 준다.
// 이 래퍼로 async 핸들러를 감싸면, 안에서 던진 에러를 Promise.catch로 잡아 next(err)로
// 넘겨서 server.js의 전역 에러 핸들러(500 응답)까지 도달하게 만든다. 핸들러가 이미 자체
// try/catch로 에러를 처리하는 경우엔 여기까지 에러가 안 올라오므로 동작 변화가 없다 -
// "지금 응답 없이 멈추던 경우"에만 영향을 준다.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
