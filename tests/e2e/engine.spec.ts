import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outDir } from './global-setup';

const CSS = readFileSync('src/styles/template.css', 'utf8');
const OUT = outDir();

let page: Page;
let browserRef: import('@playwright/test').Browser;
test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  page = await browser.newPage();
  await page.goto(pathToFileURL(join(OUT, 'harness.html')).href);
  await page.waitForFunction(() => !!(window as any).__e2e);
});
test.afterAll(async () => page?.close());

const inline = (html: string, css = CSS, opts: object = {}) =>
  page.evaluate(
    ([h, c, o]) => (window as any).__e2e.convertToInline(h, c, { bodyOnly: true, profile: 'email', renderWidth: 1000, ...(o as object) }),
    [html, css, opts] as const,
  ) as Promise<{ html: string; warnings: any[] }>;

const exportAll = (over: object = {}) =>
  page.evaluate(
    async ([css, o]) => {
      const e = (window as any).__e2e;
      const project = e.makeProject();
      const r = await e.exportBundle(project, { inline: e.convertToInline, css, ...(o as object) });
      return { issues: r.issues, hasErrors: r.hasErrors, blocked: r.blocked, bundle: r.bundle, rendered: r.rendered, verify: r.bundle ? e.verifyBundle(JSON.parse(r.json)) : null };
    },
    [CSS, over] as const,
  );

test.describe('1. 실제 convertToInline 의 보존 동작', () => {
  test('tbody 보존', async () => {
    const r = await inline('<table><tbody><tr><td>a</td></tr></tbody></table>');
    expect(r.html).toMatch(/<tbody[\s>]/);
  });
  test('{{var}} 가 셀 텍스트·속성값 안에서 보존', async () => {
    const r = await inline('<table><tbody><tr><td title="{{name}}">{{name}} / {{qty}}개</td></tr></tbody></table>');
    expect(r.html).toContain('{{name}} / {{qty}}개');
    expect(r.html).toContain('title="{{name}}"');
  });
  test('[특성화] tbody 직속 |!#-rows_stock| 표식은 인라인 후 표 밖으로 이동(foster parenting), 표식 자체는 1회 남음', async () => {
    // 엔진 특성: 표식을 tbody 직속 텍스트로 두면 표 밖으로 밀린다. 렌더러(render.ts)는 이를 피하려고 자리표시 행을 쓴다.
    const r = await inline('<table><tbody>|!#-rows_stock|</tbody></table>');
    expect(r.html).not.toMatch(/<tbody[^>]*>\s*\|!#-rows_stock\|\s*<\/tbody>/);
    expect(r.html.split('|!#-rows_stock|').length - 1).toBe(1);
  });
  test('|!#-x| 치환자가 텍스트·href 안에서 보존', async () => {
    const r = await inline('<p>안녕 |!#-cust_nm|님 <a href="https://x.test/?no=|!#-order_no|">링크</a></p>');
    expect(r.html).toContain('|!#-cust_nm|');
    expect(r.html).toContain('href="https://x.test/?no=|!#-order_no|"');
  });
});

test.describe('1b. 원인 가설 검증(참고용, 통과해야 정상): tbody 직속 텍스트는 HTML 파서가 표 밖으로 옮긴다', () => {
  test('innerHTML 파싱만으로도 tbody 직속 텍스트가 <table> 앞으로 이동(foster parenting)', async () => {
    const out = await page.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = '<table><tbody>|!#-rows_stock|</tbody></table>';
      return d.innerHTML;
    });
    expect(out.indexOf('|!#-rows_stock|')).toBeLessThan(out.indexOf('<table'));
  });
  test('대안 A: tbody 안 HTML 주석은 인라인 후에도 tbody 안에 남는다', async () => {
    const r = await inline('<table><tbody><!--|!#-rows_stock|--></tbody></table>');
    expect(r.html).toMatch(/<tbody[^>]*><!--\|!#-rows_stock\|--><\/tbody>/);
  });
  test('대안 B: <tr><td>자리표시</td></tr> 는 tbody 안에 남아 후처리 치환 가능', async () => {
    const r = await inline('<table><tbody><tr data-rows-slot="stock"><td></td></tr></tbody></table>');
    expect(r.html).toMatch(/<tbody[^>]*><tr[^>]*data-rows-slot="stock"/);
  });
});

test.describe('1c. 행 합성(B 경로) 자체는 엔진이 정상 처리', () => {
  test('tbody 안 <tr><td>{{var}}</td></tr> 가 인라인 스타일 <tr> 로 보존', async () => {
    const r = await inline('<div class="mail"><table class="data"><thead><tr><th>상품</th><th>수량</th></tr></thead><tbody><tr><td>{{name}}</td><td>{{qty}}개</td></tr></tbody></table></div>');
    const tb = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(r.html)?.[1] ?? '';
    expect(tb).toMatch(/^<tr\b[^>]*style="[^"]+"[^>]*>[\s\S]*<\/tr>$/);
    expect(tb).toContain('>{{name}}</td>');
    expect(tb).toContain('>{{qty}}개</td>');
    expect((tb.match(/<td\b[^>]*style="/g) ?? []).length).toBe(2);
  });
});

test.describe('2~3. 행 템플릿 추출 / 번들 전체 경로 (fixture)', () => {
  test('행 템플릿이 <tr>…</tr> 인라인 스타일 한 줄', async () => {
    const x = await exportAll();
    const t = x.rendered.dynamicTables[0];
    expect(x.rendered.warnings.filter((w: any) => ['marker-lost', 'row-template-malformed'].includes(w.code))).toEqual([]);
    for (const lang of ['ko', 'en', 'ja']) {
      const row = t.rowTemplates[lang];
      expect(row, lang).toMatch(/^<tr\b[\s\S]*<\/tr>$/);
      expect(row).not.toMatch(/\n/);
      expect((row.match(/<td\b/g) ?? []).length).toBe(2);
      expect(row).toMatch(/<td[^>]*style="/);
      expect(row).toContain('{{name}}');
      expect(row).toContain('{{qty}}');
      expect(row).not.toMatch(/data-t=/);
    }
    expect(t.rowTemplates.en).toContain('pcs');
    expect(t.rowTemplates.ja).toContain('個');
    expect(t.columns).toBe(2);
    writeFileSync(join(OUT, 'row-templates.json'), JSON.stringify(t.rowTemplates, null, 2));
  });

  test('exportBundle → verifyBundle, data-t 미잔존, 표식 1회, body 안 전체', async () => {
    const x = await exportAll();
    expect(x.blocked, JSON.stringify(x.issues.filter((i: any) => i.level === 'error'))).toBe(false);
    expect(x.verify).toEqual({ ok: true, errors: [] });
    const b = x.bundle!;
    for (const lang of ['ko', 'en', 'ja']) {
      const h: string = b.locales[lang].html;
      expect(h).not.toMatch(/\sdata-(?:t|rows)\s*=/);
      expect(h.split('|!#-rows_orders|').length - 1).toBe(1);
      expect(h).not.toMatch(/<\/?(html|head|body)\b/i);
      expect(h).toMatch(/^\s*<table\b/i); // <body> 안 전체: 최상위 래퍼 표부터
      expect(h).toContain('|!#-cust_nm|');
      expect(h).toContain('|!#-order_no|');
    }
    writeFileSync(join(OUT, 'bundle.json'), JSON.stringify(b, null, 2));
  });
});

test.describe('3b. 셸 래퍼 lang 별 폰트 스택(번들 HTML 을 브라우저에서 계산)', () => {
  test('ko/en/ja 래퍼의 computed font-family 가 서로 다르고 data-tx-shell 이 없다', async () => {
    // 픽스처에는 셸이 없으므로, 같은 구조를 data-tx-shell 래퍼로 감싼 프로젝트를 브라우저 쪽에서 만든다.
    const x = await page.evaluate(async (css) => {
      const e = (window as any).__e2e;
      const p = e.makeProject();
      p.structure = `<table class="mail" lang="ko" data-tx-shell width="100%" role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><main>${p.structure}</main></td></tr></table>`;
      const r = await e.exportBundle(p, { inline: e.convertToInline, css });
      return { blocked: r.blocked, issues: r.issues, bundle: r.bundle };
    }, CSS);
    expect(x.blocked, JSON.stringify(x.issues.filter((i: any) => i.level === 'error'))).toBe(false);
    const fonts: Record<string, string> = {};
    for (const lang of ['ko', 'en', 'ja']) {
      const html: string = x.bundle!.locales[lang].html;
      expect(html, lang).not.toContain('data-tx-shell');
      expect(html, lang).toMatch(new RegExp(`^\\s*<table[^>]*\\slang="${lang}"`));
      const p = await (await browserRef.newContext()).newPage();
      await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`);
      fonts[lang] = await p.evaluate(() => getComputedStyle(document.querySelector('table[lang]') as Element).fontFamily);
      await p.context().close();
    }
    writeFileSync(join(OUT, 'fonts.json'), JSON.stringify(fonts, null, 2));
    expect(fonts.ko).toBeTruthy();
    expect(new Set(Object.values(fonts)).size).toBe(3);
  });
});

test.describe('4. 현재 template.css 기록 + 스크린샷', () => {
  test('크기·warnings 기록, 3개 언어 스크린샷', async () => {
    mkdirSync(OUT, { recursive: true });
    const x = await exportAll({ expectedRows: { orders: 5 } });
    const b = x.bundle ?? x.rendered;
    const report: any = { templateCssBytes: Buffer.byteLength(CSS), renderWarnings: x.rendered.warnings, issues: x.issues, locales: {} };
    const t = x.rendered.dynamicTables[0];
    const sample = (await page.evaluate(() => (window as any).__e2e.makeProject().dynamicTables[0].sampleRows)) as Record<string, string>[];
    for (const lang of ['ko', 'en', 'ja']) {
      const html: string = x.rendered.locales[lang].html;
      const bytes = Buffer.byteLength(html);
      report.locales[lang] = { htmlBytes: bytes, htmlKB: +(bytes / 1024).toFixed(2), rowTemplateBytes: Buffer.byteLength(t.rowTemplates[lang]) };
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const rows = sample.map((r) => t.rowTemplates[lang].replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => esc(r[k] ?? ''))).join('');
      const filled = html.replace('|!#-rows_orders|', rows).replace(/\|!#-cust_nm\|/g, '홍길동').replace(/\|!#-order_no\|/g, 'A-1001');
      const p = await (await browserRef.newContext()).newPage();
      await p.setViewportSize({ width: 1000, height: 900 });
      await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">${filled}</body>`);
      await p.screenshot({ path: join(OUT, `shot-${lang}.png`), fullPage: true });
      await p.close();
    }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log('E2E REPORT', JSON.stringify({ css: report.templateCssBytes, locales: report.locales, warnings: report.renderWarnings.length, issues: x.issues.map((i: any) => `${i.level}:${i.code}`) }));
    void b;
  });
});
