/**
 * 공지 유형(kind: 'notice') 렌더·출력.
 *
 * 공지는 메일 셸(로고 헤더·푸터·600px 표 래퍼) 없이 **본문 조각만** 낸다. 인라인 프로파일은 web(호스트 폰트 상속: 엔진이 font-family 를
 * 내보내지 않고, 조상과 같은 상속 값은 다시 적지 않는다). 출력은 단일 HTML 하나이고 언어별 구역을 주석 쌍으로 나눈다(docs/notice-format.md).
 *
 * 스코프: template.css 는 `.mail` 래퍼 규칙(기본 글자 크기·줄 높이·색)과 셸 클래스 외에는 요소·클래스 전역 선택자라 셸이 없어도 적용된다.
 * 빠지는 것은 `.mail` 기본값뿐이라, 공지 렌더 중에만 임시 래퍼 `<div class="notice">` 와 아래 NOTICE_CSS 를 더해 같은 효과를 낸다.
 * 인라인 뒤 래퍼는 벗겨 내므로 출력에는 남지 않는다. template.css 는 건드리지 않아 메일 결과에 영향이 없다.
 */
import { composeLang } from '../markup/compose';
import type { Lang } from '../markup/types';
import type { Project } from './model';
import { guardLinks, type InlineOptions, type RenderedProject, type RenderOptions, type RenderWarning } from './render';

/** 임시 래퍼 클래스(인라인 뒤 제거) */
export const NOTICE_WRAP_CLASS = 'notice';

/**
 * template.css 의 `.mail`(14px / 25px / --body) 과 `.mail-content > :first-child` 에 해당하는 공지용 규칙.
 * 값은 template.css 와 같아야 한다(단위 테스트가 대조).
 */
export const NOTICE_CSS = `.notice { font-size: 14px; line-height: 25px; color: var(--body); }
.notice > :first-child { margin-top: 0; }`;

export function noticeInlineOptions(p: Pick<Project, 'settings'>): InlineOptions {
  return { bodyOnly: true, profile: 'web', renderWidth: p.settings.renderWidth, mailSafeLayout: false };
}

export function wrapNoticeFragment(html: string): string {
  return `<div class="${NOTICE_WRAP_CLASS}">\n${html}\n</div>`;
}

const WRAP_OPEN = /^\s*<div\b((?:"[^"]*"|'[^']*'|[^'">])*)>/i;
const WRAP_CLASS = new RegExp(`\\sclass\\s*=\\s*["']${NOTICE_WRAP_CLASS}["']`, 'i');
const WRAP_CLOSE = /<\/div>\s*$/i;

/** 인라인 결과에서 임시 래퍼를 벗긴다. 래퍼가 없거나 모양이 다르면 ok=false 와 함께 원문 그대로 돌려준다. */
export function unwrapNoticeFragment(html: string): { html: string; ok: boolean } {
  const m = WRAP_OPEN.exec(html);
  if (!m || !WRAP_CLASS.test(m[1]) || !WRAP_CLOSE.test(html)) return { html, ok: false };
  return { html: html.slice(m[0].length).replace(WRAP_CLOSE, '').trim(), ok: true };
}

export interface NoticeFragmentOptions extends RenderOptions {
  /** true = 출력용(data-t 제거), false = 미리보기용(data-t 유지: 클릭 편집) */
  stripIds: boolean;
}

/**
 * 공지 본문 조각 하나(언어 1개): 합성 → 임시 래퍼 → 실제 인라인(web) → 링크 보장 → 래퍼 제거.
 * 미리보기와 출력이 같은 경로를 쓴다.
 */
export async function renderNoticeFragment(
  p: Project,
  lang: Lang,
  opts: NoticeFragmentOptions,
): Promise<{ html: string; warnings: RenderWarning[] }> {
  const warnings: RenderWarning[] = [];
  const composed = composeLang(p, lang, { baseLang: p.baseLang, stripIds: opts.stripIds, mode: opts.stripIds ? 'send' : 'preview' });
  const css = (opts.css ?? p.settings.customCss ?? '') + '\n' + NOTICE_CSS;
  const res = await opts.inline(wrapNoticeFragment(composed.html), css, noticeInlineOptions(p));
  for (const w of res.warnings ?? []) {
    if (w.level === 'info') continue;
    warnings.push({ lang, code: w.code ?? 'inline-warning', message: `[본문] ${w.message}` });
  }
  const guarded = guardLinks(res.html, lang, '본문', warnings);
  const un = unwrapNoticeFragment(guarded);
  if (!un.ok) warnings.push({ lang, code: 'notice-wrapper-missing', message: `인라인 결과에서 공지 임시 래퍼를 찾지 못해 벗기지 못했습니다 (${lang})` });
  return { html: un.html, warnings };
}

/** 공지를 언어별로 렌더한다. 결과는 메일과 같은 RenderedProject 모양(locales[lang].html = 구역 본문, 동적 표 없음)이라 검사·분석 상태를 그대로 쓴다. */
export async function renderNotice(p: Project, opts: RenderOptions): Promise<RenderedProject> {
  const locales: RenderedProject['locales'] = {};
  const warnings: RenderWarning[] = [];
  for (const lang of p.langs) {
    const r = await renderNoticeFragment(p, lang, { ...opts, stripIds: true });
    warnings.push(...r.warnings);
    locales[lang] = { subject: p.subject[lang] ?? '', html: r.html };
  }
  return { locales, dynamicTables: [], warnings };
}

/* ------------------------------------------------------------------ 주석 규격 */

/** 제목·언어 코드 같은 한 줄 텍스트: 모든 공백·개행·제어 문자를 공백 하나로 접고 앞뒤를 자른다. 복사 버튼이 내는 '제목 텍스트'가 이것이다. */
export function noticeTitle(subject: string): string {
  return subject.replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim();
}

/**
 * 주석 안에 안전하게 넣을 수 있는 텍스트로 바꾼다(HTML 주석을 닫거나 깨는 입력 방지).
 *  1) noticeTitle 로 한 줄로 접는다.
 *  2) `&` `<` `>` 를 `&amp;` `&lt;` `&gt;` 로 바꾼다 -> `-->` `--!>` `<!--` 이 생길 수 없다.
 *  3) `--` 가 생기지 않도록 뒤에 `-` 가 오는 `-` 를 `&#45;` 로 바꾼다(`--` -> `&#45;-`, `---` -> `&#45;&#45;-`).
 * 앞뒤는 항상 공백으로 감싸 쓰므로(`<!-- tx:title ... -->`) 끝의 `-` 나 시작 `>` 도 문제 없다.
 * 되돌리기: unescapeCommentText.
 */
export function escapeCommentText(s: string): string {
  return noticeTitle(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/-(?=-)/g, '&#45;');
}

/** escapeCommentText 의 역변환(복사·파싱용). 한 번에 치환해 `&amp;#45;` 같은 입력도 정확히 되돌린다. */
export function unescapeCommentText(s: string): string {
  const map: Record<string, string> = { amp: '&', lt: '<', gt: '>', '#45': '-' };
  return s.replace(/&(amp|lt|gt|#45);/g, (_m, n: string) => map[n]);
}

/** 언어 코드는 `[A-Za-z0-9_-]` 외를 `_` 로 바꿔 주석을 깨지 않게 한다. */
function safeLang(lang: Lang): string {
  return lang.replace(/[^A-Za-z0-9_-]/g, '_').replace(/-(?=-)/g, '_');
}

export const noticeLangOpen = (lang: Lang): string => `<!-- tx:lang ${safeLang(lang)} -->`;
export const noticeLangClose = (lang: Lang): string => `<!-- /tx:lang ${safeLang(lang)} -->`;
export const noticeTitleComment = (title: string): string => `<!-- tx:title ${escapeCommentText(title)} -->`;

/** 구역 내용: 공지 폼에 붙일 본문 HTML 만(구역·제목 주석 제외) */
export function noticeZoneContent(rendered: RenderedProject, lang: Lang): string {
  return (rendered.locales[lang]?.html ?? '').trim();
}

/** 제목 텍스트(한 줄로 접은 원문, 이스케이프 없음) — '제목 복사' 버튼의 내용 */
export function noticeZoneTitle(rendered: RenderedProject, lang: Lang): string {
  return noticeTitle(rendered.locales[lang]?.subject ?? '');
}

/** 구역 전체(주석 포함): 시작 주석 · 제목 주석 · 본문 · 끝 주석 */
export function noticeZone(rendered: RenderedProject, lang: Lang): string {
  return [noticeLangOpen(lang), noticeTitleComment(noticeZoneTitle(rendered, lang)), noticeZoneContent(rendered, lang), noticeLangClose(lang)].join('\n');
}

/** 공지 HTML 전체(언어 순서 = project.langs, 구역 사이 빈 줄 하나, 끝 개행) */
export function buildNoticeHtml(p: Pick<Project, 'langs'>, rendered: RenderedProject): string {
  return p.langs.map((l) => noticeZone(rendered, l)).join('\n\n') + '\n';
}

export interface NoticeZone {
  lang: string;
  title: string;
  content: string;
}

/** buildNoticeHtml 의 결과를 구역별로 다시 읽는다(검증·도구용). 형식이 다른 구역은 건너뛴다. */
export function parseNoticeHtml(html: string): NoticeZone[] {
  const out: NoticeZone[] = [];
  const re = /<!-- tx:lang (\S+) -->\n<!-- tx:title ([^\n]*?) -->\n([\s\S]*?)\n<!-- \/tx:lang \1 -->/g;
  for (const m of html.matchAll(re)) out.push({ lang: m[1], title: unescapeCommentText(m[2]), content: m[3] });
  return out;
}

/** 저장 파일 이름: `notice_<이름>.html` (이름은 호출자가 safeFilename 을 거쳐 넘긴다) */
export const noticeFilename = (base: string): string => `notice_${base}.html`;
