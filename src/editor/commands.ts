/**
 * 툴바·슬래시 메뉴·키맵이 쓰는 ProseMirror 명령. Milkdown ctx 에 의존하지 않고 (state, dispatch) 만 쓴다.
 * 키 처리는 Tab/Enter(표 안)·Enter(빈 버튼)뿐이며 조합(IME) 중에는 개입하지 않는다.
 */
import type { Node as PMNode, NodeType, Schema } from '@milkdown/kit/prose/model';
import { Fragment } from '@milkdown/kit/prose/model';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

export type Dispatch = (tr: Transaction) => void;
export type Cmd = (state: EditorState, dispatch?: Dispatch, view?: EditorView) => boolean;

/* ------------------------------------------------------------------ 조상 찾기 */

export interface Found {
  node: PMNode;
  pos: number; // 노드 앞 위치
  depth: number;
}

export function findAncestor(state: EditorState, names: string | string[]): Found | null {
  const list = Array.isArray(names) ? names : [names];
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (list.includes(node.type.name)) return { node, pos: d === 0 ? 0 : $from.before(d), depth: d };
  }
  return null;
}

/** 선택이 NodeSelection 으로 노드 자체를 가리키는 경우도 포함 */
export function selectedOrAncestor(state: EditorState, names: string | string[]): Found | null {
  const list = Array.isArray(names) ? names : [names];
  const sel = state.selection as Selection & { node?: PMNode };
  if (sel.node && list.includes(sel.node.type.name)) return { node: sel.node, pos: sel.from, depth: state.doc.resolve(sel.from).depth + 1 };
  return findAncestor(state, list);
}

/* ------------------------------------------------------------------ 블록 삽입 */

/** 현재 위치 뒤(빈 문단이면 그 문단 자리)에 블록을 넣는다. 커서는 새 블록 안 첫 텍스트 자리로 */
export function insertBlock(state: EditorState, dispatch: Dispatch | undefined, node: PMNode, cursor: 'inside' | 'after' = 'inside'): boolean {
  const { $from } = state.selection;
  let from = -1;
  let to = -1;
  for (let d = $from.depth; d >= 1; d--) {
    const parent = $from.node(d - 1);
    const idx = $from.index(d - 1);
    const cur = $from.node(d);
    if (d === $from.depth && cur.type.name === 'paragraph' && cur.content.size === 0 && parent.canReplaceWith(idx, idx + 1, node.type)) {
      from = $from.before(d);
      to = $from.after(d);
      break;
    }
    if (parent.canReplaceWith(idx + 1, idx + 1, node.type)) {
      from = to = $from.after(d);
      break;
    }
  }
  if (from < 0) {
    const pos = state.selection.to;
    const $p = state.doc.resolve(pos);
    if (!$p.parent.canReplaceWith($p.index(), $p.index(), node.type)) return false;
    from = to = pos;
  }
  if (!dispatch) return true;
  const tr = state.tr.replaceWith(from, to, node);
  if (cursor === 'inside') tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + 1, tr.doc.content.size)), 1));
  else tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + node.nodeSize, tr.doc.content.size)), 1));
  dispatch(tr.scrollIntoView());
  return true;
}

const cell = (s: Schema, text = '') => s.nodes.table_cell.create(null, text ? s.text(text) : undefined);
const row = (s: Schema, cells: PMNode[], head = false) => s.nodes.table_row.create({ head }, cells);
const paragraph = (s: Schema, text = '') => s.nodes.paragraph.create(null, text ? s.text(text) : undefined);

export const makeCallout = (s: Schema, kind: string): PMNode =>
  // 본문 문단은 만들지 않는다: 제목 끝에서 Enter 로 만들고, 빈 마지막 문단에서 Enter 로 콜아웃을 빠져나간다
  s.nodes.callout.create({ kind }, [s.nodes.callout_title.create()]);

export const makeVerticalTable = (s: Schema): PMNode =>
  s.nodes.table_v.create(null, [row(s, [cell(s, '항목'), cell(s, '값')]), row(s, [cell(s), cell(s)])]);

export const makeHorizontalTable = (s: Schema): PMNode =>
  s.nodes.table_h.create({ dyn: null }, [
    row(s, [cell(s, '항목'), cell(s, '내용'), cell(s, '비고')], true),
    row(s, [cell(s), cell(s), cell(s)]),
  ]);

export function nextDynId(doc: PMNode): string {
  const used = new Set<string>();
  doc.descendants((n) => {
    if (n.type.name === 'table_h' && n.attrs.dyn) used.add(String(n.attrs.dyn));
  });
  for (let i = 1; ; i++) if (!used.has(`rows${i}`)) return `rows${i}`;
}

export const makeDynamicTable = (s: Schema, id: string): PMNode => {
  const rv = (name: string, suffix = '') => [s.nodes.rowvar.create({ name }), ...(suffix ? [s.text(suffix)] : [])];
  return s.nodes.table_h.create({ dyn: id }, [
    row(s, [cell(s, '상품명'), cell(s, '수량'), cell(s, '금액')], true),
    s.nodes.table_row.create({ head: false }, [
      s.nodes.table_cell.create(null, rv('name')),
      s.nodes.table_cell.create(null, rv('qty', '개')),
      s.nodes.table_cell.create(null, rv('amount', '원')),
    ]),
    s.nodes.txmd_raw.create(null, s.text('@var name 상품명\n@var qty 수량\n@var amount 금액\n@sample name=예시 상품| qty=1| amount=1,000')),
  ]);
};

export const makeButtonGroup = (s: Schema): PMNode =>
  s.nodes.button_group.create(null, [s.nodes.button.create({ url: '#', style: '' }, s.text('버튼'))]);

export const makeQuote = (s: Schema): PMNode => s.nodes.blockquote.create(null, [paragraph(s)]);
export const makeHr = (s: Schema): PMNode => s.nodes.hr.create();

/** 선택 범위의 속성을 바꾼다(콜아웃 종류·표 동적 id·버튼 링크/스타일) */
export function setNodeAttrs(name: string | string[], attrs: Record<string, unknown>): Cmd {
  return (state, dispatch) => {
    const f = selectedOrAncestor(state, name);
    if (!f) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(f.pos, undefined, { ...f.node.attrs, ...attrs }));
    return true;
  };
}

/* ------------------------------------------------------------------ 인라인 원자 */

export function insertInlineAtom(type: 'placeholder' | 'rowvar', name: string): Cmd {
  return (state, dispatch) => {
    const t: NodeType = state.schema.nodes[type];
    const { $from } = state.selection;
    if (!$from.parent.inlineContent) return false;
    const atom = t.create({ name });
    if (!$from.parent.canReplaceWith($from.index(), $from.index(), t)) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(atom, false).scrollIntoView());
    return true;
  };
}

/* ------------------------------------------------------------------ 표 */

interface CellPos {
  row: number;
  col: number;
  /** 셀 노드 앞 위치 */
  pos: number;
}

function cellGrid(table: Found): CellPos[][] {
  const grid: CellPos[][] = [];
  let ri = 0;
  table.node.forEach((child, offset) => {
    if (child.type.name !== 'table_row') return;
    const rowPos = table.pos + 1 + offset;
    const cells: CellPos[] = [];
    child.forEach((_c, o, ci) => cells.push({ row: ri, col: ci, pos: rowPos + 1 + o }));
    grid.push(cells);
    ri++;
  });
  return grid;
}

export function currentCell(state: EditorState): { table: Found; grid: CellPos[][]; row: number; col: number } | null {
  const table = findAncestor(state, ['table_h', 'table_v']);
  const cellF = findAncestor(state, 'table_cell');
  if (!table || !cellF) return null;
  const grid = cellGrid(table);
  for (const r of grid) for (const c of r) if (c.pos === cellF.pos) return { table, grid, row: c.row, col: c.col };
  return null;
}

const cursorIn = (tr: Transaction, cellPos: number) => tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1), 1));

export const isDynamic = (t: Found) => t.node.type.name === 'table_h' && !!t.node.attrs.dyn;

export const addTableRow: Cmd = (state, dispatch) => {
  const cc = currentCell(state);
  if (!cc || isDynamic(cc.table)) return false;
  const rowF = findAncestor(state, 'table_row')!;
  if (dispatch) {
    const cells: PMNode[] = [];
    for (let i = 0; i < rowF.node.childCount; i++) cells.push(state.schema.nodes.table_cell.create());
    const at = rowF.pos + rowF.node.nodeSize;
    const tr = state.tr.insert(at, row(state.schema, cells));
    cursorIn(tr, at + 1);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const deleteTableRow: Cmd = (state, dispatch) => {
  const cc = currentCell(state);
  if (!cc) return false;
  const horizontal = cc.table.node.type.name === 'table_h';
  if (horizontal && cc.row === 0) return false; // 머리글 행
  if (!horizontal && cc.grid.length <= 1) return false;
  if (horizontal && isDynamic(cc.table) && cc.grid.length <= 2) return false; // 행 템플릿은 최소 1행
  const rowF = findAncestor(state, 'table_row')!;
  if (dispatch) {
    const tr = state.tr.delete(rowF.pos, rowF.pos + rowF.node.nodeSize);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const addTableColumn: Cmd = (state, dispatch) => {
  const cc = currentCell(state);
  if (!cc || cc.table.node.type.name !== 'table_h') return false;
  if (dispatch) {
    const tr = state.tr;
    // 뒤에서부터 넣어야 앞쪽 위치가 밀리지 않는다
    for (let r = cc.grid.length - 1; r >= 0; r--) {
      const target = cc.grid[r][cc.col];
      if (!target) continue;
      const node = state.doc.nodeAt(target.pos)!;
      tr.insert(target.pos + node.nodeSize, state.schema.nodes.table_cell.create());
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const deleteTableColumn: Cmd = (state, dispatch) => {
  const cc = currentCell(state);
  if (!cc || cc.table.node.type.name !== 'table_h') return false;
  if (cc.grid[0].length <= 1) return false;
  if (dispatch) {
    const tr = state.tr;
    for (let r = cc.grid.length - 1; r >= 0; r--) {
      const target = cc.grid[r][cc.col];
      if (!target) continue;
      const node = state.doc.nodeAt(target.pos)!;
      tr.delete(target.pos, target.pos + node.nodeSize);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const flat = (grid: CellPos[][]) => grid.flat();

/** Tab / Shift+Tab: 셀 이동. 마지막 셀에서 Tab 은 새 행(가능할 때) */
export const tabInTable = (dir: 1 | -1): Cmd => (state, dispatch, view) => {
  if (view?.composing) return false;
  const cc = currentCell(state);
  if (!cc) return false;
  const cells = flat(cc.grid);
  const at = cells.findIndex((c) => c.row === cc.row && c.col === cc.col);
  const next = cells[at + dir];
  if (next) {
    if (dispatch) dispatch(cursorIn(state.tr, next.pos).scrollIntoView());
    return true;
  }
  if (dir === 1 && !isDynamic(cc.table)) return addTableRow(state, dispatch, view);
  return true; // 표 밖으로 나가지 않는다(포커스 이동은 Esc/방향키)
};

/** Enter: 같은 열의 다음 행 셀로. 셀 안에서는 줄바꿈이 없다 */
export const enterInTable: Cmd = (state, dispatch, view) => {
  if (view?.composing) return false;
  const cc = currentCell(state);
  if (!cc) return false;
  const below = cc.grid[cc.row + 1]?.[cc.col];
  if (below) {
    if (dispatch) dispatch(cursorIn(state.tr, below.pos).scrollIntoView());
    return true;
  }
  if (!isDynamic(cc.table) && cc.table.node.type.name === 'table_h') return addTableRow(state, dispatch, view);
  return true;
};

/* ------------------------------------------------------------------ 버튼 */

/** 빈 버튼에서 Enter: 그룹에 버튼이 더 있으면 빈 버튼을 지우고 그룹 뒤로 나간다 */
export const exitEmptyButton: Cmd = (state, dispatch, view) => {
  if (view?.composing) return false;
  const btn = findAncestor(state, 'button');
  if (!btn || btn.node.content.size !== 0) return false;
  const group = findAncestor(state, 'button_group');
  if (!group) return false;
  let buttons = 0;
  group.node.forEach((c) => {
    if (c.type.name === 'button') buttons++;
  });
  if (buttons < 2) return false;
  if (dispatch) {
    const tr = state.tr.delete(btn.pos, btn.pos + btn.node.nodeSize);
    const groupEnd = tr.mapping.map(group.pos + group.node.nodeSize);
    const $end = tr.doc.resolve(Math.min(groupEnd, tr.doc.content.size));
    const next = $end.nodeAfter;
    if (!next || next.type.name !== 'paragraph') tr.insert($end.pos, state.schema.nodes.paragraph.create());
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.mapping.map(groupEnd), tr.doc.content.size)), 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------ 문서 조작 */

export function emptyParagraphFragment(s: Schema): Fragment {
  return Fragment.from(paragraph(s));
}

/**
 * 번역 줄(txmd_trans)이 붙은 목록 항목의 끝에서 Enter: 기본 동작은 뒤따르는 노드(번역 줄·중첩 목록)를 새 항목으로 옮겨
 * 번역이 엉뚱한 항목에 붙거나(빈 항목이면 출력 때 사라진다) 잃게 된다. 대신 항목 전체 뒤에 새 항목을 만든다.
 */
export const splitListItemKeepTrans: Cmd = (state, dispatch, view) => {
  if (view?.composing) return false;
  const sel = state.selection;
  if (!sel.empty) return false;
  const { $from } = sel;
  if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
  if ($from.depth < 2) return false;
  const item = $from.node(-1);
  if (item.type.name !== 'list_item') return false;
  let hasTrans = false;
  item.forEach((c) => {
    if (c.type.name === 'txmd_trans') hasTrans = true;
  });
  if (!hasTrans || $from.parent.content.size === 0) return false;
  if (dispatch) {
    const itemEnd = $from.after(-1);
    const fresh = item.type.create(item.attrs, state.schema.nodes.paragraph.create());
    const tr = state.tr.insert(itemEnd, fresh);
    tr.setSelection(TextSelection.near(tr.doc.resolve(itemEnd + 2), 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};
