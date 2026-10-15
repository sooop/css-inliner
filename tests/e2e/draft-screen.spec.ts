import { test, expect, chromium, type BrowserContext, type Locator, type Page, type FrameLocator } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { outDir } from './global-setup';
import { appDir } from './app-setup';
import { SAMPLE_TXMD } from '../../src/ui/state/sample';

/**
 * `+ 초안` = 초안으로 새 프로젝트 만들기. 초안 작성은 항상 전체 화면(DraftScreen)이다.
 * 테스트마다 새 프로필(샘플 프로젝트 1개부터)에서 독립 실행. 스크린샷은 OUT/shots-draft/.
 */
const SHOTS = join(outDir(), 'shots-draft');
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;
const SRC_BTN = '소스 보기 (.txmd 직접 편집)';

const DRAFT = `# 초안뷰 테스트 제목
@en Draft view test title
@ja 下書きビューのテスト

초안뷰 본문입니다, |!#-cust_nm|님.
@en Draft body text for |!#-cust_nm|.
@ja 下書き本文、|!#-cust_nm|様。

[정보: 경고 확인]
제목

[표: 가로형, 동적: inner]
{a| b}
- {{a}}| {{b}}
[/표]
[/정보]
`;

let ctx: BrowserContext;
let page: Page;
let dir: string;
const consoleErrors: string[] = [];
const preview = (): FrameLocator => page.frameLocator('iframe[title^="메일 미리보기"]');
const shot = (name: string) => page.screenshot({ path: join(SHOTS, name + '.png') });

async function boot() {
  await page.goto(APP_URL);
  await page.locator('.appbar').waitFor();
  await preview().locator('table').first().waitFor({ timeout: 30_000 });
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(async () => {
  consoleErrors.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'css-inliner-draftscreen-'));
  ctx = await chromium.launchPersistentContext(dir, { channel: process.env.E2E_CHANNEL ?? 'msedge', headless: true, viewport: { width: 1440, height: 900 } });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  await boot();
});
test.afterEach(async () => {
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  await ctx?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 무시 */
  }
});

const opener = () => page.locator('[data-draft-opener]');
const screen = (): Locator => page.getByRole('region', { name: /초안 화면/ });

async function openDraft() {
  await opener().click();
  await expect(screen()).toBeVisible();
}
/** 소스 보기로 전환(이미 소스면 그대로) 후 textarea 를 돌려준다 */
async function toSource(): Promise<Locator> {
  const btn = screen().getByRole('button', { name: SRC_BTN });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  const ta = page.locator('#draft-ta');
  await expect(ta).toBeVisible();
  return ta;
}
async function toEditor() {
  const btn = screen().getByRole('button', { name: SRC_BTN });
  if ((await btn.getAttribute('aria-pressed')) === 'true') await btn.click();
  await expect(page.locator('.tx-pm')).toBeVisible();
}

test('전체 화면만 있다: 모달·표시 방식 전환 UI 가 없고, 예전 표시 방식 저장값은 무시된다', async () => {
  await expect(page.locator('[data-draft-view]')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('txms.draftView', 'modal'));
  await page.reload();
  await boot();
  await openDraft();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(screen().locator('[data-draft-view]')).toHaveCount(0);
  expect(await page.locator('.app-root').getAttribute('inert')).not.toBeNull();
  // 전체 화면이 열린 채 새로고침하면 그대로 복원된다(예전 저장값 'modal' 이 남아 있어도)
  await page.reload();
  await boot();
  await expect(screen()).toBeVisible();
});

test('초안 입력 → 이름·코드 → 만들기 → 새 프로젝트로 전환(목록 2개·기존 불변·번역 줄이 초기 번역)', async () => {
  await openDraft();
  await shot('full-00-empty');
  const create = screen().locator('[data-create]');
  await expect(create, '빈 초안은 만들 수 없다').toBeDisabled();
  const ta = await toSource();
  await ta.fill(DRAFT);
  await expect(page.locator('#draft-name'), '이름 기본값 = 초안 첫 제목').toHaveValue('초안뷰 테스트 제목');
  await expect(screen().locator('[data-draft-summary]')).toContainText('en·ja');
  await expect(screen().locator('[data-draft-warnings]'), '파서 경고 목록').toBeVisible({ timeout: 5000 });
  await expect(create, '경고는 만들기를 막지 않는다').toBeEnabled();
  await page.locator('#draft-name').fill('뷰 테스트 프로젝트');
  await page.locator('#draft-code').fill('VIEW_TEST');
  await expect(screen().getByRole('group', { name: '언어 목록' })).toContainText('ko');
  await shot('full-01-filled-source');
  await create.click();
  await expect(screen()).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('뷰 테스트 프로젝트');
  await expect(page.locator('.proj-btn')).toHaveText('뷰 테스트 프로젝트');
  await expect(page.locator('.appbar .idc')).toHaveText('VIEW_TEST');
  await expect(opener(), '만든 뒤 포커스는 + 초안 버튼으로').toBeFocused();
  await expect.poll(() => preview().locator('body').innerText(), { timeout: 20_000 }).toContain('초안뷰 본문입니다');
  // 번역 줄이 초기 번역: 오래됨·미번역 없이 들어 있다
  await preview().locator('[data-t]', { hasText: '초안뷰 본문입니다' }).first().click();
  await expect(page.locator('#ta-en')).toHaveValue(/^Draft body text/);
  await expect(page.locator('#ta-ja')).toHaveValue(/下書き本文/);
  await expect(page.locator('label[for="ta-en"] .badge', { hasText: '오래됨' })).toHaveCount(0);
  // 목록에 2개, 기존 프로젝트는 그대로
  await page.locator('#ltab-projects').click();
  await expect(page.locator('.proj')).toHaveCount(2);
  await page.locator('.proj .open', { hasText: '배송 시작 안내 (샘플)' }).click();
  await expect(page.locator('.proj-btn')).toContainText('배송 시작 안내');
  await expect.poll(() => preview().locator('body').innerText(), { timeout: 20_000 }).toContain('안녕하세요');
  expect(await preview().locator('body').innerText()).not.toContain('초안뷰 본문입니다');
  await expect(page.locator('.appbar .idc')).toHaveText('SHIP_START');
  // 성공하면 작성 중이던 초안은 비워진다(새로고침 뒤에도)
  await page.reload();
  await boot();
  await openDraft();
  await expect(await toSource()).toHaveValue('');
  await expect(page.locator('#draft-name')).toHaveValue('');
  await expect(screen().locator('[data-create]')).toBeDisabled();
});

test('작성 중인 초안은 돌아가도·입력 직후 새로고침해도 유지된다(이름·코드·열린 화면 포함)', async () => {
  await openDraft();
  const ta = await toSource();
  await ta.fill(DRAFT);
  await page.locator('#draft-name').fill('새로고침 확인');
  await page.locator('#draft-code').fill('RELOAD_1');
  // 돌아가기 버튼: 닫히고 초안은 유지, 포커스는 + 초안 버튼, 셸 inert 해제
  await screen().getByRole('button', { name: '← 돌아가기' }).click();
  await expect(screen()).toHaveCount(0);
  await expect(opener()).toBeFocused();
  expect(await page.locator('.app-root').getAttribute('inert')).toBeNull();
  // 닫은 뒤 새로고침하면 화면이 다시 열리지 않는다
  await page.reload();
  await boot();
  await expect(screen()).toHaveCount(0);
  // 다시 열면 그대로(이름·코드 포함)
  await openDraft();
  await expect(await toSource()).toHaveValue(DRAFT);
  await expect(page.locator('#draft-name')).toHaveValue('새로고침 확인');
  await expect(page.locator('#draft-code')).toHaveValue('RELOAD_1');
  // Esc 로 닫기, 포커스 복귀
  await page.keyboard.press('Escape');
  await expect(screen()).toHaveCount(0);
  await expect(opener(), 'Esc 뒤 포커스는 + 초안 버튼으로').toBeFocused();
  await openDraft();
  // 입력 직후(백업 디바운스 300ms 전) 새로고침 → 열린 화면과 글이 그대로 복원
  await (await toSource()).fill(DRAFT + '\n마지막 줄 ZZ');
  await page.reload();
  await boot();
  await expect(screen(), '새로고침하면 전체 화면이 그대로 복원된다').toBeVisible();
  await expect(await toSource()).toHaveValue(DRAFT + '\n마지막 줄 ZZ');
  await expect(page.locator('#draft-name')).toHaveValue('새로고침 확인');
  await expect(page.locator('#draft-code')).toHaveValue('RELOAD_1');
  await shot('full-02-restored');
});

test('포커스·키보드(Esc)·상단 바 구성·다크/라이트·좁은 폭', async () => {
  await opener().click();
  const scr = screen();
  await expect(scr).toBeVisible();
  // 에디터 로딩 뒤 입력창에 포커스
  await expect(page.locator('.tx-pm')).toBeFocused();
  // 상단 바: 돌아가기·이름 입력·프로젝트 만들기
  const bar = scr.locator('.dscr-bar');
  await expect(bar.getByRole('button', { name: '← 돌아가기' })).toBeVisible();
  await expect(bar.locator('#draft-name')).toBeVisible();
  await expect(bar.locator('[data-create]')).toBeVisible();
  // 화면이 뷰포트 전체를 덮고, 문서(window)는 스크롤되지 않는다
  const geo = await scr.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, sh: document.documentElement.scrollHeight };
  });
  expect(geo).toMatchObject({ x: 0, y: 0, w: geo.iw, h: geo.ih });
  expect(geo.sh).toBeLessThanOrEqual(geo.ih);
  // 에디터가 남는 높이를 채운다
  const hostH = await page.locator('.tx-host').evaluate((e) => e.getBoundingClientRect().height);
  expect(hostH, `에디터 높이 ${hostH}`).toBeGreaterThan(900 * 0.52 + 20);
  // Tab 순환이 앱 셸(inert)로 새지 않는다
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => !!document.activeElement?.closest('.dscr') || document.activeElement === document.body);
    expect(where, `Tab ${i}`).toBe(true);
  }
  // 에디터 팝업이 열려 있을 때 Esc 는 팝업만 닫고 화면은 닫지 않는다
  await page.locator('.tx-pm').focus();
  await scr.getByRole('button', { name: '블록 삽입' }).click();
  await expect(scr.getByRole('menu', { name: '블록 삽입' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(scr.getByRole('menu', { name: '블록 삽입' })).toHaveCount(0);
  await expect(scr).toBeVisible();
  // 본문을 채우고 다크 테마로
  await (await toSource()).fill(DRAFT);
  await page.emulateMedia({ colorScheme: 'dark' });
  await toEditor();
  const colors = await page.evaluate(() => ({ screen: getComputedStyle(document.querySelector('.dscr')!).backgroundColor, bar: getComputedStyle(document.querySelector('.dscr-bar')!).backgroundColor }));
  expect(colors.screen).not.toBe('rgb(255, 255, 255)');
  expect(colors.bar).not.toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'light' });
  // 좁은 폭: 가로 넘침 없고 만들기 버튼·이름 입력·에디터·경고가 모두 닿는다
  await page.setViewportSize({ width: 480, height: 800 });
  await page.waitForTimeout(300);
  const narrow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(narrow.sw, '가로 스크롤').toBeLessThanOrEqual(narrow.cw);
  await expect(scr.locator('[data-create]')).toBeVisible();
  await expect(scr.locator('#draft-name')).toBeVisible();
  await scr.locator('.dscr-body').evaluate((e) => e.scrollTo(0, 1e6));
  await expect(scr.locator('[data-draft-warnings]')).toBeVisible({ timeout: 5000 });
  await expect(scr.locator('#draft-code')).toBeVisible();
  // Esc 로 돌아가기, 연 버튼으로 포커스 복귀
  await page.keyboard.press('Escape');
  await expect(scr).toHaveCount(0);
  await expect(opener()).toBeFocused();
});

/* ---------------------------------------------------------------- 편집 컬럼(최대 폭·좌우 여백) */

const COL_TEXT_MAX = 720; // 글 폭 상한(컬럼 800px − 안쪽 여백 40px×2)
const WIDE = SAMPLE_TXMD + '\n' + 'ㅇ'.repeat(120) + '\nhttps://example.com/' + 'a'.repeat(160) + '\n';

/** 에디터 모드: 스크롤 영역(.tx-host) 가장자리와 글 컬럼(최상위 블록·그 안 모든 요소)의 위치 */
async function editorGeometry() {
  return page.evaluate(() => {
    const host = document.querySelector('.tx-host') as HTMLElement;
    const pm = host.querySelector('.tx-pm') as HTMLElement;
    const hb = host.getBoundingClientRect();
    const areaL = hb.left;
    const areaR = hb.left + host.clientWidth; // 스크롤바 제외
    const blocks = [...pm.children].filter((c) => (c as HTMLElement).offsetParent !== null && c.getBoundingClientRect().width > 0) as HTMLElement[];
    const rects = blocks.map((b) => b.getBoundingClientRect());
    const textL = Math.min(...rects.map((r) => r.left));
    const textR = Math.max(...rects.map((r) => r.right));
    let deepR = -Infinity;
    let deepL = Infinity;
    for (const el of pm.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      deepR = Math.max(deepR, r.right);
      deepL = Math.min(deepL, r.left);
    }
    const bar = document.querySelector('.tx-bar') as HTMLElement;
    const first = document.querySelector('.tx-bar [data-tb]') as HTMLElement;
    const last = document.querySelector('.tx-bar .tx-src') as HTMLElement;
    return {
      areaL,
      areaR,
      textL,
      textR,
      deepL,
      deepR,
      sbw: host.offsetWidth - host.clientWidth,
      hostScrollW: host.scrollWidth,
      hostClientW: host.clientWidth,
      barFirstL: first.getBoundingClientRect().left,
      barLastR: last.getBoundingClientRect().right,
      barBoxL: bar.getBoundingClientRect().left,
      barBoxR: bar.getBoundingClientRect().right,
      barH: bar.getBoundingClientRect().height,
      docSW: document.documentElement.scrollWidth,
      docCW: document.documentElement.clientWidth,
    };
  });
}

for (const vw of [1440, 1100, 800, 480]) {
  test(`편집 컬럼(에디터·소스 보기) ${vw}px: 최대 폭 이하·가운데 정렬·좌우 여백 있음·가로 넘침 없음`, async () => {
    await page.setViewportSize({ width: vw, height: 900 });
    await openDraft();
    await (await toSource()).fill(WIDE);
    const pad = vw <= 600 ? 16 : 40;
    // ---- 소스 보기: textarea 의 padding 이 곧 글 컬럼 여백
    const src = await page.locator('#draft-ta').evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      const cs = getComputedStyle(t);
      const b = t.getBoundingClientRect();
      const sbw = t.offsetWidth - t.clientWidth;
      const textL = b.left + parseFloat(cs.paddingLeft);
      const textR = b.right - sbw - parseFloat(cs.paddingRight);
      return { areaL: b.left, areaR: b.right - sbw, textL, textR, sw: t.scrollWidth, cw: t.clientWidth, docSW: document.documentElement.scrollWidth, docCW: document.documentElement.clientWidth };
    });
    expect(src.textL - src.areaL, '소스 왼쪽 여백').toBeGreaterThanOrEqual(pad - 0.5);
    expect(src.areaR - src.textR, '소스 오른쪽 여백').toBeGreaterThanOrEqual(pad - 0.5);
    expect(src.textR - src.textL, '소스 글 폭').toBeLessThanOrEqual(COL_TEXT_MAX + 0.5);
    expect(Math.abs(src.textL - src.areaL - (src.areaR - src.textR)), '소스 좌우 대칭').toBeLessThanOrEqual(1);
    expect(src.sw, '소스 가로 스크롤').toBeLessThanOrEqual(src.cw);
    expect(src.docSW).toBeLessThanOrEqual(src.docCW);
    if (vw >= 1100) await shot(`col-${vw}-source`);

    // ---- 에디터
    await toEditor();
    await expect(page.locator('.tx-pm .tx-callout-info').first()).toBeVisible();
    await page.locator('.tx-pm').blur();
    const g = await editorGeometry();
    const left = g.textL - g.areaL;
    const right = g.areaR - g.textR;
    expect(left, `에디터 왼쪽 여백(${vw})`).toBeGreaterThanOrEqual(pad - 0.5);
    expect(right, `에디터 오른쪽 여백(${vw})`).toBeGreaterThanOrEqual(pad - 0.5);
    expect(g.textR - g.textL, '에디터 글 폭').toBeLessThanOrEqual(COL_TEXT_MAX + 0.5);
    expect(Math.abs(left - right), '에디터 좌우 대칭(가운데 정렬)').toBeLessThanOrEqual(1);
    expect(g.deepL, '안쪽 요소가 글 컬럼 왼쪽으로 나가지 않음').toBeGreaterThanOrEqual(g.textL - 1);
    expect(g.deepR, '표·버튼·콜아웃이 컬럼 밖으로 나가지 않음').toBeLessThanOrEqual(g.textR + 1);
    expect(g.hostScrollW, '에디터 가로 스크롤').toBeLessThanOrEqual(g.hostClientW);
    expect(g.docSW, '문서 가로 스크롤').toBeLessThanOrEqual(g.docCW);
    // 도구줄은 영역 전체 폭의 고정 바(컬럼에 묶이지 않는다)
    expect(g.barBoxL, '도구줄 왼쪽 = 영역 왼쪽').toBeCloseTo(g.areaL, 0);
    expect(g.barLastR, '도구줄 오른쪽 버튼이 바 안').toBeLessThanOrEqual(g.barBoxR);
    expect(g.barLastR, '도구줄 오른쪽 버튼이 오른쪽 끝에 붙는다').toBeGreaterThan(g.barBoxR - 40);
    if (vw === 1440) expect(g.barH, '넓은 화면에서 도구줄은 한 줄').toBeLessThan(48);
    if (vw === 1440) {
      // 넓은 화면: 글 폭이 상한에 닿고, 가운데 정렬로 컬럼 바깥 여백이 안쪽 여백보다 커진다
      expect(g.textR - g.textL, '글 폭이 상한에 닿는다').toBeGreaterThanOrEqual(COL_TEXT_MAX - 1);
      expect(left, '바깥 여백').toBeGreaterThan(pad + 50);
    }
    await shot(`col-${vw}-editor`);
  });
}

test('편집 컬럼: 문맥 막대 표시, 다크 스크린샷, 스크롤바는 영역 가장자리', async () => {
  await openDraft();
  await (await toSource()).fill(WIDE);
  await toEditor();
  await page.locator('.tx-pm .tx-callout-info .tx-callout-title').first().click();
  await expect(screen().getByRole('group', { name: '선택한 블록 설정' })).toBeVisible();
  const g = await editorGeometry();
  expect(g.barFirstL, '문맥 막대가 있어도 도구줄은 전체 폭 바').toBeLessThan(g.textL);
  await shot('col-1440-editor-ctx');
  // 스크롤바: 호스트 오른쪽 가장자리에 붙는다(컬럼 옆이 아니라)
  const host = await page.locator('.tx-host').boundingBox();
  expect(host!.x + host!.width, '스크롤 영역은 전체 폭').toBeGreaterThan(g.areaR);
  expect(g.areaR + g.sbw, '스크롤바 자리 = 영역 오른쪽 가장자리').toBeCloseTo(host!.x + host!.width, 0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.tx-pm').blur();
  await shot('col-1440-editor-dark');
  await toSource();
  await shot('col-1440-source-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});
