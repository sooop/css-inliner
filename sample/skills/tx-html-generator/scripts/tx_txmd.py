#!/usr/bin/env python3
"""
.txmd 문서 처리: 머리말(front matter) 읽기/쓰기, 정규화, 검증.

- parse_front_matter(): 앱의 src/markup/frontmatter.ts 와 같은 규칙(TXMD.md §6).
- normalize_txmd():     줄바꿈·공백 정리 + 머리말을 표준 순서로 다시 씀(본문 의미는 바꾸지 않는다).
- analyze():            머리말·본문 파싱 후 검증 보고서(오류/경고)를 만든다.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

try:
    from tx_markdown_parser import (ParseResult, extract_placeholders, extract_row_vars, parse_txmd)
    from tx_links import find_links_missing_target
except ImportError:  # pragma: no cover
    from .tx_markdown_parser import (ParseResult, extract_placeholders, extract_row_vars, parse_txmd)  # type: ignore
    from .tx_links import find_links_missing_target  # type: ignore

SUBJECT_LANGS = ['ko', 'en', 'ja']
DEFAULT_LANGS = ['ko', 'en', 'ja']
BASE_LANG = 'ko'


# ---------------------------------------------------------------- 머리말

@dataclass
class FrontMatter:
    kind: Optional[str] = None            # 'mail' | 'notice' | None(생략 = mail)
    name: Optional[str] = None
    template_code: Optional[str] = None
    subject: Dict[str, str] = field(default_factory=dict)
    body: str = ''
    warnings: List[str] = field(default_factory=list)
    present: bool = False                 # 머리말 블록이 있었는가


def parse_front_matter(text: str) -> FrontMatter:
    """파일 맨 첫 줄이 `---` 이면 다음 `---` 줄까지가 머리말. 한 줄 `key: value`(첫 `:` 뒤 trim). 빈 줄·`#` 줄 무시."""
    fm = FrontMatter()
    if text[:1] == '﻿':
        text = text[1:]
    lines = re.split(r'\r\n|\n|\r', text)
    if lines[0].strip() != '---':
        fm.body = text
        return fm
    end = next((i for i, l in enumerate(lines) if i > 0 and l.strip() == '---'), -1)
    if end < 0:
        fm.warnings.append('머리말이 `---` 로 닫히지 않아 전체를 본문으로 읽었습니다.')
        fm.body = text
        return fm
    fm.present = True
    for i in range(1, end):
        line = lines[i].strip()
        if line == '' or line.startswith('#'):
            continue
        c = line.find(':')
        if c < 0:
            fm.warnings.append(f'머리말 {i + 1}번째 줄을 읽지 못했습니다(key: value 형식이 아님): {line}')
            continue
        key = line[:c].strip()
        value = line[c + 1:].strip()
        if key == 'kind':
            value = re.sub(r'\s+#.*$', '', value)  # 앱과 같게: kind 는 줄 끝 `# 설명` 허용
            if value in ('mail', 'notice'):
                fm.kind = value
            elif value != '':
                fm.warnings.append(f'머리말 kind 는 mail 또는 notice 여야 합니다(받은 값: {value}) — mail 로 처리합니다.')
        elif key == 'name':
            if value:
                fm.name = value
        elif key == 'templateCode':
            if value:
                fm.template_code = value
        elif key.startswith('subject.'):
            lang = key[len('subject.'):].strip()
            if lang in SUBJECT_LANGS:
                fm.subject[lang] = value
            else:
                fm.warnings.append(f'머리말 제목의 언어 {lang} 는 지원하지 않습니다(ko·en·ja) — 무시합니다.')
        else:
            fm.warnings.append(f'머리말의 알 수 없는 키 {key} 는 무시합니다.')
    fm.body = '\n'.join(lines[end + 1:])
    return fm


def format_front_matter(fm: FrontMatter) -> str:
    out = ['---']
    out.append(f'kind: {fm.kind or "mail"}')
    if fm.name:
        out.append(f'name: {fm.name}')
    if fm.template_code:
        out.append(f'templateCode: {fm.template_code}')
    for lang in SUBJECT_LANGS:
        if lang in fm.subject:
            out.append(f'subject.{lang}: {fm.subject[lang]}')
    out.append('---')
    return '\n'.join(out)


def normalize_txmd(text: str, *, name: Optional[str] = None, kind: Optional[str] = None,
                   template_code: Optional[str] = None, subject: Optional[Dict[str, str]] = None) -> str:
    """
    정규화된 .txmd 문자열을 돌려준다.
    - 줄바꿈 LF, BOM 제거, 줄 끝 공백 제거, 연속 빈 줄은 하나로, 파일 끝 개행 1개
    - 머리말이 있으면(또는 override 인자가 있으면) 표준 순서로 다시 쓴다: kind, name, templateCode, subject.ko/en/ja
    - 본문 의미는 바꾸지 않는다(파서가 줄 끝 공백·빈 줄 수를 무시한다)
    """
    fm = parse_front_matter(text)
    if name:
        fm.name = name
    if kind:
        fm.kind = kind
    if template_code:
        fm.template_code = template_code
    if subject:
        fm.subject.update({k: v for k, v in subject.items() if v})
    body_lines = [l.rstrip() for l in fm.body.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    squeezed: List[str] = []
    for l in body_lines:
        if l == '' and (not squeezed or squeezed[-1] == ''):
            continue
        squeezed.append(l)
    while squeezed and squeezed[-1] == '':
        squeezed.pop()
    body = '\n'.join(squeezed)
    has_meta = fm.present or any([name, kind, template_code, subject])
    head = format_front_matter(fm) + '\n' if has_meta else ''
    return head + body + '\n'


# ---------------------------------------------------------------- 검증

@dataclass
class Issue:
    level: str   # 'error' | 'warning'
    code: str
    message: str


@dataclass
class Report:
    kind: str
    name: Optional[str]
    langs: List[str]
    subject: Dict[str, str]
    issues: List[Issue] = field(default_factory=list)
    results: Dict[str, ParseResult] = field(default_factory=dict)
    stats: Dict[str, int] = field(default_factory=dict)
    variables: List[str] = field(default_factory=list)
    front: Optional[FrontMatter] = None

    @property
    def errors(self) -> List[Issue]:
        return [i for i in self.issues if i.level == 'error']

    @property
    def warnings(self) -> List[Issue]:
        return [i for i in self.issues if i.level == 'warning']

    def add(self, level: str, code: str, message: str) -> None:
        self.issues.append(Issue(level, code, message))


_TAG_RE = re.compile(r'<[^>]*>')
_LETTER_RE = re.compile(r'[^\W\d_]', re.UNICODE)
_HREF_RE = re.compile(r'href="([^"]*)"')
_LEFTOVER_RE = re.compile(r'\[/?(?:정보|경고|강조|표|버튼|헤더)[:,\]]')


def _plain(html: str) -> str:
    return _TAG_RE.sub('', html)


def _snippet(html: str, n: int = 28) -> str:
    t = _plain(html).strip()
    return t if len(t) <= n else t[:n] + '…'


def _has_letters(html: str) -> bool:
    """번역이 필요한 글자(문자)가 있는가. 치환자·행 변수·숫자·기호만이면 번역 대상이 아니다."""
    t = re.sub(r'\|!#-[^|]+\||\{\{[^}]+\}\}', '', _plain(html))
    t = re.sub(r'https?://\S+', '', t)
    return bool(_LETTER_RE.search(t))


def _classify_parse_warning(w: str) -> tuple:
    if '종료 태그' in w or '자동 종료' in w:
        return 'error', 'unclosed'
    if '동적 표를 지원하지 않습니다' in w:
        return 'error', 'dynamic-table-unsupported'
    if '행 템플릿에 변수가 빠졌습니다' in w or '동적 표 id' in w:
        return 'error', 'dynamic-table'
    if '번역 대상 블록이 없는' in w or '번역 줄이 무시' in w:
        return 'warning', 'orphan-translation'
    if '칼럼 수 불일치' in w:
        return 'warning', 'column-mismatch'
    return 'warning', 'parse'


def analyze(text: str, langs: Optional[List[str]] = None, kind_override: Optional[str] = None) -> Report:
    langs = list(langs or DEFAULT_LANGS)
    fm = parse_front_matter(text)
    kind = kind_override or fm.kind or 'mail'
    rep = Report(kind=kind, name=fm.name, langs=langs, subject=dict(fm.subject), front=fm)

    for w in fm.warnings:
        rep.add('warning', 'front-matter', w)
    if not fm.present:
        rep.add('warning', 'no-front-matter',
                '머리말이 없습니다. 앱에서 불러오면 프로젝트 이름·제목을 직접 입력해야 합니다(kind/name/subject.* 권장).')
    else:
        if not fm.name:
            rep.add('warning', 'name-missing', '머리말에 name(프로젝트 이름)이 없습니다.')
    for lang in langs:
        if lang in SUBJECT_LANGS and not fm.subject.get(lang):
            rep.add('warning', 'subject-missing',
                    f'머리말에 subject.{lang} ({"공지 제목" if kind == "notice" else "메일 제목"}) 이 없습니다.')

    base = BASE_LANG
    others = [l for l in langs if l != base]
    body = fm.body

    # 언어별 파싱(같은 구조, 문자열만 다름). 구조 경고는 기준 언어 패스 것만 쓴다.
    for lang in langs:
        rep.results[lang] = parse_txmd(body, lang, base=base, langs=others, dyn_mode='preview')
    ko = rep.results[base]
    for w in ko.warnings:
        level, code = _classify_parse_warning(w)
        rep.add(level, code, w)

    # 알 수 없는 언어 코드 줄 (@jp, @zh 등 -> 일반 텍스트가 되어 버린다)
    known = set(langs) | {'var', 'sample'}
    for i, line in enumerate(re.sub(r'\r\n?', '\n', body).split('\n'), 1):
        m = re.match(r'^\s*@([A-Za-z][A-Za-z0-9_-]*)(?:\s|$)', line)
        if m and m.group(1) not in known:
            rep.add('warning', 'unknown-lang-code',
                    f"본문 {i}행: '@{m.group(1)}' 는 지원하는 번역 줄이 아닙니다(ko·en·ja 만) — 일반 텍스트로 처리됩니다.")

    # 남은 마크업 흔적 / 원시 HTML
    for u in ko.units:
        t = _plain(u.rec.get(base, ''))
        if _LEFTOVER_RE.search(t):
            rep.add('warning', 'leftover-markup', f'마크업이 해석되지 않고 본문에 남았습니다: "{_snippet(u.rec[base], 40)}" (여는/닫는 태그 짝을 확인)')
        if re.search(r'&lt;/?[A-Za-z][^&]*&gt;', u.rec.get(base, '')):
            rep.add('warning', 'raw-html', f'원시 HTML 은 이스케이프되어 그대로 보입니다: "{_snippet(u.rec[base], 40)}"')

    # 번역 누락
    for lang in others:
        missing = [u for u in ko.units if _has_letters(u.rec.get(base, '')) and not u.rec.get(lang, '').strip()]
        have = sum(1 for u in ko.units if u.rec.get(lang, '').strip())
        if have == 0 and ko.units:
            rep.add('warning', 'lang-missing', f"'{lang}' 번역이 전혀 없습니다.")
        elif missing:
            shown = ', '.join(f'"{_snippet(u.rec[base])}"' for u in missing[:5])
            more = f' 외 {len(missing) - 5}건' if len(missing) > 5 else ''
            rep.add('warning', 'untranslated', f"'{lang}' 번역 누락 {len(missing)}건: {shown}{more}")

    # 치환자 / 행 변수 / 링크 일관성
    def tokens(html: str) -> set:
        return {f'|!#-{n}|' for n in extract_placeholders(html)} | {'{{' + n + '}}' for n in extract_row_vars(html)}

    for lang in others:
        doc_ko: set = set()
        doc_l: set = set()
        per_unit = []
        for u in ko.units:
            tr = u.rec.get(lang, '').strip()
            if not tr:
                continue
            a, b = tokens(u.rec[base]), tokens(u.rec[lang])
            doc_ko |= a
            doc_l |= b
            if a != b:
                per_unit.append((u, a, b))
            ha = set(_HREF_RE.findall(u.rec[base]))
            hb = set(_HREF_RE.findall(u.rec[lang]))
            if ha != hb:
                rep.add('warning', 'link-changed', f'"{_snippet(u.rec[base])}" 의 {lang} 번역에서 링크 URL 이 원문과 다릅니다: {sorted(ha)} -> {sorted(hb)}')
        if doc_ko != doc_l:
            only_ko = sorted(doc_ko - doc_l)
            only_l = sorted(doc_l - doc_ko)
            parts = []
            if only_ko:
                parts.append(f'ko 에만: {", ".join(only_ko)}')
            if only_l:
                parts.append(f'{lang} 에만: {", ".join(only_l)}')
            rep.add('error', 'placeholder-mismatch', f"치환자 집합이 ko 와 '{lang}' 에서 다릅니다 ({'; '.join(parts)})")
        for u, a, b in per_unit:
            if doc_ko == doc_l:
                rep.add('warning', 'placeholder-moved',
                        f'"{_snippet(u.rec[base])}" 의 {lang} 번역은 같은 블록에 쓰인 치환자가 원문과 다릅니다 ({sorted(a)} -> {sorted(b)}).')

    # 구조의 치환자(버튼 URL 등): 언어 간 URL 은 구조 공통이라 불일치 없음. 제목 치환자는 별도 비교
    subj_ph = {l: set(extract_placeholders(s)) for l, s in fm.subject.items()}
    if base in subj_ph:
        for l, s in subj_ph.items():
            if l != base and s != subj_ph[base]:
                rep.add('error', 'subject-placeholder-mismatch',
                        f"제목의 치환자 집합이 ko 와 '{l}' 에서 다릅니다 ({sorted(subj_ph[base])} vs {sorted(s)})")

    # 공지 규칙: 치환자·행 변수·동적 표 금지
    all_names = set(ko.variables)
    for lang in langs:
        all_names |= set(rep.results[lang].variables)
    if kind == 'notice':
        row_vars = set()
        for lang in langs:
            for u in rep.results[lang].units:
                row_vars |= {n for t in u.rec.values() for n in extract_row_vars(t)}
        if all_names:
            rep.add('error', 'notice-placeholder',
                    '공지에는 치환자를 쓸 수 없습니다: ' + ', '.join(f'|!#-{n}|' for n in sorted(all_names)))
        if row_vars:
            rep.add('error', 'notice-placeholder', '공지에는 {{행 변수}} 를 쓸 수 없습니다: ' + ', '.join('{{' + n + '}}' for n in sorted(row_vars)))
        if ko.dynamic_tables or re.search(r'^\s*\[표:[^\]]*동적\s*:', body, re.MULTILINE):
            rep.add('error', 'notice-dynamic-table', '공지에는 동적 표를 쓸 수 없습니다 (정적 표 [표: 가로형] 로 쓰세요).')
        for l, s in fm.subject.items():
            if extract_placeholders(s):
                rep.add('error', 'notice-placeholder', f'공지 제목(subject.{l})에는 치환자를 쓸 수 없습니다.')
    else:
        pass

    # 동적 표 변수 vs 본문 치환자 이름 충돌
    for t in ko.dynamic_tables:
        for v in t['vars']:
            if v['name'] in all_names:
                rep.add('error', 'row-var-collides', f"행 변수 {{{{{v['name']}}}}} 가 본문 치환자 |!#-{v['name']}| 와 이름이 겹칩니다 ({t['id']})")
        if not t['sample_rows']:
            rep.add('warning', 'no-sample', f"동적 표 '{t['id']}' 에 @sample 이 없어 미리보기에 예시 행이 나오지 않습니다.")

    # 링크 새 창 보장(자동) 확인
    for lang in langs:
        bad = find_links_missing_target(rep.results[lang].html)
        if bad:
            rep.add('error', 'link-target', f'{lang}: target/rel 이 빠진 링크가 있습니다: {bad[0]}')

    # 통계
    h = ko.html
    rep.stats = {
        'headings': len(re.findall(r'<h[1-3]>', h)),
        'tables': len(re.findall(r'<table', h)),
        'dynamic_tables': len(ko.dynamic_tables),
        'buttons': len(re.findall(r'<a [^>]*class="btn ', h)),
        'callouts': len(re.findall(r'<div class="callout ', h)),
        'lists': len(re.findall(r'<(?:ul|ol)>', h)),
        'blocks': len(ko.units),
    }
    rep.variables = sorted(all_names)
    return rep
