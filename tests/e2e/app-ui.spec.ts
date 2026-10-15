import { test, expect, chromium, type BrowserContext, type Page, type FrameLocator } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { appDir } from './app-setup';

/**
 * UI 레이아웃·블록 속성 회귀 테스트. 테스트마다 새 프로필(샘플 프로젝트부터)에서 독립 실행한다.
 */
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;

let ctx: BrowserContext;
let page: Page;
let dir: string;
const preview = (): FrameLocator => page.frameLocator('iframe[title^="메일 미리보기"]');

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'css-inliner-ui-'));
  ctx = await chromium.launchPersistentContext(dir, { channel: process.env.E2E_CHANNEL ?? 'msedge', headless: true, viewport: { width: 1440, height: 900 } });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(APP_URL);
  await page.locator('.appbar').waitFor();
  await preview().locator('table').first().waitFor({ timeout: 30_000 });
});
test.afterEach(async () => {
  await ctx?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 무시 */
  }
});

interface Box {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

for (const [w, h] of [
  [800, 900],
  [480, 800],
] as const) {
  test(`U1. 폭 ${w}px 세로 스택: 패널이 서로 겹치지 않고 가로 넘침이 없다`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    // 블록을 늘려 각 패널의 내용이 화면 높이를 넘게 만든다(수축·겹침이 드러나는 조건)
    await page.locator('#ltab-blocks').click();
    await page.locator('.list .item', { hasText: '문단' }).first().click();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '+ 블록 추가' }).click();
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const boxes: Box[] = [];
      const add = (name: string, el: Element | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        boxes.push({ name, x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height });
      };
      add('appbar', document.querySelector('.appbar'));
      const panes = Array.from(document.querySelectorAll('.ws > .pane'));
      panes.forEach((p, i) => add(`pane${i}:${p.getAttribute('aria-label')}`, p));
      const bad = panes.map((p) => ({ label: p.getAttribute('aria-label'), sh: p.scrollHeight, ch: p.clientHeight })).filter((p) => p.sh > p.ch + 1);
      return { boxes, bad, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    const overlaps: string[] = [];
    for (let i = 0; i < info.boxes.length; i++)
      for (let j = i + 1; j < info.boxes.length; j++) {
        const a = info.boxes[i];
        const b = info.boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) overlaps.push(`${a.name} ∩ ${b.name} (${Math.round(ox)}x${Math.round(oy)})`);
      }
    expect(overlaps, JSON.stringify(info.boxes)).toEqual([]);
    expect(info.bad, '패널 내용이 패널 박스를 넘어 흘러나옴(수축)').toEqual([]);
    expect(info.boxes.filter((b) => b.name.startsWith('pane') && b.h <= 100).map((b) => b.name), JSON.stringify(info.boxes)).toEqual([]);
    expect(info.sw, '가로 스크롤').toBeLessThanOrEqual(info.cw);
    // 페이지 자체가 세로로 스크롤되어 맨 아래 패널까지 닿을 수 있어야 한다
    const reach = await page.evaluate(() => {
      window.scrollTo(0, 1e6);
      const last = document.querySelector('.ws > .pane:last-of-type')!.getBoundingClientRect();
      return { bottom: last.bottom, ih: window.innerHeight };
    });
    expect(reach.bottom).toBeLessThanOrEqual(reach.ih + 2);
  });
}

test('U2. 1100px: 중앙 헤더가 한 줄, 좁은 좌측 열의 문자열이 읽을 수 있는 폭, 넓게 모드의 언어 열 폭이 같다', async () => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(400);
  const headH = await page.locator('.pane.center .pane-head').evaluate((e) => e.getBoundingClientRect().height);
  expect(headH, '중앙 헤더 높이(한 줄은 약 45px)').toBeLessThan(60);
  await page.locator('#ltab-strings').click();
  const widths = await page.locator('#lpanel .ctext').evaluateAll((els) => els.slice(0, 12).map((e) => e.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(3);
  expect(Math.min(...widths), `문자열 텍스트 폭 ${widths.join(',')}`).toBeGreaterThan(120);
  const lineH = await page.locator('#lpanel .ctext').first().evaluate((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) }));
  expect(lineH.h, '한 글자씩 세로로 줄바꿈되지 않음').toBeLessThan(lineH.lh * 6);
  await page.locator('label.chk', { hasText: '넓게' }).locator('input').check();
  await page.waitForTimeout(300);
  const ta = await page.locator('#lpanel table.g tbody tr').first().locator('textarea').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(ta.length).toBe(3);
  expect(Math.max(...ta) - Math.min(...ta), `ko/en/ja 입력칸 폭 ${ta.join(',')}`).toBeLessThan(3);
});

test('U3. 콜아웃 종류 변경: 미리보기 색이 바뀌고 번역은 오래됨이 되지 않는다', async () => {
  const bg = () => page.evaluate(() => getComputedStyle(((document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!.querySelector('div.callout') as HTMLElement)).backgroundColor);
  const before = await bg();
  await page.locator('#ltab-strings').click();
  const staleBefore = await page.locator('#lpanel .dot.d-stale').count();
  await preview().locator('div.callout [data-t]').first().click();
  const sel = page.locator('#bp-callout');
  await expect(sel).toBeVisible();
  await expect(sel).toHaveValue('info');
  await sel.selectOption('warn');
  await expect.poll(bg, { timeout: 15_000 }).not.toBe(before);
  const after = await bg();
  await expect(preview().locator('div.callout-warn')).toHaveCount(1);
  // 번역은 그대로: 오래됨 배지/점이 생기지 않는다
  await expect(page.locator('#lpanel .dot.d-stale')).toHaveCount(staleBefore);
  await expect(page.locator('#acc-edit .badge', { hasText: '오래됨' })).toHaveCount(0);
  // 다른 종류로도 색이 다르다
  await sel.selectOption('accent');
  await expect.poll(bg, { timeout: 15_000 }).not.toBe(after);
  await expect(page.locator('#lpanel .dot.d-stale')).toHaveCount(staleBefore);
  // 콜아웃 안의 블록(제목·본문)은 그대로 남는다
  await expect(preview().locator('div.callout-accent h3[data-t]')).toHaveCount(1);
  await expect(preview().locator('div.callout-accent p[data-t]')).not.toHaveCount(0);
  // 자동 저장
  await expect(page.locator('.appbar .badge', { hasText: '자동 저장됨' })).toBeVisible({ timeout: 5000 });
});

test('U4. 제목 레벨·버튼 스타일·버튼 그룹 속성', async () => {
  const tagOf = (text: string) =>
    page.evaluate((t) => {
      const d = (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!;
      return Array.from(d.querySelectorAll('[data-t]')).find((e) => (e.textContent ?? '').includes(t))?.tagName ?? '';
    }, text);
  const h = preview().locator('h1[data-t], h2[data-t]').first();
  const htext = (await h.innerText()).trim();
  const was = await tagOf(htext);
  await h.click();
  const sel = page.locator('#bp-heading');
  await expect(sel).toBeVisible();
  await sel.selectOption('3');
  await expect.poll(() => tagOf(htext), { timeout: 15_000 }).toBe('H3');
  expect(was).not.toBe('H3');
  // 버튼
  const btn = preview().locator('a.btn[data-t]').first();
  await btn.click();
  await expect(page.locator('#bp-btn')).toBeVisible();
  const colorOf = () => btn.evaluate((e) => getComputedStyle(e).color);
  const c0 = await colorOf();
  await page.locator('#bp-btn').selectOption((await page.locator('#bp-btn').inputValue()) === 'ghost' ? 'primary' : 'ghost');
  await expect.poll(colorOf, { timeout: 15_000 }).not.toBe(c0);
  // 문자열 상태에 오래됨이 없다
  await page.locator('#ltab-strings').click();
  await expect(page.locator('#lpanel .dot.d-stale')).toHaveCount(0);
});
