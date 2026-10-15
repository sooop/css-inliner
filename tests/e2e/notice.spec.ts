import { test, expect, chromium, type BrowserContext, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { outDir } from './global-setup';
import { appDir } from './app-setup';

/**
 * 공지 유형(kind: notice): 실제 엔진(web 프로파일)으로 초안 → 공지 프로젝트 → 공지 HTML 저장·구역 복사.
 * 테스트마다 새 프로필(샘플 메일 프로젝트 1개부터). 스크린샷은 OUT/shots-notice/, 저장 파일은 OUT/notice-files/.
 */
const OUT = outDir();
const SHOTS = join(OUT, 'shots-notice');
const FILES = join(OUT, 'notice-files');
const APP_URL = pathToFileURL(join(appDir(), 'index.html')).href;
const SRC_BTN = '소스 보기 (.txmd 직접 편집)';

const NOTICE_DRAFT = `# 시스템 점검 안내
@en System maintenance notice
@ja システムメンテナンスのお知らせ

10월 20일 새벽 2시부터 4시까지 **시스템 점검**이 진행됩니다. 자세한 내용은 [공지 페이지](https://notice.example.com/maint)를 확인하세요.
@en System maintenance runs from 2 to 4 AM on Oct 20. See the [notice page](https://notice.example.com/maint) for details.
@ja 10月20日の午前2時から4時までシステムメンテナンスを行います。詳細は[お知らせページ](https://notice.example.com/maint)をご確認ください。

[표: 세로형]
- 일시: 10월 20일 02:00 - 04:00
@en - When: Oct 20, 02:00 - 04:00
@ja - 日時: 10月20日 02:00 - 04:00
- 대상: 전체 서비스
@en - Scope: All services
@ja - 対象: 全サービス
[/표]

[경고: 유의 사항]
@en Notes
@ja ご注意
점검 중에는 주문·조회가 일시 중단됩니다.
@en Orders and tracking are paused during maintenance.
@ja メンテナンス中は注文・照会を一時停止します。
[/경고]

- 점검 전 진행 중인 작업을 저장하세요
@en Save your work before maintenance
@ja メンテナンス前に作業を保存してください
- 점검 후 다시 로그인이 필요할 수 있습니다
@en You may need to sign in again afterwards
@ja 終了後に再ログインが必要な場合があります

[버튼, 점검 일정 보기, https://notice.example.com/schedule, primary]
@en View schedule
@ja スケジュールを見る
`;

const SUBJECTS = { ko: '[공지] 시스템 점검 -- 10/20 안내', en: 'Maintenance --> Oct 20', ja: '【お知らせ】システム点検 10/20' };

let ctx: BrowserContext;
let page: Page;
let dir: string;
const consoleErrors: string[] = [];
const noticePreview = (): FrameLocator => page.frameLocator('iframe[title^="공지 미리보기"]');
const mailPreview = (): FrameLocator => page.frameLocator('iframe[title^="메일 미리보기"]');
const shot = (name: string) => page.screenshot({ path: join(SHOTS, name + '.png') });
const screen = (): Locator => page.getByRole('region', { name: /초안 화면/ });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(FILES, { recursive: true });
});
test.beforeEach(async () => {
  consoleErrors.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'css-inliner-notice-'));
  ctx = await chromium.launchPersistentContext(dir, {
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

async function boot() {
  await page.goto(APP_URL);
  await page.locator('.appbar').waitFor();
  await mailPreview().locator('table').first().waitFor({ timeout: 30_000 });
}

async function acc(key: string, open = true) {
  const b = page.locator(`#acch-${key}`);
  if (((await b.getAttribute('aria-expanded')) === 'true') !== open) await b.click();
}

/** + 초안 → 유형 선택 → 초안 입력 → 만들기. 만든 뒤 공지 미리보기가 그려질 때까지 기다린다. */
async function createDraft(kind: 'mail' | 'notice', text: string, name: string) {
  await page.locator('[data-draft-opener]').click();
  await expect(screen()).toBeVisible();
  const btn = screen().getByRole('button', { name: SRC_BTN });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await page.locator('#draft-ta').fill(text);
  await screen().locator(`[data-kind="${kind}"]`).click();
  await page.locator('#draft-name').fill(name);
  return screen().locator('[data-create]');
}

async function setSubjects() {
  await page.locator('#ltab-blocks').click();
  await page.locator('.list .item', { hasText: '공지 제목' }).click();
  await page.locator('#ta-ko').fill(SUBJECTS.ko);
  await page.locator('#ta-en').fill(SUBJECTS.en);
  await page.locator('#ta-ja').fill(SUBJECTS.ja);
}

async function saveFile(buttonName: RegExp | string, file: string): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: buttonName }).click()]);
  const p = join(FILES, file);
  await dl.saveAs(p);
  expect(dl.suggestedFilename()).toBe(file.replace(/^.*\//, ''));
  return readFileSync(p, 'utf8');
}

/** Windows 클립보드는 개행을 CRLF 로 바꿔 돌려주므로(시스템 동작) LF 로 맞춰 비교한다 */
const clip = async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

test('공지 만들기: 유형 선택(기본 메일·설명 한 줄) → 공지 프로젝트 → 메일 전용 UI 숨김 → 저장 파일 검증 → 구역·제목 복사 → 새로고침 후 유지', async () => {
  await page.locator('[data-draft-opener]').click();
  await expect(screen().locator('[data-kind="mail"]')).toHaveAttribute('aria-checked', 'true');
  await expect(screen().locator('[data-kind-desc]')).toContainText('메일');
  await screen().getByRole('button', { name: '← 돌아가기' }).click();

  const create = await createDraft('notice', NOTICE_DRAFT, '시스템 점검');
  await expect(screen().locator('[data-kind-desc]')).toContainText('공지');
  await expect(screen().locator('[data-kind="notice"]')).toHaveAttribute('aria-checked', 'true');
  await expect(create).toBeEnabled();
  await shot('n00-draft-notice');
  await create.click();
  await expect(screen()).toHaveCount(0);

  // 앱바 배지·미리보기(web, 셸 없음)
  await expect(page.locator('.appbar [data-kind-badge]')).toHaveText('공지');
  await expect.poll(() => noticePreview().locator('body').innerText(), { timeout: 30_000 }).toContain('시스템 점검');
  await expect(noticePreview().locator('.mail, .mail-container, table.mail')).toHaveCount(0);
  await expect(noticePreview().locator('img.logo')).toHaveCount(0);
  await setSubjects();
  await shot('n01-notice-workspace');

  // 메일 전용 UI 가 숨겨졌다
  await expect(page.locator('#acch-vars')).toHaveCount(0);
  await expect(page.locator('#acch-dyn')).toHaveCount(0);
  await expect(page.locator('#acch-handoff')).toHaveCount(0);
  await expect(page.getByText('치환자 샘플값')).toHaveCount(0);
  await expect(page.getByText('발송용 표식')).toHaveCount(0);
  await acc('export', true);
  await expect(page.getByRole('button', { name: '번들 저장(.json)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '클립보드 복사', exact: true })).toHaveCount(0);
  await expect(page.getByText('Gmail 102KB')).toHaveCount(0);
  await expect(page.getByText('예상 행 수')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '공지 HTML 저장' })).toBeVisible();
  // 속성 패널에도 치환자 삽입이 없다
  await noticePreview().locator('[data-t]', { hasText: '점검 전' }).first().click();
  await expect(page.getByText('치환자 삽입')).toHaveCount(0);

  // 오류 없이 저장 가능해질 때까지(변환 검사 최신)
  await expect(page.getByRole('button', { name: '공지 HTML 저장' })).toBeEnabled();
  const html = await saveFile('공지 HTML 저장', 'notice_시스템_점검.html');

  // (a) 구역 시작/끝 쌍·제목 주석, 셸·메일 클래스·치환자 없음, 인라인 style, 링크 target/rel
  for (const l of ['ko', 'en', 'ja']) {
    expect(html, l).toContain(`<!-- tx:lang ${l} -->`);
    expect(html, l).toContain(`<!-- /tx:lang ${l} -->`);
  }
  expect(html).toContain('<!-- tx:title [공지] 시스템 점검 &#45;- 10/20 안내 -->');
  expect(html).toContain('<!-- tx:title Maintenance &#45;-&gt; Oct 20 -->');
  expect(html).toContain('<!-- tx:title 【お知らせ】システム点検 10/20 -->');
  expect(html).not.toMatch(/data-tx-shell|class="mail|mail-container|mail-header|mail-footer|class="notice"|data-t=|TRACXLOGIS|<main/);
  expect(html).not.toContain('|!#-');
  expect(html).not.toContain('{{');
  expect(html).toMatch(/style="[^"]+"/);
  expect(html, 'web 프로파일은 font-family 를 내보내지 않는다').not.toMatch(/font-family/i);
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref=[^>]*>/g)].map((m) => m[0]);
  expect(anchors.length).toBeGreaterThanOrEqual(6);
  for (const a of anchors) {
    expect(a, a).toContain('target="_blank"');
    expect(a, a).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"|rel="[^"]*noreferrer[^"]*noopener[^"]*"/);
  }
  // 구역 안: 해당 언어 문구만
  const zone = (l: string) => new RegExp(`<!-- tx:lang ${l} -->\\n<!-- tx:title [^\\n]* -->\\n([\\s\\S]*?)\\n<!-- /tx:lang ${l} -->`).exec(html)![1];
  expect(zone('ko')).toContain('시스템 점검');
  expect(zone('ko')).not.toContain('System maintenance');
  expect(zone('en')).toContain('System maintenance notice');
  expect(zone('ja')).toContain('システムメンテナンス');
  // 상속 속성: 본문 래퍼를 벗겨도 각 요소가 자기 글자 크기·색을 가진다
  expect(zone('ko')).toMatch(/<p style="[^"]*font-size: 14px/);
  expect(zone('ko')).toMatch(/<h1 style="[^"]*font-size: 27px/);

  // (e) 구역 복사 = 주석 제외 본문만, 제목 복사 = 한 줄 원문
  await page.locator('[data-notice-zone="en"]').click();
  await expect(page.locator('.toast')).toContainText('en 구역');
  const enZone = await clip();
  expect(enZone).toBe(zone('en').trim());
  expect(enZone).not.toContain('<!--');
  expect(enZone).toContain('System maintenance notice');
  await page.locator('[data-notice-title="ko"]').click();
  await expect(page.locator('.toast')).toContainText('ko 제목');
  expect(await clip()).toBe(SUBJECTS.ko);
  await page.locator('[data-notice-zone="ja"]').click();
  await expect.poll(clip).toBe(zone('ja').trim());
  await page.getByRole('button', { name: '공지 HTML 복사' }).click();
  await expect.poll(clip).toBe(html);

  // 프로젝트 목록 배지, (d) 새로고침 뒤에도 kind 유지
  await page.locator('#ltab-projects').click();
  await expect(page.locator('.proj', { hasText: '시스템 점검' }).locator('[data-kind-badge="notice"]')).toHaveText('공지');
  await expect(page.locator('.proj', { hasText: '배송 시작 안내' }).locator('[data-kind-badge="mail"]')).toHaveText('메일');
  await page.waitForTimeout(1200); // 자동 저장
  await page.reload();
  await page.locator('.appbar').waitFor();
  await noticePreview().locator('body').waitFor({ timeout: 30_000 });
  await expect(page.locator('.appbar [data-kind-badge]')).toHaveText('공지');
  await expect(page.locator('#acch-vars')).toHaveCount(0);
  await expect.poll(() => noticePreview().locator('body').innerText(), { timeout: 30_000 }).toContain('시스템 점검');
  // 미리보기 언어 전환(en)·스크린샷
  await page.locator('.seg[aria-label="미리보기 언어"] button', { hasText: 'en' }).click();
  await expect.poll(() => noticePreview().locator('body').innerText(), { timeout: 30_000 }).toContain('System maintenance notice');
  await shot('n02-notice-preview-en');
  await page.locator('.seg[aria-label="미리보기 언어"] button', { hasText: 'ko' }).click();
  await expect.poll(() => noticePreview().locator('body').innerText(), { timeout: 30_000 }).toContain('시스템 점검');
  await acc('export', true);
  await shot('n03-notice-export-panel');
});

test('공지에 치환자가 있으면 검사 오류로 저장이 막히고, 강제 체크로만 나온다 / 동적 표 초안은 만들기 오류', async () => {
  // 동적 표 초안은 만들기 단계에서 막힌다(메일로 바꾸면 만들 수 있다)
  const dyn = '# 제목\n\n[표: 가로형, 동적: t]\n{a| b}\n- {{a}}| {{b}}\n[/표]\n';
  const create = await createDraft('notice', dyn, '동적');
  await expect(create).toBeDisabled();
  await expect(screen()).toContainText('동적 표를 쓸 수 없습니다');
  await screen().locator('[data-kind="mail"]').click();
  await expect(create).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(screen()).toHaveCount(0);

  // 치환자: 경고만 나오고 만들 수 있다 → 검사 오류
  const ph = '# 안내\n@en Notice\n@ja お知らせ\n\n안녕하세요 |!#-cust_nm|님\n@en Hello |!#-cust_nm|\n@ja |!#-cust_nm|様\n';
  await page.locator('[data-draft-opener]').click();
  await page.locator('#draft-ta').fill(ph);
  await screen().locator('[data-kind="notice"]').click();
  await expect(screen().locator('[data-draft-warnings]')).toContainText('치환자', { timeout: 5000 });
  await page.locator('#draft-name').fill('치환자 공지');
  await screen().locator('[data-create]').click();
  await expect(screen()).toHaveCount(0);
  await expect(page.locator('.appbar [data-kind-badge]')).toHaveText('공지');
  await setSubjects();
  await acc('check', true);
  await expect(page.locator('.chk-i.err', { hasText: '공지에는 치환자를 쓸 수 없습니다' }).first()).toBeVisible();
  await acc('export', true);
  const save = page.getByRole('button', { name: '공지 HTML 저장' });
  await expect(save).toBeDisabled();
  await expect(page.locator('[data-notice-zone="ko"]')).toBeDisabled();
  await shot('n04-notice-placeholder-blocked');
  await page.getByLabel('오류를 확인했고 강제로 내보냅니다').check();
  await expect(save).toBeEnabled();
  const html = await saveFile('공지 HTML 저장', 'notice_치환자_공지.html');
  expect(html).toContain('|!#-cust_nm|');
  expect(html).toContain('<!-- tx:lang ja -->');
});

test('메일 회귀: 기본 유형은 메일, 샘플 메일은 셸·치환자·번들 UI 그대로, 번들 저장 가능', async () => {
  await expect(page.locator('.appbar [data-kind-badge]')).toHaveText('메일');
  await expect(page.locator('#acch-vars')).toBeVisible();
  await expect(page.locator('#acch-dyn')).toBeVisible();
  await expect(page.locator('#acch-handoff')).toBeVisible();
  await expect(page.getByText('치환자 샘플값')).toBeVisible();
  await expect(mailPreview().locator('table.mail')).toHaveCount(1);
  await expect(mailPreview().locator('img.logo')).toHaveCount(1);
  await acc('export', true);
  await expect(page.getByRole('button', { name: '번들 저장(.json)' })).toBeVisible();
  await expect(page.getByRole('button', { name: '공지 HTML 저장' })).toHaveCount(0);
  // 메일 초안(유형 기본값 그대로)으로 만든 프로젝트도 메일이다
  const create = await createDraft('mail', '# 메일 제목\n\n본문\n', '메일 확인');
  await create.click();
  await expect(page.locator('.appbar [data-kind-badge]')).toHaveText('메일');
  await expect(mailPreview().locator('table.mail')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot('n05-mail-preview');
});
