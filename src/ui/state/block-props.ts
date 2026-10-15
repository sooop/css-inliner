/**
 * 블록 속성(콜아웃 종류·제목 레벨·목록 순서·버튼 스타일/그룹) — 순수 함수. ops.ts 가 다시 내보낸다.
 *
 * 구조만 바꾸고 문자열(번역)·sourceHash 는 건드리지 않는다 → '오래됨' 판정에 영향이 없다.
 * 모두 data-t ID 로 대상을 찾고, html-tree 의 위치 정보로 해당 태그 문자열만 교체한다(나머지는 바이트 단위로 보존).
 * 반환이 null 이면 적용할 수 없거나 이미 같은 값이라 바뀐 것이 없다는 뜻이다.
 */
import type { Project } from '../../project/model';
import { attrOf, find, hasClass, parseTree, type El } from './html-tree';

function elById(structure: string, id: string): El | undefined {
  return find(parseTree(structure), (e) => attrOf(e, 'data-t') === id);
}

function closestEl(el: El | undefined, pred: (e: El) => boolean): El | undefined {
  for (let a = el; a; a = a.parent) if (pred(a)) return a;
  return undefined;
}

function openTagEnd(el: El): number {
  return el.start + 1 + el.tag.length + el.attrs.length + 1;
}

function classTokens(el: El): string[] {
  return (attrOf(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

/** 여는 태그의 class 를 주어진 토큰 목록으로 바꾼 문자열(없으면 추가, 빈 목록이면 속성 제거) */
function openTagWithClasses(structure: string, el: El, tokens: string[]): string {
  const open = structure.slice(el.start, openTagEnd(el));
  const re = /(\sclass\s*=\s*)(?:"[^"]*"|'[^']*')/i;
  const val = tokens.join(' ');
  if (re.test(el.attrs)) return val ? open.replace(re, (_m, a: string) => `${a}"${val}"`) : open.replace(re, '');
  return val ? open.replace(/\s*\/?>$/, (end) => ` class="${val}"${end}`) : open;
}

function replaceOpenTagClasses(p: Project, el: El, update: (tokens: string[]) => string[]): Project | null {
  const before = classTokens(el);
  const after = update(before);
  if (after.join(' ') === before.join(' ')) return null;
  const open = openTagWithClasses(p.structure, el, after);
  return { ...p, structure: p.structure.slice(0, el.start) + open + p.structure.slice(openTagEnd(el)) };
}

/** 여는/닫는 태그 이름을 같은 길이 안에서 교체한다(h2→h3, ul→ol). 닫는 태그가 없으면 null. */
function renameTag(p: Project, el: El, newTag: string): Project | null {
  if (newTag === el.tag || newTag.length !== el.tag.length) return null;
  const closeAt = el.end - (el.tag.length + 3);
  const s = p.structure;
  if (closeAt < el.innerEnd || s.slice(closeAt, el.end).toLowerCase() !== `</${el.tag}>`) return null;
  const structure = s.slice(0, el.start + 1) + newTag + s.slice(el.start + 1 + el.tag.length, closeAt + 2) + newTag + s.slice(closeAt + 2 + el.tag.length);
  return { ...p, structure };
}

const inCallout = (el: El | undefined) => !!closestEl(el, (e) => e.tag === 'div' && hasClass(e, 'callout'));

/* ---- 콜아웃 */

export const CALLOUT_KINDS = ['info', 'warn', 'accent'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
export const CALLOUT_KIND_LABEL: Record<CalloutKind, string> = { info: '정보', warn: '경고', accent: '강조' };

function calloutOf(structure: string, id: string): El | undefined {
  return closestEl(elById(structure, id), (e) => e.tag === 'div' && hasClass(e, 'callout'));
}

/** ID 가 속한(가장 가까운) 콜아웃의 종류. 콜아웃 안이 아니면 undefined, 종류 클래스가 없으면 ''. */
export function getCalloutKind(structure: string, id: string): string | undefined {
  const el = calloutOf(structure, id);
  if (!el) return undefined;
  const t = classTokens(el).find((c) => c.startsWith('callout-'));
  return t ? t.slice('callout-'.length) : '';
}

export function setCalloutKind(p: Project, id: string, kind: CalloutKind): Project | null {
  const el = calloutOf(p.structure, id);
  if (!el) return null;
  return replaceOpenTagClasses(p, el, (t) => {
    const first = t.findIndex((c) => c.startsWith('callout-'));
    if (first < 0) return [...t, `callout-${kind}`];
    return t.flatMap((c, i) => (!c.startsWith('callout-') ? [c] : i === first ? [`callout-${kind}`] : []));
  });
}

/* ---- 제목 */

export type HeadingLevel = 1 | 2 | 3;

/** 본문 제목(h1~h6)의 레벨. 콜아웃 제목(h3)이거나 제목이 아니면 undefined. */
export function getHeadingLevel(structure: string, id: string): number | undefined {
  const el = elById(structure, id);
  if (!el || !/^h[1-6]$/.test(el.tag) || inCallout(el)) return undefined;
  return Number(el.tag[1]);
}

export function setHeadingLevel(p: Project, id: string, level: HeadingLevel): Project | null {
  if (getHeadingLevel(p.structure, id) === undefined) return null;
  return renameTag(p, elById(p.structure, id)!, `h${level}`);
}

/* ---- 목록 */

/** ID(li 등)가 속한 가장 가까운 목록의 종류 */
export function getListType(structure: string, id: string): 'ul' | 'ol' | undefined {
  const l = closestEl(elById(structure, id), (e) => e.tag === 'ul' || e.tag === 'ol');
  return l ? (l.tag as 'ul' | 'ol') : undefined;
}

/** ID 가 속한 목록 한 레벨(중첩 목록은 안쪽/바깥쪽을 따로)만 ul↔ol 로 바꾼다. */
export function setListType(p: Project, id: string, type: 'ul' | 'ol'): Project | null {
  const l = closestEl(elById(p.structure, id), (e) => e.tag === 'ul' || e.tag === 'ol');
  return l ? renameTag(p, l, type) : null;
}

/* ---- 버튼 */

export const BUTTON_STYLES = ['primary', 'secondary', 'outline', 'warn', 'ghost'] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];
export const BUTTON_STYLE_LABEL: Record<ButtonStyle, string> = {
  primary: '기본(파랑 채움)',
  secondary: '보조(파랑 글자)',
  outline: '윤곽선(파랑 테두리)',
  warn: '회색 테두리',
  ghost: '회색 테두리(고스트)',
};

const isStyleClass = (c: string) => c.startsWith('btn-') && c !== 'btn-group';

function buttonEl(structure: string, id: string): El | undefined {
  const el = elById(structure, id);
  return el && el.tag === 'a' && hasClass(el, 'btn') ? el : undefined;
}

/** 버튼 스타일 이름(`btn-primary` → 'primary'). 버튼이 아니면 undefined, 스타일 클래스가 없으면 ''. */
export function getButtonStyle(structure: string, id: string): string | undefined {
  const el = buttonEl(structure, id);
  if (!el) return undefined;
  const t = classTokens(el).find(isStyleClass);
  return t ? t.slice(4) : '';
}

export function setButtonStyle(p: Project, id: string, style: ButtonStyle): Project | null {
  const el = buttonEl(p.structure, id);
  if (!el) return null;
  return replaceOpenTagClasses(p, el, (t) => {
    const i = t.findIndex(isStyleClass);
    if (i < 0) return [...t, `btn-${style}`];
    const out = [...t];
    out[i] = `btn-${style}`;
    return out;
  });
}

/** 안에 `a.btn` 만(사이는 공백만) 들어 있는 `<p>` 이면 그 앵커들 */
function buttonAnchors(structure: string, pEl: El): El[] | null {
  if (pEl.tag !== 'p') return null;
  const anchors = pEl.children.filter((c) => c.tag === 'a' && hasClass(c, 'btn'));
  if (anchors.length === 0 || anchors.length !== pEl.children.length) return null;
  let rest = structure.slice(pEl.innerStart, pEl.innerEnd);
  for (const a of [...anchors].reverse()) rest = rest.slice(0, a.start - pEl.innerStart) + rest.slice(a.end - pEl.innerStart);
  return rest.trim() === '' ? anchors : null;
}

export interface ButtonGroupInfo {
  /** 같은 `<p>` 안의 버튼 수 */
  count: number;
  /** 버튼이 둘 이상 묶여 있음(btn-group) */
  grouped: boolean;
  /** 바로 다음 형제가 버튼만 든 문단이라 합칠 수 있음 */
  canGroupWithNext: boolean;
}

function nextButtonParagraph(structure: string, roots: El[], pEl: El): El | null {
  const sibs = pEl.parent ? pEl.parent.children : roots;
  const next = sibs[sibs.indexOf(pEl) + 1];
  if (!next || !buttonAnchors(structure, next)) return null;
  if (structure.slice(pEl.end, next.start).trim() !== '') return null;
  return next;
}

function buttonParagraph(roots: El[], id: string): El | undefined {
  const a = find(roots, (e) => attrOf(e, 'data-t') === id && e.tag === 'a' && hasClass(e, 'btn'));
  return a?.parent;
}

export function getButtonGroupInfo(structure: string, id: string): ButtonGroupInfo | undefined {
  const roots = parseTree(structure);
  const pEl = buttonParagraph(roots, id);
  const anchors = pEl ? buttonAnchors(structure, pEl) : null;
  if (!pEl || !anchors) return undefined;
  return { count: anchors.length, grouped: anchors.length > 1, canGroupWithNext: nextButtonParagraph(structure, roots, pEl) !== null };
}

/** 버튼 그룹(`p.btn-group`)을 버튼마다 한 문단으로 푼다. 문자열 ID 는 그대로. */
export function ungroupButtons(p: Project, id: string): Project | null {
  const pEl = buttonParagraph(parseTree(p.structure), id);
  const anchors = pEl ? buttonAnchors(p.structure, pEl) : null;
  if (!pEl || !anchors || anchors.length < 2) return null;
  const rest = classTokens(pEl).filter((c) => c !== 'btn-group');
  const open = rest.length ? `<p class="${rest.join(' ')}">` : '<p>';
  const html = anchors.map((x) => `${open}${p.structure.slice(x.start, x.end)}</p>`).join('\n');
  return { ...p, structure: p.structure.slice(0, pEl.start) + html + p.structure.slice(pEl.end) };
}

/** 이 버튼의 문단과 바로 다음 버튼 문단을 하나의 `p.btn-group` 으로 합친다. */
export function groupButtonWithNext(p: Project, id: string): Project | null {
  const roots = parseTree(p.structure);
  const pEl = buttonParagraph(roots, id);
  const mine = pEl ? buttonAnchors(p.structure, pEl) : null;
  const next = pEl ? nextButtonParagraph(p.structure, roots, pEl) : null;
  const theirs = next ? buttonAnchors(p.structure, next) : null;
  if (!pEl || !mine || !next || !theirs) return null;
  const tokens = classTokens(pEl);
  const open = openTagWithClasses(p.structure, pEl, tokens.includes('btn-group') ? tokens : [...tokens, 'btn-group']);
  const html = open + [...mine, ...theirs].map((x) => p.structure.slice(x.start, x.end)).join('') + '</p>';
  return { ...p, structure: p.structure.slice(0, pEl.start) + html + p.structure.slice(next.end) };
}
