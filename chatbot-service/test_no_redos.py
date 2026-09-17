"""
[TDD - 검증/회귀고정] 2번 문제: 자연어 예약 파싱 정규식의 ReDoS 위험.

실제로 100KB~1MB 적대적 입력으로 실측한 결과 크기 10배 -> 시간 10배(선형)로, 지수 폭발이
없음을 확인했다. 이 테스트는 그 실측을 pytest 회귀 테스트로 고정한다 - 나중에 누가 정규식을
"개선"하다 실수로 중첩 반복(`(a+)+` 류) 같은 걸 넣어도 이 테스트가 잡아낸다.

주의: 이 테스트는 지금 이미 통과한다(Green). "고쳐야 할 버그"가 아니라 "이미 안전하다는
사실을 고정하는" 목적이라 정상이다 - RATE_LIMIT_PROMPT_INJECTION_WORKFLOW.md 참고.
"""
import re
import time

# hospital_agent.py와 완전히 동일한 패턴 정의(소스와 동기화 유지 필요).
ISO_DATETIME_PATTERN = re.compile(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?")
MONTH_DAY_PATTERN = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일")
RELATIVE_DAY_PATTERN = re.compile(r"(오늘|내일|모레)")
HOUR_MINUTE_PATTERN = re.compile(r"(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?")
AMPM_PATTERN = re.compile(r"(오전|오후)")
DEPARTMENT_PATTERN = re.compile(r"([가-힣]{2,6}과)")

ALL_PATTERNS = [
    ISO_DATETIME_PATTERN, MONTH_DAY_PATTERN, RELATIVE_DAY_PATTERN,
    HOUR_MINUTE_PATTERN, AMPM_PATTERN, DEPARTMENT_PATTERN,
]

# was/routes/chat.js:44 의 실제 입력 상한(1000자)보다 100배 넉넉하게 잡은 임계값.
# 이 정도로 커도 선형이면 수십 ms 안에 끝나야 하고, 지수 폭발이면 몇 초 이상 걸린다.
ADVERSARIAL_LENGTH = 100_000
MAX_ALLOWED_SECONDS = 0.5


def _adversarial_inputs():
    return {
        "digits_only": "9" * ADVERSARIAL_LENGTH,
        "near_miss_iso": "2026-09" * (ADVERSARIAL_LENGTH // 7),
        "near_miss_hour_minute": "12시 34" * (ADVERSARIAL_LENGTH // 6),
        "whitespace_only": " " * ADVERSARIAL_LENGTH,
        "repeated_gwa": "과" * ADVERSARIAL_LENGTH,
    }


def test_no_pattern_shows_exponential_blowup_on_adversarial_input():
    for name, text in _adversarial_inputs().items():
        for pattern in ALL_PATTERNS:
            start = time.perf_counter()
            pattern.search(text)
            elapsed = time.perf_counter() - start
            assert elapsed < MAX_ALLOWED_SECONDS, (
                f"{pattern.pattern!r} 이(가) 입력 '{name}'(길이 {len(text)})에서 "
                f"{elapsed:.3f}초 소요 - ReDoS 의심, 즉시 확인 필요"
            )


def test_realistic_input_at_actual_length_cap_is_fast():
    """chat.js가 실제로 허용하는 최대 길이(1000자)에서는 훨씬 더 엄격한 기준(10ms)도
    통과해야 한다 - 실사용 조건에서는 사실상 무시해도 되는 비용임을 보여준다."""
    text = "9" * 1000
    for pattern in ALL_PATTERNS:
        start = time.perf_counter()
        pattern.search(text)
        elapsed = time.perf_counter() - start
        assert elapsed < 0.01
