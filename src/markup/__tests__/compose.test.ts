// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTxmd } from '../parser';
import { ensureLinkTargets } from '../links';
import {
  decompose,
  composeLang,
  composeForSend,
  composePreview,
  sanitizeInline,
  extractRowVars,
  extractPlaceholders,
  findVariableConflicts,
  fillRowVars,
} from '../compose';
import { hashText, findStale, inheritIds, listBlocks, stampMissing } from '../ids';
import type { DynamicTable } from '../types';

const GOLDEN = fileURLToPath(new URL('../__golden__/', import.meta.url));
const expectedFiles = readdirSync(GOLDEN + 'expected').filter((f) => f.endsWith('.html'));

describe('분해 -> 합성 왕복', () => {
  for (const f of expectedFiles) {
    it(`원본 HTML 과 동일: ${f}`, () => {
      const html = readFileSync(GOLDEN + 'expected/' + f, 'utf8');
      const { structure, strings } = decompose(html);
      expect(Object.keys(strings).length).toBeGreaterThan(0);
      // 구조에는 텍스트가 남지 않는다(요소 직접 텍스트 없음)
      expect(structure).toMatch(/data-t="b001"/);
      const out = composeForSend({ structure, strings }, 'ko');
      expect(out.warnings).toEqual([]);
      // 파서 원본(골든)은 그대로 두고, 합성은 링크에 target/rel 이 더해진 것만 다르다
      expect(out.html).toBe(ensureLinkTargets(html));
      // ID 를 유지한 합성은 data-t 를 지우면 원본과 같다
      const keep = composeLang({ structure, strings }, 'ko').html;
      expect(keep.replace(/ data-t="[^"]*"/g, '')).toBe(ensureLinkTargets(html));
    });
  }

  it('li 는 자기 텍스트만 문자열이 되고 중첩 목록은 구조에 남는다', () => {
    const { structure, strings } = decompose('<ul>\n<li>부모<ul>\n<li>자식</li>\n</ul></li>\n</ul>');
    expect(structure).toBe('<ul>\n<li data-t="b001"><ul>\n<li data-t="b002"></li>\n</ul></li>\n</ul>');
    expect(strings).toEqual({ b001: { ko: '부모' }, b002: { ko: '자식' } });
  });

  it('버튼 그룹 <p> 는 컨테이너라 문자열이 되지 않고 a.btn 이 단위', () => {
    const { structure, strings } = decompose('<p class="btn-group"><a href="u" class="btn btn-primary">확인</a></p>');
    expect(structure).toBe('<p class="btn-group"><a href="u" class="btn btn-primary" data-t="b001"></a></p>');
    expect(strings.b001.ko).toBe('확인');
  });
});

describe('언어별 합성', () => {
  const { structure, strings } = decompose('<h1>제목</h1>\n<p>안녕 |!#-cust_nm|님</p>');
  strings.b001.en = 'Title';
  strings.b002.en = 'Hello |!#-cust_nm|';

  it('언어별 문자열을 채운다', () => {
    expect(composeForSend({ structure, strings }, 'en').html).toBe('<h1>Title</h1>\n<p>Hello |!#-cust_nm|</p>');
  });
  it('번역이 없으면 빈 문자열, fallbackToBase 면 기준 언어', () => {
    expect(composeForSend({ structure, strings }, 'ja').html).toBe('<h1></h1>\n<p></p>');
    expect(composeForSend({ structure, strings }, 'ja', { fallbackToBase: true }).html).toBe(
      '<h1>제목</h1>\n<p>안녕 |!#-cust_nm|님</p>',
    );
  });
  it('발송용은 data-t 가 없고, 편집용은 data-t 가 남는다', () => {
    expect(composeForSend({ structure, strings }, 'ko').html).not.toContain('data-t');
    expect(composeLang({ structure, strings }, 'ko').html).toContain('data-t="b001"');
  });
});

describe('허용 외 인라인 태그 제거', () => {
  it('strong/em/a/br 은 유지, 나머지는 태그만 제거하고 경고', () => {
    const r = sanitizeInline('a <strong>b</strong> <em>c</em> <a href="x">d</a><br/>e<br>f <span style="x">g</span> <script>h</script><!-- c -->');
    expect(r.html).toBe('a <strong>b</strong> <em>c</em> <a href="x">d</a><br/>e<br>f g h');
    expect(r.removed.sort()).toEqual(['<!-- -->', 'script', 'script', 'span', 'span'].sort());
  });
  it('위험한 a(on* / javascript:)는 제거', () => {
    expect(sanitizeInline('<a href="javascript:alert(1)">x</a>').html).toBe('x</a>');
    expect(sanitizeInline('<a href="u" onclick="x()">x</a>').html).toBe('x</a>');
  });
  it('합성 결과에 경고가 담긴다', () => {
    const r = composeForSend(
      { structure: '<p data-t="b001"></p>', strings: { b001: { ko: '<div>안녕</div> <b>굵게</b>' } } },
      'ko',
    );
    expect(r.html).toBe('<p>안녕 굵게</p>');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: 'inline-tag-removed', id: 'b001', lang: 'ko' });
    expect(r.warnings[0].message).toContain('div');
  });
});

describe('동적 표 합성', () => {
  const r = parseTxmd(
    [
      '[표: 가로형, 동적: orders]',
      '{상품명| 수량}',
      '@en {Item| Qty}',
      '- {{name}}| {{qty}}개',
      '@en - {{name}}| {{qty}} pcs',
      '@sample name=이어폰 <A>| qty=2',
      '@sample name=배터리| qty=1',
      '[/표]',
    ].join('\n'),
  );
  const src = { structure: r.structure, strings: r.strings, dynamicTables: r.dynamicTables };

  it('발송용: tbody 안은 표식 치환자 하나뿐, 속성·행 템플릿·예시 행 없음', () => {
    for (const lang of ['ko', 'en']) {
      const h = composeForSend(src, lang).html;
      expect(h).toContain('<tbody>|!#-rows_orders|</tbody>');
      expect(h).not.toContain('data-');
      expect(h).not.toContain('{{');
      expect(h).not.toContain('<td>이어폰');
    }
    expect(composeForSend(src, 'en').html).toContain('<th>Item</th>');
  });

  it('미리보기: 예시 행을 행 템플릿(언어별)에 채우고 값은 이스케이프', () => {
    const ko = composePreview(src, 'ko').html;
    expect(ko).toContain('<td data-t=');
    expect(ko).toMatch(/<tbody data-rows="orders">\n<tr>\n<td data-t="b\d+">이어폰 &lt;A&gt;<\/td>\n<td data-t="b\d+">2개<\/td>\n<\/tr>\n<tr>/);
    const en = composeLang(src, 'en', { mode: 'preview', stripIds: true }).html;
    expect(en).toContain('<tbody>\n<tr>\n<td>이어폰 &lt;A&gt;</td>\n<td>2 pcs</td>\n</tr>\n<tr>\n<td>배터리</td>\n<td>1 pcs</td>\n</tr>\n</tbody>');
    expect(en).not.toContain('|!#-rows_');
  });

  it('예시 행이 없으면 미리보기도 표식 치환자', () => {
    const t = { ...src, dynamicTables: src.dynamicTables.map((d) => ({ ...d, sampleRows: [] })) };
    expect(composeLang(t, 'ko', { mode: 'preview', stripIds: true }).html).toContain('<tbody>|!#-rows_orders|</tbody>');
  });

  it('{{var}} 추출, 예시 행 채우기', () => {
    expect(extractRowVars('{{a}} 와 {{b_c}} {{a}} |!#-x|')).toEqual(['a', 'b_c']);
    expect(extractPlaceholders('{{a}} |!#-x| |!#-y_z| |!#-x|')).toEqual(['x', 'y_z']);
    expect(fillRowVars('<td>{{a}}-{{b}}</td>', { a: '1&2' })).toBe('<td>1&amp;2-</td>');
  });
});

describe('표식/행 변수 이름 충돌 검출', () => {
  const table = (over: Partial<DynamicTable> = {}): DynamicTable => ({
    id: 'orders',
    rowStructure: '<tr><td data-t="b010"></td></tr>',
    vars: [{ name: 'name', description: '', sample: '' }],
    sampleRows: [],
    ...over,
  });
  const base = {
    structure: '<p data-t="b001"></p><tbody data-rows="orders"></tbody>',
    strings: { b001: { ko: '|!#-cust_nm|' }, b010: { ko: '{{name}}', en: '{{name}}' } },
  };

  it('정상이면 문제 없음', () => {
    expect(findVariableConflicts({ ...base, dynamicTables: [table()] })).toEqual([]);
  });
  it('행 변수가 본문 치환자와 같은 이름', () => {
    const issues = findVariableConflicts({
      structure: base.structure,
      strings: { b001: { ko: '|!#-name|' }, b010: base.strings.b010 },
      dynamicTables: [table()],
    });
    expect(issues.map((i) => i.code)).toEqual(['row-var-collides-with-placeholder']);
  });
  it('본문이 표식 치환자 |!#-rows_orders| 를 직접 사용', () => {
    const issues = findVariableConflicts({
      structure: base.structure,
      strings: { b001: { ko: '|!#-rows_orders|' }, b010: base.strings.b010 },
      dynamicTables: [table()],
    });
    expect(issues.map((i) => i.code)).toContain('marker-collides');
  });
  it('표 id 중복·형식 오류', () => {
    const issues = findVariableConflicts({ ...base, dynamicTables: [table(), table({ id: 'a b' })] }).map((i) => i.code);
    expect(issues).toContain('table-id-invalid');
    const dup = findVariableConflicts({ ...base, dynamicTables: [table(), table()] }).map((i) => i.code);
    expect(dup).toContain('table-id-duplicate');
  });
  it('언어 간 행 변수 불일치·미선언 변수', () => {
    const issues = findVariableConflicts({
      structure: base.structure,
      strings: { b001: base.strings.b001, b010: { ko: '{{name}} {{qty}}', en: '{{name}}' } },
      dynamicTables: [table()],
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('row-var-mismatch');
    expect(codes).toContain('row-var-undeclared');
  });
});

describe('ID 이어받기 · 오래됨 판정', () => {
  const prevParsed = parseTxmd('# 제목\n@en Title\n\n문단 하나\n@en Para one\n\n문단 둘\n@en Para two');
  const prev = { structure: prevParsed.structure, strings: prevParsed.strings, sourceHash: prevParsed.sourceHash };

  it('해시: 같은 문자열은 같고 다르면 다르다', () => {
    expect(hashText('가나다')).toBe(hashText('가나다'));
    expect(hashText('가나다')).not.toBe(hashText('가나라'));
    expect(hashText('a')).toMatch(/^[0-9a-f]{14}$/);
  });

  it('새로 파싱한 직후에는 오래된 번역이 없다', () => {
    expect(findStale(prev.strings, prev.sourceHash, 'ko')).toEqual([]);
  });

  it('원문이 바뀐 블록은 ID 를 이어받고 번역은 오래됨, 같은 블록은 번역 유지', () => {
    const next = parseTxmd('# 제목\n\n문단 하나 (수정됨)\n\n문단 둘');
    const merged = inheritIds(prev, next, 'ko');
    expect(merged.report.kept).toEqual(['b001', 'b003']);
    expect(merged.report.changed).toEqual(['b002']);
    expect(merged.strings.b001.en).toBe('Title');
    expect(merged.strings.b002).toEqual({ ko: '문단 하나 (수정됨)', en: 'Para one' });
    expect(merged.strings.b003.en).toBe('Para two');
    expect(findStale(merged.strings, merged.sourceHash, 'ko')).toEqual([{ id: 'b002', lang: 'en' }]);
  });

  it('중간에 블록이 삽입돼도 기존 ID 가 밀리지 않는다', () => {
    const next = parseTxmd('# 제목\n\n새 문단\n\n문단 하나\n\n문단 둘');
    const merged = inheritIds(prev, next, 'ko');
    expect(merged.report.added).toEqual(['b004']);
    expect(merged.report.kept).toEqual(['b001', 'b002', 'b003']);
    expect(listBlocks(merged.structure).map((b) => b.id)).toEqual(['b001', 'b004', 'b002', 'b003']);
    expect(merged.strings.b002.en).toBe('Para one');
    expect(merged.strings.b004).toEqual({ ko: '새 문단' });
    expect(findStale(merged.strings, merged.sourceHash, 'ko')).toEqual([]);
  });

  it('삭제된 블록은 report.removed, 새 파싱의 번역은 이전 것을 덮어씀', () => {
    const next = parseTxmd('# 제목\n@en New Title\n\n문단 둘');
    const merged = inheritIds(prev, next, 'ko');
    expect(merged.report.removed).toEqual(['b002']);
    expect(merged.strings.b001.en).toBe('New Title');
    expect(merged.strings.b002).toBeUndefined();
    expect(Object.keys(merged.strings)).toEqual(['b001', 'b003']);
  });

  it('stampMissing: 해시 없는 번역에만 현재 해시를 기록', () => {
    const h = stampMissing({ b1: { en: 'old' } }, { b1: { ko: 'x', en: 'y', ja: 'z' } }, 'ko');
    expect(h.b1.en).toBe('old');
    expect(h.b1.ja).toBe(hashText('x'));
  });
});
