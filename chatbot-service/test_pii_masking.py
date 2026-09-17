"""
[테스트 추가] pii_masking.py의 mask_pii()를 검증하는 자동화 pytest가 하나도 없었음
(audit-agent/test_masking_secrets.py는 다른 파일 대상). 기존에 파일 하단 __main__
블록에 있던 수동 확인용 케이스들을 pytest 회귀 테스트로 옮긴다. 순수 테스트 추가라
기존 코드는 건드리지 않았다.

[중요] 아래 xfail 테스트 2개는 "지금 이렇게 동작하니 정상"이라는 의미가 아니라,
2026-09-16 시점에 실제로 재현 확인된 미해결 버그를 문서화한 것이다(자세한 경위는
대화 기록/CHATBOT_SECURITY_WORK_0915.md 참고). origin/main에는 이미 고쳐진 버전이
있으나 로컬 chatbot 브랜치에는 아직 반영되지 않았다. 코드를 고쳐서 이 테스트가
우연히 통과하게 되면(xfail인데 성공) pytest가 XPASS로 알려주므로, 고쳐지는 순간
바로 알아챌 수 있다.
"""
import pytest

from pii_masking import mask_pii
import pii_masking as _pii_masking_module


# --- 주민등록번호 ---

def test_ssn_with_hyphen():
    assert mask_pii("제 주민번호는 900101-1234567 입니다.") == "제 주민번호는 900101-[MASKED] 입니다."


def test_ssn_without_separator():
    assert mask_pii("제 번호는 9001011234567이에요.") == "제 번호는 900101-[MASKED]이에요."


def test_ssn_with_spaces_between_digits():
    assert mask_pii("주민번호 9 0 0 1 0 1 - 1 2 3 4 5 6 7 입니다.") == "주민번호 9 0 0 1 0 1-[MASKED] 입니다."


def test_ssn_with_dot_separator():
    # [보안 수정 2026-09-10] 마침표 구분자 우회 수정 회귀 테스트
    assert mask_pii("주민번호는 900101.1234567 입니다") == "주민번호는 900101-[MASKED] 입니다"


# --- 전화번호 ---

def test_phone_with_hyphen():
    assert mask_pii("전화번호는 010-1234-5678 입니다.") == "전화번호는 010-****-5678 입니다."


def test_phone_without_separator():
    assert mask_pii("연락처 01012345678") == "연락처 010-****-5678"


def test_phone_with_dot_separator():
    # [보안 수정 2026-09-10] 마침표 구분자 우회 수정 회귀 테스트
    assert mask_pii("제 번호는 010.1234.5678 이에요") == "제 번호는 010-****-5678 이에요"


# --- 이름 (트리거 단어 + 성씨 화이트리스트) ---

def test_korean_name_short():
    assert mask_pii("저는 김구야") == "저는 김*야"


def test_korean_name_with_formal_ending():
    assert mask_pii("제 이름은 홍길동입니다.") == "제 이름은 홍*동입니다."


def test_korean_compound_surname():
    assert mask_pii("이름이 남궁민수야") == "이름이 남**수야"


def test_korean_name_four_chars():
    assert mask_pii("저는 윤알렉산더입니다.") == "저는 윤***더입니다."


def test_english_name_two_words():
    assert mask_pii("내 이름은 Howl Jenkins 라고") == "내 이름은 Howl ******* 라고"


def test_english_name_mixed_with_korean_context():
    """[2026-09-16 수정] 원래 nlp(spaCy) 로드 여부에 따라 기대값이 달라지는 비결정적 테스트였음
    - 3번(정규식) 단계는 'Luis clanton' -> 'Luis *******'(성만 마스킹)로 끝내는데, 모델이
    로드돼 있으면 그 결과가 6번(NER) 단계에 다시 들어가 남은 'Luis'까지 한 번 더 마스킹되어
    'L**s *******'가 됨. 어떤 환경에서 pytest를 돌리느냐에 따라 통과/실패가 갈리던 문제라,
    nlp를 명시적으로 None 고정해서 3번 단계 정규식 로직만 결정론적으로 검증한다. NER과의
    상호작용은 아래 test_ner_further_masks_foreign_given_name_when_model_available 참고."""
    original_nlp = _pii_masking_module.nlp
    _pii_masking_module.nlp = None
    try:
        result = mask_pii("내 이름은 Luis clanton 인데 호흡기 안심 클리닉은 어디에 위치 해 있어?")
    finally:
        _pii_masking_module.nlp = original_nlp

    assert result == "내 이름은 Luis ******* 인데 호흡기 안심 클리닉은 어디에 위치 해 있어?"


@pytest.mark.skipif(_pii_masking_module.nlp is None, reason="spaCy 한국어 모델이 설치된 환경에서만 검증 가능")
def test_ner_further_masks_foreign_given_name_when_model_available():
    """[2026-09-16 발견] 3번(정규식) 단계가 영문 2단어 이름에서 성만 마스킹하고 이름은 그대로
    두면('Luis clanton' -> 'Luis *******'), 그 결과가 6번(NER) 단계에서 spaCy에 의해 다시
    스캔되면서 남은 'Luis'가 PERSON으로 잡혀 한 번 더(한국어식 중간 마스킹으로) 가려진다.
    의도된 설계라기보다 두 단계가 순차 실행되며 생기는 부수효과이고, 마스킹이 더 강해지는
    방향이라 당장 위험하지는 않지만 모델 유무에 따라 최종 형태가 달라진다는 사실 자체를
    회귀 테스트로 고정해둔다."""
    result = mask_pii("내 이름은 Luis clanton 인데 호흡기 안심 클리닉은 어디에 위치 해 있어?")
    assert result == "내 이름은 L**s ******* 인데 호흡기 안심 클리닉은 어디에 위치 해 있어?"


def test_korean_name_without_trigger_word_but_with_context():
    assert mask_pii("이름이 홍길동 인데 진료 예약 가능한가요?") == "이름이 홍*동 인데 진료 예약 가능한가요?"


def test_korean_compound_surname_casual_speech():
    assert mask_pii("안녕 나는 남궁민수라고해") == "안녕 나는 남**수라고해"


def test_korean_compound_surname_with_question():
    assert mask_pii("안녕 나는 남궁민수인데 안과 진료도 받아?") == "안녕 나는 남**수인데 안과 진료도 받아?"


# --- 이름 오탐 방지 (성씨 화이트리스트 도입 목적 그 자체) ---

def test_non_name_does_not_get_masked():
    # "저는" 뒤에 성씨로 시작 안 하는 일반 표현 - 화이트리스트 도입 계기가 된 케이스
    assert mask_pii("저는 아파요") == "저는 아파요"


def test_bot_refusal_message_does_not_get_masked():
    # 실제 사례: 챗봇 거절 메시지 "미소병원"이 "미**원"으로 오탐 마스킹됐던 버그
    assert mask_pii("저는 미소병원 안내 챗봇입니다") == "저는 미소병원 안내 챗봇입니다"


def test_place_name_starting_with_surname_char_via_trigger():
    # "서울"의 "서"가 성씨라 트리거 패턴만으로 오탐할 뻔했던 케이스 - 조사 lookahead로 방지됨
    assert mask_pii("저는 서울에 살아요") == "저는 서울에 살아요"


def test_food_name_starting_with_surname_char():
    # "김치찌개"의 "김"이 성씨라 NER 쪽에서 오탐할 뻔했던 케이스
    assert mask_pii("김치찌개 먹고 배가 아파요") == "김치찌개 먹고 배가 아파요"


# --- 이메일 / 차트번호 ---

def test_email():
    assert mask_pii("내 이메일은 test@example.com 이야") == "내 이메일은 [MASKED_EMAIL] 이야"


def test_chart_number():
    assert mask_pii("제 차트 번호는 12345678 인데요") == "제 차트 번호는 [MASKED_CHART_NO] 인데요"


# --- 트리거 없는 이름 (spaCy NER 2차 안전망) ---

def test_ner_catches_name_without_trigger_word():
    assert mask_pii("홍길동 취소해줘") == "홍*동 취소해줘"


def test_ner_catches_name_at_end_of_sentence():
    assert mask_pii("아파요 김구") == "아파요 김*"


# --- 알려진 미해결 버그 (2026-09-16 확인, xfail로 명시) ---

# [2026-09-16 해결됨] pii_masking.py를 origin/main 커밋 3715733 기준으로 동기화하면서
# _NAME_TAIL_BOUNDARY의 \b 제거가 반영되어 이 버그는 더 이상 재현되지 않는다.
# xfail 마커 제거 - 이제 일반 회귀 테스트로 취급.
def test_place_name_ending_in_station_is_not_masked_as_name():
    assert mask_pii("나는 강남역 근처에 있어요") == "나는 강남역 근처에 있어요"


@pytest.mark.xfail(
    reason=(
        "실제 재현됨: spaCy 한국어 모델이 없으면(nlp=None) 아무 경고 없이 6번 블록(NER 기반 "
        "트리거 없는 이름 마스킹)이 통째로 스킵됨 - '홍길동 취소해줘' 같은 문장이 그대로 통과. "
        "origin/main 커밋 eb12e57이 logger.warning + start.sh 자동 설치로 이미 해결함 - "
        "로컬 chatbot 브랜치만 미반영. fail-open 상태를 정상으로 고정하지 않기 위해 xfail로 둔다."
    ),
    strict=True,
)
def test_ner_fallback_without_model_should_not_silently_pass_names_through():
    original_nlp = _pii_masking_module.nlp
    _pii_masking_module.nlp = None
    try:
        result = mask_pii("홍길동 취소해줘")
    finally:
        _pii_masking_module.nlp = original_nlp

    # 모델이 없어도 최소한 트리거 없는 이름은 그대로 새어나가면 안 된다는 것이 바람직한 동작.
    assert result != "홍길동 취소해줘"
