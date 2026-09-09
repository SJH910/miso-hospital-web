"""
교차검증: shared_test_vectors.json에 대해 Python mask_pii가 기대한 대로 판정하는지 확인.
같은 파일을 was/test-shared-vectors.js가 JS 쪽에서도 검증한다 - 두 결과가 어긋나면
Python/JS 마스킹 규칙이 드리프트됐다는 신호.
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pii_masking import mask_pii

VECTORS_PATH = Path(__file__).resolve().parent.parent / "shared_test_vectors.json"


class TestSharedVectors(unittest.TestCase):
    def test_all_vectors(self):
        with open(VECTORS_PATH, encoding="utf-8") as f:
            vectors = json.load(f)

        for v in vectors:
            with self.subTest(text=v["text"]):
                result = mask_pii(v["text"])
                has_url = "[MASKED_INTERNAL_URL]" in result
                has_key = "[MASKED_API_KEY]" in result
                self.assertEqual(has_url, v["expect_internal_url"], f"internal_url 판정 불일치: {v['text']!r} -> {result!r}")
                self.assertEqual(has_key, v["expect_api_key"], f"api_key 판정 불일치: {v['text']!r} -> {result!r}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
