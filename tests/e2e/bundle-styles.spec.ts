import { test, expect, chromium, type BrowserContext, type Page, type FrameLocator } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { outDir } from './global-setup';
import { appDir } from './app-setup';

/**
 * 번들의 locales.{lang}.html 에 인라인 스타일이 들어가는지 경로별로 확인한다(조사용).
 * 결과는 OUT/bundle-styles/report.json 에 기록한다.
 */
const OUT = join(outDir(), 'bundle-styles');
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;
const report: Record<string, unknown> = {};
let ctx: BrowserContext;
let page: Page;
let dir: string;
const preview = (): FrameLocator => page.frameLocator('iframe[title^="메일 미리보기"]');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

function stat(b: any) {
  const o: Record<string, unknown> = {};
  for (const l of b.langs as string[]) {
    const h: string = b.locales[l].html;
    o[l] = { style: count(h, /style="/g), mail: /class="mail"/.test(h), len: h.length, head: h.slice(0, 200) };
  }
  o.sourceStructureStyle = count(b.source.structure, /style="/g);
  o.customCssLen = (b.source.settings?.customCss ?? '').length;
  o.settings = { ...b.source.settings, logoUrl: String(b.source.settings?.logoUrl ?? '').slice(0, 20) };
  return o;
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'css-inliner-bstyle-'));
  ctx = await chromium.launchPersistentContext(dir, { channel: process.env.E2E_CHANNEL ?? 'msedge', headless: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
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
test.afterAll(() => writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2)));

async function openExport() {
  const b = page.locator('#acch-export');
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
}
async function saveBundle(force = false): Promise<{ b: any; path: string }> {
  await openExport();
  const btn = page.getByRole('button', { name: '번들 저장(.json)' });
  const chk = page.locator('#acc-export label.chk input');
  if (force && (await chk.count())) await chk.check();
  const info = async () => {
    const ck = page.locator('#acch-check');
    if ((await ck.getAttribute('aria-expanded')) !== 'true') await ck.click();
    return {
      disabled: await btn.isDisabled(),
      banner: (await page.locator('#acc-export .banner').first().innerText().catch(() => '')).replace(/\s+/g, ' '),
      toast: await page.locator('.toast').innerText().catch(() => ''),
      issues: (await page.locator('#acc-check .chk-i').allInnerTexts().catch(() => [])).map((x) => x.replace(/\s+/g, ' ').slice(0, 110)),
    };
  };
  try {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), btn.click({ timeout: 5000 })]);
    const path = join(dir, `${Date.now()}-${dl.suggestedFilename()}`);
    await dl.saveAs(path);
    return { b: JSON.parse(readFileSync(path, 'utf8')), path };
  } catch (e) {
    const i = await info();
    report['saveFailed@' + Date.now()] = i;
    throw new Error('저장 실패: ' + JSON.stringify(i));
  }
}
async function blockedInfo() {
  await openExport();
  const btn = page.getByRole('button', { name: '번들 저장(.json)' });
  const ck = page.locator('#acch-check');
  if ((await ck.getAttribute('aria-expanded')) !== 'true') await ck.click();
  return {
    disabled: await btn.isDisabled(),
    banner: (await page.locator('#acc-export .banner').first().innerText()).replace(/\s+/g, ' '),
    issues: (await page.locator('#acc-check .chk-i').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').slice(0, 110)),
  };
}
async function copyBundle(): Promise<any> {
  await openExport();
  await page.getByRole('button', { name: '클립보드 복사' }).click();
  await expect(page.locator('.toast')).toContainText(/클립보드/, { timeout: 40_000 });
  return JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
}

const DRAFT = `# 초안 스타일 테스트
@en Draft style test
@ja 下書きスタイル

본문입니다.
@en Body text.
@ja 本文です。

[정보: 알림]
제목
[/정보]
`;

async function createDraft() {
  // 초안 작성은 항상 전체 화면이다(모달·표시 방식 전환은 제거됨)
  await page.locator('[data-draft-opener]').click();
  const scope = page.getByRole('region', { name: /초안 화면/ });
  await expect(scope).toBeVisible();
  const btn = scope.getByRole('button', { name: '소스 보기 (.txmd 직접 편집)' });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await page.locator('#draft-ta').fill(DRAFT);
  await scope.locator('[data-create]').click();
  await expect(scope).toHaveCount(0);
  await expect.poll(() => preview().locator('body').innerText(), { timeout: 20_000 }).toContain('본문입니다');
}

test('1. 샘플 -> 저장 / 4. 복사 동일성 / 5. 불러오기 후 저장', async () => {
  const { b, path } = await saveBundle();
  report['1.sample.save'] = stat(b);
  const c = await copyBundle();
  report['4.sample.copy'] = stat(c);
  report['4.copySameLocales'] = JSON.stringify(c.locales) === JSON.stringify(b.locales);
  // 5. 불러오기
  await page.locator('#ltab-projects').click();
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(page.locator('.proj-btn')).toContainText('(가져옴)');
  await expect.poll(() => preview().locator('body').innerText(), { timeout: 20_000 }).toContain('안녕하세요');
  const r = await saveBundle();
  report['5.restored.save'] = stat(r.b);
  // 불러온 직후 즉시 저장(분석 idle 상태)이었음 -> 위 saveBundle 이 곧 그 경로
});

test('2. 새 초안 프로젝트(전체 화면) -> 저장', async () => {
  await createDraft();
  report['2.draft.full.blockedInfo'] = await blockedInfo();
  const { b } = await saveBundle(true); // 생성 직후 즉시 저장(분석 idle)
  report['2.draft.full.immediateSave'] = stat(b);
  await openExport();
  const c = await copyBundle();
  report['2.draft.full.copy'] = stat(c);
});

test('3. 블록 편집 직후(분석 stale) 즉시 저장 / 편집 후 대기 저장 / 저장 중 편집', async () => {
  await page.locator('#ltab-blocks').click();
  await page.locator('.list .item', { hasText: '문단' }).first().click();
  const n0 = await page.locator('.list .item .idc').count();
  await page.getByRole('button', { name: '+ 블록 추가' }).click();
  await expect.poll(() => page.locator('.list .item .idc').count()).toBe(n0 + 1);
  const a = await saveBundle(true); // 편집 직후(타이머 2.5s 이전) 저장
  report['3.afterAddBlock.immediateSave'] = stat(a.b);
  // 콜아웃 종류 변경
  await page.locator('#ltab-strings').click();
  await preview().locator('div.callout [data-t]').first().click();
  await page.locator('#bp-callout').selectOption('warn');
  await expect(preview().locator('div.callout-warn')).toHaveCount(1, { timeout: 15_000 });
  const c = await saveBundle(true);
  report['3.afterCallout.immediateSave'] = stat(c.b);
  expect(c.b.locales.ko.html).toContain('callout-warn');
  // 저장 중 편집: 저장 클릭 직후 또 편집
  await openExport();
  await page.locator('#acc-export label.chk input').check();
  const dlP = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: '번들 저장(.json)' }).click();
  await page.locator('#ltab-blocks').click();
  await page.locator('.list .item', { hasText: '문단' }).first().click();
  await page.getByRole('button', { name: '+ 블록 추가' }).click();
  const dl = await dlP;
  const p = join(dir, 'race.json');
  await dl.saveAs(p);
  report['3.editDuringSave'] = stat(JSON.parse(readFileSync(p, 'utf8')));
  // 유휴 대기(2.5s 자동 분석) 후 저장
  await page.waitForTimeout(8000);
  const d = await saveBundle(true);
  report['3.afterAutoAnalysis.save'] = stat(d.b);
});

test('6. 분석 완료(fresh) 상태에서 저장 / 샘플 연속 저장', async () => {
  await openExport();
  await page.getByRole('button', { name: /크기·변환 검사 실행/ }).click();
  await expect(page.getByRole('button', { name: /크기·변환 검사 실행/ })).toBeDisabled({ timeout: 40_000 });
  const a = await saveBundle();
  report['6.fresh.save'] = stat(a.b);
  const b = await saveBundle();
  report['6.fresh.save2'] = stat(b.b);
});

test('7/8. 하네스: CSS 유무·profile·customCss·renderWidth·bodyOnly 별 인라인 결과', async () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/template.css'), 'utf8');
  const hp = await ctx.newPage();
  await hp.goto(pathToFileURL(join(outDir(), 'harness.html')).href);
  await hp.waitForFunction(() => !!(window as any).__e2e);
  const { b } = await (async () => {
    await page.bringToFront();
    return saveBundle();
  })();
  const res = await hp.evaluate(
    async ({ src, css }) => {
      const e = (window as any).__e2e;
      const out: Record<string, any> = {};
      const run = async (key: string, mut: (p: any) => void, cssArg: string | undefined) => {
        const p = JSON.parse(JSON.stringify(src));
        mut(p);
        try {
          const r = await e.renderProject(p, { inline: e.convertToInline, css: cssArg });
          out[key] = (r.locales.ko.html.match(/style="/g) ?? []).length;
        } catch (err) {
          out[key] = 'ERR ' + String(err).slice(0, 120);
        }
      };
      await run('css=template', () => {}, css);
      await run('css=빈문자열', () => {}, '');
      await run('css=undefined(customCss만)', () => {}, undefined);
      await run('css=template profile=web', (p) => (p.settings.profile = 'web'), css);
      await run('css=template renderWidth=320', (p) => (p.settings.renderWidth = 320), css);
      await run('css=template renderWidth=0', (p) => (p.settings.renderWidth = 0), css);
      await run('css=template renderWidth=undefined', (p) => delete p.settings.renderWidth, css);
      await run('css=template mailSafeLayout', (p) => (p.settings.mailSafeLayout = true), css);
      await run('css=template+customCss(@import 없음)', (p) => (p.settings.customCss = '.x{color:red}'), css + '\n.x{color:red}');
      await run('css=template logoUrl=https', (p) => (p.settings.logoUrl = 'https://x/y.png'), css);
      await run('css=template settings 없음', (p) => delete p.settings, css);
      return out;
    },
    { src: b.source, css },
  ).catch((e) => ({ error: String(e) }));
  report['7/8.harness'] = res;
  await hp.close();
});

/* ------------------------------------------------------------------ 내용 오류별 */
async function editEn(text: string) {
  await page.locator('#ltab-strings').click();
  await preview().locator('[data-t]', { hasText: '안녕하세요' }).first().click();
  await page.locator('#ta-en').fill(text);
  await page.waitForTimeout(400);
}
const cases: [string, string, string][] = [
  ['en 미번역(빈 문자열)', 'ko', ''],
  ['치환자 불일치(en 에 |!#-zzz| 추가)', 'en', 'Hello |!#-zzz| there'],
  ['닫는 | 누락 치환자(en: |!#-cust_nm)', 'en', 'Hello |!#-cust_nm there'],
];
for (const [name, , txt] of cases) {
  test(`E(a). ${name}: 강제 미체크 -> 저장 불가 / 체크 후 저장`, async () => {
    await editEn(txt);
    const bi = await blockedInfo();
    report[`E.${name}.unforced`] = bi;
    const { b } = await saveBundle(true);
    report[`E.${name}.forced`] = stat(b);
    report[`E.${name}.forced.enHtmlHasText`] = b.locales.en.html.includes(txt) || txt === '';
    // 클립보드 경로
    const c = await copyBundle();
    report[`E.${name}.forcedCopy`] = stat(c);
  });
}

test('E(b-d). 하네스: 깨진 구조 HTML / 경고 / 언어별 영향', async () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/template.css'), 'utf8');
  const { b } = await saveBundle();
  const hp = await ctx.newPage();
  await hp.goto(pathToFileURL(join(outDir(), 'harness.html')).href);
  await hp.waitForFunction(() => !!(window as any).__e2e);
  const res = await hp.evaluate(
    async ({ src, css }) => {
      const e = (window as any).__e2e;
      const out: Record<string, any> = {};
      const run = async (key: string, mut: (p: any) => void) => {
        const p = JSON.parse(JSON.stringify(src));
        mut(p);
        try {
          const r = await e.renderProject(p, { inline: e.convertToInline, css });
          const per: Record<string, number> = {};
          for (const l of p.langs) per[l] = (r.locales[l].html.match(/style="/g) ?? []).length;
          out[key] = { style: per, warnings: r.warnings.map((w: any) => `${w.lang}:${w.code}`).slice(0, 6) };
        } catch (err) {
          out[key] = 'THROW ' + String(err).slice(0, 150);
        }
      };
      await run('정상', () => {});
      await run('닫히지 않은 div 추가', (p) => (p.structure = '<div class="callout">' + p.structure));
      await run('닫는 태그 과다', (p) => (p.structure = p.structure + '</div></table></td>'));
      await run('table 안에 div/잘못된 중첩', (p) => (p.structure = '<table><div><tr><td>' + p.structure + '</table>'));
      await run('속성 따옴표 깨짐', (p) => (p.structure = '<div class="a>' + p.structure + '</div>'));
      await run('구조 빈 문자열', (p) => (p.structure = ''));
      await run('ja 문자열만 깨진 HTML', (p) => { for (const id of Object.keys(p.strings)) if (p.strings[id].ja) p.strings[id].ja = '<b><i>' + p.strings[id].ja; });
      await run('en 빈 문자열', (p) => { for (const id of Object.keys(p.strings)) p.strings[id].en = ''; });
      await run('ja 에 <script>', (p) => { for (const id of Object.keys(p.strings)) if (p.strings[id].ja) p.strings[id].ja = '<script>x</script>' + p.strings[id].ja; });
      return out;
    },
    { src: b.source, css },
  );
  report['E(b-d).harness'] = res;
  await hp.close();
});
