/**
 * 대조 기준 생성기: 앱의 TypeScript 파서/합성/셸이 tests/cases/* 에 내는 결과를 tests/fixtures/ts_reference.json 으로 저장한다.
 * 파이썬 파서(scripts/)가 이와 같은 출력을 내는지 test_parity.py 가 대조한다. 앱 파서를 바꾼 뒤에만 다시 생성하면 된다.
 *
 * 실행(저장소 루트에서):
 *   node_modules/.bin/esbuild sample/skills/tx-html-generator/tests/ts_reference/gen.ts --bundle --platform=node --format=esm --outfile=<임시>/gen.mjs
 *   node <임시>/gen.mjs sample/skills/tx-html-generator/tests
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseTxmd } from '../../../../../src/markup/parser';
import { composeLang } from '../../../../../src/markup/compose';
import { wrapShell, setShellLang } from '../../../../../src/markup/shell';
import { parseFrontMatter } from '../../../../../src/markup/frontmatter';

const root = process.argv[2];
const LANGS = ['ko', 'en', 'ja'];
const out: Record<string, unknown> = {};

for (const f of readdirSync(`${root}/cases`).sort()) {
  const text = readFileSync(`${root}/cases/${f}`, 'utf8');
  if (f.endsWith('.fm')) {
    const r = parseFrontMatter(text);
    out[f] = { kind: 'frontmatter', meta: r.meta, body: r.body, warnings: r.warnings };
    continue;
  }
  const r = parseTxmd(parseFrontMatter(text).body);
  const html: Record<string, Record<string, string>> = { preview: {}, send: {}, shell: {} };
  for (const lang of LANGS) {
    html.preview[lang] = composeLang(r, lang, { stripIds: true, mode: 'preview' }).html;
    html.send[lang] = composeLang(r, lang, { stripIds: true, mode: 'send' }).html;
  }
  const sh = wrapShell(r.structure, { logoSrc: 'LOGO' });
  const src = { structure: sh.structure, strings: { ...r.strings, ...sh.strings }, dynamicTables: r.dynamicTables };
  for (const lang of LANGS) {
    html.shell[lang] = setShellLang(composeLang(src, lang, { stripIds: true, mode: 'preview' }).html, lang);
  }
  out[f] = { kind: 'txmd', warnings: r.warnings, variables: [...r.variables].sort(), html };
}
writeFileSync(`${root}/fixtures/ts_reference.json`, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', Object.keys(out).length, 'cases');
