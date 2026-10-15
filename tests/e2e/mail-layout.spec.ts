import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { outDir } from './global-setup';

// 발송 HTML 구조(래퍼 표 -> 600px 컨테이너 표) 자체의 가운데 정렬 검증. 앱이 아니라 renderProject 결과를 새 페이지에 setContent.
const OUT = outDir();
const CSS = readFileSync('src/styles/template.css', 'utf8');

let page: Page;
let browserRef: import('@playwright/test').Browser;
test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  const r = await build({ entryPoints: [resolve('tests/e2e/mail-layout-entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', loader: { '.json': 'json' } });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'mail-layout-harness.html'), `<!doctype html><meta charset="utf-8"><body><script>${r.outputFiles[0].text.replace(/<\/script/gi, '<\/script')}</script></body>`);
  page = await browser.newPage();
  await page.goto(pathToFileURL(join(OUT, 'mail-layout-harness.html')).href);
  await page.waitForFunction(() => !!(window as any).__ml);
});
test.afterAll(async () => page?.close());

const render = (): Promise<Record<string, string>> => page.evaluate((css) => (window as any).__ml.render(css), CSS);

const geom = (p: Page) =>
  p.evaluate(() => {
    const c = document.querySelector('table.mail-container') as HTMLElement;
    const o = document.querySelector('td.mail-outer') as HTMLElement;
    const r = c.getBoundingClientRect();
    const textLefts = [...document.querySelectorAll('.mail-content p, .mail-content h1, .mail-footer p')].map((el) => ({
      ta: getComputedStyle(el).textAlign,
    }));
    const alt = document.querySelector('img.logo') as HTMLElement;
    return {
      left: r.left,
      width: r.width,
      vw: document.documentElement.clientWidth,
      containerAlign: c.getAttribute('align'),
      containerStyle: c.getAttribute('style'),
      outerAlign: o.getAttribute('align'),
      outerStyle: o.getAttribute('style'),
      outerTA: getComputedStyle(o).textAlign,
      bodyTA: getComputedStyle(document.querySelector('td.mail-body')!).textAlign,
      textAligns: textLefts.map((t) => t.ta),
      logoLeft: alt.getBoundingClientRect().left,
    };
  });

test('발송 HTML: 폭 1000/600/400 에서 컨테이너 가운데, 내용은 left', async () => {
  const htmls = await render();
  mkdirSync(join(OUT, 'shots'), { recursive: true });
  for (const [lang, html] of Object.entries(htmls)) {
    expect(html).toMatch(/<table[^>]*class="mail-container"[^>]*\salign="center"|<table[^>]*\salign="center"[^>]*class="mail-container"/);
    for (const w of [1000, 600, 400]) {
      const p = await browserRef.newPage({ viewport: { width: w, height: 900 } });
      await p.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${html}</body></html>`);
      const g = await geom(p);
      const msg = `${lang}@${w} ${JSON.stringify(g)}`;
      const expectedLeft = Math.max(0, (g.vw - 600) / 2);
      expect(Math.abs(g.left - expectedLeft), msg).toBeLessThan(2);
      expect(g.width, msg).toBeLessThanOrEqual(600);
      for (const ta of g.textAligns) expect(['left', 'start'], msg).toContain(ta);
      expect(['left', 'start'], msg).toContain(g.bodyTA);
      if (w === 1000) await p.screenshot({ path: join(OUT, 'shots', `mail-${lang}-1000.png`) });
      await p.close();
    }
  }
});

test('이미지 차단 시 alt 텍스트가 왼쪽 정렬(로고 셀)', async () => {
  const htmls = await render();
  const p = await browserRef.newPage({ viewport: { width: 1000, height: 600 } });
  await p.setContent(`<!doctype html><body style="margin:0">${htmls.ko.replace(/<img\b[^>]*class="logo"[^>]*>/, '<img class="logo" alt="TRACXLOGIS" width="160" height="25" style="display:block;border:0;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0F2A52">')}`);
  const g = await p.evaluate(() => {
    const c = document.querySelector('table.mail-container')!.getBoundingClientRect();
    const l = document.querySelector('img.logo')!.getBoundingClientRect();
    return { containerLeft: c.left, logoLeft: l.left, ta: getComputedStyle(document.querySelector('td.mail-logo')!).textAlign };
  });
  expect(g.logoLeft - g.containerLeft, JSON.stringify(g)).toBeGreaterThanOrEqual(0);
  expect(g.logoLeft - g.containerLeft, JSON.stringify(g)).toBeLessThanOrEqual(40);
  expect(['left', 'start']).toContain(g.ta);
  await p.close();
});

test('CSS margin 을 신뢰하지 않는 클라이언트 모사: container 의 margin 을 지워도 align 속성만으로 가운데', async () => {
  const htmls = await render();
  for (const w of [1000, 400]) {
    const p = await browserRef.newPage({ viewport: { width: w, height: 600 } });
    const stripped = htmls.ko.replace(/(<table class="mail-container"[^>]*style="[^"]*?)margin: 0px auto;/, '$1');
    expect(stripped).not.toBe(htmls.ko);
    await p.setContent(`<!doctype html><html><body style="margin:0">${stripped}</body></html>`);
    const left = await p.evaluate(() => document.querySelector('table.mail-container')!.getBoundingClientRect().left);
    expect(Math.abs(left - Math.max(0, (w - 600) / 2)), `w=${w} left=${left}`).toBeLessThan(2);
    await p.close();
  }
});
