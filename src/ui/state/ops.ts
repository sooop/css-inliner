/**
 * 구조 조작(블록 추가·삭제·이동, 표 행 추가·삭제) — 순수 함수.
 * 모두 새 Project 를 돌려주며 모든 언어에 동시에 반영된다(구조는 언어 공통, 문자열은 ID 로 묶임).
 * 새 블록의 비기준 언어 문자열은 비어 시작한다(= 미번역, 내보내기 검사에서 오류로 잡힘).
 */
import { IdAllocator, hashText, listBlocks } from '../../markup/ids';
import type { Lang } from '../../markup/types';
import type { Project } from '../../project/model';
import { attrOf, descendantsOf, escAttr, find, hasAttr, hasClass, parseTree, walk, type El } from './html-tree';

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'button'
  | 'list'
  | 'table-h'
  | 'table-v'
  | 'table'
  | 'dynamic'
  | 'callout'
  | 'divider'
  | 'quote'
  | 'block';

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  heading: '제목',
  paragraph: '문단',
  button: '버튼',
  list: '목록',
  'table-h': '가로형 표',
  'table-v': '세로형 표',
  table: '표',
  dynamic: '동적 표',
  callout: '콜아웃',
  divider: '구분선',
  quote: '인용',
  block: '블록',
};

export interface TopBlock {
  index: number;
  el: El;
  tag: string;
  kind: BlockKind;
  /** 이 블록(중첩 포함)에 들어 있는 data-t ID, 문서 순서 */
  ids: string[];
  /** 이 블록 안의 동적 표 id */
  tableIds: string[];
}

/* ------------------------------------------------------------------ 컨테이너 / 블록 목록 */

const NEXT: Record<string, string[]> = { table: ['tbody', 'tr'], tbody: ['tr'], tr: ['td'] };

interface Container {
  innerStart: number;
  innerEnd: number;
  children: El[];
}

function isWrapperRoot(e: El): boolean {
  if (e.tag === 'main') return true;
  if (e.tag === 'table' || e.tag === 'div') return /wrap|container|outer|layout|mail/i.test(attrOf(e, 'class') ?? '');
  return false;
}

/**
 * '본문 블록'이 들어 있는 컨테이너. 우선순위:
 * 1) `data-blocks` 속성이 있는 요소(있으면 그것이 정답)
 * 1.5) 셸(wrapShell)로 감싼 구조: 안의 `<main>`
 * 2) 루트가 단일 래퍼(`main`, class 에 wrap/container 가 든 table·div)면 table>tbody>tr>td 를 따라 내려간 곳
 * 3) 루트 자체
 */
export function findContainer(html: string, roots: El[] = parseTree(html)): Container {
  const marked = find(roots, (e) => hasAttr(e, 'data-blocks'));
  if (marked) return { innerStart: marked.innerStart, innerEnd: marked.innerEnd, children: marked.children };
  // 메일 셸(wrapShell)은 본문을 단일 <main> 에 둔다
  const main = find(roots, (e) => e.tag === 'main');
  if (main) return { innerStart: main.innerStart, innerEnd: main.innerEnd, children: main.children };
  if (roots.length === 1 && isWrapperRoot(roots[0])) {
    let cur = roots[0];
    for (;;) {
      const next = NEXT[cur.tag];
      if (next && cur.children.length === 1 && next.includes(cur.children[0].tag)) cur = cur.children[0];
      else break;
    }
    return { innerStart: cur.innerStart, innerEnd: cur.innerEnd, children: cur.children };
  }
  return { innerStart: 0, innerEnd: html.length, children: roots };
}

export function kindOfElement(el: El): BlockKind {
  const tag = el.tag;
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'hr') return 'divider';
  if (tag === 'ul' || tag === 'ol') return 'list';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'p') return descendantsOf(el).some((d) => d.tag === 'a' && hasClass(d, 'btn')) ? 'button' : 'paragraph';
  if (tag === 'a' && hasClass(el, 'btn')) return 'button';
  if (tag === 'table') {
    if (descendantsOf(el).some((d) => d.tag === 'tbody' && attrOf(d, 'data-rows') !== undefined)) return 'dynamic';
    if (hasClass(el, 'table-horizontal')) return 'table-h';
    if (hasClass(el, 'table-vertical')) return 'table-v';
    return 'table';
  }
  if (tag === 'div' && hasClass(el, 'callout')) return 'callout';
  return 'block';
}

function idsIn(html: string, el: El): string[] {
  return listBlocks(html.slice(el.start, el.end)).map((b) => b.id);
}

function tableIdsIn(el: El): string[] {
  const out: string[] = [];
  const check = (e: El) => {
    if (e.tag === 'tbody') {
      const r = attrOf(e, 'data-rows');
      if (r !== undefined) out.push(r);
    }
  };
  check(el);
  walk(el.children, check);
  return out;
}

export function listTopBlocks(structure: string): TopBlock[] {
  const roots = parseTree(structure);
  const c = findContainer(structure, roots);
  return c.children.map((el, index) => ({
    index,
    el,
    tag: el.tag,
    kind: kindOfElement(el),
    ids: idsIn(structure, el),
    tableIds: tableIdsIn(el),
  }));
}

/** ID 가 들어 있는 최상위 블록 번호(없으면 -1) */
export function blockIndexOfId(structure: string, id: string): number {
  return listTopBlocks(structure).findIndex((b) => b.ids.includes(id));
}

/* ------------------------------------------------------------------ ID 종류 설명(그리드 '종류' 열) */

export type IdKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'th'
  | 'td'
  | 'button'
  | 'callout-title'
  | 'callout-body'
  | 'quote'
  | 'row-cell'
  | 'other';

export const ID_KIND_LABEL: Record<IdKind, string> = {
  heading: '제목',
  paragraph: '문단',
  'list-item': '목록 항목',
  th: '표 항목명',
  td: '표 값',
  button: '버튼',
  'callout-title': '콜아웃 제목',
  'callout-body': '콜아웃 본문',
  quote: '인용',
  'row-cell': '동적 표 행 문구',
  other: '문구',
};

/** 구조 안 모든 data-t ID 의 종류를 계산한다(콜아웃 안/밖 구분 포함). */
export function describeIds(structure: string): Map<string, IdKind> {
  const out = new Map<string, IdKind>();
  const roots = parseTree(structure);
  const visit = (el: El, inCallout: boolean, inQuote: boolean) => {
    const callout = inCallout || (el.tag === 'div' && hasClass(el, 'callout'));
    const quote = inQuote || el.tag === 'blockquote';
    const id = attrOf(el, 'data-t');
    if (id !== undefined) {
      let k: IdKind = 'other';
      if (/^h[1-6]$/.test(el.tag)) k = callout && el.tag === 'h3' ? 'callout-title' : 'heading';
      else if (el.tag === 'a') k = 'button';
      else if (el.tag === 'th') k = 'th';
      else if (el.tag === 'td') k = 'td';
      else if (el.tag === 'li') k = 'list-item';
      else if (el.tag === 'p') k = quote ? 'quote' : callout ? 'callout-body' : 'paragraph';
      out.set(id, k);
    }
    for (const c of el.children) visit(c, callout, quote);
  };
  for (const r of roots) visit(r, false, false);
  return out;
}

/* ------------------------------------------------------------------ 공통 보조 */

/** 본문 + 모든 행 템플릿 + 문자열 표에 있는 모든 블록 ID(ID 충돌 방지용) */
export function allBlockIds(p: Pick<Project, 'structure' | 'strings' | 'dynamicTables'>): string[] {
  const ids = new Set<string>(listBlocks(p.structure).map((b) => b.id));
  for (const t of p.dynamicTables ?? []) for (const b of listBlocks(t.rowStructure)) ids.add(b.id);
  for (const id of Object.keys(p.strings)) ids.add(id);
  return [...ids];
}

function removeRange(html: string, start: number, end: number): string {
  let s = start;
  while (s > 0 && (html[s - 1] === ' ' || html[s - 1] === '\t')) s--;
  let e = end;
  if (html[e] === '\r') e++;
  if (html[e] === '\n') e++;
  // 앞에서 들여쓰기만 지우고 줄바꿈은 남기므로, 뒤 줄바꿈까지 지워도 줄 구분은 유지된다
  return html.slice(0, s) + html.slice(e);
}

function dropIds(p: Project, ids: string[]): Pick<Project, 'strings' | 'sourceHash'> {
  const strings = { ...p.strings };
  const sourceHash = { ...p.sourceHash };
  for (const id of ids) {
    delete strings[id];
    delete sourceHash[id];
  }
  return { strings, sourceHash };
}

function withStrings(p: Project, id: string, texts: Record<Lang, string>): void {
  p.strings[id] = { ...texts };
  for (const [lang, text] of Object.entries(texts)) {
    if (lang !== p.baseLang && text) (p.sourceHash[id] ??= {})[lang] = hashText(texts[p.baseLang] ?? '');
  }
}

function cloneForWrite(p: Project): Project {
  return { ...p, strings: { ...p.strings }, sourceHash: { ...p.sourceHash } };
}

/* ------------------------------------------------------------------ 블록 이동 / 삭제 */

export function moveBlock(p: Project, index: number, dir: -1 | 1): Project | null {
  const blocks = listTopBlocks(p.structure);
  const j = index + dir;
  if (index < 0 || index >= blocks.length || j < 0 || j >= blocks.length) return null;
  const [lo, hi] = index < j ? [blocks[index].el, blocks[j].el] : [blocks[j].el, blocks[index].el];
  const s = p.structure;
  const structure = s.slice(0, lo.start) + s.slice(hi.start, hi.end) + s.slice(lo.end, hi.start) + s.slice(lo.start, lo.end) + s.slice(hi.end);
  return { ...p, structure };
}

export function removeBlock(p: Project, index: number): Project | null {
  const blocks = listTopBlocks(p.structure);
  const b = blocks[index];
  if (!b) return null;
  const rowIds: string[] = [];
  const dynamicTables = (p.dynamicTables ?? []).filter((t) => {
    if (!b.tableIds.includes(t.id)) return true;
    rowIds.push(...listBlocks(t.rowStructure).map((x) => x.id));
    return false;
  });
  return {
    ...p,
    structure: removeRange(p.structure, b.el.start, b.el.end),
    dynamicTables,
    ...dropIds(p, [...b.ids, ...rowIds]),
  };
}

/* ------------------------------------------------------------------ 블록 추가 */

export type AddKind = 'paragraph' | 'heading' | 'callout' | 'button' | 'list' | 'table-v' | 'divider';

export const ADD_KIND_LABEL: Record<AddKind, string> = {
  paragraph: '문단',
  heading: '소제목',
  callout: '콜아웃',
  button: '버튼',
  list: '목록',
  'table-v': '세로형 표',
  divider: '구분선',
};

interface Template {
  defaults: string[];
  html: (ids: string[]) => string;
}

const TEMPLATES: Record<AddKind, Template> = {
  paragraph: { defaults: ['새 문단'], html: ([a]) => `<p data-t="${a}"></p>` },
  heading: { defaults: ['새 소제목'], html: ([a]) => `<h2 data-t="${a}"></h2>` },
  callout: {
    defaults: ['새 콜아웃 제목', '콜아웃 내용을 입력하세요.'],
    html: ([a, b]) => `<div class="callout callout-info">\n<h3 data-t="${a}"></h3>\n<p data-t="${b}"></p>\n</div>`,
  },
  button: {
    defaults: ['새 버튼'],
    html: ([a]) => `<p><a href="#" class="btn btn-primary" data-t="${a}"></a></p>`,
  },
  list: { defaults: ['새 항목'], html: ([a]) => `<ul>\n<li data-t="${a}"></li>\n</ul>` },
  'table-v': {
    defaults: ['새 항목', '값', '새 항목', '값'],
    html: ([a, b, c, d]) =>
      `<table class="table-vertical">\n<tr>\n<th data-t="${a}"></th>\n<td data-t="${b}"></td>\n</tr>\n<tr>\n<th data-t="${c}"></th>\n<td data-t="${d}"></td>\n</tr>\n</table>`,
  },
  divider: { defaults: [], html: () => '<hr>' },
};

export function slotCount(kind: AddKind): number {
  return TEMPLATES[kind].defaults.length;
}

export interface InsertResult {
  project: Project;
  ids: string[];
  /** 삽입된 블록의 번호 */
  index: number;
}

/**
 * 블록 삽입. `afterIndex` 가 null 이면 맨 끝, -1 이면 맨 앞.
 * `texts`: 언어별 슬롯 문자열(없으면 기준 언어에 기본 문구, 다른 언어는 비움).
 */
export function insertBlock(
  p: Project,
  kind: AddKind,
  afterIndex: number | null,
  texts?: Record<Lang, string[]>,
): InsertResult {
  const tpl = TEMPLATES[kind];
  const alloc = new IdAllocator(allBlockIds(p));
  const ids = tpl.defaults.map(() => alloc.next());
  const blocks = listTopBlocks(p.structure);
  const c = findContainer(p.structure);
  const html = tpl.html(ids);
  const s = p.structure;
  let at: number;
  let insertText: string;
  let index: number;
  if (blocks.length === 0) {
    at = c.innerStart;
    insertText = '\n' + html + '\n';
    index = 0;
  } else if (afterIndex === -1) {
    at = blocks[0].el.start;
    insertText = html + '\n';
    index = 0;
  } else {
    const i = afterIndex === null ? blocks.length - 1 : Math.min(afterIndex, blocks.length - 1);
    at = blocks[i].el.end;
    insertText = '\n' + html;
    index = i + 1;
  }
  const next = cloneForWrite(p);
  next.structure = s.slice(0, at) + insertText + s.slice(at);
  const langs = new Set<Lang>([p.baseLang, ...Object.keys(texts ?? {})]);
  ids.forEach((id, i) => {
    const byLang: Record<Lang, string> = {};
    for (const l of langs) {
      const v = texts?.[l]?.[i] ?? (l === p.baseLang ? tpl.defaults[i] : '');
      if (v !== '' || l === p.baseLang) byLang[l] = v;
    }
    withStrings(next, id, byLang);
  });
  return { project: next, ids, index };
}

/* ------------------------------------------------------------------ 표 행 */

function staticTableRows(table: El): El[] {
  // 동적 표(tbody[data-rows])의 행은 제외, 머리글 행(thead)은 제외
  const rows: El[] = [];
  walk(table.children, (e) => {
    if (e.tag !== 'tr') return;
    let a = e.parent;
    while (a && a !== table) {
      if (a.tag === 'thead') return;
      if (a.tag === 'tbody' && attrOf(a, 'data-rows') !== undefined) return;
      a = a.parent;
    }
    rows.push(e);
  });
  return rows;
}

function cloneRowWithNewIds(p: Project, row: El, alloc: IdAllocator): { html: string; ids: string[]; texts: Record<string, string> } {
  const src = p.structure.slice(row.start, row.end);
  const ids: string[] = [];
  const texts: Record<string, string> = {};
  const html = src.replace(/(<(th|td)\b[^>]*?\sdata-t=")([^"]*)(")/gi, (_m, a: string, tag: string, _old: string, d: string) => {
    const id = alloc.next();
    ids.push(id);
    texts[id] = tag.toLowerCase() === 'th' ? '새 항목' : '-';
    return a + id + d;
  });
  return { html, ids, texts };
}

/** 선택한 최상위 블록이 (정적) 표이면 마지막 데이터 행을 복제해 한 행을 추가한다. */
export function addTableRow(p: Project, blockIndex: number): InsertResult | null {
  const b = listTopBlocks(p.structure)[blockIndex];
  if (!b || !['table-h', 'table-v', 'table'].includes(b.kind)) return null;
  return addRowInTable(p, b.el, blockIndex);
}

function addRowInTable(p: Project, table: El, index: number): InsertResult | null {
  const rows = staticTableRows(table);
  const last = rows[rows.length - 1];
  if (!last) return null;
  const alloc = new IdAllocator(allBlockIds(p));
  const { html, ids, texts } = cloneRowWithNewIds(p, last, alloc);
  const next = cloneForWrite(p);
  next.structure = p.structure.slice(0, last.end) + '\n' + html + p.structure.slice(last.end);
  for (const id of ids) withStrings(next, id, { [p.baseLang]: texts[id] });
  return { project: next, ids, index };
}

/** 문자열 ID 가 속한 정적 표의 `tr` 와 표를 찾는다. 동적 표 행 템플릿 쪽은 대상이 아니다. */
function rowOfId(structure: string, id: string): { table: El; row: El } | null {
  const roots = parseTree(structure);
  const el = find(roots, (e) => attrOf(e, 'data-t') === id);
  if (!el) return null;
  let row: El | undefined;
  let a: El | undefined = el;
  while (a) {
    if (a.tag === 'tr' && !row) row = a;
    if (a.tag === 'table') return row ? { table: a, row } : null;
    a = a.parent;
  }
  return null;
}

/** ID 가 표 행 안에 있고 그 정적 표의 데이터 행이 2개 이상이면 true */
export function canRemoveTableRow(p: Project, id: string): boolean {
  const r = rowOfId(p.structure, id);
  if (!r) return false;
  const rows = staticTableRows(r.table);
  return rows.includes(r.row) && rows.length > 1;
}

export function removeTableRow(p: Project, id: string): Project | null {
  const r = rowOfId(p.structure, id);
  if (!r || !canRemoveTableRow(p, id)) return null;
  const ids = listBlocks(p.structure.slice(r.row.start, r.row.end)).map((b) => b.id);
  return { ...p, structure: removeRange(p.structure, r.row.start, r.row.end), ...dropIds(p, ids) };
}

/* ------------------------------------------------------------------ 속성(버튼 링크) */

export function getBlockAttr(structure: string, id: string, name: string): string | undefined {
  const el = find(parseTree(structure), (e) => attrOf(e, 'data-t') === id);
  if (!el) return undefined;
  const v = attrOf(el, name);
  return v === undefined ? undefined : v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** data-t 가 id 인 요소의 속성 값을 바꾼다(없으면 추가). 구조의 다른 부분은 바이트 단위로 보존된다. */
export function setBlockAttr(p: Project, id: string, name: string, value: string): Project | null {
  const el = find(parseTree(p.structure), (e) => attrOf(e, 'data-t') === id);
  if (!el) return null;
  const open = p.structure.slice(el.start, el.start + 1 + el.tag.length + el.attrs.length + 1);
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, 'i');
  const enc = ` ${name}="${escAttr(value)}"`;
  const newOpen = re.test(el.attrs)
    ? open.replace(re, (_m, a: string) => `${a}"${escAttr(value)}"`)
    : open.replace(/\s*\/?>$/, (end) => enc + end);
  return { ...p, structure: p.structure.slice(0, el.start) + newOpen + p.structure.slice(el.start + open.length) };
}

/* 블록 속성(콜아웃 종류·제목 레벨·목록 순서·버튼) */
export * from './block-props';
