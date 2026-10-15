import { test, expect, chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { outDir } from './global-setup';
import { appDir } from './app-setup';
import { SAMPLE_TXMD } from '../../src/ui/state/sample';

/**
 * 초안 전체 화면(새 프로젝트 만들기)의 Milkdown 에디터(P5)를 실제 Edge 에서 검증한다(앱 번들 file://, 개발 서버 없음).
 * 직렬 시나리오: 같은 persistent context 를 공유한다. 산출물: OUT/draft-editor-report.json, OUT/shots-editor/*.png
 */
const OUT = outDir();
const SHOTS = join(OUT, 'shots-editor');
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;
const report: Record<string, unknown> = {};
const consoleErrors: string[] = [];

let ctx: BrowserContext;
let page: Page;
let userDir: string;

const shot = (name: string) => page.screenshot({ path: join(SHOTS, name + '.png') });
const pm = () => page.locator('.tx-pm');
const ta = () => page.locator('#draft-ta');
const dlg = () => page.getByRole('region', { name: /초안 화면/ });
const opener = () => page.locator('[data-draft-opener]');
const SRC_BTN = '소스 보기 (.txmd 직접 편집)';
/** 고른 요소(셀·버튼 라벨 등)의 글 전체를 선택한다(키보드 선택은 DOM→상태 동기화가 비동기라 결정적이지 않아 상태로 직접 선택) */
const selectContentOf = (loc: Locator) =>
  loc.evaluate((el) => {
    type V = { state: { doc: unknown; tr: { setSelection(s: unknown): unknown }; selection: { constructor: { create(d: unknown, a: number, b: number): unknown } } }; dispatch(tr: unknown): void; posAtDOM(n: Node, o: number): number; focus(): void };
    const v = (document.querySelector('.tx-pm') as HTMLElement & { __txView: V }).__txView;
    const from = v.posAtDOM(el, 0);
    const to = v.posAtDOM(el, el.childNodes.length);
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, from, to)));
    v.focus();
  });
/** ProseMirror 선택 길이(에디터가 DOM 선택을 따라잡을 때까지 폴링하려고 쓴다) */
const selLen = () => page.evaluate(() => { const s = (document.querySelector('.tx-pm') as HTMLElement & { __txView?: { state: { selection: { from: number; to: number } } } }).__txView!.state.selection; return s.to - s.from; });

async function openScreen() {
  await opener().click();
  await expect(dlg()).toBeVisible();
}

/** 에디터 → 소스로 바꿔 .txmd 를 읽고, 다시 에디터로 돌아온다(두 모드가 같은 내용을 공유하는지도 검증) */
async function readTxmd(): Promise<string> {
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(ta()).toBeVisible();
  const v = await ta().inputValue();
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(pm()).toBeVisible();
  await expect(pm()).toBeFocused();
  return v;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  userDir = mkdtempSync(join(tmpdir(), 'css-inliner-e2e-editor-'));
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  await page.goto(APP_URL);
  await page.locator('.appbar').waitFor();
  await page.frameLocator('iframe[title^="메일 미리보기"]').locator('table').first().waitFor({ timeout: 30_000 });
});

test.afterAll(async () => {
  writeFileSync(join(OUT, 'draft-editor-report.json'), JSON.stringify({ ...report, consoleErrors }, null, 2));
  console.log('EDITOR REPORT', JSON.stringify({ ...report, consoleErrors }));
  await ctx?.close();
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {
    /* 무시 */
  }
});

/** 빈 초안에 샘플 .txmd 를 소스 보기로 넣고 에디터로 돌아온다(새 프로젝트 흐름에서는 초안이 비어 시작한다) */
async function seedSample() {
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(ta()).toBeVisible();
  await ta().fill(SAMPLE_TXMD);
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(pm()).toBeVisible();
  await expect(pm()).toBeFocused();
}

test('1. 초안 화면을 열면 빈 초안이 에디터로 열리고 입력창에 포커스, 샘플 초안을 넣으면 블록이 로드, 툴바 접근성 이름', async () => {
  await openScreen();
  await expect(pm()).toBeVisible();
  await expect(pm()).toBeFocused();
  await expect(dlg().locator('[data-create]')).toBeDisabled();
  await seedSample();
  await expect(dlg().locator('[data-create]')).toBeEnabled();
  await expect(pm()).toHaveAttribute('aria-label', '초안 에디터');
  await expect(pm()).toHaveAttribute('role', 'textbox');
  // 샘플 초안의 블록들
  await expect(pm().locator('h1')).toContainText('배송이 시작되었습니다');
  await expect(pm().locator('.tx-callout-info')).toBeVisible();
  await expect(pm().locator('.tx-tablewrap.tx-dyn')).toContainText('동적 표 · stock');
  await expect(pm().locator('.tx-btn')).toContainText('배송 조회하기');
  await expect(pm().locator('.tx-ph').first()).toBeVisible();
  await expect(pm().locator('.tx-rv').first()).toContainText('{{sku}}');
  // 번역 줄은 접힌 회색 줄('번역 줄 N줄 (편집은 문자열 그리드에서)')
  const trans = pm().locator('.tx-trans summary').first();
  await expect(trans).toContainText('편집은 문자열 그리드에서');
  report.transLineNodes = await pm().locator('.tx-trans').count();
  // 툴바: 이름 있는 버튼
  const tb = dlg().getByRole('toolbar', { name: '초안 서식 도구' });
  await expect(tb).toBeVisible();
  const names = await tb.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent?.trim() || ''));
  report.toolbarButtons = names;
  expect(names.every((n) => n.length > 0)).toBe(true);
  for (const n of ['제목 1', '굵게', '기울임', '취소선', '링크', '글머리 목록', '번호 목록', '인용', '블록 삽입', '치환자 삽입', '실행 취소']) expect(names).toContain(n);
  await shot('01-editor-open-light');
});

test('2. 툴바 키보드: 탭 정지점은 하나, 방향키로 버튼 이동, 포커스 링', async () => {
  const tb = dlg().getByRole('toolbar', { name: '초안 서식 도구' });
  const stops = await tb.locator('[data-tb]').evaluateAll((els) => els.filter((e) => (e as HTMLButtonElement).tabIndex === 0).length);
  expect(stops).toBe(1);
  await dlg().getByRole('button', { name: '제목 1' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dlg().getByRole('button', { name: '제목 2' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(dlg().getByRole('button', { name: /소스 보기/ })).toBeFocused();
  // 포커스 링(outline)이 보인다
  const ow = await dlg().getByRole('button', { name: /소스 보기/ }).evaluate((e) => getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth);
  report.focusRing = ow;
  expect(ow).not.toMatch(/^none/);
  await pm().focus();
});

test('3. 한글·일본어 입력(insertText)과 CDP IME 조합: 유실 없이 들어간다', async () => {
  await pm().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('한글 입력 테스트 — こんにちは世界');
  await expect(pm().locator('p').last()).toHaveText('한글 입력 테스트 — こんにちは世界');
  // 실제 조합: Chromium DevTools 의 IME 이벤트(조합 중 → 확정)
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => {
    const w = window as unknown as { __imeEnd: number; __imeUpd: number };
    w.__imeEnd = 0;
    w.__imeUpd = 0;
    const el = document.querySelector('.tx-pm')!;
    el.addEventListener('compositionupdate', () => w.__imeUpd++, true);
    el.addEventListener('compositionend', () => w.__imeEnd++, true);
  });
  const imeEnded = (n: number) => page.waitForFunction((k) => (window as unknown as { __imeEnd: number }).__imeEnd >= k, n);
  await page.keyboard.press('Enter');
  const steps = ['ㅎ', '하', '한', '한ㄱ', '한그', '한글'];
  for (const t of steps) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
  // 조합 중에도 문서는 깨지지 않고, 확정하면 글자가 그대로 남는다
  await cdp.send('Input.insertText', { text: '한글' });
  await imeEnded(1);
  await page.keyboard.insertText(' 조합 확정 뒤 계속');
  const last = await pm().locator('p').last().innerText();
  report.imeResult = last;
  expect(last).toBe('한글 조합 확정 뒤 계속');
  // 일본어도 같은 방식
  await page.keyboard.press('Enter');
  for (const t of ['に', 'にほ', 'にほん', 'にほんご']) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
  await cdp.send('Input.insertText', { text: '日本語' });
  await imeEnded(2);
  await expect(pm().locator('p').last()).toHaveText('日本語');
  report.imeCompositionUpdates = await page.evaluate(() => (window as unknown as { __imeUpd: number }).__imeUpd);
  expect(report.imeCompositionUpdates).toBeGreaterThanOrEqual(10); // 조합 중 갱신이 실제로 들어갔다
  await cdp.detach();
  await shot('03-ime');
});

test('4. 치환자: 툴바 목록 검색 삽입, 직접 입력 |!#-x| 칩 변환, 칩은 한 번에 지워지는 토큰', async () => {
  await pm().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('안녕하세요, ');
  await dlg().getByRole('button', { name: '치환자 삽입' }).click();
  const search = dlg().getByRole('textbox', { name: '치환자 검색' });
  await expect(search).toBeFocused();
  await search.fill('cust');
  await dlg().getByRole('button', { name: /\|!#-cust_nm\|/ }).click();
  report.dbg4 = await page.evaluate(() => ({ text: (document.querySelector('.tx-pm') as HTMLElement).innerText.slice(-400), tail: [...document.querySelectorAll('.tx-pm > *')].slice(-3).map((e) => e.outerHTML.slice(0, 160)), phCount: document.querySelectorAll('.tx-pm .tx-ph').length, active: document.activeElement?.className }));
  await expect(pm().locator('p').last().locator('.tx-ph')).toHaveText('|!#-cust_nm|');
  await expect(pm()).toBeFocused();
  // 직접 입력 → 칩으로 바뀐다
  await page.keyboard.insertText('님, 주문 ');
  await page.keyboard.type('|!#-order_no|');
  await expect(pm().locator('p').last().locator('.tx-ph')).toHaveCount(2);
  // Backspace 한 번으로 칩 전체가 지워진다(글자 단위 편집 불가)
  await page.keyboard.press('Backspace');
  await expect(pm().locator('p').last().locator('.tx-ph')).toHaveCount(1);
  await page.keyboard.insertText('님.');
  await shot('04-placeholder');
});

test('4b. 마크다운식 입력 규칙: ~~취소선~~ **굵게** *기울임* · ## 제목 · - 목록 · 단일 ~ 는 일반 문자', async () => {
  await pm().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('~~gone~~ and **bold** and *it* ');
  const p = pm().locator('p').last();
  await expect(p.locator('del')).toHaveText('gone');
  await expect(p.locator('strong')).toHaveText('bold');
  await expect(p.locator('em')).toHaveText('it');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Mon~Fri ~ x');
  await expect(pm().locator('p').last().locator('del')).toHaveCount(0); // 단일 ~ 는 취소선이 아니다
  await page.keyboard.press('Enter');
  await page.keyboard.type('## ');
  await page.keyboard.type('Head');
  await expect(pm().locator('h2').last()).toHaveText('Head');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- ');
  await page.keyboard.type('item one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('item two');
  await expect(pm().locator('ul').last().locator('li')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // 빈 항목에서 Enter: 목록 끝
  const txt = await readTxmd();
  expect(txt).toContain('~~gone~~ and **bold** and *it*');
  expect(txt).toContain('Mon~Fri ~ x');
  expect(txt).toContain('## Head');
  expect(txt).toMatch(/- item one\n- item two/);
});

test('5. 서식·콜아웃·슬래시 메뉴·구분선 → 소스 보기의 .txmd', async () => {
  await pm().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('굵은 글씨');
  for (let i = 0; i < '굵은 글씨'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(selLen).toBe(5);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('ArrowRight'); // 선택 해제(끝으로)
  await expect.poll(selLen).toBe(0);
  await page.keyboard.press('Control+b'); // 이어 쓰는 글은 굵게 아님
  await page.keyboard.insertText(' 그리고 ');
  await dlg().getByRole('button', { name: '취소선' }).click();
  await page.keyboard.insertText('취소');
  await dlg().getByRole('button', { name: '취소선' }).click();
  await page.keyboard.press('Enter');
  // 콜아웃(경고) 삽입 → 제목 → Enter → 본문
  await dlg().getByRole('button', { name: '블록 삽입' }).click();
  await dlg().getByRole('menuitem', { name: /콜아웃: 경고/ }).click();
  await page.keyboard.insertText('점검 안내');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('점검 시간에는 이용할 수 없습니다.');
  await expect(pm().locator('.tx-callout-warn')).toBeVisible();
  await expect(dlg().getByRole('group', { name: '콜아웃 종류' }).getByRole('button', { name: '경고' })).toHaveAttribute('aria-pressed', 'true');
  // 종류 바꾸기
  await dlg().getByRole('group', { name: '콜아웃 종류' }).getByRole('button', { name: '강조' }).click();
  await expect(pm().locator('.tx-callout-accent')).toBeVisible();
  // 콜아웃 밖으로(빈 문단에서 Enter) → 슬래시 메뉴로 구분선
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/구분');
  const slash = dlg().getByRole('listbox', { name: /슬래시 메뉴/ });
  await expect(slash).toBeVisible();
  await expect(slash.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(slash).toHaveCount(0);
  await expect(pm().locator('hr').last()).toBeVisible();
  await page.keyboard.insertText('마지막 문단');
  await shot('05-callout-hr');
  const txt = await readTxmd();
  report.txmdAfterEdit = txt;
  expect(txt).toContain('**굵은 글씨** 그리고 ~~취소~~');
  expect(txt).toMatch(/\[강조: 점검 안내\]\n\n점검 시간에는 이용할 수 없습니다\.\n\[\/강조\]/);
  expect(txt).toMatch(/\[\/강조\]\n\n---\n\n마지막 문단/);
  // 원문(번역 줄 포함)은 그대로: 샘플의 번역 줄이 남아 있다
  expect(txt).toContain('@en Your shipment is on its way');
  expect(txt).toContain('@ja 発送を開始しました');
  expect(txt).toContain('[표: 가로형, 동적: stock]');
  expect(txt).toContain('@sample sku=WM-1001| name=Wireless Mouse| qty=12');
});

test('6. 동적 표·세로형 표·버튼 삽입과 표 편집(Tab·행 추가), 버튼 속성', async () => {
  await pm().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await dlg().getByRole('button', { name: '블록 삽입' }).click();
  await dlg().getByRole('menuitem', { name: /표: 동적/ }).click();
  const dyn = pm().locator('.tx-tablewrap.tx-dyn').last();
  await expect(dyn).toContainText('동적 표 · rows1');
  await expect(dlg().getByRole('group', { name: '표 편집' })).toContainText('동적 표');
  await expect(dlg().getByRole('button', { name: '행 추가' })).toBeDisabled(); // 동적 표는 행 템플릿 1행
  // 머리글 셀에 입력 후 Tab
  await dyn.locator('.tx-cell').first().click();
  await selectContentOf(dyn.locator('.tx-cell').first());
  await page.keyboard.insertText('품명');
  await page.keyboard.press('Tab');
  // 행 변수 삽입 버튼은 동적 표 안에서만 활성
  await expect(dlg().getByRole('button', { name: '행 변수 삽입' })).toBeEnabled();
  // 세로형 표
  await page.keyboard.press('Control+End');
  await dlg().getByRole('button', { name: '블록 삽입' }).click();
  await dlg().getByRole('menuitem', { name: /표: 세로형/ }).click();
  const v = pm().locator('.tx-tablewrap:not(.tx-dyn)').last();
  await v.locator('.tx-row').nth(1).locator('.tx-cell').first().click();
  await page.keyboard.insertText('택배사');
  await page.keyboard.press('Tab');
  await page.keyboard.type('|!#-carrier_nm|');
  await expect(dlg().getByRole('button', { name: '행 추가' })).toBeEnabled();
  await dlg().getByRole('button', { name: '행 추가' }).click();
  expect(await v.locator('.tx-row').count()).toBe(3);
  // 버튼
  await page.keyboard.press('Control+End');
  await dlg().getByRole('button', { name: '블록 삽입' }).click();
  await dlg().getByRole('menuitem', { name: /^버튼/ }).click();
  await selectContentOf(pm().locator('.tx-btn').last());
  await page.keyboard.insertText('추적하기');
  const url = dlg().getByRole('textbox', { name: '버튼 링크 URL' });
  await url.fill('https://t.example.com/|!#-tracking_no|');
  await url.press('Tab');
  await dlg().getByLabel('버튼 스타일').selectOption('primary');
  await shot('06-tables-button');
  const txt = await readTxmd();
  report.txmdTables = txt.slice(txt.indexOf('[표: 가로형, 동적: rows1]'));
  expect(txt).toMatch(/\[표: 가로형, 동적: rows1\]\n\{품명\| 수량\| 금액\}\n- \{\{name\}\}\| \{\{qty\}\}개\| \{\{amount\}\}원\n@var name 상품명/);
  expect(txt).toContain('@sample name=예시 상품| qty=1| amount=1,000');
  expect(txt).toMatch(/\[표: 세로형\]\n- 항목: 값\n- 택배사: \|!#-carrier_nm\|/);
  expect(txt).toContain('[버튼, 추적하기, https://t.example.com/|!#-tracking_no|, primary]');
});

test('7. 소스 보기 ⇄ 에디터가 같은 내용을 공유하고, 읽지 못하는 글은 원문 textarea 로 폴백', async () => {
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await ta().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n소스에서 추가한 문단\n@en Added in source');
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(pm()).toContainText('소스에서 추가한 문단');
  await expect(pm().locator('.tx-trans').last()).toContainText('번역 줄 1줄');
  // 에디터가 정규화할 수 없는 글(파서가 '[헤더]  ' 를 글자로 남기는 병적 입력) → 폴백 + 원문 보존
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  const patho = '[헤더]  \n# 엣지\n\n본문';
  await ta().fill(patho);
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(dlg().getByRole('alert').filter({ hasText: '에디터로 열지 못해' })).toBeVisible();
  await expect(ta()).toHaveValue(patho);
  report.fallbackNotice = await dlg().getByRole('alert').filter({ hasText: '에디터로 열지 못해' }).innerText();
  await shot('07-fallback');
});

test('8. 에디터에서 쓴 글로 [프로젝트 만들기] → 새 프로젝트로 전환(번역 줄 포함)', async () => {
  // 앞 테스트의 병적 입력이 버퍼에 남아 있으므로 소스에서 짧은 초안으로 되돌린다
  await ta().fill('# 배송이 시작되었습니다\n@en Your shipment is on its way\n@ja 発送を開始しました\n\n안녕하세요.\n');
  await dlg().getByRole('button', { name: SRC_BTN }).click();
  await expect(pm().locator('h1')).toContainText('배송이 시작되었습니다');
  await pm().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await dlg().getByRole('button', { name: '블록 삽입' }).click();
  await dlg().getByRole('menuitem', { name: /콜아웃: 정보/ }).click();
  await page.keyboard.insertText('새 안내');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('에디터에서 쓴 본문입니다.');
  // 이름 기본값은 초안 첫 제목, 점검 요약에는 블록 수·번역 줄이 보인다
  await expect(dlg().locator('#draft-name')).toHaveValue('배송이 시작되었습니다');
  await expect(dlg().locator('[data-draft-summary]')).toContainText('번역 줄 있음');
  await shot('08-create');
  await dlg().locator('[data-create]').click();
  await expect(dlg()).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('만들었습니다');
  await expect(page.locator('.proj-btn')).toHaveText('배송이 시작되었습니다');
  const prev = page.frameLocator('iframe[title^="메일 미리보기"]').locator('body');
  await expect.poll(() => prev.innerText(), { timeout: 20_000 }).toContain('에디터에서 쓴 본문입니다.');
  // 샘플 프로젝트는 그대로 목록에 남는다
  await page.locator('#ltab-projects').click();
  await expect(page.locator('.proj')).toHaveCount(2);
});

test('9. 다크 테마: 앱 토큰을 따른다', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openScreen();
  const toggle = dlg().getByRole('button', { name: SRC_BTN });
  if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click(); // 소스 보기 상태면 에디터로
  await expect(pm()).toBeVisible();
  const bg = await page.locator('.tx-host').evaluate((e) => getComputedStyle(e).backgroundColor);
  const fg = await pm().evaluate((e) => getComputedStyle(e).color);
  report.darkColors = { bg, fg };
  expect(bg).not.toBe('rgb(255, 255, 255)');
  await shot('09-dark');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
