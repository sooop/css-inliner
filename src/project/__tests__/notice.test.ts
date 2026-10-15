import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createProjectFromDraft, analyzeDraft } from '../../ui/state/draft';
import { createSampleProject } from '../../ui/state/sample';
import { findLinksMissingTarget } from '../../markup/links';
import {
  NOTICE_CSS,
  buildNoticeHtml,
  buildBundle,
  createProject,
  escapeCommentText,
  exportBundle,
  hasErrors,
  noticeTitle,
  noticeZone,
  noticeZoneContent,
  noticeZoneTitle,
  parseNoticeHtml,
  projectKind,
  renderNotice,
  renderProject,
  restoreProject,
  unescapeCommentText,
  unwrapNoticeFragment,
  validateProject,
  verifyBundle,
  ProjectStore,
  type InlineFn,
  type Project,
} from '../index';
import { makeFakeInline } from './fixture';

const DRAFT = `# 점검 안내
@en Maintenance notice
@ja メンテナンスのお知らせ

시스템 점검이 있습니다. [자세히](https://notice.test/a)
@en System maintenance is scheduled. [Details](https://notice.test/a)
@ja システムメンテナンスがあります。[詳細](https://notice.test/a)

[표: 세로형]
- 일시: 10월 20일
@en - When: Oct 20
@ja - 日時: 10月20日
[/표]
`;

function noticeProject(over: Partial<Project> = {}): Project {
  const { project } = createProjectFromDraft(DRAFT, { name: '점검', kind: 'notice' });
  return {
    ...project,
    subject: { ko: '[공지] 점검 -- 안내', en: 'Maintenance --> notice', ja: 'メンテ <!-- x -->' },
    ...over,
  };
}

/** 실제 엔진처럼 임시 래퍼에 style 을 달고 td 에도 달아 준다(래퍼를 지우지 않음) */
const inline: InlineFn = async (html) => ({
  html: html.replace('<div class="notice">', '<div class="notice" style="font-size: 14px; ">').replace(/<td>/g, '<td style="padding: 4px;">'),
  warnings: [{ level: 'info', code: 'x', message: 'info 는 무시' }],
});

describe('kind 기본값·마이그레이션', () => {
  it('필드가 없으면 메일, 알 수 없는 값도 메일, notice 만 공지', () => {
    expect(projectKind({})).toBe('mail');
    expect(projectKind({ kind: 'x' as never })).toBe('mail');
    expect(projectKind({ kind: 'notice' })).toBe('notice');
  });
  it('메일(기본)은 필드를 쓰지 않아 기존 모양 그대로, 공지는 web 프로파일 기본 설정', () => {
    expect('kind' in createProject({ name: 'm' })).toBe(false);
    const n = createProject({ name: 'n', kind: 'notice' });
    expect(n.kind).toBe('notice');
    expect(n.settings.profile).toBe('web');
  });
  it('IndexedDB 에 kind 없이 저장된 옛 레코드는 읽을 때 메일, 공지는 kind 유지', async () => {
    const store = new ProjectStore('test-notice-db');
    const old = createProject({ id: 'old', name: '옛' });
    await store.save(old);
    await store.save(noticeProject());
    const list = await store.listSummaries();
    expect(list.find((x) => x.id === 'old')!.kind).toBe('mail');
    expect(projectKind((await store.get('old'))!)).toBe('mail');
    expect(list.filter((x) => x.kind === 'notice')).toHaveLength(1);
    store.close();
  });
  it('번들: source 에 kind 가 있어도 복원은 항상 메일, 공지는 번들 내보내기 거부', async () => {
    const sample = createSampleProject(1);
    const fake = makeFakeInline().inline;
    const rendered = await renderProject(sample, { inline: fake, css: '' });
    const b = buildBundle(sample, rendered);
    const forged = JSON.parse(JSON.stringify(b)) as typeof b;
    (forged.source as Project).kind = 'notice';
    expect(projectKind(restoreProject(forged))).toBe('mail');
    expect('kind' in restoreProject(b)).toBe(false);
    expect(verifyBundle(b).ok).toBe(true);
    await expect(exportBundle(noticeProject(), { inline: fake })).rejects.toThrow(/공지/);
  });
});

describe('초안 → 공지 프로젝트', () => {
  it('셸 문자열(푸터)이 없고 구조에 셸 표식·mail 클래스가 없다', () => {
    const p = noticeProject();
    expect(p.kind).toBe('notice');
    expect(p.structure).not.toMatch(/data-tx-shell|class="mail|mail-footer/);
    expect(Object.values(p.strings).some((s) => /TRACXLOGIS/.test(s.ko))).toBe(false);
    const mail = createProjectFromDraft(DRAFT, { name: 'm' }).project;
    expect(mail.structure).toMatch(/data-tx-shell/);
    expect('kind' in mail).toBe(false);
  });
  it('동적 표 선언은 만들기 오류, 치환자는 경고', () => {
    const dyn = '# 제목\n\n[표: 가로형, 동적: t]\n{a| b}\n- {{a}}| {{b}}\n[/표]\n';
    expect(analyzeDraft(dyn, 'notice').error).toMatch(/동적 표/);
    expect(analyzeDraft(dyn, 'mail').error).toBeNull();
    expect(() => createProjectFromDraft(dyn, { name: 'x', kind: 'notice' })).toThrow(/동적 표/);
    const ph = analyzeDraft('# 제목\n\n안녕 |!#-name|\n', 'notice');
    expect(ph.error).toBeNull();
    expect(ph.warnings.join(' ')).toMatch(/치환자/);
  });
});

describe('공지 렌더·구역 조립', () => {
  it('web 프로파일·셸 없음·래퍼 제거, 구역 시작/끝 쌍과 제목 주석', async () => {
    const calls: { html: string; css: string; opts: unknown }[] = [];
    const spy: InlineFn = async (h, c, o) => {
      calls.push({ html: h, css: c, opts: o });
      return inline(h, c, o);
    };
    const p = noticeProject();
    const r = await renderNotice(p, { inline: spy, css: '/*t*/' });
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.opts).toMatchObject({ profile: 'web', bodyOnly: true, mailSafeLayout: false });
      expect(c.html.startsWith('<div class="notice">')).toBe(true);
      expect(c.css).toContain(NOTICE_CSS);
    }
    const html = buildNoticeHtml(p, r);
    for (const l of ['ko', 'en', 'ja']) {
      expect(html).toContain(`<!-- tx:lang ${l} -->`);
      expect(html).toContain(`<!-- /tx:lang ${l} -->`);
    }
    expect(html).not.toMatch(/class="notice"|data-t=|data-tx-shell|class="mail/);
    expect(html).toContain('style="padding: 4px;"');
    const zones = parseNoticeHtml(html);
    expect(zones.map((z) => z.lang)).toEqual(['ko', 'en', 'ja']);
    expect(zones[0].title).toBe('[공지] 점검 -- 안내');
    expect(zones[0].content.startsWith('<h1')).toBe(true);
    expect(zones[1].content).toContain('Maintenance notice');
    expect(zones[0].content).not.toContain('Maintenance notice');
  });
  it('구역 복사 문자열: 내용은 주석 제외, 제목은 한 줄 원문, 전체 구역은 주석 포함', async () => {
    const p = noticeProject({ subject: { ko: '  줄\n바꿈\t제목 ', en: 'E', ja: 'J' } });
    const r = await renderNotice(p, { inline });
    expect(noticeZoneTitle(r, 'ko')).toBe('줄 바꿈 제목');
    const content = noticeZoneContent(r, 'en');
    expect(content).not.toContain('<!--');
    expect(content).toContain('Maintenance notice');
    const zone = noticeZone(r, 'en');
    expect(zone.split('\n')[0]).toBe('<!-- tx:lang en -->');
    expect(zone.split('\n')[1]).toBe('<!-- tx:title E -->');
    expect(zone.endsWith('<!-- /tx:lang en -->')).toBe(true);
    expect(zone).toContain(content);
  });
  it('링크: 출력의 모든 a[href] 에 target/rel, 인라인이 지우면 복구 경고', async () => {
    const p = noticeProject();
    const r = await renderNotice(p, { inline });
    for (const l of p.langs) {
      expect(r.locales[l].html).toContain('href="https://notice.test/a"');
      expect(findLinksMissingTarget(r.locales[l].html)).toEqual([]);
    }
    const stripping: InlineFn = async (h, c, o) => {
      const out = await inline(h, c, o);
      return { ...out, html: out.html.replace(/ target="_blank"| rel="noopener noreferrer"/g, '') };
    };
    const r2 = await renderNotice(p, { inline: stripping });
    expect(r2.warnings.some((w) => w.code === 'link-target-restored')).toBe(true);
    expect(findLinksMissingTarget(r2.locales.ko.html)).toEqual([]);
  });
  it('래퍼가 없으면 경고 notice-wrapper-missing', async () => {
    const r = await renderNotice(noticeProject(), { inline: async () => ({ html: '<p>x</p>', warnings: [] }) });
    expect(r.warnings.some((w) => w.code === 'notice-wrapper-missing')).toBe(true);
  });
  it('unwrapNoticeFragment', () => {
    expect(unwrapNoticeFragment('<div class="notice" style="a: b;">\n<p>x</p>\n</div>')).toEqual({ html: '<p>x</p>', ok: true });
    expect(unwrapNoticeFragment('<div class="other"><p>x</p></div>').ok).toBe(false);
  });
  it('NOTICE_CSS 값이 template.css 의 .mail 규칙과 같다', () => {
    const css = readFileSync('src/styles/template.css', 'utf8');
    const mail = /\n\.mail \{([^}]*)\}/.exec(css)![1];
    for (const k of ['font-size', 'line-height', 'color']) {
      const v = new RegExp(`${k}:\\s*([^;]+);`).exec(mail)![1].trim();
      expect(NOTICE_CSS).toContain(`${k}: ${v}`);
    }
  });
});

describe('제목 주석 이스케이프', () => {
  const bad = ['a -- b', '--', '---', 'x-->y', 'x--!>y', '<!-- 주입 -->', '> 시작', '->', '끝 -', '-', 'a&amp;b', '&#45;&#45;', '<b>x</b>', '한\n줄\r\n둘'];
  it.each(bad)('주석을 깨지 않는다: %j', (s) => {
    const e = escapeCommentText(s);
    expect(e).not.toMatch(/--|<|>|[\r\n]/);
    const comment = `<!-- tx:title ${e} -->`;
    // HTML 주석 문법: 시작 뒤 첫 '-->' 가 맨 끝이어야 한다
    expect(comment.indexOf('-->')).toBe(comment.length - 3);
    expect(unescapeCommentText(e)).toBe(noticeTitle(s));
  });
  it('일반 하이픈·한글은 그대로', () => {
    expect(escapeCommentText('[공지] 2026-10-20 점검')).toBe('[공지] 2026-10-20 점검');
  });
});

describe('공지 검사 규칙', () => {
  const codes = (p: Project, rendered?: Awaited<ReturnType<typeof renderNotice>>) =>
    validateProject(p, rendered ? { rendered } : {})
      .filter((i) => i.level === 'error')
      .map((i) => i.code);

  it('정상 공지는 오류 없음(제목이 채워져 있을 때)', async () => {
    const p = noticeProject();
    expect(codes(p, await renderNotice(p, { inline }))).toEqual([]);
  });
  it('제목이 비면 untranslated 경고(오류 아님)', () => {
    const p = noticeProject({ subject: { ko: '', en: 'e', ja: 'j' } });
    expect(codes(p)).not.toContain('untranslated');
    expect(validateProject(p).some((i) => i.level === 'warning' && i.code === 'untranslated')).toBe(true);
  });
  it('치환자 |!#- 와 {{x}} 는 검사 오류(문자열·제목)', () => {
    const base = noticeProject();
    const id = Object.keys(base.strings)[1];
    const withPh = { ...base, strings: { ...base.strings, [id]: { ...base.strings[id], en: 'Hi |!#-name|' } } };
    expect(codes(withPh)).toContain('notice-placeholder');
    const withRow = { ...base, strings: { ...base.strings, [id]: { ...base.strings[id], ja: '{{qty}}個' } } };
    expect(codes(withRow)).toContain('notice-placeholder');
    expect(codes({ ...base, subject: { ...base.subject, ko: '제목 |!#-x|' } })).toContain('notice-placeholder');
    // 메일에서는 같은 문자열이 notice-placeholder 가 아니다
    const { kind: _k, ...asMail } = withPh;
    expect(validateProject(asMail).some((i) => i.code === 'notice-placeholder')).toBe(false);
  });
  it('동적 표·셸 구조·출력의 셸 흔적·링크 누락은 오류', async () => {
    const base = noticeProject();
    expect(codes({ ...base, dynamicTables: [{ id: 't', rowStructure: '', vars: [], sampleRows: [] }] })).toContain('notice-dynamic-table');
    expect(codes({ ...base, structure: '<table class="mail" data-tx-shell></table>' + base.structure })).toContain('notice-shell');
    const r = await renderNotice(base, { inline });
    const dirty = { ...r, locales: { ...r.locales, ko: { ...r.locales.ko, html: '<table class="mail-container"></table><a href="https://x.y">x</a>' } } };
    const c = codes(base, dirty);
    expect(c).toContain('notice-leftover');
    expect(c).toContain('notice-link-target');
    expect(hasErrors(validateProject(base, { rendered: dirty }))).toBe(true);
  });
  it('메일 검사는 그대로(notice 규칙이 끼지 않는다)', () => {
    const issues = validateProject(createSampleProject(1));
    expect(issues.some((i) => i.code.startsWith('notice-'))).toBe(false);
  });
});
