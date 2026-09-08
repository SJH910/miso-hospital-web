#!/usr/bin/env python3
"""로컬 프론트 개발 서버. 기본 http.server와 동일하지만 캐시를 전부 끈다.

python3 -m http.server만 쓰면 브라우저(특히 LAN의 다른 기기)가 "/" 같은 응답을
캐시해서, 파일을 고쳐도 화면이 안 바뀌는 것처럼 보일 수 있다. 이 스크립트는
모든 응답에 Cache-Control: no-store를 붙여서 그 문제를 막는다.

사용법: python3 serve.py [포트, 기본 5500]
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    # ThreadingHTTPServer를 써야 함: 기본 HTTPServer는 연결을 한 번에 하나씩만
    # 처리해서, 브라우저가 같은 페이지 로드에서 연결을 여러 개 동시에 열면
    # (정적 파일 여러 개를 병렬로 받아오는 것뿐인 정상적인 동작) 서버 전체가
    # 멈춰버린다. curl은 연결을 하나만 쓰기 때문에 이 문제가 안 보였다.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()
