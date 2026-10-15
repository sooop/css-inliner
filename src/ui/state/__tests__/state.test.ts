import { describe, expect, it } from 'vitest';
import { parseTxmd } from '../../../markup/parser';
import { listBlocks } from '../../../markup/ids';
import { composeForSend, composePreview } from '../../../markup/compose';
import { validateProject } from '../../../project/validate';
import { createProject } from '../../../project/model';
import {
  addTableRow,
  allBlockIds,
  blockIndexOfId,
  canRemoveTableRow,
  describeIds,
  findContainer,
  getBlockAttr,
  insertBlock,
  listTopBlocks,
  moveBlock,
  removeBlock,
  removeTableRow,
  setBlockAttr,
} from '../ops';
import { ackStale, cellState, completion, listStringRows, rowHasProblem, setText, SUBJECT_ID, staleSet, syncVariables, removeVariable } from '../strings';
import { addSampleRow, removeSampleRow, removeTableVar, setSampleCell, tableLayout, unusedVars, updateTableVar } from '../dyn';
import { analyzeDraft, createProjectFromDraft, draftTitle, planDraft } from '../draft';
import { createSampleProject, SAMPLE_TXMD } from '../sample';
import { applySamples, decoratePreview, selectionCss } from '../preview-html';
import { insertAt, wrapLink, wrapSelection } from '../inline-edit';
import { parseTree } from '../html-tree';
import { wrapMarkersInRow } from '../preview';
import { shellOptionsFrom } from '../draft';

const sample = () => createSampleProject(1);
const KO_ONLY = SAMPLE_TXMD.split('\n').filter((l) => !/^@(en|ja) /.test(l)).join('\n');

describe('샘플 프로젝트(실제 파서·검사와의 연동)', () => {
  it('경고 없이 파싱되고 오류 없이 검사를 통과한다', () => {
    const r = parseTxmd(SAMPLE_TXMD, { baseLang: 'ko', langs: ['en', 'ja'] });
    expect(r.warnings).toEqual([]);
    const p = sample();
    expect(validateProject(p).filter((i) => i.level === 'error')).toEqual([]);
    expect(p.variables.map((v) => v.name).sort()).toEqual(['carrier_nm', 'cust_nm', 'eta_dt', 'item_cnt', 'tracking_no']);
    expect(p.variables.every((v) => v.sample !== '' && v.description !== '')).toBe(true);
    expect(p.dynamicTables).toHaveLength(1);
    expect(p.dynamicTables[0].vars.map((v) => v.name)).toEqual(['sku', 'name', 'qty']);
  });
  it('블록 목록 종류와 ID', () => {
    const blocks = listTopBlocks(sample().structure);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'table-v', 'dynamic', 'callout', 'button', 'paragraph']);
    expect(blocks[3].tableIds).toEqual(['stock']);
    expect(blocks[4].ids).toHaveLength(2);
  });
  it('ID 종류 설명(콜아웃 제목/본문 구분)', () => {
    const p = sample();
    const k = describeIds(p.structure);
    const co = listTopBlocks(p.structure)[4];
    expect(k.get(co.ids[0])).toBe('callout-title');
    expect(k.get(co.ids[1])).toBe('callout-body');
  });
});

describe('컨테이너 탐색', () => {
  it('루트가 평평하면 루트', () => {
    expect(listTopBlocks('<h1 data-t="b001"></h1>\n<p data-t="b002"></p>')).toHaveLength(2);
  });
  it('래퍼 표(table.wrap>tbody>tr>td)를 따라 내려간다', () => {
    const s = '<table class="wrap"><tbody><tr><td><img class="logo" src="x"><h1 data-t="b001"></h1><p data-t="b002"></p></td></tr></tbody></table>';
    const b = listTopBlocks(s);
    expect(b.map((x) => x.tag)).toEqual(['img', 'h1', 'p']);
  });
  it('data-blocks 가 있으면 그 안이 본문', () => {
    const s = '<table class="wrap"><tr><td>head</td></tr><tr><td data-blocks><p data-t="b001"></p></td></tr><tr><td>foot</td></tr></table>';
    expect(listTopBlocks(s).map((x) => x.ids)).toEqual([['b001']]);
    const c = findContainer(s);
    expect(s.slice(c.innerStart, c.innerEnd)).toBe('<p data-t="b001"></p>');
  });
  it('main 래퍼', () => {
    expect(listTopBlocks('<main>\n<h1 data-t="b001"></h1>\n<p data-t="b002"></p>\n</main>').map((b) => b.tag)).toEqual(['h1', 'p']);
  });
  it('파서는 짝이 안 맞는 태그에도 죽지 않는다', () => {
    expect(() => parseTree('<div><p>a</div></p><br><x')).not.toThrow();
  });
});

describe('구조 조작', () => {
  it('블록 이동: 위/아래 교체, 왕복하면 원래 구조', () => {
    const p = sample();
    const up = moveBlock(p, 2, -1)!;
    expect(listTopBlocks(up.structure).map((b) => b.kind).slice(0, 3)).toEqual(['heading', 'table-v', 'paragraph']);
    expect(up.strings).toBe(p.strings);
    const back = moveBlock(up, 1, 1)!;
    expect(back.structure).toBe(p.structure);
    expect(moveBlock(p, 0, -1)).toBeNull();
    expect(moveBlock(p, listTopBlocks(p.structure).length - 1, 1)).toBeNull();
  });
  it('이동해도 모든 언어 합성 결과의 블록 순서가 같이 바뀐다', () => {
    const p = sample();
    const up = moveBlock(p, 1, -1)!;
    for (const lang of p.langs) {
      const html = composeForSend(up, lang).html;
      expect(html.indexOf('<p>')).toBeLessThan(html.indexOf('<h1>'));
    }
  });
  it('블록 삭제: 문자열·해시 제거, 동적 표는 표 정의와 행 문자열까지 제거', () => {
    const p = sample();
    const para = listTopBlocks(p.structure)[1];
    const r = removeBlock(p, 1)!;
    for (const id of para.ids) {
      expect(r.strings[id]).toBeUndefined();
      expect(r.sourceHash[id]).toBeUndefined();
    }
    expect(listTopBlocks(r.structure)).toHaveLength(6);

    const rowIds = listBlocks(p.dynamicTables[0].rowStructure).map((b) => b.id);
    const dyn = removeBlock(p, 3)!;
    expect(dyn.dynamicTables).toEqual([]);
    for (const id of rowIds) expect(dyn.strings[id]).toBeUndefined();
    expect(dyn.structure).not.toContain('data-rows');
  });
  it('블록 추가: 새 ID 는 충돌하지 않고 비기준 언어는 미번역', () => {
    const p = sample();
    const before = new Set(allBlockIds(p));
    const r = insertBlock(p, 'callout', 2);
    expect(r.ids).toHaveLength(2);
    for (const id of r.ids) expect(before.has(id)).toBe(false);
    expect(r.index).toBe(3);
    expect(listTopBlocks(r.project.structure)[3].kind).toBe('callout');
    expect(r.project.strings[r.ids[0]]).toEqual({ ko: '새 콜아웃 제목' });
    const issues = validateProject(r.project).filter((i) => i.code === 'untranslated');
    expect(issues.map((i) => `${i.blockId}/${i.lang}`).sort()).toEqual([`${r.ids[0]}/en`, `${r.ids[0]}/ja`, `${r.ids[1]}/en`, `${r.ids[1]}/ja`].sort());
    // 합성 결과가 구조를 깨지 않는다
    expect(composePreview(r.project, 'ko').html).toContain('새 콜아웃 제목');
  });
  it('블록 추가: 맨 앞/맨 끝/빈 프로젝트', () => {
    const p = sample();
    expect(insertBlock(p, 'paragraph', -1).index).toBe(0);
    const end = insertBlock(p, 'paragraph', null);
    expect(end.index).toBe(listTopBlocks(p.structure).length);
    const empty = createProject({ name: 'x' });
    const a = insertBlock(empty, 'paragraph', null);
    const b = insertBlock(a.project, 'heading', null);
    expect(listTopBlocks(b.project.structure).map((x) => x.tag)).toEqual(['p', 'h2']);
    expect(Object.keys(b.project.strings)).toEqual(['b001', 'b002']);
  });
  it('스니펫처럼 언어별 문구와 함께 삽입하면 번역 해시가 기록된다(오래됨 아님)', () => {
    const r = insertBlock(sample(), 'paragraph', null, { ko: ['안녕'], en: ['Hello'], ja: ['こんにちは'] });
    const id = r.ids[0];
    expect(r.project.strings[id]).toEqual({ ko: '안녕', en: 'Hello', ja: 'こんにちは' });
    expect(cellState(r.project, id, 'en')).toBe('ok');
    expect(validateProject(r.project).filter((i) => i.code === 'stale-translation')).toEqual([]);
  });
  it('표 행 추가/삭제(세로형)', () => {
    const p = sample();
    const idx = blockIndexOfId(p.structure, listTopBlocks(p.structure)[2].ids[0]);
    expect(idx).toBe(2);
    const r = addTableRow(p, 2)!;
    expect(r.ids).toHaveLength(2);
    expect(listTopBlocks(r.project.structure)[2].ids).toHaveLength(8);
    expect(r.project.strings[r.ids[0]].ko).toBe('새 항목');
    expect(r.project.strings[r.ids[1]].ko).toBe('-');
    expect(canRemoveTableRow(r.project, r.ids[0])).toBe(true);
    const back = removeTableRow(r.project, r.ids[1])!;
    expect(listTopBlocks(back.structure)[2].ids).toHaveLength(6);
    expect(back.strings[r.ids[0]]).toBeUndefined();
    expect(addTableRow(p, 0)).toBeNull();
  });
  it('표의 마지막 한 행은 삭제 불가, 동적 표는 행 추가 대상이 아님', () => {
    const one = '<table class="table-vertical"><tr><th data-t="b001"></th><td data-t="b002"></td></tr></table>';
    const p = createProject({ name: 'x', structure: one, strings: { b001: { ko: 'a' }, b002: { ko: 'b' } } });
    expect(canRemoveTableRow(p, 'b001')).toBe(false);
    expect(removeTableRow(p, 'b001')).toBeNull();
    const q = sample();
    expect(addTableRow(q, 3)).toBeNull();
    expect(canRemoveTableRow(q, q.dynamicTables[0].rowStructure.match(/data-t="([^"]*)"/)![1])).toBe(false);
  });
  it('버튼 링크 속성 읽기/쓰기는 나머지 구조를 건드리지 않는다', () => {
    const p = sample();
    const btn = listTopBlocks(p.structure)[5];
    const id = btn.ids[0];
    expect(getBlockAttr(p.structure, id, 'href')).toContain('track.example.com');
    const r = setBlockAttr(p, id, 'href', 'https://x.test/?a=1&b="2"')!;
    expect(getBlockAttr(r.structure, id, 'href')).toBe('https://x.test/?a=1&b="2"');
    expect(r.structure.replace(/href="[^"]*"/g, '')).toBe(p.structure.replace(/href="[^"]*"/g, ''));
    expect(setBlockAttr(p, 'nope', 'href', 'x')).toBeNull();
  });
});

describe('문자열 편집 · 오래됨 판정', () => {
  it('기준 언어를 고치면 번역은 오래됨, [최신 확인]하면 해제', () => {
    const p = sample();
    const id = listTopBlocks(p.structure)[1].ids[0];
    expect(cellState(p, id, 'en')).toBe('ok');
    const q = setText(p, id, 'ko', p.strings[id].ko + ' 추가');
    expect(cellState(q, id, 'ko')).toBe('ok');
    expect(cellState(q, id, 'en')).toBe('stale');
    expect(cellState(q, id, 'ja')).toBe('stale');
    expect(validateProject(q).filter((i) => i.code === 'stale-translation')).toHaveLength(2);
    const r = ackStale(q, id, 'en');
    expect(cellState(r, id, 'en')).toBe('ok');
    expect(cellState(r, id, 'ja')).toBe('stale');
  });
  it('번역을 고치면 그 시점의 원문 해시가 기록되어 오래됨이 풀린다', () => {
    const p = sample();
    const id = listTopBlocks(p.structure)[1].ids[0];
    const q = setText(p, id, 'ko', '바뀐 원문 |!#-cust_nm|님 |!#-item_cnt|');
    const r = setText(q, id, 'en', 'Changed |!#-cust_nm| |!#-item_cnt|');
    expect(cellState(r, id, 'en')).toBe('ok');
    expect(cellState(r, id, 'ja')).toBe('stale');
  });
  it('해시가 없던 번역도 기준 원문이 바뀌면 오래됨으로 잡힌다', () => {
    const p = createProject({ name: 'x', structure: '<p data-t="b001"></p>', strings: { b001: { ko: '가', en: 'A' } } });
    expect(staleSet(p).size).toBe(0);
    const q = setText(p, 'b001', 'ko', '나');
    expect(cellState(q, 'b001', 'en')).toBe('stale');
  });
  it('같은 값이면 같은 객체를 돌려준다(불필요한 저장 방지)', () => {
    const p = sample();
    const id = listTopBlocks(p.structure)[0].ids[0];
    expect(setText(p, id, 'ko', p.strings[id].ko)).toBe(p);
  });
  it('제목(subject) 편집', () => {
    const p = sample();
    const q = setText(p, SUBJECT_ID, 'en', '[X] Shipped |!#-order_no|');
    expect(q.subject.en).toBe('[X] Shipped |!#-order_no|');
    expect(q.variables.map((v) => v.name)).toContain('order_no');
    expect(cellState(q, SUBJECT_ID, 'en')).toBe('ok');
    expect(cellState(setText(q, SUBJECT_ID, 'ja', ''), SUBJECT_ID, 'ja')).toBe('miss');
  });
  it('새 치환자는 목록에 자동 추가되고, 기존 설명·샘플은 보존된다', () => {
    const p = sample();
    const id = listTopBlocks(p.structure)[1].ids[0];
    const q = setText(p, id, 'ko', '주문 |!#-order_no| |!#-cust_nm|');
    expect(q.variables.find((v) => v.name === 'order_no')).toEqual({ name: 'order_no', description: '', sample: '' });
    expect(q.variables.find((v) => v.name === 'cust_nm')!.sample).toBe('홍길동');
    expect(syncVariables(q)).toBe(q);
    expect(removeVariable(q, 'order_no').variables.some((v) => v.name === 'order_no')).toBe(false);
  });
  it('그리드 행: 제목 → 본문 → 행 템플릿 순서, 문제 판정', () => {
    const p = sample();
    const rows = listStringRows(p);
    expect(rows[0].id).toBe(SUBJECT_ID);
    expect(rows.slice(1).every((r) => r.scope === 'body' || r.scope === 'row:stock')).toBe(true);
    expect(rows.filter((r) => r.scope === 'row:stock')).toHaveLength(3);
    const stale = staleSet(p);
    expect(rows.some((r) => rowHasProblem(p, r.id, stale))).toBe(false);
    const q = insertBlock(p, 'paragraph', null).project;
    const newId = Object.keys(q.strings).find((k) => !p.strings[k])!;
    expect(rowHasProblem(q, newId)).toBe(true);
    expect(completion(p, 'en')).toBe(100);
    expect(completion(q, 'en')).toBeLessThan(100);
    expect(completion(q, 'ko')).toBe(100);
  });
  it('행 템플릿에 새 {{변수}} 를 쓰면 동적 표 vars 에 선언이 추가된다', () => {
    const p = sample();
    const id = p.dynamicTables[0].rowStructure.match(/data-t="([^"]*)"/)![1];
    const q = setText(p, id, 'ko', '{{sku}} {{lot}}');
    expect(q.dynamicTables[0].vars.map((v) => v.name)).toEqual(['sku', 'name', 'qty', 'lot']);
    expect(unusedVars(p, p.dynamicTables[0])).toEqual([]);
  });
});

describe('동적 표', () => {
  it('머리/셀 ID', () => {
    const p = sample();
    const l = tableLayout(p, 'stock');
    expect(l.headIds).toHaveLength(3);
    expect(l.cellIds).toHaveLength(3);
  });
  it('변수·예시 행 편집', () => {
    let p = sample();
    p = updateTableVar(p, 'stock', 'qty', { sample: '99', description: '개수' });
    expect(p.dynamicTables[0].vars.find((v) => v.name === 'qty')).toMatchObject({ sample: '99', description: '개수' });
    const n = p.dynamicTables[0].sampleRows.length;
    p = addSampleRow(p, 'stock');
    expect(p.dynamicTables[0].sampleRows).toHaveLength(n + 1);
    expect(Object.keys(p.dynamicTables[0].sampleRows[n]).sort()).toEqual(['name', 'qty', 'sku']);
    p = setSampleCell(p, 'stock', n, 'name', '<b>x</b>');
    expect(composePreview(p, 'ko').html).toContain('&lt;b&gt;x&lt;/b&gt;');
    p = removeSampleRow(p, 'stock', n);
    expect(p.dynamicTables[0].sampleRows).toHaveLength(n);
    p = removeTableVar(p, 'stock', 'qty');
    expect(p.dynamicTables[0].vars.map((v) => v.name)).toEqual(['sku', 'name']);
    expect(p.dynamicTables[0].sampleRows.every((r) => !('qty' in r))).toBe(true);
  });
});

describe('초안 → ID 이어받기 연동', () => {
  it('같은 초안이면 변경 없음', () => {
    const p = sample();
    const plan = planDraft(p, SAMPLE_TXMD);
    expect(plan.counts).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(plan.unchanged).toBe(true);
    expect(plan.next.strings).toEqual(p.strings);
  });
  it('ko 만 있는 초안(Milkdown 흐름)이면 기존 번역을 그대로 이어받는다', () => {
    const p = sample();
    const plan = planDraft(p, KO_ONLY);
    expect(plan.counts).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(plan.next.strings).toEqual(p.strings);
    expect(plan.next.sourceHash).toEqual(p.sourceHash);
  });
  it('초안에 번역 줄이 있으면 그 번역이 우선', () => {
    const p = sample();
    const plan = planDraft(p, SAMPLE_TXMD.replace('@en Your shipment is on its way', '@en Shipping started'));
    const id = listTopBlocks(p.structure)[0].ids[0];
    expect(plan.next.strings[id].en).toBe('Shipping started');
    expect(cellState(plan.next, id, 'en')).toBe('ok');
  });
  it('문단 수정·새 문단·삭제: 요약 수치와 번역 보존', () => {
    const p = sample();
    const txmd = KO_ONLY
      .replace('안녕하세요, |!#-cust_nm|님. 주문하신', '안녕하세요, |!#-cust_nm|님! 주문하신')
      .replace('[버튼, 배송 조회하기, https://track.example.com/|!#-tracking_no|, primary]\n', '')
      .replace('[정보: 수령 안내]', '기상 악화로 지연될 수 있습니다.\n\n[정보: 수령 안내]');
    const plan = planDraft(p, txmd);
    expect(plan.counts.changed).toBe(1);
    expect(plan.counts.added).toBe(1);
    expect(plan.counts.removed).toBe(1);
    expect(plan.unchanged).toBe(false);
    expect(plan.items.map((i) => i.kind).sort()).toEqual(['added', 'changed', 'removed']);
    const changedId = plan.items.find((i) => i.kind === 'changed')!.id;
    // 같은 ID 를 이어받고 en/ja 번역은 보존, 오래됨 처리
    expect(plan.next.strings[changedId].en).toBe(p.strings[changedId].en);
    expect(cellState(plan.next, changedId, 'en')).toBe('stale');
    expect(cellState(plan.next, changedId, 'ja')).toBe('stale');
    // 삭제된 ID 는 문자열에서 사라지고, 새 ID 는 미번역
    const removedId = plan.items.find((i) => i.kind === 'removed')!.id;
    expect(plan.next.strings[removedId]).toBeUndefined();
    const addedId = plan.items.find((i) => i.kind === 'added')!.id;
    expect(plan.next.strings[addedId].ko).toContain('기상 악화');
    expect(cellState(plan.next, addedId, 'en')).toBe('miss');
    expect(plan.next.draftMarkup).toBe(txmd);
    // 원본 프로젝트는 변하지 않는다(적용 전)
    expect(p.draftMarkup).toBe(SAMPLE_TXMD);
    // 안 바뀐 블록은 그대로
    expect(plan.counts.kept).toBeGreaterThan(5);
  });
  it('동적 표 변수 설명·샘플은 초안에 없으면 이전 값을 유지', () => {
    const p = updateTableVar(sample(), 'stock', 'qty', { description: '내가 고친 설명' });
    const txmd = SAMPLE_TXMD.replace('@var qty 입고 수량(정수)\n', '');
    const plan = planDraft(p, txmd);
    expect(plan.next.dynamicTables[0].vars.find((v) => v.name === 'qty')!.description).toBe('내가 고친 설명');
  });
  it('빈 프로젝트에 첫 변환', () => {
    const empty = createProject({ name: 'n', subject: { ko: '', en: '', ja: '' } });
    const plan = planDraft(empty, '# 제목\n@en Title\n\n본문 |!#-x|\n');
    expect(plan.hadBlocks).toBe(false);
    expect(plan.counts.added).toBe(4); // 본문 2 + 셸 푸터 2
    expect(plan.next.variables.map((v) => v.name)).toEqual(['x']);
    expect(cellState(plan.next, 'b001', 'en')).toBe('ok');
    expect(cellState(plan.next, 'b002', 'en')).toBe('miss');
  });
  it('파서 경고를 그대로 전달', () => {
    const plan = planDraft(createProject({ name: 'n' }), '@en 대상 없는 번역\n');
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});

describe('미리보기 보조', () => {
  it('샘플값 치환: 이스케이프, 빈 샘플·모르는 이름은 그대로', () => {
    const html = '<p>|!#-a| |!#-b| |!#-c|</p><a href="https://t/|!#-a|">x</a>';
    const out = applySamples(html, [
      { name: 'a', sample: '<홍&"길">' },
      { name: 'b', sample: '' },
    ]);
    expect(out).toBe('<p>&lt;홍&amp;&quot;길&quot;&gt; |!#-b| |!#-c|</p><a href="https://t/&lt;홍&amp;&quot;길&quot;&gt;">x</a>');
  });
  it('선택 CSS 는 ID 를 안전하게 이스케이프', () => {
    expect(selectionCss(null)).toBe('');
    expect(selectionCss('b001')).toContain('[data-t="b001"]');
    expect(selectionCss('a"]{x')).toContain('\\"');
  });
  it('후처리: 빈 data-t 는 미번역 표시, 남은 치환자는 하이라이트', () => {
    const doc = new DOMParser().parseFromString('<body><p data-t="b1"></p><p data-t="b2">안녕 |!#-x| 님 |!#-y|</p><a data-t="b3" href="#"><b>x</b></a></body>', 'text/html');
    decoratePreview(doc);
    expect(doc.querySelector('[data-t="b1"]')!.hasAttribute('data-miss')).toBe(true);
    expect(doc.querySelector('[data-t="b2"]')!.hasAttribute('data-miss')).toBe(false);
    expect(Array.from(doc.querySelectorAll('.__ph')).map((e) => e.textContent)).toEqual(['|!#-x|', '|!#-y|']);
    expect(doc.querySelector('[data-t="b2"]')!.textContent).toBe('안녕 |!#-x| 님 |!#-y|');
  });
});

describe('인라인 편집 도우미', () => {
  it('선택 감싸기', () => {
    expect(wrapSelection('가나다', 1, 2, 'strong')).toEqual({ text: '가<strong>나</strong>다', selStart: 9, selEnd: 10 });
    expect(wrapSelection('ab', 1, 1, 'em').text).toBe('a<em></em>b');
    expect(wrapLink('가나다', 0, 1).text).toBe('<a href="https://">가</a>나다');
    expect(wrapLink('x', 1, 1).text).toContain('링크 문구');
    expect(insertAt('가|나', 1, 2, '|!#-x|')).toEqual({ text: '가|!#-x|나', selStart: 7, selEnd: 7 });
  });
});

describe('메일 셸 연동', () => {
  it('샘플은 셸로 감싸이고 본문 블록은 <main> 안쪽만 센다', () => {
    const p = sample();
    expect(p.structure).toContain('data-tx-shell');
    expect(listTopBlocks(p.structure).map((b) => b.kind)).toEqual(['heading', 'paragraph', 'table-v', 'dynamic', 'callout', 'button', 'paragraph']);
    // 푸터 문구도 번역 대상 문자열
    expect(listStringRows(p).filter((r) => r.kind === '문단').length).toBeGreaterThanOrEqual(3);
  });
  it('블록 추가는 <main> 안에 들어간다', () => {
    const r = insertBlock(sample(), 'paragraph', null);
    const s = r.project.structure;
    expect(s.indexOf(`data-t="${r.ids[0]}"`)).toBeLessThan(s.indexOf('</main>'));
  });
  it('앱에서 고친 푸터는 재변환해도 유지된다', () => {
    const p = sample();
    const footId = Object.keys(p.strings).find((id) => p.strings[id].ko.startsWith('©'))!;
    const q = setText(p, footId, 'ko', '© 고친 푸터');
    expect(shellOptionsFrom(q).footerBlocks!.map((b) => b.ko)).toContain('© 고친 푸터');
    const plan = planDraft(q, SAMPLE_TXMD);
    expect(plan.counts).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(Object.values(plan.next.strings).some((s) => s.ko === '© 고친 푸터')).toBe(true);
  });
  it('발송용 표식 보기는 표식을 tr/td 로 감싼다', () => {
    const p = sample();
    const html = wrapMarkersInRow('<tbody data-rows="stock">|!#-rows_stock|</tbody>', p);
    expect(html).toBe('<tbody data-rows="stock"><tr><td colspan="3">|!#-rows_stock|</td></tr></tbody>');
  });
});
