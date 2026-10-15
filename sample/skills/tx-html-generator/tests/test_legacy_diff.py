#!/usr/bin/env python3
"""
기존 단일 언어 입력의 출력 회귀(퍼즈): 개정 전 원본 파서(tests/legacy/legacy_tx_markdown_parser.py, 동결 사본)와
개정 파서가 같은 HTML·같은 stderr 를 내는지 무작위 문서로 비교한다.

제외한 입력(의도적으로 달라진 부분, tx_markdown_parser.py 상단 주석 참조):
  - 콜아웃 [정보|경고|강조]  : 본문에 표·목록·버튼·인용·구분선을 쓸 수 있게 확장됨(원본은 문자 그대로 <p> 안에 흘림)
  - `_` 포함 줄(변수·URL 안의 밑줄 오인 수정), `~` 포함 줄(취소선 확장)
허용한 차이: 원본이 버튼 3개 이상 그룹에서 <p> 를 중첩시키던 버그(`</a><p><a`), 원본의 IndexError 크래시.

    python -I sample/skills/tx-html-generator/tests/test_legacy_diff.py
"""
import contextlib
import importlib.util
import io
import random
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(SKILL / 'scripts'))
import tx_markdown_parser as new  # noqa: E402

spec = importlib.util.spec_from_file_location('legacy_parser', HERE / 'legacy' / 'legacy_tx_markdown_parser.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)

POOL_EXTRA = [
    '', '', '', '[표: 세로형]', '[표: 가로형]', '{a| b}', '- k: v', '- 1| 2', '[/표]', '## h2', '### h3', '- 항목', '  - 중첩',
    '1. 하나', '> 인용', '[버튼, 확인, https://x.com]', '[버튼, 취소, #]', '일반 **문장** *기울임* [링크](https://a.com)',
    '문장 a', '문장 b', '---', '***', '# 제목', '[헤더]', '|!#-x| 와 {y}', '특수문자 3 < 5 & "따옴표"',
]
CALLOUT = ('[정보', '[경고', '[강조', '[/정보', '[/경고', '[/강조')


def run(parse, text):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        out = parse(text)
    return out, err.getvalue()


class LegacyFuzz(unittest.TestCase):
    def test_same_output_as_frozen_original(self):
        pool = list(POOL_EXTRA)
        golden = SKILL.parents[2] / 'src' / 'markup' / '__golden__' / 'cases'
        for f in sorted(golden.glob('*.md')) if golden.exists() else sorted((HERE / 'cases').glob('g0*.md')):
            pool += f.read_text(encoding='utf-8').split('\n')
        pool = [l for l in pool if not l.strip().startswith(CALLOUT) and '_' not in l and '~' not in l]
        rnd = random.Random(20261015)
        compared = crashes = tolerated = 0
        for i in range(3000):
            text = '\n'.join(rnd.choice(pool) for _ in range(rnd.randint(1, 14)))
            try:
                a = run(old.TracXMarkdownParser().parse, text)
            except IndexError:   # 원본 크래시: 개정판은 크래시하지 않는다
                crashes += 1
                run(new.TracXMarkdownParser().parse, text)
                continue
            b = run(new.TracXMarkdownParser().parse, text)
            if a != b:
                self.assertIn('</a><p><a', a[0], f'#{i} 예상 밖 차이:\n{text}\n--old\n{a[0]}\n--new\n{b[0]}')
                tolerated += 1
                continue
            compared += 1
        self.assertGreater(compared, 2500)
        print(f'\n동일 {compared}건 / 허용된 차이 {tolerated}건 / 원본 크래시 {crashes}건')


if __name__ == '__main__':
    unittest.main(verbosity=1)
