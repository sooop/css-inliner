import { describe, expect, it } from 'vitest';
import { Node as PMNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import {
  addTableColumn,
  addTableRow,
  deleteTableColumn,
  deleteTableRow,
  insertBlock,
  insertInlineAtom,
  splitListItemKeepTrans,
  makeButtonGroup,
  makeCallout,
  makeDynamicTable,
  makeHorizontalTable,
  makeHr,
  makeVerticalTable,
  nextDynId,
  setNodeAttrs,
} from '../commands';
import { loadTxmd } from '../load';
import { docToTxmd } from '../serialize';
import { sameMeaning, verifyDocStable } from '../roundtrip';
import { getEditor } from './helpers';

/** 에디터에 .txmd 를 넣고(문서 교체) 뷰를 돌려준다 */
async function withDoc(txmd: string) {
  const { view } = await getEditor();
  const doc = PMNode.fromJSON(view.state.schema, loadTxmd(txmd) as never);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  return view;
}

/** 문서에서 텍스트가 text 인 첫 위치(텍스트 노드 안, 끝)로 커서를 옮긴다 */
function cursorAtEndOf(view: Awaited<ReturnType<typeof withDoc>>, text: string) {
  let at = -1;
  view.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text!.includes(text)) at = pos + n.text!.indexOf(text) + text.length;
  });
  expect(at).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

describe('블록 삽입·표 편집 명령 → .txmd', () => {
  it('콜아웃·구분선·버튼 삽입', async () => {
    const view = await withDoc('앞 문단\n');
    cursorAtEndOf(view, '앞 문단');
    const s = view.state.schema;
    expect(insertBlock(view.state, view.dispatch.bind(view), makeCallout(s, '경고'))).toBe(true);
    // 콜아웃 제목에 글 입력
    view.dispatch(view.state.tr.insertText('주의'));
    expect(docToTxmd(view.state.doc)).toBe('앞 문단\n\n[경고: 주의]\n[/경고]\n');
    // 제목이 비면 `[경고]`
    insertBlock(view.state, view.dispatch.bind(view), makeHr(s), 'after');
    expect(docToTxmd(view.state.doc)).toContain('---');
  });

  it('동적 표 id 자동 부여·행 변수·버튼 CSV 인용', async () => {
    const view = await withDoc('[표: 가로형, 동적: rows1]\n{a| b}\n- {{x}}| {{y}}\n[/표]\n');
    const s = view.state.schema;
    expect(nextDynId(view.state.doc)).toBe('rows2');
    expect(docToTxmd(PMNode.fromJSON(s, { type: 'doc', content: [makeDynamicTable(s, 'rows2').toJSON()] }))).toContain('[표: 가로형, 동적: rows2]\n{상품명| 수량| 금액}\n- {{name}}| {{qty}}개| {{amount}}원');
    const btn = s.nodes.button.create({ url: 'https://a.com/?x=1,2', style: 'primary' }, s.text('콤마, 포함 "따옴표"'));
    const doc = PMNode.fromJSON(s, { type: 'doc', content: [s.nodes.button_group.create(null, [btn]).toJSON()] });
    const out = docToTxmd(doc);
    expect(out).toBe('[버튼, "콤마, 포함 \\"따옴표\\"", "https://a.com/?x=1,2", primary]\n');
    expect(sameMeaning(out, out).ok).toBe(true);
  });

  it('가로형 표: 행·열 추가/삭제, 동적 표는 행 추가 불가', async () => {
    const view = await withDoc('[표: 가로형]\n{a| b}\n- 1| 2\n[/표]\n');
    cursorAtEndOf(view, '1');
    const run = (cmd: typeof addTableRow) => cmd(view.state, view.dispatch.bind(view), view);
    expect(run(addTableRow)).toBe(true);
    expect(docToTxmd(view.state.doc)).toBe('[표: 가로형]\n{a| b}\n- 1| 2\n- | \n[/표]\n');
    cursorAtEndOf(view, '1');
    expect(run(addTableColumn)).toBe(true);
    expect(docToTxmd(view.state.doc)).toContain('{a| | b}');
    cursorAtEndOf(view, '1');
    expect(run(deleteTableColumn)).toBe(true); // 커서가 있던 열(1 이 있던 열)이 지워진다
    expect(docToTxmd(view.state.doc)).toContain('{| b}');
    cursorAtEndOf(view, '2');
    expect(run(deleteTableRow)).toBe(true);
    // 머리글 행은 지울 수 없다
    cursorAtEndOf(view, 'b');
    expect(run(deleteTableRow)).toBe(false);
  });

  it('동적 표 안에서는 행 추가가 막힌다', async () => {
    const view = await withDoc('[표: 가로형, 동적: t]\n{a| b}\n- {{x}}| {{y}}\n[/표]\n');
    let at = -1;
    view.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'rowvar') at = pos;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at), 1)));
    expect(addTableRow(view.state, view.dispatch.bind(view), view)).toBe(false);
  });

  it('속성 변경: 콜아웃 종류', async () => {
    const view = await withDoc('[정보: 제목]\n본문\n[/정보]\n');
    cursorAtEndOf(view, '본문');
    expect(setNodeAttrs('callout', { kind: '강조' })(view.state, view.dispatch.bind(view))).toBe(true);
    expect(docToTxmd(view.state.doc)).toContain('[강조: 제목]');
  });

  it('치환자 원자 삽입', async () => {
    const view = await withDoc('안녕\n');
    cursorAtEndOf(view, '안녕');
    expect(insertInlineAtom('placeholder', 'cust_nm')(view.state, view.dispatch.bind(view))).toBe(true);
    expect(docToTxmd(view.state.doc)).toBe('안녕|!#-cust_nm|\n');
  });
});

describe('안전장치', () => {
  it('마크업으로 해석되는 글(번역 줄·목록 기호)은 불안정으로 감지한다', async () => {
    const view = await withDoc('안녕\n');
    const s = view.state.schema;
    const bad = PMNode.fromJSON(s, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '- 목록처럼 보이는 문단' }] }] });
    const r = verifyDocStable(bad, s);
    expect(r.ok).toBe(false);
    const ok = PMNode.fromJSON(s, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '평범한 문단' }] }] });
    expect(verifyDocStable(ok, s).ok).toBe(true);
  });

  it('sameMeaning 은 실제 차이를 잡는다', () => {
    expect(sameMeaning('안녕\n', '안녕\n\n').ok).toBe(true);
    expect(sameMeaning('안녕\n', '잘가\n').ok).toBe(false);
    expect(sameMeaning('a\n@en A\n', 'a\n').ok).toBe(false);
  });
});

describe('번역 줄이 붙은 목록 항목에서 Enter', () => {
  it('항목 끝에서 Enter 하면 번역 줄이 새 항목으로 옮겨 가지 않는다', async () => {
    const view = await withDoc('- 첫째\n@en First\n- 둘째\n');
    cursorAtEndOf(view, '첫째');
    const { list_item } = view.state.schema.nodes;
    // 키맵의 Enter 와 같은 순서: 번역 줄 보존 명령 → 기본 목록 분할
    const run = (c: typeof splitListItemKeepTrans) => c(view.state, view.dispatch.bind(view), view);
    expect(run(splitListItemKeepTrans) || splitListItem(list_item)(view.state, view.dispatch.bind(view))).toBe(true);
    let items = 0;
    view.state.doc.descendants((n) => {
      if (n.type.name === 'list_item') items++;
    });
    expect(items).toBe(3); // 새(빈) 항목이 생겼다
    const out = docToTxmd(view.state.doc);
    // 새(빈) 항목은 출력되지 않으므로 번역 줄은 '첫째' 항목 밑에 남아야 한다
    expect(out).toBe('- 첫째\n@en First\n- 둘째\n');
  });
});
void [makeHorizontalTable, makeVerticalTable, makeButtonGroup];
