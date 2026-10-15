import { test, expect, chromium, type BrowserContext, type Page, type FrameLocator } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { appDir } from './app-setup';

/**
 * 앱 버그 탐지 프로브. 테스트마다 새 프로필(샘플 프로젝트부터)에서 독립 실행한다.
 * 실패는 앱 버그를 뜻한다(고치지 말고 보고). app.spec.ts 의 직렬 시나리오와 분리해 하나가 실패해도 나머지가 돈다.
 */
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;

let ctx: BrowserContext;
let page: Page;
let dir: string;
const preview = (): FrameLocator => page.frameLocator('iframe[title^="메일 미리보기"]');

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'css-inliner-probe-'));
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

test('P1. 초안 전체 화면: 모드 전환 뒤에도 포커스가 화면 안에 남고 Esc 로 닫히며 작성 중 글이 유지된다', async () => {
  const opener = page.locator('[data-draft-opener]');
  await opener.click();
  const dlg = page.getByRole('region', { name: /초안 화면/ });
  await expect(dlg).toBeVisible();
  const inDialog = () => page.evaluate(() => (document.activeElement?.closest('.dscr') ? 'dialog' : document.activeElement?.tagName));
  // 에디터 ⇄ 소스 전환(눌렀던 버튼이 아닌 곳으로 포커스가 옮겨져도 body 로 떨어지지 않는다)
  await page.getByRole('button', { name: '소스 보기 (.txmd 직접 편집)' }).click();
  await page.locator('#draft-ta').fill('# 포커스 확인\n\n본문');
  expect(await inDialog(), '소스 보기 진입 직후 활성 요소').toBe('dialog');
  // 만들기 버튼은 초안이 있을 때만 활성이고, 지우면 다시 비활성(포커스를 잃지 않는다)
  await expect(page.locator('[data-create]')).toBeEnabled();
  await page.locator('#draft-ta').fill('');
  await expect(page.locator('[data-create]')).toBeDisabled();
  await page.locator('#draft-ta').fill('# 포커스 확인\n\n본문');
  await page.getByRole('button', { name: '소스 보기 (.txmd 직접 편집)' }).click(); // 에디터로
  expect(await inDialog(), '에디터 복귀 직후 활성 요소').toBe('dialog');
  // 에디터(ProseMirror)에 포커스가 있어도 Esc 가 먹는다(ProseMirror 는 Esc 를 preventDefault 하므로 defaultPrevented 로 거르면 안 된다)
  await page.locator('.tx-pm').focus();
  await page.keyboard.press('Escape');
  await expect(dlg, '에디터 포커스에서 Esc 가 먹지 않음').toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dlg).toBeVisible();
  // 포커스가 body 로 빠져 있어도 Esc 가 먹는다(keydown 은 document 에서 받는다)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(dlg, 'Esc 가 먹지 않음').toHaveCount(0);
  await expect(opener).toBeFocused();
  // 닫아도 작성 중이던 글은 남는다
  await opener.click();
  await page.getByRole('button', { name: '소스 보기 (.txmd 직접 편집)' }).click();
  await expect(page.locator('#draft-ta')).toHaveValue('# 포커스 확인\n\n본문');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('P2. 메일 컨테이너(600px)가 렌더 폭(1000px) 안에서 가운데 정렬된다', async () => {
  const geo = await page.evaluate(() => {
    const d = (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!;
    const c = d.querySelector('table.mail-container') as HTMLElement;
    const r = c.getBoundingClientRect();
    const outer = d.querySelector('td.mail-outer') as HTMLElement;
    return { left: r.left, width: r.width, frameWidth: d.documentElement.clientWidth, outerAlign: outer.getAttribute('align'), outerTextAlign: getComputedStyle(outer).textAlign, containerStyle: c.getAttribute('style') };
  });
  const expectedLeft = (geo.frameWidth - geo.width) / 2;
  expect(Math.abs(geo.left - expectedLeft), JSON.stringify(geo)).toBeLessThan(2);
});

test('P3. 편집 직후(자동 저장 700ms 전) 새로고침해도 편집이 보존된다', async () => {
  await preview().locator('[data-t]', { hasText: '안녕하세요' }).first().click();
  await page.locator('#ta-ko').fill('경쟁상태RACE |!#-cust_nm|');
  await page.reload();
  await page.locator('.appbar').waitFor();
  await preview().locator('table').first().waitFor({ timeout: 30_000 });
  const t = await preview().locator('body').innerText();
  expect(t.includes('경쟁상태RACE'), '자동 저장 대기 중 새로고침하면 편집이 유실됨').toBe(true);
});

test('P4. 블록이 많아져도 문서(window) 자체는 스크롤되지 않는다', async () => {
  await page.locator('#ltab-blocks').click();
  await page.locator('.list .item', { hasText: '문단' }).first().click();
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: '+ 블록 추가' }).click();
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const culprits: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('iframe')) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight + 1 && getComputedStyle(el).position === 'absolute') culprits.push(`${el.tagName}.${(el as HTMLElement).className} (bottom=${Math.round(r.bottom)})`);
    }
    return { sh: document.documentElement.scrollHeight, ih: window.innerHeight, culprits: culprits.slice(0, 6) };
  });
  expect(info.sh, `문서 높이 ${info.sh} > 창 ${info.ih}; position:absolute 후보: ${info.culprits.join(', ')}`).toBeLessThanOrEqual(info.ih);
});
