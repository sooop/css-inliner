/**
 * TXMD 전용 노드 스키마(Milkdown `$node`). 기본 CommonMark 요소(문단·제목·목록·강조·링크·구분선·줄바꿈)는
 * Milkdown 프리셋을 쓰고(plugins.ts), 문법이 다른 인용·목록 항목은 여기서 덮어쓴다.
 *
 * 문서 <-> .txmd 변환은 remark 를 거치지 않는다(load.ts / serialize.ts). 그래서 `parseMarkdown`/`toMarkdown` 은
 * Milkdown 이 요구하는 자리만 채운 빈 구현이다(호출되지 않는다).
 */
import type { NodeSchema } from '@milkdown/kit/transformer';
import { $node } from '@milkdown/kit/utils';

const noMd = {
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: { match: () => false, runner: () => {} },
};

export const CALLOUT_KINDS = ['정보', '경고', '강조'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
export const CALLOUT_CSS: Record<string, string> = { 정보: 'info', 경고: 'warn', 강조: 'accent' };

/** 콜아웃 본문에 올 수 있는 블록(콜아웃 중첩 불가) */
const CALLOUT_BODY = 'paragraph | heading | blockquote | bullet_list | ordered_list | hr | table_h | table_v | button_group | txmd_raw | txmd_trans';
const CELL_INLINE = '(text | cellInline)*';

const spec = (s: Omit<NodeSchema, 'parseMarkdown' | 'toMarkdown'>): NodeSchema => ({ ...s, ...noMd }) as NodeSchema;

const dataAttr = (dom: HTMLElement | string, name: string) => (typeof dom === 'string' ? null : dom.getAttribute(name));

/* ------------------------------------------------------------------ 인라인 원자 */

export const placeholderNode = $node('placeholder', () =>
  spec({
    group: 'inline cellInline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: { name: { default: '' } },
    parseDOM: [{ tag: 'span[data-tx-ph]', getAttrs: (d) => ({ name: dataAttr(d, 'data-tx-ph') ?? '' }) }],
    toDOM: (n) => ['span', { class: 'tx-ph', 'data-tx-ph': n.attrs.name, title: `치환자 ${n.attrs.name} (편집 불가, Backspace 로 삭제)` }, `|!#-${n.attrs.name}|`],
    leafText: (n) => `|!#-${n.attrs.name}|`,
  }),
);

export const rowVarNode = $node('rowvar', () =>
  spec({
    group: 'inline cellInline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: { name: { default: '' } },
    parseDOM: [{ tag: 'span[data-tx-rv]', getAttrs: (d) => ({ name: dataAttr(d, 'data-tx-rv') ?? '' }) }],
    toDOM: (n) => ['span', { class: 'tx-rv', 'data-tx-rv': n.attrs.name, title: `행 변수 ${n.attrs.name} (편집 불가)` }, `{{${n.attrs.name}}}`],
    leafText: (n) => `{{${n.attrs.name}}}`,
  }),
);

/* ------------------------------------------------------------------ 프리셋을 덮는 노드 */

/** TXMD 인용은 `<blockquote><p>` 한 덩어리(여러 줄은 줄바꿈). 번역 줄은 인용 뒤에 붙는다 */
export const blockquoteNode = $node('blockquote', () =>
  spec({
    content: 'paragraph txmd_trans?',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', { class: 'tx-quote' }, 0],
  }),
);

/** 목록 항목: 본문 한 줄 + (번역 줄) + 중첩 목록. 프리셋의 label/listType 속성은 그대로 유지(목록 번호 동기화 플러그인이 쓴다) */
export const listItemNode = $node('list_item', () =>
  spec({
    group: 'listItem',
    content: 'paragraph txmd_trans? (bullet_list | ordered_list)*',
    attrs: {
      label: { default: '•' },
      listType: { default: 'bullet' },
      spread: { default: false },
    },
    defining: true,
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (dom) => ({
          label: dataAttr(dom, 'data-label') ?? '•',
          listType: dataAttr(dom, 'data-list-type') ?? 'bullet',
          spread: false,
        }),
      },
    ],
    toDOM: (n) => ['li', { 'data-label': n.attrs.label, 'data-list-type': n.attrs.listType }, 0],
  }),
);

/* ------------------------------------------------------------------ 콜아웃 */

export const calloutNode = $node('callout', () =>
  spec({
    group: 'block',
    content: `callout_title (${CALLOUT_BODY})*`,
    attrs: { kind: { default: '정보' } },
    defining: true,
    parseDOM: [{ tag: 'div[data-tx-callout]', getAttrs: (d) => ({ kind: dataAttr(d, 'data-tx-callout') ?? '정보' }) }],
    toDOM: (n) => [
      'div',
      { class: `tx-callout tx-callout-${CALLOUT_CSS[n.attrs.kind] ?? 'info'}`, 'data-tx-callout': n.attrs.kind },
      ['div', { class: 'tx-tag', contenteditable: 'false' }, `콜아웃 · ${n.attrs.kind}`],
      ['div', { class: 'tx-callout-body' }, 0],
    ],
  }),
);

export const calloutTitleNode = $node('callout_title', () =>
  spec({
    content: CELL_INLINE,
    parseDOM: [{ tag: 'div.tx-callout-title' }],
    toDOM: () => ['div', { class: 'tx-callout-title', 'data-placeholder': '제목(선택)' }, 0],
  }),
);

/* ------------------------------------------------------------------ 표 */

export const tableHNode = $node('table_h', () =>
  spec({
    group: 'block',
    content: 'table_row (table_row | txmd_trans | txmd_raw)*',
    attrs: { dyn: { default: null } },
    defining: true,
    isolating: true,
    parseDOM: [{ tag: 'div[data-tx-table="h"]', getAttrs: (d) => ({ dyn: dataAttr(d, 'data-tx-dyn') || null }) }],
    toDOM: (n) => [
      'div',
      { class: `tx-tablewrap${n.attrs.dyn ? ' tx-dyn' : ''}`, 'data-tx-table': 'h', 'data-tx-dyn': n.attrs.dyn ?? undefined },
      ['div', { class: 'tx-tag', contenteditable: 'false' }, n.attrs.dyn ? `동적 표 · ${n.attrs.dyn} (행 템플릿 1행)` : '가로형 표'],
      ['div', { class: 'tx-table tx-table-h' }, 0],
    ],
  }),
);

export const tableVNode = $node('table_v', () =>
  spec({
    group: 'block',
    content: '(txmd_trans | txmd_raw)* table_row (table_row | txmd_trans | txmd_raw)*',
    defining: true,
    isolating: true,
    parseDOM: [{ tag: 'div[data-tx-table="v"]' }],
    toDOM: () => [
      'div',
      { class: 'tx-tablewrap', 'data-tx-table': 'v' },
      ['div', { class: 'tx-tag', contenteditable: 'false' }, '세로형 표 (왼쪽 칸 = 항목, 오른쪽 칸 = 값)'],
      ['div', { class: 'tx-table tx-table-v' }, 0],
    ],
  }),
);

export const tableRowNode = $node('table_row', () =>
  spec({
    content: 'table_cell+',
    attrs: { head: { default: false } },
    isolating: true,
    parseDOM: [{ tag: 'div.tx-row' }],
    toDOM: (n) => ['div', { class: 'tx-row', 'data-head': n.attrs.head ? '1' : undefined }, 0],
  }),
);

export const tableCellNode = $node('table_cell', () =>
  spec({
    content: CELL_INLINE,
    isolating: true,
    parseDOM: [{ tag: 'div.tx-cell' }],
    toDOM: () => ['div', { class: 'tx-cell' }, 0],
  }),
);

/* ------------------------------------------------------------------ 버튼 */

export const buttonGroupNode = $node('button_group', () =>
  spec({
    group: 'block',
    content: '(button | txmd_trans | txmd_raw)+',
    defining: true,
    parseDOM: [{ tag: 'div[data-tx-btns]' }],
    toDOM: () => ['div', { class: 'tx-btns', 'data-tx-btns': '1' }, 0],
  }),
);

export const BUTTON_STYLES = ['primary', 'secondary', 'outline', 'warn'] as const;

export const buttonNode = $node('button', () =>
  spec({
    content: CELL_INLINE,
    attrs: { url: { default: '#' }, style: { default: '' } },
    defining: true,
    parseDOM: [{ tag: 'div.tx-btn', getAttrs: (d) => ({ url: dataAttr(d, 'data-url') ?? '#', style: dataAttr(d, 'data-style-raw') ?? '' }) }],
    toDOM: (n) => [
      'div',
      {
        class: 'tx-btn',
        'data-style': n.attrs.style || 'auto',
        'data-style-raw': n.attrs.style,
        'data-url': n.attrs.url,
        title: `버튼 · ${n.attrs.url || '(링크 없음)'} · ${n.attrs.style || '스타일 자동'}`,
      },
      0,
    ],
  }),
);

/* ------------------------------------------------------------------ 불투명 보존 노드 */

/** 번역 줄 묶음(`@en …`). 편집하지 않고 접어서 보여 주며 삭제만 허용. orphan = 앞 블록에 붙지 않은 줄(파서가 무시) */
export const transNode = $node('txmd_trans', () =>
  spec({
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { lines: { default: [] }, orphan: { default: false } },
    parseDOM: [
      {
        tag: 'div[data-tx-trans]',
        getAttrs: (d) => ({ lines: (dataAttr(d, 'data-tx-trans') ?? '').split('\n').filter(Boolean), orphan: dataAttr(d, 'data-orphan') === '1' }),
      },
    ],
    toDOM: (n) => ['div', { class: 'tx-trans', 'data-tx-trans': (n.attrs.lines as string[]).join('\n'), 'data-orphan': n.attrs.orphan ? '1' : undefined }, `번역 줄 ${(n.attrs.lines as string[]).length}줄`],
    leafText: (n) => (n.attrs.lines as string[]).join('\n'),
  }),
);

/** 에디터가 모르는 줄·`@var`/`@sample`·`[헤더]` 를 그대로 보존하는 회색 코드 블록(직접 편집 가능) */
export const rawNode = $node('txmd_raw', () =>
  spec({
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    whitespace: 'pre',
    parseDOM: [{ tag: 'pre[data-tx-raw]', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', { class: 'tx-raw', 'data-tx-raw': '1', 'data-label': '원문 보존 (해석되지 않는 줄 · @var · @sample)' }, ['code', 0]],
  }),
);

export const customNodes = [
  placeholderNode,
  rowVarNode,
  blockquoteNode,
  listItemNode,
  calloutNode,
  calloutTitleNode,
  tableHNode,
  tableVNode,
  tableRowNode,
  tableCellNode,
  buttonGroupNode,
  buttonNode,
  transNode,
  rawNode,
];
