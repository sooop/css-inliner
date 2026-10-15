#!/usr/bin/env python3
"""
TracX Logis TXMD 도구 (스킬의 단일 진입점)

.txmd(머리말 + 한국어 원문 + @en/@ja 번역 줄)를 검증하고 언어별 미리보기 HTML 을 만든다.

사용
  # 검증만 (오류가 있으면 종료 코드 1)
  python3 tx_generate.py input.txmd

  # 검증 + 정규화본 저장 + 언어별 미리보기
  python3 tx_generate.py input.txmd --normalize out/name.txmd --preview-dir out/

  # 예전 인터페이스(호환): 한 언어(기본 ko)의 완전한 HTML 한 개
  python3 tx_generate.py input.md output.html --title "문서제목" [--lang en] [--template-dir DIR]

종료 코드: 0 통과(경고 가능) / 1 검증 오류(--strict 면 경고도) / 2 입력·실행 오류
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from tx_html_builder import TemplateBuilder  # noqa: E402
from tx_markdown_parser import parse_txmd  # noqa: E402
from tx_txmd import (BASE_LANG, DEFAULT_LANGS, analyze, normalize_txmd, parse_front_matter)  # noqa: E402


def read_text(path: str) -> str:
    with open(path, 'r', encoding='utf-8-sig') as f:  # BOM 허용
        return f.read()


def write_text(path: str, text: str) -> None:
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def format_stats(stats) -> str:
    items = []
    for key, label in (('headings', '제목'), ('tables', '표'), ('dynamic_tables', '동적 표'), ('buttons', '버튼'),
                       ('callouts', '콜아웃'), ('lists', '목록'), ('blocks', '번역 블록')):
        if stats.get(key):
            items.append(f'{label} {stats[key]}개')
    return ', '.join(items) if items else '기본 콘텐츠'


def build_previews(text: str, rep, builder: TemplateBuilder, langs, fallback: bool, title_override=None):
    """언어별 미리보기 문서 {lang: html}. 미번역 블록은 fallback 이면 ko 문장으로 채운다."""
    fm = rep.front
    others = [l for l in langs if l != BASE_LANG]
    docs = {}
    for lang in langs:
        r = parse_txmd(fm.body, lang, base=BASE_LANG, langs=others, fallback=fallback, dyn_mode='preview')
        subject = fm.subject.get(lang) or (fm.subject.get(BASE_LANG) if fallback else None)
        title = title_override or subject or fm.name or 'TracX Logis'
        docs[lang] = builder.build_document(r.html, lang, kind=rep.kind, title=title, subject=subject)
    return docs


def _utf8_streams() -> None:
    """콘솔 인코딩(예: Windows cp949)과 무관하게 한글 출력이 깨지지 않도록 UTF-8 로 고정"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


def main() -> int:
    _utf8_streams()
    ap = argparse.ArgumentParser(
        description='TracX Logis TXMD 검증 + 언어별 미리보기 생성기',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split('사용', 1)[1] if __doc__ else '')
    ap.add_argument('input', help='입력 .txmd (머리말 유무 모두 가능) 또는 예전 마크업 파일')
    ap.add_argument('output', nargs='?', help='(호환) 출력 .html 한 개. 주면 한 언어의 완전한 HTML 만 만든다')
    ap.add_argument('--preview-dir', help='언어별 미리보기 출력 폴더 (preview_ko.html, preview_en.html, preview_ja.html)')
    ap.add_argument('--normalize', metavar='PATH', help='정규화된 .txmd 를 이 경로에 저장')
    ap.add_argument('--langs', default=','.join(DEFAULT_LANGS), help='검사·미리보기 언어(기본 ko,en,ja)')
    ap.add_argument('--kind', choices=['mail', 'notice'], help='머리말 kind 를 덮어씀(기본: 머리말 값, 없으면 mail)')
    ap.add_argument('--name', help='정규화본의 머리말 name 이 없을 때 채움')
    ap.add_argument('--title', help='(호환) 문서 <title>. 생략하면 머리말 제목')
    ap.add_argument('--lang', default=BASE_LANG, help='(호환 모드) 출력 언어, 기본 ko')
    ap.add_argument('--template-dir', help='assets 폴더(기본: 스킬의 assets)')
    ap.add_argument('--no-fallback', action='store_true', help='미리보기에서 미번역 블록을 비워 둠(기본: ko 문장으로 채움)')
    ap.add_argument('--strict', action='store_true', help='경고도 실패로 취급')
    ap.add_argument('--json', action='store_true', help='검증 결과를 JSON 으로 출력')
    ap.add_argument('--scripts-dir', help=argparse.SUPPRESS)  # 예전 인자 호환(무시)
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()

    langs = [l.strip() for l in args.langs.split(',') if l.strip()]
    if BASE_LANG not in langs:
        langs.insert(0, BASE_LANG)

    try:
        text = read_text(args.input)
    except FileNotFoundError:
        print(f'오류: 입력 파일을 찾을 수 없습니다: {args.input}', file=sys.stderr)
        return 2
    except UnicodeDecodeError:
        print('오류: 입력 파일이 UTF-8 이 아닙니다.', file=sys.stderr)
        return 2

    try:
        builder = TemplateBuilder(args.template_dir)
        builder.load_all()
    except FileNotFoundError as e:
        print(f'오류: {e}', file=sys.stderr)
        return 2

    # ---- 호환 모드: 예전 `input output.html`
    if args.output:
        rep = analyze(text, [args.lang] if args.lang == BASE_LANG else langs, args.kind)
        fm = rep.front
        lang = args.lang
        others = [l for l in langs if l != BASE_LANG]
        r = parse_txmd(fm.body, lang, base=BASE_LANG, langs=others, fallback=True, dyn_mode='preview')
        title = args.title or fm.subject.get(lang) or fm.name or 'TracX Logis'
        write_text(args.output, builder.build_document(r.html, lang, kind=rep.kind, title=title,
                                                       subject=fm.subject.get(lang)))
        for w in fm.warnings + r.warnings:
            print(w, file=sys.stderr)
        print(f'HTML 생성 완료: {args.output}')
        print(f'생성된 콘텐츠: {format_stats(rep.stats)}')
        return 0

    rep = analyze(text, langs, args.kind)

    # ---- 보고
    if args.json:
        out = {
            'kind': rep.kind, 'name': rep.name, 'langs': rep.langs, 'subject': rep.subject,
            'variables': rep.variables, 'stats': rep.stats,
            'errors': [{'code': i.code, 'message': i.message} for i in rep.errors],
            'warnings': [{'code': i.code, 'message': i.message} for i in rep.warnings],
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print(f'종류: {"공지" if rep.kind == "notice" else "메일"}   이름: {rep.name or "(없음)"}   언어: {", ".join(rep.langs)}')
        print(f'구성: {format_stats(rep.stats)}')
        if rep.variables:
            print('치환자: ' + ', '.join(f'|!#-{v}|' for v in rep.variables))
        for i in rep.errors:
            print(f'[오류] ({i.code}) {i.message}')
        for i in rep.warnings:
            print(f'[경고] ({i.code}) {i.message}')
        print(f'결과: 오류 {len(rep.errors)}건, 경고 {len(rep.warnings)}건')

    # ---- 산출물
    try:
        if args.normalize:
            fm = rep.front
            norm = normalize_txmd(text, name=args.name if not fm.name else None, kind=args.kind)
            write_text(args.normalize, norm)
            if not args.json:
                print(f'정규화본 저장: {args.normalize}')
        if args.preview_dir:
            docs = build_previews(text, rep, builder, langs, fallback=not args.no_fallback, title_override=args.title)
            for lang, doc in docs.items():
                path = os.path.join(args.preview_dir, f'preview_{lang}.html')
                write_text(path, doc)
                if not args.json:
                    print(f'미리보기 저장: {path}')
    except OSError as e:
        print(f'오류: 파일을 쓸 수 없습니다: {e}', file=sys.stderr)
        return 2

    failed = bool(rep.errors) or (args.strict and bool(rep.warnings))
    return 1 if failed else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f'오류: 예상치 못한 문제가 생겼습니다: {exc}', file=sys.stderr)
        sys.exit(2)
