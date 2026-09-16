"""Discord 웹훅으로 risk_level=high 이벤트를 실시간 알림.

관리자 웹 세션과 완전히 분리된 알림 경로다 - 오늘 병합된 감사 로그 대시보드
(chatbot-service/audit_summary.py, was/audit-severity.js, 2a1a303)는 조회형이라, 세션이
탈취되면 침입자도 같은 화면을 볼 수 있다는 문제가 남는다. Discord는 그 세션과 무관한 별도
채널이라 이 문제를 보완한다(제안서: https://claude.ai/code/artifact/2f536ff6-4219-4fd1-8e3b-
55437c7f5112 "왜 디스코드인가" 참고).

같은 action(+actor)은 짧은 시간 안에 재발송하지 않는다 - 인메모리 디바운스라 서버 재시작 시
초기화되는데, 이건 ANOMALY_DETECTION.md의 기존 인메모리 카운터와 동일한 종류의 한계로 이미
이 프로젝트가 감수하고 있는 트레이드오프다.

새 pip 패키지를 추가하지 않기 위해 표준 라이브러리 urllib만 사용한다.
요구사항/동작 명세는 test_audit_notify.py 참고 (TDD로 먼저 작성됨).
"""
import json
import os
import time
import urllib.request

_DEBOUNCE_SECONDS = 300  # 5분
_recent_sent = {}  # (action, actor) -> 마지막 발송 시각(epoch)

# [가독성 개선 2026-09-11] SECURITY_AUDIT_CRITERIA.md의 등급 매핑 표를 그대로 옮긴 한글
# 라벨/사유/등급. 원문 action 영문 문자열은 검색·디버깅용으로 계속 같이 남기되, 사람이
# 처음 보고 바로 판단할 수 있도록 한글 라벨을 맨 앞에 둔다. 이 파일은 챗봇 쪽(engine.py)에서만
# 호출되고, risk_classification.py 설계상 챗봇 쪽이 "high"가 되는 유일한 경로는 프롬프트
# 인젝션(MALICIOUS_OVERRIDE_LEVEL)이라 기본값도 그에 맞춘다.
_EVENT_LABELS = {
    "login_anomaly_admin_repeated_failure": ("관리자 계정 반복 실패", "고권한 계정이 집중 공격받는 중 (5분 내 3회)", "CRITICAL"),
    "login_anomaly_admin_new_ip": ("관리자 신규 IP 로그인", "이미 로그인에 성공한 이벤트 - 계정 탈취 가능성", "CRITICAL"),
    "login_anomaly_admin_new_location": ("관리자 신규 지역 로그인", "신규 IP 로그인과 동일 + 지리적으로도 이상", "CRITICAL"),
    "totp_verify_fail": ("TOTP 인증 실패", "비밀번호 통과 후 2차인증 실패 - 탈취 정황", "HIGH"),
    "totp_disabled": ("TOTP 해제", "2차인증 자체를 제거하는 조작", "HIGH"),
}
_DEFAULT_LABEL = ("챗봇 프롬프트 인젝션 의심", "챗봇 도구 호출 중 악의적 지시 시도가 탐지됨", "HIGH")
_SEVERITY_EMOJI = {"CRITICAL": "\U0001f534", "HIGH": "\U0001f7e0"}  # 🔴 / 🟠


def notify_discord(action: str, actor=None, detail: str = "", event_id: str = None) -> None:
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        return  # 알림은 부가 기능 - 설정이 없다고 본 서비스(챗봇 응답)를 막으면 안 됨

    # [2026-09-16] was/discord-notify.js와 동일한 이유 - 알림만 보고 대시보드를 직접 찾아
    # 들어가지 않아도 클릭 한 번으로 확인할 수 있도록 링크를 붙인다. 로컬 개발 기본값은
    # serve.py 포트(5500), 운영 배포는 PUBLIC_SITE_URL을 실제 도메인으로 지정해야 함.
    public_site_url = os.getenv("PUBLIC_SITE_URL", "http://localhost:5500").rstrip("/")

    key = (action, actor if actor is not None else "-")
    now = time.time()
    last_sent = _recent_sent.get(key)
    if last_sent is not None and now - last_sent < _DEBOUNCE_SECONDS:
        return
    _recent_sent[key] = now

    label, reason, severity = _EVENT_LABELS.get(action, _DEFAULT_LABEL)
    emoji = _SEVERITY_EMOJI.get(severity, "\U0001f6a8")

    lines = [
        f"{emoji} **[{severity}] {label}**",
        f"사유: {reason}",
        f"이벤트: `{action}`",
    ]
    if actor is not None:
        lines.append(f"행위자(계정 ID): `{actor}`")
    if detail:
        lines.append(f"상세: {detail}")
    # [2026-09-16 정정] "챗봇 쪽은 구조적으로 안 됨"이라고 판단했던 게 틀렸음 - audit_summary.py의
    # notable 항목이 이미 record_id(=event_id)를 들고 있고, admin-audit-dashboard.js의 "위험도
    # 요약" 표(페이지네이션 없음, 항상 최근 20건 전체 렌더링)에서 그대로 찾을 수 있다. source=chatbot
    # 을 같이 보내야 프론트가 "전체 이력"(WAS 전용, audit_log 테이블) 쪽이 아니라 이 요약 표에서
    # 찾는다는 걸 구분할 수 있다.
    dashboard_link = f"{public_site_url}/admin-audit-dashboard.html"
    if event_id:
        dashboard_link += f"?event={event_id}&source=chatbot"
    lines.append(f"대시보드 바로가기: {dashboard_link}")

    payload = json.dumps({"content": "\n".join(lines)}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            # [버그 수정 2026-09-11] 기본 User-Agent(Python-urllib/x.y)를 Discord/Cloudflare가
            # 403으로 차단함 - 실제 웹훅으로 검증하다 발견. 브라우저처럼 보이는 UA로 우회.
            "User-Agent": "Mozilla/5.0 (compatible; miso-hospital-audit-bot/1.0)",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=3)
    except Exception as e:
        # 알림 실패가 챗봇 응답 자체를 막으면 안 되므로 로그만 남기고 삼킨다.
        print(f"[discord notify error] {type(e).__name__}: {e}")
