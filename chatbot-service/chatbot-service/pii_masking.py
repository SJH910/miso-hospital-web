import re

# spacy(+ 한국어 모델)는 무거운 선택적 의존성이라, 설치가 안 되어 있어도
# 정규식 기반 마스킹(주민번호/전화번호/이메일/이름 패턴)은 그대로 동작하게 방어적으로 처리.
try:
    import spacy
    try:
        nlp = spacy.load("ko_core_news_sm")
    except OSError:
        nlp = None  # spacy는 있지만 한국어 모델이 없는 경우
except ImportError:
    nlp = None  # spacy 자체가 설치 안 된 경우

def build_spaced_regex(digit_counts):
    # digit_counts = [6, 7] -> 6 digits, then 7 digits
    parts = []
    for count in digit_counts:
        part = r'[\s\-\~_]*'.join([r'\d'] * count)
        parts.append(part)
    return re.compile(r'(' + parts[0] + r')[\s\-\~_]*(' + parts[1] + r')')

def mask_pii(text: str) -> str:
    """
    사용자 입력 텍스트에서 PII(개인정보)를 탐지하고 마스킹 처리합니다.
    """
    if not text:
        return text

    masked_text = text

    # 1. 주민등록번호 (RRN)
    # \d 6번 + \d 7번
    rrn_pattern = build_spaced_regex([6, 7])
    masked_text = rrn_pattern.sub(r'\1-[MASKED]', masked_text)

    # 2. 전화번호 (Phone Number)
    # 010 (3) + 4 + 4
    # '0', '1', '[016789]'
    phone_part1 = r'0[\s\-\~_]*1[\s\-\~_]*[016789]'
    phone_part2 = r'[\s\-\~_]*'.join([r'\d'] * 3) + r'[\s\-\~_]*\d?' # 3 or 4 digits. Let's just use 4 digits for simplicity, or \d 4 times.
    phone_part2 = r'[\s\-\~_]*'.join([r'\d'] * 4)
    phone_part3 = r'[\s\-\~_]*'.join([r'\d'] * 4)
    phone_pattern = re.compile(f'({phone_part1})[\\s\\-\\~_]*({phone_part2})[\\s\\-\\~_]*({phone_part3})')
    masked_text = phone_pattern.sub(r'\1-****-\3', masked_text)

    # 3. 이름 (Name)
    # 문맥상 이름이 나오는 패턴을 잡아 마스킹 (lookahead 활용)
    name_pattern1 = re.compile(
        r'(이름은|이름이|저는|내 이름은|제 이름은|나는|난|내 이름이|제 이름이)\s+([가-힣]{2,5}?)(?=\s*(?:입니다|이에요|야|이야|라고|인데|은|는|이|가|입니|요|\b|\.|\,|$))|'
        r'(이름은|이름이|저는|내 이름은|제 이름은|나는|난|내 이름이|제 이름이)\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)'
    )
    def mask_name(match):
        prefix = match.group(1) or match.group(3)
        name = match.group(2) or match.group(4)
        
        # 영문 이름 처리
        if re.match(r'^[A-Za-z\s]+$', name):
            parts = name.split()
            if len(parts) > 1:
                masked_parts = [parts[0]] + ['*' * len(p) for p in parts[1:]]
                masked_name = ' '.join(masked_parts)
            else:
                mid = len(name) // 2
                if mid == 0: mid = 1
                masked_name = name[:mid] + '*' * (len(name) - mid)
        else:
            # 한국어 이름 처리
            length = len(name)
            if length == 2:
                masked_name = name[0] + '*'
            elif length == 3:
                masked_name = name[0] + '*' + name[2]
            elif length >= 4:
                masked_name = name[0] + '*' * (length - 2) + name[-1]
            else:
                masked_name = name
                
        # 정규식에서 suffix를 포함하지 않고 lookahead로만 확인했으므로, 
        # 매치된 텍스트(접두사 + 이름)만 교체하면 뒤의 문맥은 그대로 유지됩니다.
        return f"{prefix} {masked_name}"
    
    masked_text = name_pattern1.sub(mask_name, masked_text)

    # 4. 이메일 (Email)
    email_pattern = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')
    masked_text = email_pattern.sub('[MASKED_EMAIL]', masked_text)

    # 5. 차트 번호 (8자리 숫자)
    # 이미 마스킹된 전화번호나 주민번호에 영향을 주지 않기 위해 단어 경계(\b)를 사용하고 
    # MASKED 키워드와 겹치지 않게 조심합니다.
    # 한국어 텍스트 특성상 띄어쓰기가 없으면 \b가 안 먹힐 수 있으므로
    # 앞뒤에 숫자나 영문자가 없는 8자리 숫자를 찾습니다.
    chart_pattern = re.compile(r'(?<![A-Za-z0-9\-])\d{8}(?![A-Za-z0-9\-])')
    masked_text = chart_pattern.sub('[MASKED_CHART_NO]', masked_text)

    # 6. 문맥 없는 이름 마스킹 (spaCy NER)
    if nlp is not None:
        doc = nlp(masked_text)
        # 인덱스 밀림을 방지하기 위해 뒤에서부터 교체
        for ent in reversed(doc.ents):
            if ent.label_ in ["PERSON", "PS"]:
                name = ent.text
                # 이미 마스킹된 부분(*나 MASKED)이 포함되어 있다면 건너뜀
                if '*' in name or 'MASKED' in name:
                    continue
                
                length = len(name)
                if length == 1:
                    masked_name = '*'
                elif length == 2:
                    masked_name = name[0] + '*'
                elif length == 3:
                    masked_name = name[0] + '*' + name[2]
                elif length >= 4:
                    masked_name = name[0] + '*' * (length - 2) + name[-1]
                else:
                    masked_name = name
                    
                masked_text = masked_text[:ent.start_char] + masked_name + masked_text[ent.end_char:]

    return masked_text

if __name__ == "__main__":
    # Test cases
    test_inputs = [
        "제 주민번호는 900101-1234567 입니다.",
        "제 번호는 9001011234567이에요.",
        "주민번호 9 0 0 1 0 1 - 1 2 3 4 5 6 7 입니다.",
        "전화번호는 010-1234-5678 입니다.",
        "연락처 01012345678",
        "저는 김구야",
        "제 이름은 홍길동입니다.",
        "이름이 남궁민수야",
        "저는 윤알렉산더입니다.",
        "내 이름은 Howl Jenkins 라고",
        "내 이름은 Luis clanton 인데 호흡기 안심 클리닉은 어디에 위치 해 있어?",
        "이름이 홍길동 인데 진료 예약 가능한가요?",
        "안녕 나는 남궁민수라고해",
        "안녕 나는 남궁민수인데 안과 진료도 받아?",
        "내 이메일은 test@example.com 이야",
        "제 차트 번호는 12345678 인데요",
        "홍길동 취소해줘",
        "아파요 김구"
    ]
    
    for t in test_inputs:
        print(f"Original: {t}")
        print(f"Masked  : {mask_pii(t)}")
        print("-")
