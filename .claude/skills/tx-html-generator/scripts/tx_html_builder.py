#!/usr/bin/env python3
"""
TracX Logis HTML Builder

본문 HTML 을 미리보기 문서(완전한 HTML)로 만든다.
- 메일: 앱 셸(src/markup/shell.ts)과 같은 구조 - 로고 헤더 + 본문(<main class="mail-content">) + 푸터, 폭 600px 표 래퍼.
- 공지: 셸 없는 본문 조각(앱의 공지 출력과 같은 형태). 미리보기 문서에서만 호스트 페이지 흉내(폰트·여백)를 둔다.
스타일은 assets/template.css(앱 src/styles/template.css 사본)를 <style> 로 넣는다.
"""

import argparse
import base64
import html as html_module
import os
import re
import sys
from typing import Callable, Dict, List, Optional

try:
    from tx_links import ensure_link_targets
except ImportError:  # pragma: no cover
    from .tx_links import ensure_link_targets  # type: ignore

DEFAULT_LOGO_ALT = 'TRACXLOGIS'
DEFAULT_LOGO_HREF = 'https://www.tracxlogis.com'
DEFAULT_FOOTER_BLOCKS = [
    'TracXLogis - Beyond Borders, Beyond Limit',
    '© TRACXLOGIS Co., Ltd.',
]
TABLE_ATTRS = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'

# 미리보기 문서 전용 보조 스타일 (발송·공지 출력과 무관)
PREVIEW_BASE_CSS = """html,body{margin:0;padding:0}
body{background:#fff}
.tx-ph{background:#FFF1B8;color:#5A4300;padding:0 2px;border-radius:2px;font-family:ui-monospace,Consolas,monospace;font-size:.9em}
.tx-preview-bar{padding:8px 14px;background:#F3F6FB;border-bottom:1px solid #D0DEF2;font:12px/18px 'Malgun Gothic',Arial,sans-serif;color:#3E5468}
.tx-preview-bar b{color:#0F2A52}"""
# 공지: template.css 의 .mail 기본값과 같은 규칙(앱 NOTICE_CSS) + 호스트 페이지 흉내(앱 NOTICE_HOST_CSS)
NOTICE_CSS = """.notice { font-size: 14px; line-height: 25px; color: var(--body); }
.notice > :first-child { margin-top: 0; }"""
NOTICE_HOST_CSS = ("body{font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Segoe UI',Arial,sans-serif;"
                   "padding:28px 36px;background:#fff}")


def _attr(s: str) -> str:
    return s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')


def _esc(s: str) -> str:
    return html_module.escape(s, quote=True)


def strip_main(html: str) -> str:
    """입력의 <main> 여는/닫는 태그를 모두 제거(셸이 <main> 을 한 번만 만든다)"""
    return re.sub(r'</?main\b(?:"[^"]*"|\'[^\']*\'|[^\'">])*>', '', html, flags=re.IGNORECASE).strip()


def wrap_mail_shell(inner_html: str, lang: str, *, logo_src: str, logo_alt: str = DEFAULT_LOGO_ALT,
                    logo_href: str = DEFAULT_LOGO_HREF, header_tag: Optional[str] = None,
                    footer_blocks: Optional[List[str]] = None) -> str:
    """
    합성이 끝난 본문 HTML 을 메일 셸로 감싼다(앱의 wrapShell + composeForSend + setShellLang 결과와 같은 구조).
    header_tag/footer_blocks 는 이미 해당 언어의 인라인 HTML 이다.
    """
    inner = strip_main(inner_html)
    blocks = DEFAULT_FOOTER_BLOCKS if footer_blocks is None else footer_blocks
    tag_cell = (f'<td class="mail-tag" align="right" valign="middle">{header_tag}</td>' if header_tag else '')
    footer_lines = ''.join(f'<p class="mail-footer-line">{t}</p>' for t in blocks)

    header = (
        '<tr><td class="mail-header">'
        f'<table class="mail-header-row" width="100%" {TABLE_ATTRS}><tr>'
        f'<td class="mail-logo" valign="middle"><a href="{_attr(logo_href)}" target="_blank">'
        f'<img class="logo" src="{_attr(logo_src)}" alt="{_attr(logo_alt)}" width="160" height="25"></a></td>'
        f'{tag_cell}'
        '</tr></table></td></tr>'
    )
    footer = (
        '<tr><td class="mail-footer-wrap">'
        f'<table class="mail-footer-row" width="100%" {TABLE_ATTRS}><tr><td class="mail-footer">'
        f'{footer_lines}'
        '</td></tr></table></td></tr>'
    ) if footer_lines else ''

    html = (
        f'<table class="mail" width="100%" {TABLE_ATTRS} bgcolor="#FFFFFF" lang="{_attr(lang)}"><tr>'
        '<td class="mail-outer" align="center">'
        f'<table class="mail-container" width="600" align="center" {TABLE_ATTRS}>'
        f'{header}'
        f'<tr><td class="mail-body"><main class="mail-content">\n{inner}\n</main></td></tr>'
        f'{footer}'
        '</table></td></tr></table>'
    )
    return ensure_link_targets(html)


def wrap_notice_fragment(inner_html: str) -> str:
    """공지 미리보기용 임시 래퍼(앱이 인라인 때 쓰는 `div.notice` 와 같음). 실제 공지 출력에는 포함되지 않는다."""
    return f'<div class="notice">\n{inner_html}\n</div>'


def highlight_placeholders(html: str) -> str:
    """미리보기 전용: 본문 텍스트(태그·속성 밖)의 `|!#-x|` 를 노란 표시로 감싼다."""
    parts = re.split(r'(<[^>]*>)', html)
    out = []
    for p in parts:
        if p.startswith('<'):
            out.append(p)
        else:
            out.append(re.sub(r'\|!#-[^|]+\|', lambda m: f'<span class="tx-ph">{m.group(0)}</span>', p))
    return ''.join(out)


class TemplateBuilder:
    """assets 폴더의 template_base.html / template.css / logo_tx.png 로 미리보기 문서를 만든다."""

    def __init__(self, template_dir: Optional[str] = None):
        if template_dir is None:
            template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
        self.template_dir = template_dir
        self.template: Optional[str] = None
        self.css: Optional[str] = None
        self.logo_base64: Optional[str] = None

    def _read(self, name: str) -> str:
        path = os.path.join(self.template_dir, name)
        if not os.path.exists(path):
            raise FileNotFoundError(f'템플릿 파일을 찾을 수 없습니다: {path}')
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()

    def load_template(self) -> None:
        self.template = self._read('template_base.html')

    def load_css(self) -> None:
        self.css = self._read('template.css')

    def load_logo(self) -> None:
        path = os.path.join(self.template_dir, 'logo_tx.png')
        if not os.path.exists(path):
            print(f'경고: 로고 파일을 찾을 수 없습니다: {path} (빈 로고로 진행)', file=sys.stderr)
            self.logo_base64 = ''
            return
        with open(path, 'rb') as f:
            self.logo_base64 = base64.b64encode(f.read()).decode('ascii')

    def load_all(self) -> 'TemplateBuilder':
        self.load_template()
        self.load_css()
        self.load_logo()
        return self

    @property
    def logo_src(self) -> str:
        return f'data:image/png;base64,{self.logo_base64 or ""}'

    def _fill(self, values: Dict[str, str]) -> str:
        # 한 번에 치환한다(본문 안의 {{행 변수}} 가 다시 치환되지 않도록)
        assert self.template is not None
        return re.sub(r'\{\{(\w+)\}\}', lambda m: values.get(m.group(1), m.group(0)), self.template)

    def build_document(self, body_html: str, lang: str, *, kind: str = 'mail', title: str = 'TracX Logis',
                       subject: Optional[str] = None, shell: bool = True,
                       footer_blocks: Optional[List[str]] = None) -> str:
        """
        미리보기 문서 하나. body_html 은 parse_txmd() 가 만든 해당 언어 본문(<main> 없음).
        kind == 'mail': 셸로 감싼다(shell=False 면 본문만). kind == 'notice': 셸 없이 본문 조각.
        """
        if self.template is None or self.css is None or self.logo_base64 is None:
            self.load_all()
        body = highlight_placeholders(body_html)
        extra = PREVIEW_BASE_CSS
        bar = ''
        if kind == 'notice':
            body = wrap_notice_fragment(body)
            extra += '\n' + NOTICE_CSS + '\n' + NOTICE_HOST_CSS
            label = '공지 제목'
        else:
            if shell:
                body = wrap_mail_shell(body, lang, logo_src=self.logo_src, footer_blocks=footer_blocks)
            label = '메일 제목'
        if subject:
            bar = (f'<div class="tx-preview-bar">미리보기 [{_esc(lang)}] {label}: <b>{highlight_placeholders(_esc(subject))}</b>'
                   ' (미리보기 전용 표시 — 발송 HTML 에는 들어가지 않음)</div>\n')
        return self._fill({
            'lang': _esc(lang),
            'title': _esc(title),
            'styles': self.css or '',
            'preview_styles': extra,
            'content': bar + body,
        })

    # 하위 호환: 예전 build(content_html, title). 본문(원본 호환 파서 출력)을 메일 셸로 감싼 단일 문서.
    def build(self, content_html: str, title: str = 'TracX Logis') -> str:
        content_html = content_html.replace('<!--HEADER_PLACEHOLDER-->', '')
        return self.build_document(content_html, 'ko', kind='mail', title=title)


def main():
    """CLI: 본문 HTML 파일 -> 미리보기 문서 (예전 인터페이스 유지)"""
    ap = argparse.ArgumentParser(description='본문 HTML 을 TracX Logis 미리보기 문서로 감쌉니다.')
    ap.add_argument('input', help='입력 HTML 본문 파일')
    ap.add_argument('output', help='출력 HTML 파일')
    ap.add_argument('--title', default='TracX Logis')
    ap.add_argument('--template-dir', default=None, help='assets 폴더(기본: 스킬의 assets)')
    ap.add_argument('--kind', choices=['mail', 'notice'], default='mail')
    ap.add_argument('--lang', default='ko')
    args = ap.parse_args()
    try:
        with open(args.input, 'r', encoding='utf-8') as f:
            content = f.read().replace('<!--HEADER_PLACEHOLDER-->', '')
        b = TemplateBuilder(args.template_dir).load_all()
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(b.build_document(content, args.lang, kind=args.kind, title=args.title))
        print(f'[완료] 문서 생성: {args.output}')
    except Exception as e:  # noqa: BLE001
        print(f'[오류] {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
