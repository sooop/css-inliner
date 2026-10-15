"""골든 파일 생성기: 파이썬 원본 파서(sample/skills/tx-html-generator)의 출력을 cases/*.md -> expected/*.html 로 저장.

사용: python -I src/markup/__golden__/generate.py   (저장소 루트에서)
원본 파서 출력을 '있는 그대로' 저장한다. TS 포팅이 의도적으로 다르게 동작하는 케이스는
parser.test.ts 의 INTENTIONAL_DIFFS 에 사유와 함께 따로 선언한다.
"""
import importlib.util, io, sys, contextlib
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[2]
spec = importlib.util.spec_from_file_location(
    "tx_markdown_parser", root / "sample/skills/tx-html-generator/scripts/tx_markdown_parser.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

out = here / "expected"; out.mkdir(exist_ok=True)
for f in sorted((here / "cases").glob("*.md")):
    text = f.read_text(encoding="utf-8")  # universal newlines (\r\n -> \n), 원본 CLI 와 동일
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        html = mod.TracXMarkdownParser().parse(text)
    (out / (f.stem + ".html")).write_text(html, encoding="utf-8", newline="")
    (out / (f.stem + ".stderr.txt")).write_text(err.getvalue(), encoding="utf-8", newline="")
    print("wrote", f.stem, len(html), "chars,", len(err.getvalue().splitlines()), "warnings")
