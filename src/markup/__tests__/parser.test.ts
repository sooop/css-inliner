// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMarkup, parseInline, normalizeVariables, parseTxmd } from '../parser';
import { composeForSend } from '../compose';

const GOLDEN = fileURLToPath(new URL('../__golden__/', import.meta.url));
const caseNames = readdirSync(GOLDEN + 'cases')
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

describe('골든: 파이썬 원본 파서 출력과 동일', () => {
  it('골든 케이스가 존재한다', () => {
    expect(caseNames.length).toBeGreaterThanOrEqual(4);
  });
  for (const name of caseNames) {
    it(name, () => {
      const input = readFileSync(`${GOLDEN}cases/${name}.md`, 'utf8');
      const expected = readFileSync(`${GOLDEN}expected/${name}.html`, 'utf8');
      const expectedWarn = readFileSync(`${GOLDEN}expected/${name}.stderr.txt`, 'utf8');
      const r = parseMarkup(input);
      expect(r.html).toBe(expected);
      // 경고 메시지도 원본의 stderr 와 같다
      expect(r.warnings.map((w) => w + '\n').join('')).toBe(expectedWarn);
    });
  }
});

/**
 * 파이썬 원본과 의도적으로 다른 동작(골든 대상 아님). 사유는 parser.ts 상단 주석 참고.
 */
describe('의도적 수정(원본 버그)', () => {
  it('변수·URL 안의 _ 가 강조로 오인되지 않는다 (원본: |!#-cust<em>nm|)', () => {
    expect(parseInline('|!#-cust_nm| 와 |!#-order_no|')).toBe('|!#-cust_nm| 와 |!#-order_no|');
    expect(parseInline('[x](https://a.com/foo_bar_baz)')).toBe('<a href="https://a.com/foo_bar_baz">x</a>');
    expect(parseInline('[x](https://a.com/o/|!#-order_no|)')).toBe('<a href="https://a.com/o/|!#-order_no|">x</a>');
  });
  it('snake_case_word 는 기울임이 아니다, 단어 경계의 _x_ 는 기울임', () => {
    expect(parseInline('snake_case_word')).toBe('snake_case_word');
    expect(parseInline('가 _기울임_ 나')).toBe('가 <em>기울임</em> 나');
    expect(parseInline('__굵게__ ___둘다___')).toBe('<strong>굵게</strong> <strong><em>둘다</em></strong>');
  });
  it('중첩 순서 목록은 무한 루프 없이 중첩 <ol> (원본은 hang)', () => {
    const r = parseMarkup('1. a\n2. b\n   1. c\n   2. d\n3. e', { wrapMain: false });
    expect(r.html).toBe(
      '<ol>\n<li>a</li>\n<li>b<ol>\n<li>c</li>\n<li>d</li>\n</ol></li>\n<li>e</li>\n</ol>',
    );
  });
  it('[버튼,레이블] 쉼표 뒤 공백 없어도 레이블을 자르지 않는다 (원본: 첫 글자 손실)', () => {
    expect(parseMarkup('[버튼,레이블만]', { wrapMain: false }).html).toBe(
      '<p><a href="#" class="btn btn-secondary">레이블만</a></p>',
    );
  });
  it('레이블에 서식이 있는 단일 버튼도 <p> 로 감싼다', () => {
    expect(parseMarkup('[버튼, **확인** 하기, https://x.com]', { wrapMain: false }).html).toBe(
      '<p><a href="https://x.com" class="btn btn-primary"><strong>확인</strong> 하기</a></p>',
    );
  });
  it('{{x}} 는 단일 중괄호 변수 변환 대상이 아니다', () => {
    expect(normalizeVariables('{a} {{b}} {c}')).toBe('|!#-a| {{b}} |!#-c|');
  });
  it('wrapMain=false 는 <main> 을 만들지 않는다(템플릿 <main> 3중 중첩 방지)', () => {
    expect(parseMarkup('안녕', { wrapMain: false }).html).toBe('<p>안녕</p>');
    expect(parseMarkup('안녕').html).toBe('<main>\n<p>안녕</p>\n</main>');
  });
  it('[헤더] 마커는 플레이스홀더 주석으로 남는다(원본 동일)', () => {
    expect(parseMarkup('[헤더]\n안녕').html).toBe('<!--HEADER_PLACEHOLDER--><main>\n<p>안녕</p>\n</main>');
  });
});

describe('.txmd 파싱 (기준 언어 구조 + 문자열표)', () => {
  const SRC = [
    '# 배송 시작 안내',
    '@en Your shipment is on its way',
    '@ja 発送開始のお知らせ',
    '',
    '안녕하세요, |!#-cust_nm|님!',
    '주문하신 **상품**이 출발했습니다.',
    '@en Hello, |!#-cust_nm|!',
    '@en Your **order** is on its way.',
    '@ja |!#-cust_nm|様、ご注文の商品を発送しました。',
    '',
    '- 항목 하나',
    '@en Item one',
    '- 항목 둘',
    '  - 중첩',
    '  @en Nested',
    '',
    '> 인용',
    '@en Quote',
    '',
    '[표: 세로형]',
    '- 주문번호: |!#-order_no|',
    '@en - Order No: |!#-order_no|',
    '- 배송시간| 14:30',
    '@en Delivery time| 14:30',
    '[/표]',
    '',
    '[표: 가로형]',
    '{마켓| 상태}',
    '@en {Market| Status}',
    '- 쿠팡| 정상',
    '@en - Coupang| OK',
    '[/표]',
    '',
    '[정보: 배송 추적]',
    '@en Track shipment',
    '@ja 配送追跡',
    '실시간으로 확인하세요.',
    '@en Check in real time.',
    '[/정보]',
    '',
    '[버튼, 배송 추적하기, https://t.com/|!#-tracking_no|, primary]',
    '@en Track shipment',
    '@ja 配送を追跡',
    '[버튼, 문의, https://s.com]',
  ].join('\n');

  const r = parseTxmd(SRC);

  it('구조에는 텍스트가 없고 모든 텍스트 요소에 data-t 가 있다', () => {
    expect(r.warnings).toEqual([]);
    expect(r.structure).not.toMatch(/[가-힣]/);
    expect(r.structure).toContain('<h1 data-t="b001"></h1>');
    expect(r.structure).toContain('<a href="https://t.com/|!#-tracking_no|" class="btn btn-primary" data-t=');
    expect(r.structure).not.toContain('<main>');
  });

  it('제목 번역', () => {
    expect(r.strings.b001).toEqual({ ko: '배송 시작 안내', en: 'Your shipment is on its way', ja: '発送開始のお知らせ' });
  });

  it('여러 줄 문단: 번역 줄도 줄 수만큼 <br/> 로 합쳐진다', () => {
    expect(r.strings.b002).toEqual({
      ko: '안녕하세요, |!#-cust_nm|님!<br/>주문하신 <strong>상품</strong>이 출발했습니다.',
      en: 'Hello, |!#-cust_nm|!<br/>Your <strong>order</strong> is on its way.',
      ja: '|!#-cust_nm|様、ご注文の商品を発送しました。',
    });
  });

  it('목록 항목(중첩 포함): 번역은 바로 앞 항목에 붙는다', () => {
    expect(r.strings.b003).toEqual({ ko: '항목 하나', en: 'Item one' });
    expect(r.strings.b004).toEqual({ ko: '항목 둘' });
    expect(r.strings.b005).toEqual({ ko: '중첩', en: 'Nested' });
    expect(r.structure).toContain('<li data-t="b004"><ul>');
  });

  it('인용문', () => {
    const q = Object.values(r.strings).find((s) => s.ko === '인용');
    expect(q).toEqual({ ko: '인용', en: 'Quote' });
  });

  it('세로형 표: 행 번역(콜론/파이프 구분자 규칙 동일)', () => {
    const th = Object.values(r.strings).find((s) => s.ko === '주문번호');
    expect(th).toEqual({ ko: '주문번호', en: 'Order No' });
    const tv = Object.values(r.strings).find((s) => s.ko === '14:30');
    expect(tv).toEqual({ ko: '14:30', en: '14:30' });
    const th2 = Object.values(r.strings).find((s) => s.ko === '배송시간');
    expect(th2).toEqual({ ko: '배송시간', en: 'Delivery time' });
  });

  it('가로형 표: 셀 단위 번역', () => {
    expect(Object.values(r.strings).find((s) => s.ko === '마켓')).toEqual({ ko: '마켓', en: 'Market' });
    expect(Object.values(r.strings).find((s) => s.ko === '상태')).toEqual({ ko: '상태', en: 'Status' });
    expect(Object.values(r.strings).find((s) => s.ko === '쿠팡')).toEqual({ ko: '쿠팡', en: 'Coupang' });
    expect(Object.values(r.strings).find((s) => s.ko === '정상')).toEqual({ ko: '정상', en: 'OK' });
  });

  it('콜아웃: 여는 줄 바로 아래 @ 는 제목, 본문 문단 안의 @ 는 문단 번역', () => {
    expect(Object.values(r.strings).find((s) => s.ko === '배송 추적')).toEqual({
      ko: '배송 추적',
      en: 'Track shipment',
      ja: '配送追跡',
    });
    expect(Object.values(r.strings).find((s) => s.ko === '실시간으로 확인하세요.')).toEqual({
      ko: '실시간으로 확인하세요.',
      en: 'Check in real time.',
    });
  });

  it('버튼: @ 줄은 레이블 번역, URL 은 구조에 공통', () => {
    expect(Object.values(r.strings).find((s) => s.ko === '배송 추적하기')).toEqual({
      ko: '배송 추적하기',
      en: 'Track shipment',
      ja: '配送を追跡',
    });
    expect(r.structure).toContain('<p class="btn-group">');
    expect(Object.values(r.strings).find((s) => s.ko === '문의')).toEqual({ ko: '문의' });
  });

  it('치환자·언어·해시 수집', () => {
    expect(r.variables.sort()).toEqual(['cust_nm', 'order_no', 'tracking_no']);
    expect(r.langsFound.sort()).toEqual(['en', 'ja']);
    expect(Object.keys(r.sourceHash.b001).sort()).toEqual(['en', 'ja']);
    expect(r.sourceHash.b004).toBeUndefined();
  });

  it('하위 호환: @ 줄이 없으면 기준 언어 문자열만 있고 구조는 원본 HTML 과 같은 형태', () => {
    const plain = '# 제목\n\n문단 1\n문단 2\n\n- a\n- b';
    const t = parseTxmd(plain);
    expect(Object.values(t.strings).every((s) => Object.keys(s).join() === 'ko')).toBe(true);
    expect(t.structure.replace(/ data-t="[^"]*"/g, '')).toBe(
      '<h1></h1>\n<p></p>\n<ul>\n<li></li>\n<li></li>\n</ul>',
    );
    // ko 문자열을 합성하면 원본 호환 파서의 출력과 같다
    const html = parseMarkup(plain, { wrapMain: false }).html;
    expect(composeForSend(t, 'ko').html).toBe(html);
  });

  it('언어 목록 밖의 @ 줄은 일반 텍스트(이메일 주소 등)로 남는다', () => {
    const t = parseTxmd('문의: \n@fr salut\n\n@example.com 으로 보내세요', { langs: ['en'] });
    expect(Object.values(t.strings).map((s) => s.ko)).toEqual(['문의:<br/>@fr salut', '@example.com 으로 보내세요']);
  });

  it('고아 번역 줄은 경고하고 무시한다', () => {
    const t = parseTxmd('---\n@en orphan\n\n문단');
    expect(t.warnings.some((w) => w.includes('번역 대상 블록이 없는'))).toBe(true);
    expect(Object.values(t.strings).map((s) => s.ko)).toEqual(['문단']);
  });

  it('표 번역 칼럼 수 불일치는 경고 후 보정', () => {
    const t = parseTxmd('[표: 가로형]\n{a| b}\n@en A\n- 1| 2\n[/표]');
    expect(t.warnings.some((w) => w.includes('칼럼 수 불일치'))).toBe(true);
    expect(Object.values(t.strings).find((s) => s.ko === 'b')).toEqual({ ko: 'b', en: '' });
  });
});

describe('동적 표 (.txmd)', () => {
  const SRC = [
    '[표: 가로형, 동적: orders]',
    '{상품명| 수량| 금액}',
    '@en {Item| Qty| Amount}',
    '- {{name}}| {{qty}}개| {{amount}}원',
    '@en - {{name}}| {{qty}} pcs| {{amount}} KRW',
    '@var name 상품명',
    '@var qty 수량',
    '@sample name=무선 이어폰| qty=2| amount=90,000',
    '@sample name=보조배터리| qty=1| amount=32,000',
    '[/표]',
  ].join('\n');
  const r = parseTxmd(SRC);

  it('structure 에는 tbody 자리표시만, 행 템플릿은 dynamicTables 에 구조+문자열로 분리', () => {
    expect(r.warnings).toEqual([]);
    expect(r.structure).toContain('<tbody data-rows="orders"></tbody>');
    expect(r.dynamicTables).toHaveLength(1);
    const t = r.dynamicTables[0];
    expect(t.id).toBe('orders');
    expect(t.rowStructure).toMatch(/^<tr>\n<td data-t="b\d+"><\/td>\n<td data-t="b\d+"><\/td>\n<td data-t="b\d+"><\/td>\n<\/tr>$/);
    const rowStrings = [...t.rowStructure.matchAll(/data-t="([^"]*)"/g)].map((m) => r.strings[m[1]]);
    expect(rowStrings).toEqual([
      { ko: '{{name}}', en: '{{name}}' },
      { ko: '{{qty}}개', en: '{{qty}} pcs' },
      { ko: '{{amount}}원', en: '{{amount}} KRW' },
    ]);
  });

  it('행 변수 추출·설명·예시 행', () => {
    const t = r.dynamicTables[0];
    expect(t.vars).toEqual([
      { name: 'name', description: '상품명', sample: '무선 이어폰' },
      { name: 'qty', description: '수량', sample: '2' },
      { name: 'amount', description: '', sample: '90,000' },
    ]);
    expect(t.sampleRows).toEqual([
      { name: '무선 이어폰', qty: '2', amount: '90,000' },
      { name: '보조배터리', qty: '1', amount: '32,000' },
    ]);
  });

  it('{{var}} 는 본문 치환자(variables)에 섞이지 않는다', () => {
    expect(r.variables).toEqual([]);
  });

  it('행 템플릿이 2개 이상이면 경고하고 첫 행만 사용', () => {
    const t = parseTxmd('[표: 가로형, 동적: t]\n{a}x\n[/표]'.replace('{a}x', '{a| b}\n- {{x}}| 1\n- {{y}}| 2'));
    expect(t.warnings.some((w) => w.includes('행 템플릿 1개만'))).toBe(true);
    expect(t.dynamicTables[0].vars.map((v) => v.name)).toEqual(['x']);
  });

  it('언어별 행 변수 누락은 경고', () => {
    const t = parseTxmd('[표: 가로형, 동적: t]\n{a| b}\n- {{x}}| {{y}}\n@en - {{x}}| fixed\n[/표]');
    expect(t.warnings.some((w) => w.includes("'en' 행 템플릿에 변수가 빠졌습니다"))).toBe(true);
  });

  it('parseMarkup(원본 호환 경로)에서는 표식 치환자만 남긴다', () => {
    const h = parseMarkup('[표: 가로형, 동적: orders]\n{a}\n[/표]'.replace('{a}', '{a| b}\n- 1| 2'), { wrapMain: false }).html;
    expect(h).toContain('<tbody>|!#-rows_orders|</tbody>');
  });
});
