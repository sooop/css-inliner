import { createProject, type Project } from '../model';
import type { InlineFn } from '../render';

/** 동적 표(orders) 1개와 정적 표 1개를 가진 ko/en/ja 프로젝트 */
export function makeProject(over: Partial<Project> = {}): Project {
  return createProject({
    id: 'proj-1',
    name: '배송 시작 안내',
    templateCode: 'SHIP_START',
    structure:
      '<table class="wrap"><tbody><tr><td>' +
      '<img class="logo" src="data:image/png;base64,iVBORw0KGgo=" alt="TRACXLOGIS">' +
      '<h1 data-t="b001"></h1>' +
      '<p data-t="b002"></p>' +
      '<table class="info"><tbody><tr><th data-t="b003"></th><td>|!#-order_no|</td></tr></tbody></table>' +
      '<table class="table-horizontal"><thead><tr><th data-t="b004"></th><th data-t="b005"></th></tr></thead><tbody data-rows="orders"></tbody></table>' +
      '</td></tr></tbody></table>',
    strings: {
      b001: { ko: '배송이 시작되었습니다', en: 'Your shipment is on its way', ja: '発送を開始しました' },
      b002: { ko: '<strong>|!#-cust_nm|</strong>님, 안녕하세요.', en: 'Hello, <strong>|!#-cust_nm|</strong>.', ja: '<strong>|!#-cust_nm|</strong>様、こんにちは。' },
      b003: { ko: '주문번호', en: 'Order No.', ja: '注文番号' },
      b004: { ko: '상품', en: 'Item', ja: '商品' },
      b005: { ko: '수량', en: 'Qty', ja: '数量' },
      b006: { ko: '{{name}}', en: '{{name}}', ja: '{{name}}' },
      b007: { ko: '{{qty}}개', en: '{{qty}} pcs', ja: '{{qty}}個' },
    },
    dynamicTables: [
      {
        id: 'orders',
        rowStructure: '<tr><td data-t="b006"></td><td data-t="b007"></td></tr>',
        vars: [
          { name: 'name', description: '상품명', sample: '무선 이어폰' },
          { name: 'qty', description: '수량', sample: '2' },
        ],
        sampleRows: [
          { name: '무선 이어폰', qty: '2' },
          { name: '케이블 <3m> & "세트"', qty: '1' },
        ],
      },
    ],
    subject: { ko: '[TRACXLOGIS] 배송 시작 (|!#-order_no|)', en: '[TRACXLOGIS] Shipped (|!#-order_no|)', ja: '[TRACXLOGIS] 発送 (|!#-order_no|)' },
    variables: [
      { name: 'cust_nm', description: '고객명', sample: '홍길동' },
      { name: 'order_no', description: '주문번호', sample: 'A-1001' },
    ],
    settings: { profile: 'email', logoUrl: '', renderWidth: 1000, mailSafeLayout: false },
    updatedAt: 1760400000000,
    ...over,
  });
}

/**
 * fake 변환기: 실제 엔진처럼 `<tr>`/`<td>`/`<th>` 에 style 을 달고, 행 사이에 개행·들여쓰기를 넣는다.
 * calls 에 호출 기록을 남긴다.
 */
export function makeFakeInline(extra?: (html: string) => { html: string; warnings?: { level: string; code: string; message: string }[] }) {
  const calls: { html: string; css: string }[] = [];
  const inline: InlineFn = async (html, css) => {
    calls.push({ html, css });
    let out = html
      .replace(/<tr>/g, '\n  <tr style="height: 20px;">')
      .replace(/<td>/g, '<td style="padding: 4px;">')
      .replace(/<th>/g, '<th style="padding: 4px;">')
      .replace(/<(td|th)( data-t="[^"]*")?>/g, '<$1$2 style="padding: 4px;">');
    // 속성이 없는 td/th(위 치환 후 style 이 붙지 않은 것)는 없으므로 그대로
    const warnings: { level: string; code: string; message: string }[] = [{ level: 'info', code: 'media-query', message: '무시되는 info' }];
    if (extra) {
      const r = extra(out);
      out = r.html;
      warnings.push(...(r.warnings ?? []));
    }
    return { html: out, warnings };
  };
  return { inline, calls };
}
