# Chatbot Service Issue History & Fixes

## 📅 업데이트 일자: 2026-09-08

### 1. 이슈 개요 (Troubleshooting)
- **증상**: 챗봇 프론트엔드 및 API(`/chat`) 호출 시 `{"answer":"죄송합니다. 현재 챗봇 서비스에 문제가 발생했습니다."}` 에러가 발생하며 정상적인 답변이 오지 않음.
- **에러 로그**: `Agent error: 404 models/gemini-1.5-flash is not found` 및 `models/gemini-2.5-flash is no longer available`
- **원인 분석**: 
  - 과거에 사용되던 Gemini 모델(1.5-flash, 2.5-flash)이 Google API 서버에서 더 이상 지원되지 않아 발생하는 404 모델 에러.
  - 일부 스크립트 실행 시 환경 변수(`.env`) 로드 누락.

### 2. 해결 및 수정 사항 (Fixes)
- **`.env` 환경변수 충돌 방지 처리**
  - 기존 `.env` 파일에 작성되어 있던 `GEMINI_MODEL` 값을 주석 처리하여, 환경 변수가 코드의 최신 모델 설정을 덮어쓰는(Twisted) 문제를 방지했습니다.
- **`3-1-llm.py` (LLM 모델 최신화)**
  - 지원이 종료된 모델을 대신하여, 현재 서비스 가능한 가장 빠르고 저렴한 최신 모델인 `gemini-3.6-flash`로 코드를 수정(하드코딩)했습니다.
- **`2-embeddings.py` (임베딩 안정화 및 API 키 로드)**
  - 임베딩 모델을 `models/gemini-embedding-001`로 명시했습니다.
  - 파일 상단에 `from dotenv import load_dotenv; load_dotenv()` 코드를 추가하여, 단독 실행 시에도 `.env`에서 `GEMINI_API_KEY`를 정상적으로 읽어올 수 있도록 수정했습니다.
- **GitHub 원격 저장소 동기화 (Push)**
  - 위 수정 사항이 적용된 `3-1-llm.py`와 `2-embeddings.py` 파일을 `miso-hospital` GitHub 저장소의 `main` 브랜치에 성공적으로 푸쉬(Push)하여 팀원들과 공유될 수 있도록 반영했습니다.

