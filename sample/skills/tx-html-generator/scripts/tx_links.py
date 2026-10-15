#!/usr/bin/env python3
"""
링크 새 창 보장 (앱 src/markup/links.ts 의 Python 포팅, TXMD.md §4-C).

모든 `<a href>` 는 `target="_blank"` + `rel="noopener noreferrer"` 를 가진다.
제외: href 가 `mailto:` `tel:` `sms:` 또는 `#앵커` 인 링크, href 없는 `<a>`.
치환자(`|!#-url|`)·`{{var}}`·상대 경로·`http(s)://` 는 붙인다. 멱등.
"""

import re
from typing import List, NamedTuple, Optional

A_OPEN = re.compile(r'<a(\s(?:"[^"]*"|\'[^\']*\'|[^\'">])*)>', re.IGNORECASE)
ATTR = re.compile(r'\s+([^\s=/>"\']+)(?:\s*=\s*("[^"]*"|\'[^\']*\'|[^\s"\'>]+))?')
NO_TARGET_HREF = re.compile(r'^(?:mailto:|tel:|sms:|#)', re.IGNORECASE)


class _Attr(NamedTuple):
    name: str
    value: Optional[str]
    start: int
    end: int


def _parse_attrs(attrs: str) -> List[_Attr]:
    out: List[_Attr] = []
    for m in ATTR.finditer(attrs):
        value = m.group(2)
        if value is not None and value[:1] in ('"', "'"):
            value = value[1:-1]
        out.append(_Attr(m.group(1).lower(), value, m.start(), m.end()))
    return out


def needs_link_target(href: str) -> bool:
    return not NO_TARGET_HREF.match(href.strip())


def _has_rel_tokens(rel: Optional[str]) -> bool:
    t = (rel or '').lower().split()
    return 'noopener' in t and 'noreferrer' in t


def _fix_open_tag(attrs: str) -> str:
    lst = _parse_attrs(attrs)
    href = next((a for a in lst if a.name == 'href'), None)
    if href is None or not needs_link_target(href.value or ''):
        return attrs
    target = next((a for a in lst if a.name == 'target'), None)
    rel = next((a for a in lst if a.name == 'rel'), None)
    target_ok = target is not None and (target.value or '') == '_blank'
    rel_ok = rel is not None and _has_rel_tokens(rel.value)
    if target_ok and rel_ok:
        return attrs

    out = attrs
    edits = []
    if target is not None and not target_ok:
        edits.append((target, ' target="_blank"'))
    if rel is not None and not rel_ok:
        have = (rel.value or '').split()
        lower = [x.lower() for x in have]
        for need in ('noopener', 'noreferrer'):
            if need not in lower:
                have.append(need)
        edits.append((rel, f' rel="{" ".join(have)}"'))
    edits.sort(key=lambda e: e[0].start, reverse=True)
    for a, text in edits:
        out = out[:a.start] + text + out[a.end:]
    if target is None:
        out += ' target="_blank"'
    if rel is None:
        out += ' rel="noopener noreferrer"'
    return out


def ensure_link_targets(html: str) -> str:
    """HTML 안의 모든 `<a href>`(제외 대상 제외)에 target="_blank" 와 rel="noopener noreferrer" 를 보장한다."""
    def repl(m: 're.Match[str]') -> str:
        fixed = _fix_open_tag(m.group(1))
        return m.group(0) if fixed == m.group(1) else f'<a{fixed}>'
    return A_OPEN.sub(repl, html)


def find_links_missing_target(html: str) -> List[str]:
    """보장이 빠진 `<a href>` 여는 태그 목록(검증용). 비어 있으면 통과."""
    bad = []
    for m in A_OPEN.finditer(html):
        if _fix_open_tag(m.group(1)) != m.group(1):
            s = m.group(0)
            bad.append(s if len(s) <= 120 else s[:117] + '...')
    return bad
