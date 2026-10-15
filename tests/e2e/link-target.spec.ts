import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { outDir } from './global-setup';

/**
 * 링크(버튼·인라인·로고·행 템플릿)는 실제 엔진으로 인라인한 번들 HTML 에서도 항상
 * target="_blank" rel="noopener noreferrer" 를 가진다(mailto/tel/sms/# 제외). 엔진이 <a> 속성을 보존하는지 확인한다.
 */
const CSS = readFileSync('src/styles/template.css', 'utf8');
const OUT = outDir();
let page: Page;

const DRAFT = [
  '# 링크 테스트',
  '@en Link test',
  '',
  '문단 [인라인](https://a.test/x) 와 [메일](mailto:a@b.c) 와 [전화](tel:+8210) 와 [변수](|!#-url|)',
  '@en Para [inline](https://a.test/x) and [mail](mailto:a@b.c) and [tel](tel:+8210) and [var](|!#-url|)',
  '',
  '[버튼, 하나, https://t.com/|!#-no|, primary]',
  '@en One',
  '[버튼, 둘, https://u.com, secondary]',
  '@en Two',
  '',
  '[정보: 안내]',
  '@en Notice',
  '콜아웃 [링크](https://c.test)',
  '@en Callout [link](https://c.test)',
  '',
  '[버튼, 콜아웃 버튼, https://cb.test, primary]',
  '@en Callout button',
  '[/정보]',
].join('\n');

const DRAFT_DYN = [
  '# 동적 표 링크',
  '@en Dynamic link',
  '@ja 動的リンク',
  '',
  '[표: 가로형, 동적: orders]',
  '{상품명| 조회}',
  '@en {Item| View}',
  '@ja {商品| 照会}',
  '- [{{name}}]({{url}})| [보기](https://r.test/{{id}})',
  '@en - [{{name}}]({{url}})| [view](https://r.test/{{id}})',
  '@ja - [{{name}}]({{url}})| [表示](https://r.test/{{id}})',
  '@sample name=이어폰| url=https://r.test/1| id=1',
  '[/표]',
  '',
  '[버튼, 하나, https://t.com/x, primary]',
  '@en One',
].join('\n');

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const r = await build({
    entryPoints: [resolve('tests/e2e/link-target-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    loader: { '.json': 'json' },
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
  const file = join(OUT, 'link-target-harness.html');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>lt</title><body><script>${js}</script></body>`);
  page = await browser.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => !!(window as any).__lt);
});
test.afterAll(async () => page?.close());

type Out = { hasErrors: boolean; verify: { ok: boolean; errors: string[] } | null; htmls: Record<string, string>; rows: Record<string, string>; warn: string[] };

const run = (kind: 'sample' | 'draft' | 'dyn') =>
  page.evaluate(
    async ([css, k, draft, dyn]) => {
      const e = (window as any).__lt;
      const project = k === 'sample' ? e.createSampleProject() : e.createProjectFromDraft(k === 'dyn' ? dyn : draft, { name: '링크' }).project;
      const r = await e.exportBundle(project, { inline: e.convertToInline, css, force: true });
      const b = r.bundle;
      const rows: Record<string, string> = {};
      for (const t of b.dynamicTables) for (const [l, v] of Object.entries(t.rowTemplates)) rows[`${t.id}/${l}`] = v as string;
      return {
        hasErrors: r.hasErrors,
        verify: e.verifyBundle(JSON.parse(r.json)),
        htmls: Object.fromEntries(Object.entries(b.locales).map(([l, v]: [string, any]) => [l, v.html])),
        rows,
        warn: r.rendered.warnings.map((w: any) => `${w.code}:${w.message}`),
      };
    },
    [CSS, kind, DRAFT, DRAFT_DYN] as const,
  ) as Promise<Out>;

/** 제외 대상이 아닌 <a href> 의 여는 태그 중 target/rel 이 빠진 것 */
function missing(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<a\s[^>]*>/gi)) {
    const tag = m[0];
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!href) continue;
    const h = (href[1] ?? href[2] ?? href[3] ?? '').trim();
    if (/^(mailto:|tel:|sms:|#)/i.test(h)) continue;
    const t = /\starget\s*=\s*"_blank"/i.test(tag);
    const rel = /\srel\s*=\s*"[^"]*\bnoopener\b[^"]*\bnoreferrer\b[^"]*"|\srel\s*=\s*"[^"]*\bnoreferrer\b[^"]*\bnoopener\b[^"]*"/i.test(tag);
    if (!t || !rel) bad.push(tag);
  }
  return bad;
}
const count = (html: string) => [...html.matchAll(/<a\s(?:[^>]*\s)?href=/gi)].length;

for (const kind of ['sample', 'draft', 'dyn'] as const) {
  test(`실제 엔진 인라인 결과의 모든 링크가 target/rel 을 가진다: ${kind}`, async () => {
    const r = await run(kind);
    expect(r.verify, JSON.stringify(r.verify)).toEqual({ ok: true, errors: [] });
    expect(r.warn.filter((w) => w.startsWith('link-target-restored')), '엔진이 속성을 바꾸지 않아야 한다').toEqual([]);
    for (const [lang, html] of Object.entries(r.htmls)) {
      expect(count(html), `${lang}: 링크 존재`).toBeGreaterThan(0);
      expect(missing(html), lang).toEqual([]);
    }
    for (const [k, row] of Object.entries(r.rows)) {
      expect(missing(row), k).toEqual([]);
      if (kind === 'dyn') expect(count(row), `${k}: 행 템플릿 링크 2개`).toBe(2);
    }
    if (kind === 'dyn') expect(Object.keys(r.rows).length).toBeGreaterThan(0);
  });
}

test('초안: 제외 대상(mailto/tel)은 그대로, 나머지는 보장', async () => {
  const r = await run('draft');
  const ko = r.htmls.ko;
  expect(ko).toMatch(/<a [^>]*href="mailto:a@b\.c"[^>]*>/);
  expect(ko.match(/<a [^>]*href="mailto:a@b\.c"[^>]*>/)![0]).not.toContain('target=');
  expect(ko.match(/<a [^>]*href="tel:\+8210"[^>]*>/)![0]).not.toContain('target=');
  expect(ko.match(/<a [^>]*href="\|!#-url\|"[^>]*>/)![0]).toContain('target="_blank"');
  const btn = ko.match(/<a [^>]*class="btn btn-primary"[^>]*>/g)!;
  expect(btn.length).toBeGreaterThanOrEqual(2);
  for (const b of btn) expect(b).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
});
