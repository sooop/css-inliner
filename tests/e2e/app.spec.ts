import { test, expect, chromium, type BrowserContext, type Page, type FrameLocator } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { outDir } from './global-setup';
import { appDir } from './app-setup';
import { SAMPLE_TXMD } from '../../src/ui/state/sample';

/**
 * 앱 번들(file://) 전체를 실제 Edge 에서 검증한다. 하나의 persistent context(임시 userDataDir)를 공유하는 직렬 시나리오다.
 * 보고용 수치는 OUT/app-report.json, 스크린샷은 OUT/shots/ 에 남는다.
 */
const OUT = outDir();
const SHOTS = join(OUT, 'shots');
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;
const report: Record<string, unknown> = {};
const consoleErrors: string[] = [];

let ctx: BrowserContext;
let page: Page;
let userDir: string;

const preview = (): FrameLocator => page.frameLocator('iframe[title^="메일 미리보기"]');
const shot = (name: string) => page.screenshot({ path: join(SHOTS, name + '.png') });
const fresh = () => page.evaluate(() => (document.querySelector('.stage iframe') as HTMLIFrameElement | null)?.contentDocument?.body?.innerText ?? '');

async function launch(): Promise<void> {
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => consoleErrors.push(`[requestfailed] ${r.url().slice(0, 120)}`));
}

async function openApp(): Promise<number> {
  const t0 = Date.now();
  await page.goto(APP_URL);
  await page.locator('.appbar').waitFor();
  await preview().locator('table').first().waitFor({ timeout: 30_000 });
  return Date.now() - t0;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  userDir = mkdtempSync(join(tmpdir(), 'css-inliner-e2e-profile-'));
  await launch();
});
test.afterAll(async () => {
  writeFileSync(join(OUT, 'app-report.json'), JSON.stringify({ ...report, consoleErrors }, null, 2));
  console.log('APP REPORT', JSON.stringify({ ...report, consoleErrors }));
  await ctx?.close();
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {
    /* 무시 */
  }
});

test('1. 첫 로드: 샘플 생성·콘솔 오류 0·첫 미리보기 시간·외부 @import 없음', async () => {
  const ms = await openApp();
  report.firstPreviewMs = ms;
  await expect(page.locator('.proj-btn')).toContainText('배송 시작 안내');
  // 번들·샘플·템플릿에 외부 폰트 @import 가 남았는지
  const html = readFileSync(join(appDir(), 'index.html'), 'utf8');
  const css = readFileSync('src/styles/template.css', 'utf8');
  report.templateCssHasImport = /@import|@font-face|fonts\.googleapis/i.test(css);
  report.bundleHasFontsGoogleapis = /fonts\.googleapis|fonts\.gstatic/i.test(html);
  report.bundleExternalUrls = Array.from(new Set(html.match(/https?:\/\/[^"'\s)<>]+/g) ?? [])).filter((u) => !/json-schema|svelte\.dev|ajv|tinyurl|tracxlogis|example\.com|raw\.githubusercontent/.test(u));
  expect(report.templateCssHasImport).toBe(false);
  expect(report.bundleHasFontsGoogleapis).toBe(false);
  // 인라인 경고 배너
  const warn = page.locator('.banner.ban-warn summary');
  report.inlineWarningBanner = (await warn.count()) ? await warn.first().innerText() : '없음';
  await shot('01-first-load-light');
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

/* ------------------------------------------------------------------ 보조 */

const bodyText = () => preview().locator('body').innerText();
const waitText = (re: RegExp, timeout = 20_000) => expect.poll(bodyText, { timeout }).toMatch(re);
const toast = () => page.locator('.toast');
async function acc(key: string, open = true) {
  const b = page.locator(`#acch-${key}`);
  if (((await b.getAttribute('aria-expanded')) === 'true') !== open) await b.click();
}
const tab = (k: 'blocks' | 'strings' | 'snippets' | 'projects') => page.locator(`#ltab-${k}`).click();
const gridCount = async () => Number(/\((\d+)\)/.exec(await page.locator('h3.rh', { hasText: '문자열 그리드' }).innerText())![1]);
const blockCount = async () => Number(/\((\d+)\)/.exec(await page.locator('h3.rh', { hasText: '블록 구조' }).innerText())![1]);
const blockIds = () => page.locator('.list .item .idc').allInnerTexts();
const statBytes = (p: string): number => readFileSync(p).length;

/** 미리보기 iframe 안에서 표식의 위치(표 밖으로 튀었는지) */
const markerInfo = (marker: string) =>
  page.evaluate((m) => {
    const d = (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!;
    const w = d.createTreeWalker(d.body, 4);
    const hits: { inTbody: boolean; tableHasSku: boolean; inTable: boolean }[] = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!(n as Text).data.includes(m)) continue;
      const el = (n as Text).parentElement!;
      const tbody = el.closest('tbody');
      const table = el.closest('table');
      hits.push({ inTbody: !!tbody, inTable: !!table, tableHasSku: !!table && /SKU/.test(table.textContent ?? '') });
    }
    return { count: hits.length, hits };
  }, marker);

/* ------------------------------------------------------------------ 4(초안) — 깨끗한 샘플 상태에서 먼저 */

test('4. + 초안(전체 화면): 포커스 가둠·Esc·복귀·글 유지 → 이름·만들기 → 새 프로젝트로 전환(기존 프로젝트 불변)', async () => {
  const opener = page.locator('[data-draft-opener]');
  const create = page.locator('[data-create]');
  await opener.click();
  const dlg = page.getByRole('region', { name: /초안 화면/ });
  await expect(dlg).toBeVisible();
  await expect(page.locator('.tx-pm')).toBeFocused(); // 기본은 Milkdown 에디터(P5). 아래 시나리오는 소스 보기(.txmd 직접 편집)에서 진행한다
  await expect(create, '빈 초안은 만들 수 없다').toBeDisabled();
  await page.getByRole('button', { name: '소스 보기 (.txmd 직접 편집)' }).click();
  await expect(page.locator('#draft-ta')).toBeFocused();
  expect(await page.locator('.app-root').getAttribute('inert')).not.toBeNull();
  await shot('04a-draft-screen-empty');
  // 포커스 가둠: Tab/Shift+Tab 을 여러 번 눌러도 초안 화면 밖(inert 셸)으로 나가지 않는다
  const inDlg = () => page.evaluate(() => !!document.activeElement?.closest('.dscr') || document.activeElement === document.body);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await inDlg(), `Tab ${i}`).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inDlg(), `Shift+Tab ${i}`).toBe(true);
  }
  // 글 유지: 입력 → Esc → 포커스 복귀 → 다시 열면 그대로(만들기 전에는 비우지 않는다)
  await page.locator('#draft-ta').fill('# 임시 제목\n\nZZTEMP');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(page.locator('#draft-ta')).toHaveValue(/ZZTEMP$/);
  // 이름 기본값 = 초안 첫 제목
  await expect(page.locator('#draft-name')).toHaveValue('임시 제목');

  // 초안: 샘플 초안에서 인사말 변경(번역 줄은 유지), 새 문단 추가(번역 줄 포함), 푸터 삭제, 콜아웃 안 동적 표(파서 경고)
  let txt = SAMPLE_TXMD;
  txt = txt.replace('안녕하세요, |!#-cust_nm|님.', '반갑습니다, |!#-cust_nm|님.');
  txt = txt.replace(/본 메일은 발신 전용입니다[^\n]*\n@en[^\n]*\n@ja[^\n]*\n?/, '');
  txt = txt.replace('\n[표: 세로형]', '\n새로 추가한 안내 문단입니다.\n@en This is a newly added notice.\n@ja 新しく追加したお知らせです。\n\n[표: 세로형]');
  txt += '\n[정보: 경고 확인]\n제목\n\n[표: 가로형, 동적: inner]\n{a| b}\n- {{a}}| {{b}}\n[/표]\n[/정보]\n';
  expect(txt).toContain('새로 추가한 안내 문단입니다.');
  await page.locator('#draft-ta').fill(txt);
  await expect(page.locator('#draft-name')).toHaveValue('배송이 시작되었습니다');
  await page.locator('#draft-name').fill('초안으로 만든 프로젝트');
  await page.locator('#draft-code').fill('DRAFT_E2E');
  await expect(page.locator('[data-draft-warnings]'), '파서 경고는 목록으로 보여 준다').toBeVisible({ timeout: 5000 });
  report.draftWarnings = await page.locator('[data-draft-warnings]').innerText();
  await expect(create, '경고는 만들기를 막지 않는다').toBeEnabled();
  await shot('04b-draft-screen-filled');
  await create.click();
  await expect(dlg).toHaveCount(0);
  await expect(toast()).toContainText('초안으로 만든 프로젝트');
  // 새 프로젝트로 전환
  await expect(page.locator('.proj-btn')).toHaveText('초안으로 만든 프로젝트');
  await expect(page.locator('.appbar .idc')).toHaveText('DRAFT_E2E');
  await waitText(/반갑습니다/);
  let t = await bodyText();
  expect(t).toContain('새로 추가한 안내 문단');
  expect(t).not.toContain('본 메일은 발신 전용');
  // @en/@ja 번역 줄이 초기 번역: 오래됨·미번역 없이 들어 있다
  await preview().locator('[data-t]', { hasText: '반갑습니다' }).first().click();
  await expect(page.locator('#ta-en')).toHaveValue(/^Hello, /);
  await expect(page.locator('#ta-ja')).toHaveValue(/様/);
  await expect(page.locator('label[for="ta-en"] .badge', { hasText: '오래됨' })).toHaveCount(0);
  await expect(page.locator('label[for="ta-ja"] .badge', { hasText: '오래됨' })).toHaveCount(0);
  await page.locator('.center .seg button', { hasText: /^en$/ }).click();
  await waitText(/This is a newly added notice\./);
  await page.locator('.center .seg button', { hasText: /^ko$/ }).click();
  // 목록에 2개, 기존 프로젝트는 그대로
  await tab('projects');
  await expect(page.locator('.proj')).toHaveCount(2);
  await page.locator('.proj .open', { hasText: '배송 시작 안내 (샘플)' }).click();
  await expect(page.locator('.proj-btn')).toContainText('배송 시작 안내');
  await waitText(/안녕하세요/);
  t = await bodyText();
  expect(t).not.toContain('반갑습니다');
  expect(t).not.toContain('새로 추가한 안내 문단');
  expect(t).toContain('본 메일은 발신 전용');
  await expect(page.locator('.appbar .idc')).toHaveText('SHIP_START');
  // 만들기에 성공했으니 작성 중이던 초안은 비워졌다
  await opener.click();
  // 에디터 모드는 마지막 선택(소스)이 유지된다 — 소스가 아니면 소스로
  if (!(await page.locator('#draft-ta').isVisible())) await page.getByRole('button', { name: '소스 보기 (.txmd 직접 편집)' }).click();
  await expect(page.locator('#draft-ta')).toHaveValue('');
  await expect(page.locator('#draft-name')).toHaveValue('');
  await expect(page.locator('#draft-code')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  // 마지막 초안은 새 프로젝트의 draftMarkup(참고용)에 남아 있다 — IndexedDB 에서 직접 확인
  const saved = await page.evaluate(
    () =>
      new Promise<{ name: string; draftMarkup?: string }[]>((resolve, reject) => {
        const r = indexedDB.open('TxMailStudio');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const g = r.result.transaction('projects').objectStore('projects').getAll();
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
      }),
  );
  const made = saved.find((p) => p.name === '초안으로 만든 프로젝트');
  expect(made?.draftMarkup).toContain('반갑습니다');
  expect(saved.find((p) => p.name.startsWith('배송 시작 안내'))?.draftMarkup ?? '').not.toContain('반갑습니다');
  // 이후 시나리오는 샘플 프로젝트 하나만 있는 상태를 전제로 하므로 만든 프로젝트를 지운다(2단계 확인)
  await page.locator('.proj', { hasText: '초안으로 만든 프로젝트' }).getByRole('button', { name: '삭제' }).click();
  await page.getByRole('button', { name: '정말 삭제?' }).click();
  await expect(page.locator('.proj')).toHaveCount(1);
  await tab('blocks');
});

/* ------------------------------------------------------------------ 2 */

test('2. 미리보기 클릭 편집(data-t 생존)·언어 전환·샘플값·표식 토글', async () => {
  const dataT = await page.evaluate(() => {
    const d = (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!;
    return d.querySelectorAll('[data-t]').length;
  });
  report.previewDataTCount = dataT;
  expect(dataT).toBeGreaterThan(10);
  await preview().locator('[data-t]', { hasText: '배송이 시작되었습니다' }).first().click();
  await expect(page.locator('#ta-ko')).toHaveValue('배송이 시작되었습니다');
  await expect(page.locator('#ta-en')).toHaveValue('Your shipment is on its way');
  await expect(page.locator('#ta-ja')).toHaveValue('発送を開始しました');
  await shot('02a-click-edit');
  // 편집 → 미리보기 반영
  const tEdit = Date.now();
  await page.locator('#ta-ko').fill('배송이 출발했습니다');
  await waitText(/배송이 출발했습니다/);
  report.editToPreviewMs = Date.now() - tEdit;
  // 언어 전환
  await page.locator('.center .seg button', { hasText: /^en$/ }).click();
  await waitText(/Your shipment is on its way/);
  await expect(page.locator('.stage iframe')).toHaveAttribute('title', /\(en\)/);
  await shot('02b-lang-en');
  await page.locator('.center .seg button', { hasText: /^ja$/ }).click();
  await waitText(/発送を開始しました/);
  await page.locator('.center .seg button', { hasText: /^ko$/ }).click();
  await waitText(/배송이 출발했습니다/);
  // 치환자 샘플값 토글
  const sample = page.locator('label.chk', { hasText: '치환자 샘플값' }).locator('input');
  await waitText(/홍길동/);
  await sample.uncheck();
  await waitText(/\|!#-cust_nm\|/);
  await sample.check();
  await waitText(/홍길동/);
  // 동적 표: 예시 행 <-> 발송용 표식
  const mk = page.locator('label.chk', { hasText: '발송용 표식' }).locator('input');
  await waitText(/WM-1001/);
  await mk.check();
  await waitText(/\|!#-rows_stock\|/);
  const info = await markerInfo('|!#-rows_stock|');
  report.markerPreview = info;
  expect(info.count).toBe(1);
  expect(info.hits[0]).toEqual({ inTbody: true, inTable: true, tableHasSku: true });
  expect(await bodyText()).not.toMatch(/WM-1001/);
  await shot('02c-markers');
  await mk.uncheck();
  await waitText(/WM-1001/);
  expect((await bodyText()).includes('|!#-rows_stock|')).toBe(false);
});

/* ------------------------------------------------------------------ 5a 내보내기(깨끗한 상태) */

test('5a. 내보내기: 번들 다운로드 검증·handoff MD·클립보드·번들 불러오기·크기 수치(8)', async () => {
  await acc('export', true);
  await acc('handoff', true);
  await expect(page.locator('.banner.ban-ok', { hasText: '오류가 없습니다' })).toBeVisible();
  const saveBtn = page.getByRole('button', { name: '번들 저장(.json)' });
  await expect(saveBtn).toBeEnabled();
  const dir = mkdtempSync(join(tmpdir(), 'css-inliner-dl-'));
  const tSave = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 40_000 }), saveBtn.click()]);
  report.bundleSaveMs = Date.now() - tSave;
  const bundlePath = join(dir, dl.suggestedFilename());
  await dl.saveAs(bundlePath);
  report.bundleFile = dl.suggestedFilename();
  const text = readFileSync(bundlePath, 'utf8');
  const b = JSON.parse(text);
  // 하네스 페이지에서 verifyBundle
  const hp = await ctx.newPage();
  await hp.goto(pathToFileURL(join(OUT, 'harness.html')).href);
  await hp.waitForFunction(() => !!(window as any).__e2e);
  const v = await hp.evaluate((j) => (window as any).__e2e.verifyBundle(j), b);
  await hp.close();
  expect(v).toEqual({ ok: true, errors: [] });
  const sizes: Record<string, number> = {};
  for (const lang of ['ko', 'en', 'ja']) {
    const h: string = b.locales[lang].html;
    expect(h, lang).not.toMatch(/\sdata-(?:t|rows)\s*=/);
    expect(h.split('|!#-rows_stock|').length - 1, lang).toBe(1);
    expect(h, lang).toMatch(/<tbody[^>]*>\s*\|!#-rows_stock\|\s*<\/tbody>/);
    expect(h, lang).not.toMatch(/<\/?(html|head|body)\b/i);
    expect(h, lang).toContain('data:image/png;base64,');
    expect(h, lang).not.toMatch(/fonts\.googleapis|@import/);
    expect(b.locales[lang].subject, lang).toBeTruthy();
    sizes[lang] = Buffer.byteLength(h);
  }
  expect(b.source).toBeTruthy();
  for (const lang of ['ko', 'en', 'ja']) expect(b.dynamicTables[0].rowTemplates[lang]).not.toMatch(/data-t=/);
  report.bundle = {
    bytes: Buffer.byteLength(text),
    localeHtmlBytes: sizes,
    rowTemplateBytes: Object.fromEntries(['ko', 'en', 'ja'].map((l) => [l, Buffer.byteLength(b.dynamicTables[0].rowTemplates[l])])),
    checksum: b.checksum,
  };
  // 앱이 보여주는 크기·최대 행 수
  await acc('check', true);
  report.exportPanelText = (await page.locator('#acc-export').innerText()).replace(/\s+/g, ' ');
  report.handoffPanelText = (await page.locator('#acc-handoff').innerText()).replace(/\s+/g, ' ').slice(0, 1500);
  const rowsTable = await page.locator('#acc-handoff table.g tbody tr').allInnerTexts();
  report.maxRowsTable = rowsTable.map((r) => r.replace(/\s+/g, ' '));
  report.checkIssues = (await page.locator('#acc-check .chk-i').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
  await shot('05a-export-panel');
  // handoff MD 다운로드
  const [md] = await Promise.all([page.waitForEvent('download', { timeout: 40_000 }), page.getByRole('button', { name: 'handoff MD 저장' }).click()]);
  const mdPath = join(dir, md.suggestedFilename());
  await md.saveAs(mdPath);
  const mdText = readFileSync(mdPath, 'utf8');
  report.handoffMd = { file: md.suggestedFilename(), bytes: Buffer.byteLength(mdText) };
  expect(mdText).toContain('|!#-rows_stock|');
  expect(mdText).toContain('{{sku}}');
  expect(mdText).toMatch(/최대 행 수/);
  writeFileSync(join(OUT, 'handoff-sample.md'), mdText);
  writeFileSync(join(OUT, 'bundle-sample.json'), text);
  // 클립보드(번들 / MD)
  await page.getByRole('button', { name: '클립보드 복사' }).click();
  await expect(toast()).toContainText(/클립보드에 복사|복사가 막혔/);
  report.clipboardToast = await toast().innerText();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clip).locales.ko.html).toBe(b.locales.ko.html);
  await page.getByRole('button', { name: 'MD 복사' }).click();
  await expect(toast()).toContainText(/MD 를 복사|복사가 막혔/);
  const clipMd = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipMd).toContain('|!#-rows_stock|');
  // 번들 불러오기 -> 새 프로젝트로 복원
  await tab('projects');
  await page.locator('input[type=file]').setInputFiles(bundlePath);
  await expect(toast()).toContainText(/복원/);
  await expect(page.locator('.proj-btn')).toContainText('(가져옴)');
  await waitText(/배송이 출발했습니다/);
  await waitText(/WM-1001/);
  await expect(page.locator('.proj')).toHaveCount(2);
  report.importedOk = true;
  // 잘못된 파일: 오류 토스트
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...b, checksum: 'sha256:00' }));
  await page.locator('input[type=file]').setInputFiles(bad);
  await expect(toast()).toContainText(/번들 검증 실패/);
  await expect(page.locator('.proj')).toHaveCount(2);
  await tab('blocks');
});

/* ------------------------------------------------------------------ 3 구조 조작 */

test('3. 구조 조작(블록 추가·이동·삭제, 표 행)·오래됨 배지·문자열 그리드 필터', async () => {
  await tab('blocks');
  const n0 = await blockCount();
  const ids0 = await blockIds();
  // 블록 추가(선택한 블록 바로 아래)
  await page.locator('.list .item', { hasText: '문단' }).first().click();
  await page.getByRole('button', { name: '+ 블록 추가' }).click();
  await expect.poll(blockCount).toBe(n0 + 1);
  const ids1 = await blockIds();
  const newId = ids1.find((x) => !ids0.includes(x))!;
  expect(newId).toBeTruthy();
  report.addedBlockId = newId;
  // 이동
  const pos = ids1.indexOf(newId);
  await page.getByRole('button', { name: '위로' }).click();
  await expect.poll(async () => (await blockIds()).indexOf(newId)).toBe(pos - 1);
  await page.getByRole('button', { name: '아래로' }).click();
  await expect.poll(async () => (await blockIds()).indexOf(newId)).toBe(pos);
  // 표 행 추가(세로형 표)
  await tab('strings');
  const g0 = await gridCount();
  await tab('blocks');
  await page.locator('.list .item', { hasText: '세로형 표' }).click();
  await page.getByRole('button', { name: '+ 표 행' }).click();
  await tab('strings');
  const g1 = await gridCount();
  report.gridRows = { before: g0, afterRowAdd: g1 };
  expect(g1).toBeGreaterThan(g0);
  report.previewMissMarks = await page.evaluate(() => (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!.querySelectorAll('[data-miss]').length);
  // ko 수정 -> en/ja 오래됨
  await preview().locator('[data-t]', { hasText: '안녕하세요' }).first().click();
  await page.locator('#ta-ko').fill('수정한 인사말 |!#-cust_nm|님');
  await expect(page.locator('label[for="ta-en"] .badge', { hasText: '오래됨' })).toBeVisible();
  await page.locator('label[for="ta-en"]').locator('xpath=..').getByRole('button', { name: '최신 확인' }).click();
  await expect(page.locator('label[for="ta-en"] .badge', { hasText: '오래됨' })).toHaveCount(0);
  await expect(page.locator('label[for="ta-ja"] .badge', { hasText: '오래됨' })).toBeVisible();
  // 문자열 그리드 '문제만'
  await tab('strings');
  const all = await gridCount();
  await page.locator('.seg button', { hasText: '문제만' }).click();
  const prob = await gridCount();
  report.gridProblems = { all, problemsOnly: prob };
  expect(prob).toBeGreaterThan(0);
  expect(prob).toBeLessThan(all);
  await shot('03a-grid-problems');
  await page.locator('.seg button', { hasText: /^전체$/ }).click();
  await expect.poll(gridCount).toBe(all);
  // 삭제(2단계 확인)
  await tab('blocks');
  await page.locator('.list .item', { hasText: newId }).click();
  const n1 = await blockCount();
  await page.getByRole('button', { name: '블록 삭제' }).click();
  await expect(page.getByRole('button', { name: '정말 삭제?' })).toBeVisible();
  expect(await blockCount()).toBe(n1);
  await page.getByRole('button', { name: '정말 삭제?' }).click();
  await expect.poll(blockCount).toBe(n1 - 1);
});

/* ------------------------------------------------------------------ 5b 오류 시 차단 / 강제 */

test('5b. 오류 시 내보내기 비활성 -> 강제 체크 후 활성(+ 번들 검증)', async () => {
  await acc('export', true);
  await acc('check', true);
  const err = Number(/오류 (\d+)/.exec(await page.locator('.acch', { hasText: '검사' }).innerText())![1]);
  report.errorsAfterOps = err;
  expect(err).toBeGreaterThan(0);
  const save = page.getByRole('button', { name: '번들 저장(.json)' });
  const copy = page.getByRole('button', { name: '클립보드 복사' });
  await expect(save).toBeDisabled();
  await expect(copy).toBeDisabled();
  await expect(page.locator('.acch', { hasText: '내보내기' })).toContainText('차단됨');
  await shot('05b-export-blocked');
  await page.getByLabel('오류를 확인했고 강제로 내보냅니다').check();
  await expect(save).toBeEnabled();
  await expect(page.locator('.acch', { hasText: '내보내기' })).toContainText('가능');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 40_000 }), save.click()]);
  const p = join(mkdtempSync(join(tmpdir(), 'css-inliner-dl-')), dl.suggestedFilename());
  await dl.saveAs(p);
  const b = JSON.parse(readFileSync(p, 'utf8'));
  expect(b.schema).toBe('tx-mail-bundle');
  report.forcedBundleBytes = statBytes(p);
});

/* ------------------------------------------------------------------ 2b 모든 data-t 요소의 클릭 연결 */

test('2b. 미리보기의 모든 data-t 요소(표 셀·버튼·콜아웃 등)가 클릭으로 선택되고 속성 패널에 열린다', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('label.chk', { hasText: '발송용 표식' }).locator('input').uncheck();
  const ids: string[] = await page.evaluate(() => {
    const d = (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!;
    return Array.from(new Set(Array.from(d.querySelectorAll('[data-t]')).map((e) => e.getAttribute('data-t')!)));
  });
  expect(ids.length).toBeGreaterThan(10);
  const bad: string[] = [];
  for (const id of ids) {
    await page.evaluate((i) => {
      const d = (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!;
      (Array.from(d.querySelectorAll('[data-t]')).find((e) => e.getAttribute('data-t') === i) as HTMLElement).click();
    }, id);
    const shown = await page.locator('#acch-edit .idc').innerText().catch(() => '');
    const ko = await page.locator('#ta-ko').count();
    const en = await page.locator('#ta-en').count();
    const ja = await page.locator('#ta-ja').count();
    if (shown !== id || !ko || !en || !ja) bad.push(`${id}: badge=${shown} ko/en/ja=${ko}/${en}/${ja}`);
  }
  report.clickableIds = ids.length;
  report.clickFailures = bad;
  expect(bad).toEqual([]);
  // 실제 마우스 클릭(좌표 변환 포함)으로도: 표 셀·버튼
  await preview().locator('[data-t]', { hasText: '배송 조회하기' }).first().click();
  await expect(page.locator('#acch-edit .idc')).not.toHaveText('');
  await expect(page.locator('#btn-href')).toBeVisible();
});

/* ------------------------------------------------------------------ 6 IndexedDB 영속 */

test('6. 새로고침·브라우저 재시작 후 IndexedDB 영속(편집 내용·프로젝트 목록·아코디언·테마)', async () => {
  // 편집 -> '저장 대기…' -> '자동 저장됨'
  await preview().locator('[data-t]', { hasText: '배송이 출발했습니다' }).first().click();
  await page.locator('#ta-ko').fill('영속 확인 제목');
  await expect(page.locator('.appbar .badge', { hasText: /저장 (대기|중)/ })).toBeVisible();
  await expect(page.locator('.appbar .badge', { hasText: '자동 저장됨' })).toBeVisible({ timeout: 5000 });
  // 아코디언·테마 상태 변경
  await acc('vars', true);
  await acc('check', false);
  await page.locator('.appbar .seg button', { hasText: '다크' }).click();
  const names = await page.locator('.proj-btn').innerText();
  // (1) 새로고침
  await page.reload();
  await page.locator('.appbar').waitFor();
  await preview().locator('table').first().waitFor({ timeout: 30_000 });
  await waitText(/영속 확인 제목/);
  await expect(page.locator('.proj-btn')).toHaveText(names);
  await expect(page.locator('#acch-vars')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#acch-check')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await tab('projects');
  await expect(page.locator('.proj')).toHaveCount(2);
  await tab('blocks');
  // (2) 브라우저 종료 후 같은 userDataDir 로 재시작(디스크 영속)
  await ctx.close();
  await launch();
  await page.goto(APP_URL);
  await page.locator('.appbar').waitFor();
  await preview().locator('table').first().waitFor({ timeout: 30_000 });
  await waitText(/영속 확인 제목/);
  await tab('projects');
  await expect(page.locator('.proj')).toHaveCount(2);
  await expect(page.locator('.proj-btn')).toHaveText(names);
  await tab('blocks');
  report.persistence = 'reload ok, browser-restart ok';
  // 라이트로 복귀
  await page.locator('.appbar .seg button', { hasText: '라이트' }).click();
  await acc('check', true);
  await acc('vars', false);
});

/* ------------------------------------------------------------------ 7 레이아웃 */

test('7a. 데스크톱 1440x900: 3열 독립 스크롤·툴바 불투명·아코디언', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 문자열 그리드를 길게: 블록을 넉넉히 추가
  await tab('blocks');
  await page.locator('.list .item', { hasText: '문단' }).first().click();
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: '+ 블록 추가' }).click();
  await waitText(/./);
  await tab('strings');
  const rows = await gridCount();
  report.longGridRows = rows;
  expect(rows).toBeGreaterThan(40);
  // 길어진 미리보기가 갱신될 때까지
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('.stage iframe') as HTMLIFrameElement).contentDocument!.querySelectorAll('[data-t]').length), { timeout: 20_000 })
    .toBeGreaterThan(50);
  await page.waitForTimeout(500);
  const m = () =>
    page.evaluate(() => {
      const st = document.querySelector('.stage') as HTMLElement;
      const left = document.querySelector('#lpanel') as HTMLElement;
      const right = document.querySelector('.pane:last-of-type .scr') as HTMLElement;
      const fr = document.querySelector('.stage iframe') as HTMLElement;
      const bar = document.querySelector('.appbar') as HTMLElement;
      return {
        win: [window.scrollX, window.scrollY],
        doc: [document.documentElement.scrollHeight, window.innerHeight],
        left: [left.scrollTop, left.scrollHeight, left.clientHeight],
        stage: [st.scrollTop, st.scrollHeight, st.clientHeight],
        right: [right.scrollTop, right.scrollHeight, right.clientHeight],
        frameTop: fr.getBoundingClientRect().top,
        barTop: bar.getBoundingClientRect().top,
        barBottom: bar.getBoundingClientRect().bottom,
      };
    });
  const m0 = await m();
  report.scrollBefore = m0;
  report.pageScrollableExtra = m0.doc[0] - m0.doc[1]; // 0 이어야 정상(페이지 자체는 스크롤되지 않음) — 엄격 검증은 7e 프로브
  expect(m0.left[1]).toBeGreaterThan(m0.left[2]);
  expect(m0.stage[1]).toBeGreaterThan(m0.stage[2]);
  // 좌측 스크롤 -> 다른 열 불변
  await page.locator('#lpanel').evaluate((e) => e.scrollTo(0, 100000));
  const m1 = await m();
  expect(m1.left[0]).toBeGreaterThan(0);
  expect(m1.stage[0]).toBe(m0.stage[0]);
  expect(m1.frameTop).toBe(m0.frameTop);
  expect(m1.right[0]).toBe(m0.right[0]);
  expect(m1.win).toEqual([0, 0]);
  expect(m1.barTop).toBe(0);
  await shot('07a-desktop-light-left-scrolled');
  // 중앙 스크롤 -> 좌/우 불변
  await page.locator('.stage').evaluate((e) => e.scrollTo(0, 400));
  const m2 = await m();
  expect(m2.stage[0]).toBeGreaterThan(0);
  expect(m2.left[0]).toBe(m1.left[0]);
  expect(m2.right[0]).toBe(m1.right[0]);
  expect(m2.barTop).toBe(0);
  // 상단 툴바: 완전 불투명(알파 1)·backdrop-filter 없음·미리보기가 비치지 않음
  const bar = await page.locator('.appbar').evaluate((e) => {
    const cs = getComputedStyle(e);
    return { bg: cs.backgroundColor, backdrop: cs.backdropFilter, opacity: cs.opacity, pos: cs.position, z: cs.zIndex };
  });
  report.appbarStyle = bar;
  expect(bar.bg).not.toMatch(/rgba\(.*,\s*0?\.\d+\)|transparent/);
  expect(bar.backdrop === 'none' || bar.backdrop === '').toBe(true);
  expect(bar.opacity).toBe('1');
  await shot('07a-desktop-light-center-scrolled');
  // 우측 스크롤
  await acc('handoff', true);
  await page.locator('.pane:last-of-type .scr').evaluate((e) => e.scrollTo(0, 100000));
  const m3 = await m();
  expect(m3.right[0]).toBeGreaterThan(0);
  expect(m3.left[0]).toBe(m1.left[0]);
  expect(m3.stage[0]).toBe(m2.stage[0]);
  await shot('07a-desktop-light-right-scrolled');
  report.scrollAfter = m3;
  // 아코디언 접기/펼치기 상태 저장은 6 에서 검증. 여기서는 키보드 토글
  const btn = page.locator('#acch-dyn');
  await btn.focus();
  const was = await btn.getAttribute('aria-expanded');
  await page.keyboard.press('Enter');
  expect(await btn.getAttribute('aria-expanded')).not.toBe(was);
  await page.keyboard.press('Enter');
  // 넓게
  await page.locator('#lpanel').evaluate((e) => e.scrollTo(0, 0));
  await page.locator('label.chk', { hasText: '넓게' }).locator('input').check();
  await page.waitForTimeout(300);
  await shot('07a-desktop-light-strings-wide');
  await page.locator('label.chk', { hasText: '넓게' }).locator('input').uncheck();
});

test('7c. 다크 테마·좁은 폭·중간 폭 스크린샷 + 가로 넘침 없음', async () => {
  await page.locator('.appbar .seg button', { hasText: '다크' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await shot('07b-desktop-dark');
  const dark = await page.evaluate(() => {
    const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
    return { appbar: cs('.appbar').backgroundColor, pane: cs('.pane').backgroundColor, text: cs('.pane').color, theme: document.documentElement.dataset.theme };
  });
  report.darkColors = dark;
  await acc('export', true);
  await shot('07b-desktop-dark-export');
  await page.locator('.appbar .seg button', { hasText: '라이트' }).click();
  for (const [w, h] of [
    [1100, 800],
    [800, 900],
    [480, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight }));
    report[`overflow_${w}`] = ov;
    await shot(`07c-width-${w}`);
    await page.screenshot({ path: join(SHOTS, `07c-width-${w}-full.png`), fullPage: true });
    expect.soft(ov.sw, `${w}px 에서 가로 스크롤 발생`).toBeLessThanOrEqual(ov.cw);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('7d. 예상 행 수 입력 -> Gmail 102KB 경고 단계(앱 표시값)', async () => {
  await acc('export', true);
  const input = page.locator('#acc-export input[type=number]');
  await input.scrollIntoViewIfNeeded();
  const out: Record<string, string> = {};
  for (const n of [0, 50, 74, 75, 200]) {
    await input.fill(String(n));
    await page.waitForTimeout(100);
    out[n] = (await page.locator('#acc-export .meter').first().locator('xpath=..').innerText().catch(() => '')).replace(/\s+/g, ' ') + ' | ' + (await page.locator('#acc-export').innerText()).match(/(ko|en|ja) [\d.]+ KB \/ 102 KB[^\n]*/g)?.join(' ; ');
  }
  report.expectedRowsPanel = out;
  await input.fill('200');
  await shot('07d-expected-rows-200');
  await input.fill('0');
});
