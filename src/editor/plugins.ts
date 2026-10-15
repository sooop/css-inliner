/**
 * 에디터 플러그인 조립. 프리셋은 필요한 조각만 가져온다(코드 블록·인라인 코드·이미지·HTML·GFM 표는 TXMD 에 없으므로 제외).
 * 키 입력 가로채기는 표 셀 이동(Tab/Enter)과 빈 버튼 Enter 뿐이며 조합 중에는 통과시킨다.
 */
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import {
  blockquoteKeymap,
  bulletListAttr,
  bulletListKeymap,
  bulletListSchema,
  docSchema,
  downgradeHeadingCommand,
  emphasisAttr,
  emphasisKeymap,
  emphasisSchema,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  hardbreakAttr,
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  hardbreakKeymap,
  hardbreakSchema,
  headingAttr,
  headingIdGenerator,
  headingKeymap,
  headingSchema,
  hrAttr,
  hrSchema,
  inlineNodesCursorPlugin,
  insertHardbreakCommand,
  insertHrCommand,
  insertHrInputRule,
  linkAttr,
  linkSchema,
  listItemKeymap,
  liftFirstListItemCommand,
  liftListItemCommand,
  orderedListAttr,
  orderedListKeymap,
  orderedListSchema,
  paragraphAttr,
  paragraphKeymap,
  paragraphSchema,
  sinkListItemCommand,
  splitListItemCommand,
  strongAttr,
  strongInputRule,
  strongKeymap,
  strongSchema,
  syncListOrderPlugin,
  textSchema,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBlockquoteInputRule,
  wrapInBulletListCommand,
  wrapInBulletListInputRule,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
  wrapInOrderedListInputRule,
} from '@milkdown/kit/preset/commonmark';
import { history } from '@milkdown/kit/plugin/history';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { markRule } from '@milkdown/kit/prose';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { gapCursor } from '@milkdown/kit/prose/gapcursor';
import { InputRule, textblockTypeInputRule } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, Selection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $inputRule, $mark, $prose, $useKeymap, $view } from '@milkdown/kit/utils';
import { enterInTable, exitEmptyButton, splitListItemKeepTrans, tabInTable } from './commands';
import { customNodes, transNode } from './schema';

const VAR_NAME = 'a-zA-Z0-9_가-힣.\\-';

/* ------------------------------------------------------------------ 취소선 마크 */

export const strikeMark = $mark('strike_through', () => ({
  parseDOM: [{ tag: 'del' }, { tag: 's' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (v: string) => (v === 'line-through') as false }],
  toDOM: () => ['del', 0],
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: { match: () => false, runner: () => {} },
}));

const strikeKeymap = $useKeymap('txStrikeKeymap', {
  ToggleStrike: {
    shortcuts: 'Mod-Shift-x',
    command: (ctx) => toggleMark(strikeMark.type(ctx)),
  },
});

/** `~~x~~` 만 취소선(TXMD 에서 단일 `~` 는 일반 문자: 월~금) */
const strikeInputRule = $inputRule((ctx) => markRule(/(?<![\w:/~])~~(?=[^\s~])(.+?)(?<=[^\s~])~~(?![\w/~])$/, strikeMark.type(ctx)));

/* ------------------------------------------------------------------ 입력 규칙 */

/** `#`·`##`·`###` + 공백 → 제목(TXMD 는 h1~h3) */
const headingInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^(#{1,3})\s$/, headingSchema.type(ctx), (m) => ({ level: m[1].length })),
);

const placeholderInputRule = $inputRule(
  (ctx) =>
    new InputRule(new RegExp(`\\|!#-([${VAR_NAME}]+)\\|$`), (state, match, start, end) => {
      const t = state.schema.nodes.placeholder;
      return state.tr.replaceWith(start, end, t.create({ name: match[1] }));
    }),
);

const rowVarInputRule = $inputRule(
  () =>
    new InputRule(new RegExp(`\\{\\{([${VAR_NAME}]+)\\}\\}$`), (state, match, start, end) => {
      const t = state.schema.nodes.rowvar;
      return state.tr.replaceWith(start, end, t.create({ name: match[1] }));
    }),
);

/* ------------------------------------------------------------------ 키맵(표·버튼) */

const txKeymap = $prose(() =>
  keymap({
    Tab: tabInTable(1),
    'Shift-Tab': tabInTable(-1),
    Enter: (state, dispatch, view) => enterInTable(state, dispatch, view) || exitEmptyButton(state, dispatch, view) || splitListItemKeepTrans(state, dispatch, view),
    // 브라우저 기본 Ctrl+End 는 문서 끝의 편집 불가 노드(번역 줄 노드뷰) 안으로 커서를 보낼 수 있어 직접 처리한다
    'Mod-End': (state, dispatch) => {
      dispatch?.(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
      return true;
    },
    'Mod-Home': (state, dispatch) => {
      dispatch?.(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
      return true;
    },
  }),
);

/* ------------------------------------------------------------------ 보정 플러그인 */

/** 제목은 h1~h3 만 쓴다(붙여넣기 등으로 h4 이상이 들어오면 h3 로) */
const clampHeading = $prose(
  () =>
    new Plugin({
      key: new PluginKey('TX_CLAMP_HEADING'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null;
        let tr = state.tr;
        let changed = false;
        state.doc.descendants((n, pos) => {
          if (n.type.name === 'heading' && n.attrs.level > 3) {
            tr = tr.setNodeMarkup(pos, undefined, { ...n.attrs, level: 3 });
            changed = true;
          }
        });
        return changed ? tr : null;
      },
    }),
);

/* ------------------------------------------------------------------ 번역 줄 노드뷰 */

const transView = $view(transNode, () => (node, view, getPos) => {
  let cur: PMNode = node;
  const dom = document.createElement('div');
  dom.className = 'tx-trans';
  dom.contentEditable = 'false';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const pre = document.createElement('pre');
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'tx-trans-del';
  del.textContent = '삭제';
  del.setAttribute('aria-label', '번역 줄 삭제');
  del.addEventListener('mousedown', (e) => e.preventDefault());
  del.addEventListener('click', () => {
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(view.state.tr.delete(pos, pos + cur.nodeSize));
    view.focus();
  });
  details.append(summary, pre);
  dom.append(details, del);
  const render = () => {
    const lines = (cur.attrs.lines as string[]) ?? [];
    dom.dataset.orphan = cur.attrs.orphan ? '1' : '';
    summary.textContent = cur.attrs.orphan
      ? `연결되지 않은 번역 줄 ${lines.length}줄 (무시됨 · 편집은 문자열 그리드에서)`
      : `번역 줄 ${lines.length}줄 (편집은 문자열 그리드에서)`;
    pre.textContent = lines.join('\n');
  };
  render();
  return {
    dom,
    update(n) {
      if (n.type !== cur.type) return false;
      cur = n;
      render();
      return true;
    },
    stopEvent: (e) => dom.contains(e.target as Node) && e.type !== 'dragstart',
    ignoreMutation: () => true,
  };
});

/* ------------------------------------------------------------------ 외부 알림 */

export interface EditorHooks {
  /** 문서가 바뀔 때마다(조합 중 포함) */
  onDoc?: (doc: PMNode, view: EditorView) => void;
  /** 상태가 바뀔 때마다(선택 이동 포함) — 툴바·슬래시 메뉴 갱신용 */
  onState?: (view: EditorView, prev: EditorState | null) => void;
  /** 키 입력(조합 중에는 호출되지 않는다). true 를 돌려주면 에디터 기본 처리를 막는다 */
  onKeyDown?: (view: EditorView, event: KeyboardEvent) => boolean;
}

const hooksPlugin = (hooks: EditorHooks) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('TX_HOOKS'),
        props: {
          handleKeyDown: (view, event) => (view.composing || event.isComposing || !hooks.onKeyDown ? false : hooks.onKeyDown(view, event)),
        },
        view: (v) => {
          hooks.onState?.(v, null);
          return {
            update(view, prev) {
              if (!view.state.doc.eq(prev.doc)) hooks.onDoc?.(view.state.doc, view);
              if (hooks.onState && (view.state.selection !== prev.selection || view.state.doc !== prev.doc)) hooks.onState(view, prev);
            },
          };
        },
      }),
  );

/* ------------------------------------------------------------------ 조립 */

const commonmark: MilkdownPlugin[] = [
  docSchema,
  paragraphAttr,
  paragraphSchema,
  headingIdGenerator,
  headingAttr,
  headingSchema,
  hardbreakAttr,
  hardbreakSchema,
  hrAttr,
  hrSchema,
  bulletListAttr,
  bulletListSchema,
  orderedListAttr,
  orderedListSchema,
  emphasisAttr,
  emphasisSchema,
  strongAttr,
  strongSchema,
  linkAttr,
  linkSchema,
  textSchema,
  // 입력 규칙
  wrapInBlockquoteInputRule,
  wrapInBulletListInputRule,
  wrapInOrderedListInputRule,
  insertHrInputRule,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  strongInputRule,
  // 명령
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
  downgradeHeadingCommand,
  insertHardbreakCommand,
  insertHrCommand,
  wrapInOrderedListCommand,
  wrapInBulletListCommand,
  sinkListItemCommand,
  splitListItemCommand,
  liftListItemCommand,
  liftFirstListItemCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  toggleLinkCommand,
  updateLinkCommand,
  // 키맵
  blockquoteKeymap,
  hardbreakKeymap,
  headingKeymap,
  listItemKeymap,
  orderedListKeymap,
  bulletListKeymap,
  paragraphKeymap,
  emphasisKeymap,
  strongKeymap,
  // 보조
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  inlineNodesCursorPlugin,
  syncListOrderPlugin,
].flat() as MilkdownPlugin[];

export function buildPlugins(hooks: EditorHooks = {}): MilkdownPlugin[] {
  return [
    ...commonmark,
    ...(customNodes as MilkdownPlugin[]),
    strikeMark,
    strikeKeymap,
    strikeInputRule,
    headingInputRule,
    placeholderInputRule,
    rowVarInputRule,
    transView,
    txKeymap,
    clampHeading,
    ...(history as MilkdownPlugin[]),
    ...(trailing as MilkdownPlugin[]),
    $prose(() => gapCursor()),
    hooksPlugin(hooks),
  ].flat() as MilkdownPlugin[];
}

