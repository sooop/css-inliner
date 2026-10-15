#!/usr/bin/env python3
"""
회귀·대조 테스트 (표준 라이브러리 unittest). 저장소 루트 어디서든:
    python -I sample/skills/tx-html-generator/tests/test_parity.py

1. 골든 회귀: src/markup/__golden__/expected (원본 파이썬 파서 출력, 불변)와 바이트 동일(HTML + stderr).
2. 앱(TS) 대조: tests/fixtures/ts_reference.json(= 앱 파서·합성·셸 출력, ts_reference/gen.ts 로 생성)과 같은 출력.
3. 수기 골든(sample.html 발췌), 검증 규칙, CLI 연기 테스트.
"""
import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
SCRIPTS = SKILL / 'scripts'
ROOT = SKILL.parents[2]
GOLDEN = ROOT / 'src' / 'markup' / '__golden__'
sys.path.insert(0, str(SCRIPTS))

import tx_markdown_parser as P  # noqa: E402
import tx_txmd as T  # noqa: E402
from tx_html_builder import wrap_mail_shell  # noqa: E402
from tx_links import ensure_link_targets  # noqa: E402

CASES = HERE / 'cases'
REF = json.loads((HERE / 'fixtures' / 'ts_reference.json').read_text(encoding='utf-8'))
LANGS = ['ko', 'en', 'ja']


def read(p: Path) -> str:
    return p.read_text(encoding='utf-8')  # universal newlines (원본 CLI 와 동일)


@unittest.skipUnless(GOLDEN.exists(), '골든 폴더 없음')
class GoldenRegression(unittest.TestCase):
    def test_golden_cases_byte_identical(self):
        names = sorted(p.stem for p in (GOLDEN / 'cases').glob('*.md'))
        self.assertGreaterEqual(len(names), 4)
        for name in names:
            with self.subTest(name):
                err = io.StringIO()
                with contextlib.redirect_stderr(err):
                    html = P.TracXMarkdownParser().parse(read(GOLDEN / 'cases' / f'{name}.md'))
                self.assertEqual(html.encode('utf-8'), (GOLDEN / 'expected' / f'{name}.html').read_bytes())
                self.assertEqual(err.getvalue().encode('utf-8'),
                                 (GOLDEN / 'expected' / f'{name}.stderr.txt').read_bytes())

    def test_handwritten_goldens(self):
        hw = GOLDEN / 'handwritten'
        for name in ('callout-nested', 'inline-del'):
            with self.subTest(name):
                html = P.Parser(structured=False).parse(read(hw / f'{name}.md'), False)
                self.assertEqual(html, read(hw / f'{name}.expected.html'))
                # .txmd 경로(ko)도 같다(링크에 target/rel 만 더해진다)
                r = P.parse_txmd(read(hw / f'{name}.md'), 'ko')
                self.assertEqual(r.html, ensure_link_targets(read(hw / f'{name}.expected.html')))
                self.assertEqual(r.warnings, [])


class TsParity(unittest.TestCase):
    """앱 파서(TypeScript)와 같은 출력인가. 같은 입력 파일, 같은 언어별 출력."""

    def test_reference_covers_all_cases(self):
        self.assertEqual(sorted(REF), sorted(p.name for p in CASES.iterdir()))

    def test_txmd_cases(self):
        for name, ref in REF.items():
            if ref['kind'] != 'txmd':
                continue
            text = T.parse_front_matter((CASES / name).read_text(encoding='utf-8', newline='')).body  # 원문 그대로(CRLF 보존)
            for lang in LANGS:
                with self.subTest(case=name, lang=lang, mode='preview'):
                    r = P.parse_txmd(text, lang, dyn_mode='preview')
                    self.assertEqual(r.html, ref['html']['preview'][lang])
                with self.subTest(case=name, lang=lang, mode='send'):
                    r = P.parse_txmd(text, lang, dyn_mode='send')
                    self.assertEqual(r.html, ref['html']['send'][lang])
            with self.subTest(case=name, what='warnings/variables'):
                r = P.parse_txmd(text, 'ko')
                self.assertEqual(r.warnings, ref['warnings'])
                self.assertEqual(sorted(r.variables), ref['variables'])

    def test_mail_shell(self):
        for name, ref in REF.items():
            if ref['kind'] != 'txmd':
                continue
            text = T.parse_front_matter((CASES / name).read_text(encoding='utf-8', newline='')).body
            for lang in LANGS:
                with self.subTest(case=name, lang=lang):
                    body = P.parse_txmd(text, lang, dyn_mode='preview').html
                    self.assertEqual(wrap_mail_shell(body, lang, logo_src='LOGO'), ref['html']['shell'][lang])

    def test_front_matter(self):
        for name, ref in REF.items():
            if ref['kind'] != 'frontmatter':
                continue
            with self.subTest(name):
                fm = T.parse_front_matter((CASES / name).read_text(encoding='utf-8', newline=''))
                meta = {'subject': fm.subject}
                if fm.kind:
                    meta['kind'] = fm.kind
                if fm.name:
                    meta['name'] = fm.name
                if fm.template_code:
                    meta['templateCode'] = fm.template_code
                self.assertEqual(meta, ref['meta'])
                self.assertEqual(fm.body, ref['body'])
                self.assertEqual(fm.warnings, ref['warnings'])

    def test_fallback_to_base(self):
        text = read(CASES / 't03-callout-i18n.txmd')
        en = P.parse_txmd(text, 'en', fallback=True).html
        self.assertIn('class="btn btn-secondary" target="_blank" rel="noopener noreferrer">문의</a>', en)
        en0 = P.parse_txmd(text, 'en', fallback=False).html
        self.assertIn('class="btn btn-secondary" target="_blank" rel="noopener noreferrer"></a>', en0)


class Behaviors(unittest.TestCase):
    def test_links_policy(self):
        h = P.parse_txmd(read(CASES / 't08-links.txmd'), 'ko').html
        for must in ('<a href="https://x.com" target="_blank" rel="noopener noreferrer">',
                     '<a href="/my" target="_blank"', '<a href="|!#-url|" target="_blank"',
                     'href="https://www.tracxlogis.com" class="btn btn-primary" target="_blank"'):
            self.assertIn(must, h)
        for untouched in ('<a href="mailto:a@b.com">', '<a href="tel:010">', '<a href="#top">'):
            self.assertIn(untouched, h)
        self.assertEqual(ensure_link_targets(ensure_link_targets(h)), h)  # 멱등
        self.assertEqual(ensure_link_targets('<a href="https://a.com" target="_self" rel="nofollow">'),
                         '<a href="https://a.com" target="_blank" rel="nofollow noopener noreferrer">')

    def test_legacy_ignores_translation_syntax(self):
        # 번역 줄을 인식하지 않는 원본 호환 경로: @en 줄은 일반 텍스트
        self.assertEqual(P.Parser(structured=False).parse('문단\n@en hello', False), '<p>문단<br/>@en hello</p>')

    def test_normalize(self):
        src = ('﻿---\r\nsubject.en: B  \r\nname: N\r\nkind: notice\r\nsubject.ko: A\r\n---\r\n'
               '\r\n\r\n# 제목   \r\n\r\n\r\n문단\r\n\r\n')
        out = T.normalize_txmd(src)
        self.assertEqual(out, '---\nkind: notice\nname: N\nsubject.ko: A\nsubject.en: B\n---\n# 제목\n\n문단\n')
        self.assertEqual(T.normalize_txmd(out), out)  # 멱등
        self.assertEqual(T.normalize_txmd('본문\n', name='X', kind='mail'), '---\nkind: mail\nname: X\n---\n본문\n')
        self.assertEqual(T.normalize_txmd('본문\n\n\n\n끝'), '본문\n\n끝\n')

    def codes(self, text, **kw):
        rep = T.analyze(text, **kw)
        return {i.code for i in rep.errors}, {i.code for i in rep.warnings}, rep

    def test_analyze_clean_mail(self):
        text = ('---\nkind: mail\nname: N\nsubject.ko: 안녕 |!#-n|\nsubject.en: Hi |!#-n|\nsubject.ja: こんにちは |!#-n|\n---\n'
                '# 안녕\n@en Hi\n@ja こんにちは\n\n|!#-n|님\n@en |!#-n|\n@ja |!#-n|様\n')
        e, w, rep = self.codes(text)
        self.assertEqual((e, w), (set(), set()))
        self.assertEqual(rep.variables, ['n'])

    def test_analyze_untranslated_and_placeholder_mismatch(self):
        text = ('---\nname: N\nsubject.ko: a\nsubject.en: b\n---\n# 제목\n@en Title\n\n|!#-a|님 |!#-b|\n'
                '@en |!#-a| only\n\n마지막 문단\n')
        e, w, rep = self.codes(text)
        self.assertIn('placeholder-mismatch', e)
        self.assertIn('untranslated', w)
        self.assertIn('lang-missing', w)       # ja 전혀 없음
        self.assertIn('subject-missing', w)    # subject.ja

    def test_analyze_subject_placeholder_mismatch(self):
        e, _, _ = self.codes('---\nname: n\nsubject.ko: a |!#-x|\nsubject.en: a\nsubject.ja: a |!#-x|\n---\n본문\n@en b\n@ja c\n')
        self.assertIn('subject-placeholder-mismatch', e)

    def test_analyze_unclosed(self):
        e, _, _ = self.codes('[정보: t]\n본문\n')
        self.assertIn('unclosed', e)
        e, _, _ = self.codes('[표: 가로형]\n{a| b}\n- 1| 2\n# 제목\n')
        self.assertIn('unclosed', e)

    def test_analyze_notice_rules(self):
        text = ('---\nkind: notice\nname: N\nsubject.ko: 점검 |!#-d|\n---\n안녕 |!#-x|\n\n'
                '[표: 가로형, 동적: t]\n{a| b}\n- {{v}}| 1\n[/표]\n')
        e, _, _ = self.codes(text, langs=['ko'])
        self.assertIn('notice-placeholder', e)
        self.assertIn('notice-dynamic-table', e)
        # 같은 내용이 mail 이면 통과
        e2, _, _ = self.codes(text.replace('kind: notice', 'kind: mail'), langs=['ko'])
        self.assertNotIn('notice-placeholder', e2)
        self.assertNotIn('notice-dynamic-table', e2)

    def test_analyze_unknown_lang_and_leftover(self):
        _, w, _ = self.codes('---\nkind: notice\nname: n\n---\n문단\n@jp 日本語\n\n[/정보]\n')
        self.assertIn('unknown-lang-code', w)
        self.assertIn('leftover-markup', w)

    def test_dynamic_table_preview_vs_send(self):
        text = read(CASES / 't02-dynamic.txmd')
        pv = P.parse_txmd(text, 'en', dyn_mode='preview').html
        self.assertIn('<td>2 pcs</td>', pv)
        self.assertIn('&lt;보조&gt; &amp; &quot;배터리&quot;', pv)   # 예시 값은 이스케이프
        self.assertIn('<tbody>|!#-rows_nosample|</tbody>', pv)        # 예시 행 없으면 표식
        sd = P.parse_txmd(text, 'en', dyn_mode='send').html
        self.assertIn('<tbody>|!#-rows_orders|</tbody>', sd)
        self.assertNotIn('data-', sd)


class ExampleDocs(unittest.TestCase):
    """references/example.md 의 ```txmd 블록은 전부 오류 0건·경고 0건이어야 한다(문서 예시는 검증된 것만)."""

    def blocks(self, name):
        text = read(SKILL / 'references' / name)
        return re.findall(r'^```txmd\n(.*?)^```', text, re.S | re.M)

    def test_examples_validate_clean(self):
        blocks = self.blocks('example.md')
        self.assertGreaterEqual(len(blocks), 2)
        kinds = set()
        for i, b in enumerate(blocks):
            with self.subTest(block=i):
                rep = T.analyze(b)
                kinds.add(rep.kind)
                self.assertEqual([(x.code, x.message) for x in rep.issues], [])
                for lang in LANGS:  # 미번역 없이 세 언어 모두 채워졌는가
                    r = P.parse_txmd(rep.front.body, lang, fallback=False)
                    self.assertTrue(all(u.rec.get(lang) for u in r.units if re.search(r'[^\W\d_]', u.rec.get('ko', ''))))
        self.assertEqual(kinds, {'mail', 'notice'})

    def test_example_cases_in_sync(self):
        # 앱 파서 대조 입력(tests/cases/e0*.txmd)이 문서 예시와 같은 내용인지(드리프트 방지)
        blocks = self.blocks('example.md')
        for n, b in zip(['e01-mail-example', 'e02-notice-example'], blocks):
            self.assertEqual((CASES / f'{n}.txmd').read_text(encoding='utf-8'), b)


class CliSmoke(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, '-I', str(SCRIPTS / 'tx_generate.py'), *args],
                              capture_output=True, text=True, encoding='utf-8')

    def test_preview_dir_and_normalize(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / 'in.txmd'
            src.write_text('---\nkind: mail\nname: 배송\nsubject.ko: 배송 시작\nsubject.en: Shipped\nsubject.ja: 発送\n---\n'
                           + read(CASES / 't01-multilang.txmd'), encoding='utf-8')
            r = self.run_cli(str(src), '--preview-dir', str(Path(d) / 'out'), '--normalize', str(Path(d) / 'n.txmd'))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            for lang in LANGS:
                doc = (Path(d) / 'out' / f'preview_{lang}.html').read_text(encoding='utf-8')
                self.assertIn(f'<html lang="{lang}">', doc)
                self.assertIn('class="mail-container"', doc)
                self.assertIn('data:image/png;base64,', doc)
            self.assertIn('Your shipment is on its way',
                          (Path(d) / 'out' / 'preview_en.html').read_text(encoding='utf-8'))
            self.assertTrue((Path(d) / 'n.txmd').read_text(encoding='utf-8').startswith('---\nkind: mail\nname: 배송\n'))

    def test_notice_preview_has_no_shell(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / 'n.txmd'
            src.write_text('---\nkind: notice\nname: 점검\nsubject.ko: 점검 안내\nsubject.en: Maintenance\nsubject.ja: メンテ\n---\n'
                           '# 점검\n@en Maintenance\n@ja メンテ\n', encoding='utf-8')
            r = self.run_cli(str(src), '--preview-dir', d)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            doc = (Path(d) / 'preview_en.html').read_text(encoding='utf-8')
            self.assertNotIn('class="mail-container"', doc)
            self.assertIn('<div class="notice">', doc)

    def test_error_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / 'bad.txmd'
            src.write_text('[정보: t]\n본문\n', encoding='utf-8')
            self.assertEqual(self.run_cli(str(src)).returncode, 1)
            self.assertEqual(self.run_cli(str(Path(d) / 'none.txmd')).returncode, 2)

    def test_legacy_cli_two_positional(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / 'o.html'
            r = self.run_cli(str(CASES / 'g01-syntax-all.md'), str(out), '--title', '문서 제목')
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            doc = out.read_text(encoding='utf-8')
            self.assertIn('<title>문서 제목</title>', doc)
            self.assertIn('table-vertical', doc)


if __name__ == '__main__':
    unittest.main(verbosity=1)
