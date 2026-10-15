#!/usr/bin/env python3
"""
TracX Logis 마크업(TXMD) 파서

TracX Logis 마크업을 HTML 로 변환한다. 외부 의존성 없이 Python 표준 라이브러리만 쓴다.

두 가지 진입점
  1. TracXMarkdownParser().parse(text)  -- 원본 호환(단일 언어). 번역 줄(@en)을 인식하지 않고,
     <main> 으로 감싸며, 경고를 stderr 로 낸다. __golden__ 회귀 기준이 이 경로다.
  2. parse_txmd(text, lang=...)         -- 다국어 .txmd. `@en`/`@ja` 번역 줄을 읽어 lang 하나의 본문 HTML 을 낸다.
     동작의 기준은 앱의 TypeScript 파서(src/markup/parser.ts + compose.ts)이며 출력이 같아야 한다.

문법 명세: references/MARKUP_SYNTAX.md (앱 쪽 원문: src/markup/TXMD.md)

원본(Python 단일 언어 파서) 대비 의도적 수정 - 앱 파서와 같다:
  1. 변수(`|!#-x|`, `{{x}}`)와 링크 URL 안의 `_`/`*` 가 강조로 오인되던 버그 수정.
  2. `_강조_` 는 단어 경계에서만 인식(snake_case_word 는 기울임이 아니다).
  3. 중첩 순서 목록(`   1. x`)에서 원본이 무한 루프였던 문제 수정.
  4. `[버튼,레이블]`(쉼표 뒤 공백 없음)에서 레이블 첫 글자를 잘라먹던 문제 수정.
  5. 레이블에 인라인 서식이 있는 단일 버튼도 <p> 로 감싼다.
  6. `{{x}}` 는 단일 중괄호 변수 변환(`{x}` -> `|!#-x|`)의 대상이 아니다.
확장(원본에 없음): 콜아웃 본문에 표·목록·버튼·인용·구분선, `~~취소선~~`, 번역 줄, 동적 표.
"""

import argparse
import html as html_module
import re
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

try:  # 같은 폴더의 링크 보장 모듈 (스크립트 직접 실행/임포트 모두 지원)
    from tx_links import ensure_link_targets
except ImportError:  # pragma: no cover
    from .tx_links import ensure_link_targets  # type: ignore


# ---------------------------------------------------------------- 상수

CALLOUT_TYPES = '정보|경고|강조'
CALLOUT_START = re.compile(rf'^\[({CALLOUT_TYPES})(?::\s*([^\]]*))?\]')
CALLOUT_SIMPLE = re.compile(rf'^\[({CALLOUT_TYPES})(?::|\])')
HR_LINES = ('---', '***', '___')
VAR_NAME = r'a-zA-Z0-9_가-힣.\-'
CALLOUT_CSS = {'정보': 'info', '경고': 'warn', '강조': 'accent'}

TOKEN_RE = re.compile(r'\|!#-[' + VAR_NAME + r']+\||\{\{[' + VAR_NAME + r']+\}\}')
PLACEHOLDER_RE = re.compile(r'\|!#-([' + VAR_NAME + r']+)\|')
ROW_VAR_RE = re.compile(r'\{\{([' + VAR_NAME + r']+)\}\}')
S_OPEN = ''
S_CLOSE = ''

Trans = Dict[str, List[str]]


# ---------------------------------------------------------------- 인라인

def normalize_variables(text: str) -> str:
    """`{변수}` -> `|!#-변수|`. `{{변수}}`(동적 표 행 변수)는 건드리지 않는다."""
    return re.sub(r'(?<!\{)\{([' + VAR_NAME + r']+)\}(?!\})', r'|!#-\1|', text)


def extract_placeholders(text: str) -> List[str]:
    """`|!#-name|` 치환자 이름을 등장 순서대로(중복 제거) 추출"""
    seen: List[str] = []
    for m in PLACEHOLDER_RE.finditer(text):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def extract_row_vars(text: str) -> List[str]:
    """동적 표 행 변수 `{{name}}` 이름 추출"""
    seen: List[str] = []
    for m in ROW_VAR_RE.finditer(text):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def parse_inline(text: str) -> str:
    """인라인(굵게·기울임·취소선·링크). 변수 토큰과 링크 URL 은 강조 처리에서 보호한다."""
    keep: List[str] = []

    def stash(s: str) -> str:
        keep.append(s)
        return f'{S_OPEN}{len(keep) - 1}{S_CLOSE}'

    # 1) 변수 보호 (이스케이프도 면제)
    t = TOKEN_RE.sub(lambda m: stash(m.group(0)), text)
    # 2) 이스케이프
    t = html_module.escape(t)
    # 3) 링크 URL 보호
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: f'[{m.group(1)}]({stash(m.group(2))})', t)
    # 3-2) 본문 속 맨 URL 도 강조·취소선 처리에서 보호
    t = re.sub(r'https?://[^\s<>\[\])]+', lambda m: stash(m.group(0)), t)

    # 4) 강조 (_ 계열은 단어 경계에서만)
    b = r'(?<!\w)'
    a = r'(?!\w)'
    t = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', t)
    t = re.sub(b + r'___(.+?)___' + a, r'<strong><em>\1</em></strong>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(b + r'__(.+?)__' + a, r'<strong>\1</strong>', t)
    t = re.sub(r'\*(.+?)\*', r'<em>\1</em>', t)
    t = re.sub(b + r'_(.+?)_' + a, r'<em>\1</em>', t)
    # 취소선: `~~` 쌍. 안쪽 양끝이 공백/`~` 이면 인식하지 않고, `~~~` 이상 연속은 건드리지 않는다.
    t = re.sub(r'(?<!~)~~(?=[^\s~])(.+?)(?<=[^\s~])~~(?!~)', r'<del>\1</del>', t)

    # 5) 링크
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)

    # 6) 복원 (중첩 복원 대비 반복)
    restore = re.compile(S_OPEN + r'(\d+)' + S_CLOSE)
    for _ in range(3):
        t = restore.sub(lambda m: keep[int(m.group(1))], t)
    return t


# ---------------------------------------------------------------- 결과 구조

@dataclass
class UnitRecord:
    """번역 단위 하나(제목·문단·목록 항목·표 셀·버튼 레이블 …)의 언어별 인라인 HTML. 번역이 없는 언어는 키가 없다."""
    kind: str
    rec: Dict[str, str] = field(default_factory=dict)
    dyn: Optional[str] = None  # 동적 표 행 템플릿 소속이면 표 id


@dataclass
class ParseResult:
    html: str
    lang: str
    warnings: List[str]
    units: List[UnitRecord]
    dynamic_tables: List[dict]
    variables: List[str]
    include_header: bool = False


class Unit:
    def __init__(self, parser: 'Parser', kind: str):
        self.parser = parser
        self.record = UnitRecord(kind=kind, dyn=parser.dyn_ctx)
        parser.units.append(self.record)

    def finish(self, lines: List[str], trans: Trans, joiner: str) -> str:
        p = self.parser
        rec = {p.base: joiner.join(parse_inline(l) for l in lines)}
        for lang, ls in trans.items():
            rec[lang] = joiner.join(parse_inline(l) for l in ls)
        self.record.rec = rec
        return p.pick(rec)


# ---------------------------------------------------------------- 파서

class Parser:
    def __init__(self, structured: bool = False, base: str = 'ko', langs=(), lang: Optional[str] = None,
                 fallback: bool = False, dyn_mode: str = 'send'):
        self.structured = structured   # True: .txmd 경로(번역 단위 기록·동적 표 등록·콜아웃 중첩 경고)
        self.base = base
        self.langs = set(langs)
        self.lang = lang or base
        self.fallback = fallback
        self.dyn_mode = dyn_mode       # 'send': 표식 치환자 / 'preview': 예시 행으로 채움
        self.warnings: List[str] = []
        self.units: List[UnitRecord] = []
        self.dynamic_tables: List[dict] = []
        self.dyn_ctx: Optional[str] = None
        self.include_header = False
        self.line_base = 0

    # -- 공통
    def ln(self, idx: int) -> int:
        return idx + 1 + self.line_base

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def pick(self, rec: Dict[str, str]) -> str:
        if self.lang == self.base:
            return rec.get(self.base, '')
        v = rec.get(self.lang, '')
        if not v and self.fallback:
            return rec.get(self.base, '')
        return v

    # -- 번역 줄
    def trans_match(self, raw: str) -> Optional[Tuple[str, str]]:
        if not self.langs:
            return None
        m = re.match(r'^@([A-Za-z][A-Za-z0-9_-]*)(?:[ \t]+(.*))?$', raw.strip())
        if m and m.group(1) in self.langs:
            return m.group(1), (m.group(2) or '').strip()
        return None

    @staticmethod
    def add_trans(t: Trans, lang: str, text: str) -> None:
        t.setdefault(lang, []).append(text)

    def eat_trans(self, lines: List[str], idx: int, trans: Trans) -> int:
        while idx < len(lines):
            t = self.trans_match(lines[idx])
            if not t:
                break
            self.add_trans(trans, t[0], t[1])
            idx += 1
        return idx

    def new_unit(self, kind: str) -> Unit:
        return Unit(self, kind)

    def simple(self, tag: str, lines: List[str], trans: Trans, joiner: str = '<br/>', kind: Optional[str] = None) -> str:
        u = self.new_unit(kind or tag)
        return f'<{tag}>{u.finish(lines, trans, joiner)}</{tag}>'

    # -- 인용 / 목록
    def parse_blockquote(self, lines: List[str], start: int) -> Tuple[str, int]:
        quote: List[str] = []
        trans: Trans = {}
        idx = start
        while idx < len(lines) and lines[idx].startswith('>'):
            content = lines[idx][1:].strip()
            if content:
                t = self.trans_match(content)
                if t:
                    self.add_trans(trans, t[0], t[1])
                else:
                    quote.append(content)
            idx += 1
        if quote:
            idx = self.eat_trans(lines, idx, trans)
            return f'<blockquote>{self.simple("p", quote, trans, "<br>", "quote")}</blockquote>', idx - start
        return '', 0

    def parse_list(self, lines: List[str], start: int) -> Tuple[str, int]:
        first = lines[start]
        ordered = bool(re.match(r'^\s*\d+\.\s+', first))
        tag = 'ol' if ordered else 'ul'
        base_indent = len(re.match(r'^(\s*)', first).group(1))
        items: List[dict] = []
        idx = start

        while idx < len(lines):
            line = lines[idx]
            if not line.strip():
                break
            t = self.trans_match(line)
            if t and items:
                self.add_trans(items[-1]['trans'], t[0], t[1])
                idx += 1
                continue
            cur = len(re.match(r'^(\s*)', line).group(1))
            if cur < base_indent:
                break
            if cur == base_indent:
                m = re.match(r'^\s*\d+\.\s+(.+)$', line) if ordered else re.match(r'^\s*[-*]\s+(.+)$', line)
                if not m:
                    break
                items.append({'unit': self.new_unit('li'), 'text': m.group(1), 'trans': {}, 'nested': ''})
                idx += 1
            else:
                nested, consumed = self.parse_list(lines, idx)
                if consumed == 0:
                    break
                if items:
                    items[-1]['nested'] += nested
                idx += consumed

        body = '\n'.join(
            f'<li>{it["unit"].finish([it["text"]], it["trans"], "<br/>")}{it["nested"]}</li>' for it in items)
        return f'<{tag}>\n{body}\n</{tag}>', idx - start

    # -- 표
    @staticmethod
    def split_cells(s: str) -> List[str]:
        return [c.strip() for c in s.strip().split('|')]

    @staticmethod
    def trans_row_body(text: str, is_header: bool) -> str:
        s = text.strip()
        if is_header:
            if s.startswith('{') and s.endswith('}'):
                s = s[1:-1]
        elif s.startswith('-'):
            s = s[1:].strip()
        return s

    @staticmethod
    def split_kv(content: str) -> Tuple[str, str]:
        colon = content.find(':')
        pipe = content.find('|')
        if colon == -1 and pipe == -1:
            return content.strip(), ''
        pos = pipe if (pipe != -1 and (colon == -1 or pipe < colon)) else colon
        return content[:pos].strip(), content[pos + 1:].strip()

    def parse_table_horizontal(self, lines: List[str], start: int, dyn_id: Optional[str]) -> Tuple[str, int]:
        idx = start
        if idx >= len(lines):  # 원본은 여기서 IndexError (`[표: 가로형]` 이 마지막 줄일 때)
            return '', 0
        header_line = lines[idx].strip()
        if not (header_line.startswith('{') and header_line.endswith('}')):
            return '', 0
        headers = [h.strip() for h in header_line[1:-1].split('|')]
        header_trans: Trans = {}
        idx += 1

        rows: List[dict] = []
        sample_rows: List[Dict[str, str]] = []
        var_desc: Dict[str, str] = {}
        col_count = len(headers)

        while idx < len(lines):
            line = lines[idx].strip()
            if line == '[/표]':
                idx += 1
                break
            if re.match(r'^#{1,2}\s+', line):
                self.warn(f'경고: 가로형 테이블의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line {self.ln(idx)})')
                break
            if dyn_id is not None:
                sm = re.match(r'^@sample(?:[ \t]+(.*))?$', line)
                if sm:
                    rec: Dict[str, str] = {}
                    for part in (sm.group(1) or '').split('|'):
                        eq = part.find('=')
                        if eq > 0:
                            rec[part[:eq].strip()] = part[eq + 1:].strip()
                    sample_rows.append(rec)
                    idx += 1
                    continue
                vm = re.match(r'^@var[ \t]+(\S+)(?:[ \t]+(.*))?$', line)
                if vm:
                    var_desc[vm.group(1)] = (vm.group(2) or '').strip()
                    idx += 1
                    continue
            tr = self.trans_match(line)
            if tr:
                if not rows:
                    self.add_trans(header_trans, tr[0], tr[1])
                else:
                    self.add_trans(rows[-1]['trans'], tr[0], tr[1])
                idx += 1
                continue
            if line.startswith('-'):
                rows.append({'cells': self.split_cells(line[1:]), 'trans': {}})
            idx += 1

        if idx == len(lines):
            last = lines[-1].strip() if lines else ''
            if last != '[/표]':
                self.warn("경고: 가로형 테이블의 종료 태그 '[/표]'가 파일 끝까지 없습니다")
        if not rows:
            self.warn('경고: 빈 가로형 테이블이 생성됩니다')

        use_rows = rows
        if dyn_id is not None and len(rows) > 1:
            self.warn(f"경고: 동적 표 '{dyn_id}' 는 행 템플릿 1개만 사용합니다 (나머지 {len(rows) - 1}행 무시)")
            use_rows = rows[:1]

        def cell_trans(trans: Trans, is_header: bool, what: str) -> Dict[str, List[str]]:
            out: Dict[str, List[str]] = {}
            for lang, ls in trans.items():
                if len(ls) > 1:
                    self.warn(f"경고: {what}의 '@{lang}' 줄이 여러 개입니다 - 첫 줄만 사용됩니다")
                cells = self.split_cells(self.trans_row_body(ls[0], is_header))
                if len(cells) != col_count:
                    self.warn(f"경고: {what}의 '@{lang}' 칼럼 수 불일치 (헤더: {col_count}, 번역: {len(cells)}) - 자동 보정됨")
                    while len(cells) < col_count:
                        cells.append('')
                    cells = cells[:col_count]
                out[lang] = cells
            return out

        def cell_of(ct: Dict[str, List[str]], i: int) -> Trans:
            return {lang: [cells[i]] for lang, cells in ct.items()}

        hct = cell_trans(header_trans, True, '헤더')
        html = '<table class="table-horizontal">\n<thead>\n<tr>\n'
        for i, h in enumerate(headers):
            u = self.new_unit('th')
            html += f'<th>{u.finish([h], cell_of(hct, i), "<br/>")}</th>\n'
        html += '</tr>\n</thead>\n'

        def render_row(row: dict, n: int) -> str:
            cells = row['cells']
            if len(cells) != col_count:
                self.warn(f'경고: 칼럼 수 불일치 (헤더: {col_count}, 데이터: {len(cells)}) - 자동 보정됨')
                while len(cells) < col_count:
                    cells.append('')
                if len(cells) > col_count:
                    del cells[col_count:]
            rct = cell_trans(row['trans'], False, f'{n}번째 행')
            r = '<tr>\n'
            for i, c in enumerate(cells):
                u = self.new_unit('td')
                r += f'<td>{u.finish([c], cell_of(rct, i), "<br/>")}</td>\n'
            return r + '</tr>'

        if dyn_id is None:
            html += '<tbody>\n'
            for i, row in enumerate(use_rows):
                html += render_row(row, i + 1) + '\n'
            html += '</tbody>\n</table>'
        else:
            row_html = ''
            first_row_unit = len(self.units)
            self.dyn_ctx = dyn_id
            if use_rows:
                row_html = render_row(use_rows[0], 1)
            else:
                self.warn(f"경고: 동적 표 '{dyn_id}' 에 행 템플릿이 없습니다")
            self.dyn_ctx = None
            if self.structured:
                self.register_dynamic(dyn_id, self.units[first_row_unit:], sample_rows, var_desc)
            if self.structured and self.dyn_mode == 'preview' and sample_rows and row_html:
                filled = '\n'.join(fill_row_vars(row_html, r) for r in sample_rows)
                html += f'<tbody>\n{filled}\n</tbody>\n</table>'
            else:
                html += f'<tbody>|!#-rows_{dyn_id}|</tbody>\n</table>'
        return html, idx - start

    def register_dynamic(self, tid: str, row_units: List[UnitRecord], sample_rows: List[Dict[str, str]],
                         var_desc: Dict[str, str]) -> None:
        if any(t['id'] == tid for t in self.dynamic_tables):
            self.warn(f"경고: 동적 표 id '{tid}' 가 중복됩니다")
        per_lang: Dict[str, set] = {}
        order: List[str] = []
        for u in row_units:
            for lang, text in u.rec.items():
                for v in extract_row_vars(text):
                    per_lang.setdefault(lang, set()).add(v)
                    if v not in order:
                        order.append(v)
        for lang, s in per_lang.items():
            missing = [v for v in order if v not in s]
            if missing:
                self.warn(f"경고: 동적 표 '{tid}' 의 '{lang}' 행 템플릿에 변수가 빠졌습니다: "
                          + ', '.join('{{' + v + '}}' for v in missing))
        vars_ = [{'name': n, 'description': var_desc.get(n, ''),
                  'sample': (sample_rows[0].get(n, '') if sample_rows else '')} for n in order]
        for name in var_desc:
            if name not in order:
                self.warn(f"경고: 동적 표 '{tid}' 의 @var '{name}' 는 행 템플릿에서 쓰이지 않습니다")
        self.dynamic_tables.append({'id': tid, 'vars': vars_, 'sample_rows': sample_rows, 'row_units': row_units})

    def parse_table_vertical(self, lines: List[str], start: int) -> Tuple[str, int]:
        idx = start
        rows: List[dict] = []
        while idx < len(lines):
            line = lines[idx].strip()
            if line == '[/표]':
                idx += 1
                break
            if re.match(r'^#{1,2}\s+', line):
                self.warn(f'경고: 세로형 테이블의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line {self.ln(idx)})')
                break
            if not line:
                idx += 1
                continue
            tr = self.trans_match(line)
            if tr:
                if rows:
                    self.add_trans(rows[-1]['trans'], tr[0], tr[1])
                else:
                    self.warn(f'경고: 세로형 테이블 첫 행보다 앞선 번역 줄이 무시되었습니다 (line {self.ln(idx)})')
                idx += 1
                continue
            if line.startswith('-'):
                h, v = self.split_kv(line[1:].strip())
                rows.append({'header': h, 'value': v, 'trans': {}})
            idx += 1

        if idx == len(lines):
            last = lines[-1].strip() if lines else ''
            if last != '[/표]':
                self.warn("경고: 세로형 테이블의 종료 태그 '[/표]'가 파일 끝까지 없습니다")
        if not rows:
            self.warn('경고: 빈 세로형 테이블이 생성됩니다')

        html = '<table class="table-vertical">\n'
        for row in rows:
            h_t: Trans = {}
            v_t: Trans = {}
            for lang, ls in row['trans'].items():
                if len(ls) > 1:
                    self.warn(f"경고: 세로형 행 '{row['header']}' 의 '@{lang}' 줄이 여러 개입니다 - 첫 줄만 사용됩니다")
                h, v = self.split_kv(self.trans_row_body(ls[0], False))
                h_t[lang] = [h]
                v_t[lang] = [v]
            uh = self.new_unit('th')
            uv = self.new_unit('td')
            html += '<tr>\n'
            html += f'<th>{uh.finish([row["header"]], h_t, "<br/>")}</th>\n'
            html += f'<td>{uv.finish([row["value"]], v_t, "<br/>")}</td>\n'
            html += '</tr>\n'
        html += '</table>'
        return html, idx - start

    def parse_table(self, lines: List[str], start: int, in_callout: bool = False) -> Tuple[str, int]:
        m = re.match(r'^\[표:\s*(가로형|세로형)(?:\s*,\s*동적\s*:\s*([A-Za-z0-9_-]+))?\s*\]', lines[start])
        if not m:
            return '', 0
        dyn_id = m.group(2)
        if in_callout and dyn_id is not None:
            self.warn(f"경고: 콜아웃 안에서는 동적 표를 지원하지 않습니다 ('{dyn_id}' 는 정적 표로 처리, line {self.ln(start)})")
            dyn_id = None
        if m.group(1) == '가로형':
            html, consumed = self.parse_table_horizontal(lines, start + 1, dyn_id)
            return html, consumed + 1
        if dyn_id is not None:
            self.warn(f"경고: 세로형 표는 동적 표를 지원하지 않습니다 ('{dyn_id}' 는 정적 표로 처리)")
        html, consumed = self.parse_table_vertical(lines, start + 1)
        return html, consumed + 1

    # -- 버튼
    @staticmethod
    def detect_button_style(label: str) -> str:
        l = label.lower()
        if any(k in l for k in ['신청', '등록', '확인', '구매', '결제', '시작', '추적', '완료']):
            return 'primary'
        if any(k in l for k in ['취소', '삭제', '중단', '거부', '해지', '차단']):
            return 'warn'
        if any(k in l for k in ['나중에', '건너뛰기', '선택', '건너뛰']):
            return 'outline'
        return 'secondary'

    @staticmethod
    def parse_csv_like(text: str) -> List[str]:
        """콤마 구분, 큰따옴표 안 콤마 허용, 백슬래시 이스케이프"""
        params: List[str] = []
        cur: List[str] = []
        in_q = False
        esc = False
        for ch in text:
            if esc:
                cur.append(ch)
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_q = not in_q
            elif ch == ',' and not in_q:
                params.append(''.join(cur).strip())
                cur = []
            else:
                cur.append(ch)
        if cur or params:
            params.append(''.join(cur).strip())
        return params

    def parse_button_spec(self, raw: str) -> Optional[dict]:
        line = raw.strip()
        if not line.startswith('[버튼,') or not line.endswith(']'):
            return None
        params = self.parse_csv_like(line[len('[버튼,'):-1].strip())
        if not params:
            return None
        label = params[0] if params else ''
        url = params[1] if len(params) > 1 else '#'
        style = params[2] if len(params) > 2 else ''
        if not label:
            return None
        return {'label': label, 'url': url, 'style': style.strip() if style.strip() else self.detect_button_style(label)}

    def parse_buttons(self, lines: List[str], idx: int) -> Optional[Tuple[str, int]]:
        specs: List[dict] = []
        b = idx
        last: Optional[dict] = None
        while b < len(lines):
            bl = lines[b].strip()
            if not bl:
                break
            t = self.trans_match(bl)
            if t:
                if last:
                    self.add_trans(last['trans'], t[0], t[1])
                b += 1
                continue
            if not bl.startswith('[버튼,'):
                break
            spec = self.parse_button_spec(bl)
            last = {'spec': spec, 'trans': {}} if spec else None
            if last:
                specs.append(last)
            b += 1
        if not specs:
            return None
        anchors = []
        for s in specs:
            u = self.new_unit('btn')
            sp = s['spec']
            anchors.append(f'<a href="{sp["url"]}" class="btn btn-{sp["style"]}">{u.finish([sp["label"]], s["trans"], "<br/>")}</a>')
        html = f'<p class="btn-group">{"".join(anchors)}</p>' if len(specs) > 1 else f'<p>{anchors[0]}</p>'
        return html, b - idx

    # -- 콜아웃
    def parse_callout(self, lines: List[str], start: int, in_callout: bool = False) -> Tuple[str, int]:
        first = lines[start].strip()
        m = CALLOUT_START.match(first)
        if not m:
            return '', 0
        ctype = m.group(1)
        title = m.group(2).strip() if m.group(2) else None

        if in_callout:
            # 콜아웃 안의 콜아웃은 인용으로 낮춘다. 경고는 원본 stderr 골든 보존을 위해 .txmd 경로에서만 낸다.
            if self.structured:
                self.warn(f"경고: 콜아웃 안의 콜아웃 '{ctype}' 은 지원하지 않아 인용으로 처리되었습니다 (line {self.ln(start)})")
            idx = start + 1
            bq: List[str] = []
            trans: Trans = {}
            while idx < len(lines):
                line = lines[idx]
                if line.strip() == f'[/{ctype}]':
                    idx += 1
                    break
                if not re.match(r'^\[/(정보|경고|강조)\]', line.strip()):
                    t = self.trans_match(line)
                    if t:
                        self.add_trans(trans, t[0], t[1])
                    else:
                        bq.append(line)
                idx += 1
            if bq:
                content = [l.strip() for l in bq if l.strip()]
                return f'<blockquote>{self.simple("p", content, trans, "<br>", "quote")}</blockquote>', idx - start
            return '', idx - start

        # 제목 바로 아래 번역 줄 = 제목 번역
        title_trans: Trans = {}
        idx = self.eat_trans(lines, start + 1, title_trans)
        if not title and title_trans:
            self.warn(f"경고: 제목 없는 콜아웃 '{ctype}'(line {self.ln(start)}) 아래의 번역 줄이 무시되었습니다")

        body_start = idx
        content_lines: List[str] = []
        while idx < len(lines):
            line = lines[idx]
            if line.strip() == f'[/{ctype}]':
                idx += 1
                break
            if re.match(r'^#{1,2}\s+', line.strip()):
                self.warn(f"경고: 콜아웃 '{ctype}'의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line {self.ln(idx)})")
                break
            content_lines.append(line)
            idx += 1
        if idx == len(lines):
            last = lines[-1].strip() if lines else ''
            if last != f'[/{ctype}]':
                self.warn(f"경고: 콜아웃 '{ctype}'의 종료 태그가 파일 끝까지 없습니다")

        title_unit = self.new_unit('callout-title') if title else None  # 제목이 본문보다 앞서도록 먼저 발급
        saved = self.line_base
        self.line_base = saved + body_start
        content_html = '\n'.join(self.parse_blocks(content_lines, True))
        self.line_base = saved
        if not content_lines or not ''.join(content_lines).strip():
            self.warn(f"경고: 빈 콜아웃 '{ctype}'이 생성됩니다")

        html = f'<div class="callout callout-{CALLOUT_CSS[ctype]}">\n'
        if title and title_unit:
            html += f'<h3>{title_unit.finish([title], title_trans, "<br/>")}</h3>\n'
        html += content_html
        html += '\n</div>'
        return html, idx - start

    # -- 문단
    def parse_paragraph_block(self, lines: List[str], start: int) -> Tuple[str, int]:
        p_lines: List[str] = []
        trans: Trans = {}
        idx = start
        while idx < len(lines):
            stripped = lines[idx].strip()
            if not stripped:
                break
            if (stripped.startswith('#') or stripped.startswith('[표:') or stripped.startswith('[버튼,')
                    or CALLOUT_SIMPLE.match(stripped) or stripped.startswith('>')
                    or re.match(r'^(\s*)[-*]\s+', stripped) or re.match(r'^(\s*)\d+\.\s+', stripped)
                    or stripped in HR_LINES):
                break
            t = self.trans_match(stripped)
            if t:
                self.add_trans(trans, t[0], t[1])
            else:
                p_lines.append(stripped)
            idx += 1
        if p_lines:
            return self.simple('p', p_lines, trans), idx - start
        return '', 0

    # -- 블록
    def parse_blocks(self, lines: List[str], in_callout: bool) -> List[str]:
        blocks: List[str] = []
        idx = 0
        while idx < len(lines):
            line = lines[idx].strip()
            if not line:
                idx += 1
                continue
            if line in HR_LINES:
                blocks.append('<hr>')
                idx += 1
                continue
            if self.trans_match(line):
                self.warn(
                    f'경고: 번역 대상 블록이 없는 번역 줄이 콜아웃 안에서 무시되었습니다 (line {self.ln(idx)})'
                    if in_callout else
                    f'경고: 번역 대상 블록이 없는 번역 줄이 무시되었습니다 (line {self.ln(idx)})')
                idx += 1
                continue
            if line.startswith('[표:'):
                html, consumed = self.parse_table(lines, idx, in_callout)
                if html:
                    blocks.append(html)
                    idx += consumed
                    continue
            if CALLOUT_SIMPLE.match(line):
                html, consumed = self.parse_callout(lines, idx, in_callout)
                if html:
                    blocks.append(html)
                    idx += consumed
                    continue
                if in_callout and consumed > 0:
                    idx += consumed  # 내용이 빈 안쪽 콜아웃: 여는~닫는 줄을 통째로 건너뜀
                    continue
            if line.startswith('[버튼,'):
                r = self.parse_buttons(lines, idx)
                if r:
                    blocks.append(r[0])
                    idx += r[1]
                    continue
            if line.startswith('>'):
                html, consumed = self.parse_blockquote(lines, idx)
                if html:
                    blocks.append(html)
                    idx += consumed
                    continue
            if re.match(r'^(\s*)[-*]\s+', line) or re.match(r'^(\s*)\d+\.\s+', line):
                html, consumed = self.parse_list(lines, idx)
                if html:
                    blocks.append(html)
                    idx += consumed
                    continue
            hm = re.match(r'^(#{1,3})\s+(.+)$', line)
            if hm:
                trans: Trans = {}
                nxt = self.eat_trans(lines, idx + 1, trans)
                blocks.append(self.simple(f'h{len(hm.group(1))}', [hm.group(2)], trans))
                idx = nxt
                continue
            ph, consumed = self.parse_paragraph_block(lines, idx)
            if ph:
                blocks.append(ph)
                idx += consumed
                continue
            idx += 1
        return blocks

    # -- 전체
    def parse(self, text_in: str, wrap_main: bool) -> str:
        text = re.sub(r'\r\n?', '\n', text_in)  # 원본은 universal newline 으로 읽는다
        text = normalize_variables(text)
        if '[헤더]' in text:
            self.include_header = True
            text = text.replace('[헤더]\n', '')
        lines = text.split('\n')
        blocks = self.parse_blocks(lines, False)
        html = '\n'.join(blocks)
        if wrap_main:
            html = f'<main>\n{html}\n</main>'
        if self.include_header and not self.structured:
            html = f'<!--HEADER_PLACEHOLDER-->{html}'
        return html


def fill_row_vars(row_html: str, values: Dict[str, str]) -> str:
    """예시 행 값을 `{{name}}` 에 채운다(값은 HTML 이스케이프, 값이 없는 변수는 빈 문자열)"""
    def esc(v: str) -> str:
        return v.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    return ROW_VAR_RE.sub(lambda m: esc(values.get(m.group(1), '')), row_html)


# ---------------------------------------------------------------- 공개 API

class TracXMarkdownParser:
    """원본 호환 파서(단일 언어). 번역 줄을 인식하지 않고 <main> 으로 감싸며 경고는 stderr 로 낸다."""

    def __init__(self):
        self.include_header = False
        self.warnings: List[str] = []

    def parse(self, markdown_text: str) -> str:
        p = Parser(structured=False)
        html = p.parse(markdown_text, True)
        self.include_header = p.include_header
        self.warnings = p.warnings
        for w in p.warnings:
            print(w, file=sys.stderr)
        return html


def parse_txmd(text: str, lang: str = 'ko', *, base: str = 'ko', langs=('en', 'ja'), fallback: bool = False,
               dyn_mode: str = 'preview', wrap_main: bool = False) -> ParseResult:
    """
    다국어 .txmd 본문(머리말 제거 후)을 lang 하나의 본문 HTML 로 변환한다.

    fallback: 해당 언어 번역이 없는 블록을 기준 언어 문장으로 채운다(앱의 fallbackToBase). 기본은 비워 둔다(앱 기본과 동일).
    dyn_mode: 'preview' 동적 표를 @sample 예시 행으로 채움 / 'send' 표식 치환자 `|!#-rows_<id>|` 만 남김.
    링크에는 target="_blank" rel="noopener noreferrer" 를 보장한다(앱 compose 단계와 같음).
    """
    langs = [l for l in langs if l != base]
    p = Parser(structured=True, base=base, langs=langs, lang=lang, fallback=fallback, dyn_mode=dyn_mode)
    html = ensure_link_targets(p.parse(text, wrap_main))

    names: List[str] = []

    def add_names(s: str) -> None:
        for n in extract_placeholders(s):
            if n not in names:
                names.append(n)

    add_names(html)
    for u in p.units:
        for t in u.rec.values():
            add_names(t)
    for t in p.dynamic_tables:
        if f'rows_{t["id"]}' in names:
            names.remove(f'rows_{t["id"]}')
    return ParseResult(html=html, lang=lang, warnings=p.warnings, units=p.units, dynamic_tables=p.dynamic_tables,
                       variables=names, include_header=p.include_header)


def main():
    """CLI 진입점(내용만 변환). 전체 흐름은 tx_generate.py 를 쓴다."""
    ap = argparse.ArgumentParser(description='TracX Logis 마크업을 HTML 본문으로 변환합니다.')
    ap.add_argument('input', help='입력 마크업 파일')
    ap.add_argument('output', help='출력 HTML 파일')
    ap.add_argument('--lang', help='번역 줄(@en 등)을 읽어 해당 언어 본문을 출력(.txmd 경로). 생략하면 원본 호환 변환')
    ap.add_argument('-v', '--verbose', action='store_true', help='상세 출력')
    args = ap.parse_args()
    try:
        with open(args.input, 'r', encoding='utf-8-sig') as f:
            markdown = f.read()
        if args.lang:
            try:
                from tx_txmd import parse_front_matter
            except ImportError:  # pragma: no cover
                from .tx_txmd import parse_front_matter  # type: ignore
            fm = parse_front_matter(markdown)
            r = parse_txmd(fm.body, args.lang, fallback=True)
            html = r.html
            for w in fm.warnings + r.warnings:
                print(w, file=sys.stderr)
        else:
            html = TracXMarkdownParser().parse(markdown)
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'[완료] HTML 변환 완료: {args.output}')
    except FileNotFoundError:
        print(f'[오류] 파일을 찾을 수 없습니다 - {args.input}', file=sys.stderr)
        sys.exit(1)
    except Exception as e:  # noqa: BLE001
        print(f'[오류] {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
