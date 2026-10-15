/** 툴바·문맥 막대·슬래시 메뉴가 보는 에디터 상태 스냅샷(ProseMirror 상태에서 계산) */
import type { Mark } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { currentCell, findAncestor, isDynamic, selectedOrAncestor } from './commands';

export interface UiState {
  block: 'paragraph' | 'h1' | 'h2' | 'h3' | 'other';
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: string | null;
  inList: 'bullet' | 'ordered' | null;
  inQuote: boolean;
  callout: string | null;
  table: null | { type: 'h' | 'v'; dyn: string | null; canAddRow: boolean; canDeleteRow: boolean; canAddCol: boolean; canDeleteCol: boolean };
  button: null | { url: string; style: string };
  /** 인라인 텍스트를 입력할 수 있는 자리인가(치환자 삽입 가능) */
  inline: boolean;
  /** 동적 표 안인가(행 변수 삽입 가능) */
  inDynamic: boolean;
  inRaw: boolean;
  selEmpty: boolean;
}

const hasMark = (state: EditorState, name: string): Mark | null => {
  const type = state.schema.marks[name];
  if (!type) return null;
  const { from, $from, to, empty } = state.selection;
  if (empty) return type.isInSet(state.storedMarks || $from.marks()) ?? null;
  let found: Mark | null = null;
  state.doc.nodesBetween(from, to, (n) => {
    if (!found && n.isInline) found = type.isInSet(n.marks) ?? null;
  });
  return found;
};

export function computeUi(state: EditorState): UiState {
  const { $from } = state.selection;
  const parent = $from.parent;
  let block: UiState['block'] = 'other';
  if (parent.type.name === 'paragraph') block = 'paragraph';
  else if (parent.type.name === 'heading') block = (`h${Math.min(3, parent.attrs.level)}` as UiState['block']);

  const list = findAncestor(state, ['bullet_list', 'ordered_list']);
  const callout = findAncestor(state, 'callout');
  const cc = currentCell(state);
  const btn = selectedOrAncestor(state, 'button');
  const link = hasMark(state, 'link');
  let table: UiState['table'] = null;
  if (cc) {
    const horizontal = cc.table.node.type.name === 'table_h';
    const dyn = isDynamic(cc.table);
    table = {
      type: horizontal ? 'h' : 'v',
      dyn: dyn ? String(cc.table.node.attrs.dyn) : null,
      canAddRow: !dyn,
      canDeleteRow: horizontal ? cc.row > 0 && (!dyn || cc.grid.length > 2) : cc.grid.length > 1,
      canAddCol: horizontal,
      canDeleteCol: horizontal && cc.grid[0].length > 1,
    };
  } else {
    const t = selectedOrAncestor(state, ['table_h', 'table_v']);
    if (t) table = { type: t.node.type.name === 'table_h' ? 'h' : 'v', dyn: t.node.attrs.dyn ?? null, canAddRow: false, canDeleteRow: false, canAddCol: false, canDeleteCol: false };
  }
  return {
    block,
    bold: !!hasMark(state, 'strong'),
    italic: !!hasMark(state, 'emphasis'),
    strike: !!hasMark(state, 'strike_through'),
    link: link ? String(link.attrs.href) : null,
    inList: list ? (list.node.type.name === 'ordered_list' ? 'ordered' : 'bullet') : null,
    inQuote: !!findAncestor(state, 'blockquote'),
    callout: callout ? String(callout.node.attrs.kind) : null,
    table,
    button: btn ? { url: String(btn.node.attrs.url ?? ''), style: String(btn.node.attrs.style ?? '') } : null,
    inline: parent.inlineContent && parent.type.name !== 'txmd_raw',
    inDynamic: !!cc && isDynamic(cc.table),
    inRaw: parent.type.name === 'txmd_raw',
    selEmpty: state.selection.empty,
  };
}

/** 슬래시 메뉴: 문단 맨 앞의 `/검색어` */
export interface SlashState {
  from: number;
  to: number;
  query: string;
}

export function slashAt(state: EditorState): SlashState | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (parent.type.name !== 'paragraph') return null;
  const before = parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const m = /^\/([^\s/￼]*)$/.exec(before);
  if (!m) return null;
  return { from: $from.start(), to: $from.pos, query: m[1] };
}

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
}

export const BLOCK_ITEMS: MenuItem[] = [
  { id: 'callout:정보', label: '콜아웃: 정보', hint: '파란 안내 상자', keywords: 'callout info 정보 콜아웃 안내' },
  { id: 'callout:경고', label: '콜아웃: 경고', hint: '노란 주의 상자', keywords: 'callout warn 경고 콜아웃 주의' },
  { id: 'callout:강조', label: '콜아웃: 강조', hint: '강조 상자', keywords: 'callout accent 강조 콜아웃' },
  { id: 'table-v', label: '표: 세로형', hint: '항목 | 값 쌍', keywords: 'table vertical 표 세로형 테이블' },
  { id: 'table-h', label: '표: 가로형', hint: '머리글 + 행', keywords: 'table horizontal 표 가로형 테이블' },
  { id: 'table-dyn', label: '표: 동적(행 템플릿)', hint: '서버가 행을 채우는 표', keywords: 'table dynamic 표 동적 행 템플릿' },
  { id: 'button', label: '버튼', hint: '링크 버튼(연속하면 그룹)', keywords: 'button 버튼 링크' },
  { id: 'quote', label: '인용', hint: '인용 블록', keywords: 'quote 인용' },
  { id: 'hr', label: '구분선', hint: '---', keywords: 'hr divider 구분선 줄' },
];

export const SLASH_ITEMS: MenuItem[] = [
  { id: 'h1', label: '제목 1', keywords: 'heading h1 제목' },
  { id: 'h2', label: '제목 2', keywords: 'heading h2 제목' },
  { id: 'h3', label: '제목 3', keywords: 'heading h3 제목' },
  { id: 'bullet', label: '글머리 목록', keywords: 'list bullet 목록 글머리' },
  { id: 'ordered', label: '번호 목록', keywords: 'list ordered 번호 목록' },
  ...BLOCK_ITEMS,
];

export function filterItems(items: MenuItem[], q: string): MenuItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter((i) => (i.label + ' ' + i.keywords).toLowerCase().includes(s));
}
