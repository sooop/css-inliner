// @vitest-environment node
/**
 * 확장 문법 테스트(P2 재작업): 콜아웃 안 중첩 콘텐츠, ~~취소선~~, 중첩 번역 줄, 분해·합성 왕복.
 * 기대값 출처: __golden__/handwritten/ (sample/sample.html 발췌, README 참조). 파이썬 원본에는 정답이 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMarkup, parseInline, parseTxmd } from '../parser';
import { composeForSend, composeLang, decompose, sanitizeInline } from '../compose';
import { ensureLinkTargets } from '../links';

const HW = fileURLToPath(new URL('../__golden__/handwritten/', import.meta.url));
const read = (f: string) => readFileSync(HW + f, 'utf8').replace(/\r\n/g, '\n');
const md = (src: string) => parseMarkup(src, { wrapMain: false });
const plain = (html: string) => html.replace(/ data-t="[^"]*"/g, '');

describe('수기 골든 (sample.html 발췌)', () => {
  it('콜아웃 안 목록·가로형 표·세로형 표·버튼 = sample.html 구조와 동일', () => {
    const r = md(read('callout-nested.md'));
    expect(r.html).toBe(read('callout-nested.expected.html'));
    expect(r.warnings).toEqual([]);
  });
  it('인라인 서식 문단(굵게·기울임·취소선·링크·변수) = sample.html 531행', () => {
    expect(md(read('inline-del.md')).html).toBe(read('inline-del.expected.html'));
  });
  it('.txmd 경로도 ko 합성 결과가 같다', () => {
    const t = parseTxmd(read('callout-nested.md'));
    expect(t.warnings).toEqual([]);
    expect(composeForSend(t, 'ko').html).toBe(ensureLinkTargets(read('callout-nested.expected.html')));
  });
});

describe('취소선 ~~text~~', () => {
  it('기본·다른 서식과 중첩', () => {
    expect(parseInline('a ~~지움~~ b')).toBe('a <del>지움</del> b');
    expect(parseInline('~~**굵게 지움**~~')).toBe('<del><strong>굵게 지움</strong></del>');
    expect(parseInline('**a ~~b~~ c**')).toBe('<strong>a <del>b</del> c</strong>');
    expect(parseInline('[~~링크~~](https://x.com)')).toBe('<a href="https://x.com"><del>링크</del></a>');
  });
  it('변수·{{행 변수}}·URL 안의 ~ _ * 는 오인하지 않는다', () => {
    expect(parseInline('|!#-a_b_c| |!#-d.e-f|')).toBe('|!#-a_b_c| |!#-d.e-f|');
    expect(parseInline('{{a_b_c}} {{d.e-f}}')).toBe('{{a_b_c}} {{d.e-f}}');
    expect(parseInline('~~|!#-a|~~ 와 ~~{{b}}~~')).toBe('<del>|!#-a|</del> 와 <del>{{b}}</del>');
    expect(parseInline('~~|!#-x_y|~~')).toBe('<del>|!#-x_y|</del>');
    expect(parseInline('[x](https://a.com/~~u~~/_a_/*b*)')).toBe('<a href="https://a.com/~~u~~/_a_/*b*">x</a>');
    expect(parseInline('보기 https://a.com/~~u~~/_a_/*b* 끝')).toBe('보기 https://a.com/~~u~~/_a_/*b* 끝');
    expect(parseInline('https://a.com/x/|!#-order_no|/~~z~~')).toBe('https://a.com/x/|!#-order_no|/~~z~~');
  });
  it('인식하지 않는 형태: 단일 ~, 공백 낀 쌍, 3개 이상 연속, 닫힘 없음', () => {
    expect(parseInline('월~금 10~20')).toBe('월~금 10~20');
    expect(parseInline('a ~~ b ~~ c')).toBe('a ~~ b ~~ c');
    expect(parseInline('~~~x~~~')).toBe('~~~x~~~');
    expect(parseInline('~~닫힘 없음')).toBe('~~닫힘 없음');
  });
  it('HTML 은 여전히 이스케이프된다', () => {
    expect(parseInline('~~<b>x</b>~~')).toBe('<del>&lt;b&gt;x&lt;/b&gt;</del>');
  });
  it('sanitizeInline 은 del 을 허용한다(그 외 태그는 제거)', () => {
    expect(sanitizeInline('a <del>b</del> <s>c</s>')).toEqual({ html: 'a <del>b</del> c', removed: ['s', 's'] });
  });
  it('모든 블록 종류의 문자열에서 동작(제목·목록·표 셀·버튼 레이블)', () => {
    const r = parseTxmd('# ~~옛~~ 제목\n- ~~a~~\n[표: 세로형]\n- ~~h~~: ~~v~~\n[/표]\n[버튼, ~~x~~ y, #]');
    expect(Object.values(r.strings).map((s) => s.ko)).toEqual([
      '<del>옛</del> 제목', '<del>a</del>', '<del>h</del>', '<del>v</del>', '<del>x</del> y',
    ]);
  });
});

describe('콜아웃 안 중첩 콘텐츠 (parseMarkup)', () => {
  it('비순서·중첩 목록', () => {
    const r = md('[정보: 목록]\n- a\n- b\n  - c\n[/정보]');
    expect(r.html).toBe(
      '<div class="callout callout-info">\n<h3>목록</h3>\n<ul>\n<li>a</li>\n<li>b<ul>\n<li>c</li>\n</ul></li>\n</ul>\n</div>',
    );
    expect(r.warnings).toEqual([]);
  });
  it('순서 목록 중첩', () => {
    expect(md('[경고]\n1. a\n2. b\n   1. c\n[/경고]').html).toBe(
      '<div class="callout callout-warn">\n<ol>\n<li>a</li>\n<li>b<ol>\n<li>c</li>\n</ol></li>\n</ol>\n</div>',
    );
  });
  it('문단 바로 뒤(빈 줄 없이) 목록·표·버튼·인용이 이어져도 경계가 갈린다', () => {
    const r = md('[강조: t]\n앞 문단\n- 항목\n[버튼, 확인, #]\n> 인용\n[/강조]');
    expect(r.html).toBe(
      '<div class="callout callout-accent">\n<h3>t</h3>\n<p>앞 문단</p>\n<ul>\n<li>항목</li>\n</ul>\n' +
        '<p><a href="#" class="btn btn-primary">확인</a></p>\n<blockquote><p>인용</p></blockquote>\n</div>',
    );
  });
  it('버튼 그룹', () => {
    expect(md('[정보]\n[버튼, 확인, https://a.com]\n[버튼, 취소, https://b.com]\n[/정보]').html).toBe(
      '<div class="callout callout-info">\n<p class="btn-group"><a href="https://a.com" class="btn btn-primary">확인</a>' +
        '<a href="https://b.com" class="btn btn-warn">취소</a></p>\n</div>',
    );
  });
  it('구분선·소제목(###)', () => {
    expect(md('[정보]\n### 소제목\n본문\n---\n뒷문단\n[/정보]').html).toBe(
      '<div class="callout callout-info">\n<h3>소제목</h3>\n<p>본문</p>\n<hr>\n<p>뒷문단</p>\n</div>',
    );
  });
  it('인용 여러 줄', () => {
    expect(md('[정보]\n> 가\n> 나\n[/정보]').html).toBe(
      '<div class="callout callout-info">\n<blockquote><p>가<br>나</p></blockquote>\n</div>',
    );
  });
  it('가로형 표 + 세로형 표가 한 콜아웃에 함께', () => {
    const h = md('[정보]\n[표: 가로형]\n{a| b}\n- 1| 2\n[/표]\n\n[표: 세로형]\n- k: v\n[/표]\n[/정보]').html;
    expect(h.match(/<table class="table-horizontal">/g)).toHaveLength(1);
    expect(h.match(/<table class="table-vertical">/g)).toHaveLength(1);
    expect(h.indexOf('table-horizontal')).toBeLessThan(h.indexOf('table-vertical'));
    expect(h.endsWith('</table>\n</div>')).toBe(true);
  });
  it('원본 호환 동작은 유지: 제목·문단만 있는 콜아웃, 제목 없는 콜아웃', () => {
    expect(md('[정보: 제목]\n문단\n\n둘째 **굵게**\n[/정보]').html).toBe(
      '<div class="callout callout-info">\n<h3>제목</h3>\n<p>문단</p>\n<p>둘째 <strong>굵게</strong></p>\n</div>',
    );
  });
});

describe('콜아웃 경계·오류 케이스', () => {
  it('콜아웃 안 콜아웃: 인용으로 낮추고 .txmd 경로에서는 경고', () => {
    const src = '[정보]\n바깥\n[경고: 안쪽]\n중첩\n[/경고]\n뒤 문단\n[/정보]';
    expect(md(src).html).toBe(
      '<div class="callout callout-info">\n<p>바깥</p>\n<blockquote><p>중첩</p></blockquote>\n<p>뒤 문단</p>\n</div>',
    );
    expect(md(src).warnings).toEqual([]); // 원본 stderr 와의 골든 호환을 위해 parseMarkup 은 경고 없음
    const t = parseTxmd(src);
    expect(t.warnings.some((w) => w.includes('콜아웃 안의 콜아웃') && w.includes('line 3'))).toBe(true);
    expect(composeForSend(t, 'ko').html).toBe(md(src).html);
  });
  it('빈 안쪽 콜아웃은 통째로 건너뛴다(닫는 태그가 문단으로 새지 않음)', () => {
    expect(md('[정보]\n[경고]\n[/경고]\n본문\n[/정보]').html).toBe('<div class="callout callout-info">\n<p>본문</p>\n</div>');
  });
  it('닫는 태그 누락: 파일 끝까지 콜아웃, 안의 표·목록도 정상 + 경고', () => {
    const r = md('[정보: t]\n- a\n- b\n[표: 세로형]\n- k: v\n[/표]');
    expect(r.html).toContain('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(r.html).toContain('<table class="table-vertical">');
    expect(r.html.endsWith('</table>\n</div>')).toBe(true);
    expect(r.warnings).toEqual(["경고: 콜아웃 '정보'의 종료 태그가 파일 끝까지 없습니다"]);
  });
  it('콜아웃 안 표의 [/표] 누락: 콜아웃 끝에서 표가 닫히고 경고', () => {
    const r = md('[정보]\n[표: 세로형]\n- k: v\n[/정보]\n뒤');
    expect(r.html).toBe(
      '<div class="callout callout-info">\n<table class="table-vertical">\n<tr>\n<th>k</th>\n<td>v</td>\n</tr>\n</table>\n</div>\n<p>뒤</p>',
    );
    expect(r.warnings.some((w) => w.includes('종료 태그'))).toBe(true);
  });
  it('# / ## 제목은 여전히 콜아웃을 자동 종료한다(### 는 본문 소제목)', () => {
    const r = md('[정보]\n- a\n## 새 절\n문단');
    expect(r.html).toBe('<div class="callout callout-info">\n<ul>\n<li>a</li>\n</ul>\n</div>\n<h2>새 절</h2>\n<p>문단</p>');
    expect(r.warnings[0]).toContain('자동 종료');
  });
  it('콜아웃 안 동적 표는 지원하지 않는다: 경고 후 정적 표로 처리', () => {
    const t = parseTxmd('[정보]\n[표: 가로형, 동적: orders]\n{a| b}\n- {{x}}| 1\n[/표]\n[/정보]');
    expect(t.warnings.some((w) => w.includes('콜아웃 안에서는 동적 표를 지원하지 않습니다') && w.includes("'orders'"))).toBe(true);
    expect(t.dynamicTables).toEqual([]);
    expect(t.structure).not.toContain('data-rows');
    expect(t.structure).toContain('<table class="table-horizontal">');
  });
  it('콜아웃 밖 동적 표는 그대로 동작(회귀)', () => {
    const t = parseTxmd('[표: 가로형, 동적: o]\n{a}\n[/표]'.replace('{a}', '{a| b}\n- {{x}}| 1'));
    expect(t.dynamicTables).toHaveLength(1);
  });
  it('경고의 줄 번호는 콜아웃 본문 안에서도 원문 기준', () => {
    const t = parseTxmd('가\n\n[정보]\n본문\n[표: 세로형]\n# 제목\n[/정보]');
    // `# 제목` 은 콜아웃을 종료(line 6) — 줄 번호는 6 이어야 한다
    expect(t.warnings.find((w) => w.includes('자동 종료'))).toContain('line 6');
  });
});

describe('.txmd 번역 줄: 콜아웃 안 중첩 콘텐츠', () => {
  const SRC = [
    '[정보: 연동 확인]',
    '@en Check before linking',
    '@ja 連携前の確認',
    '시작 전에 **준비**하세요.',
    '@en Prepare **first**.',
    '',
    '- 계정',
    '@en Account',
    '- 키',
    '@en Key',
    '  - 시크릿',
    '  @en Secret',
    '  @ja シークレット',
    '',
    '1. 하나',
    '@en One',
    '',
    '[표: 가로형]',
    '{일자| 내용}',
    '@en {Date| Detail}',
    '- 10-20| 중단',
    '@en - 10-20| Outage',
    '[/표]',
    '',
    '[표: 세로형]',
    '- 업체: CJ',
    '@en - Carrier: CJ',
    '[/표]',
    '',
    '> 인용문',
    '@en Quote',
    '',
    '[버튼, 추적, https://t.com/|!#-no|, primary]',
    '@en Track',
    '[버튼, 문의, https://s.com]',
    '@ja お問い合わせ',
    '[/정보]',
  ].join('\n');
  const t = parseTxmd(SRC);
  const find = (ko: string) => Object.entries(t.strings).find(([, s]) => s.ko === ko);

  it('경고 없음, 구조에 텍스트 없음, 모든 문자열 단위에 data-t', () => {
    expect(t.warnings).toEqual([]);
    expect(t.structure).not.toMatch(/[가-힣]/);
    expect(t.structure).toContain('<div class="callout callout-info">');
    // 콜아웃 안 요소마다 고유 ID
    const ids = [...t.structure.matchAll(/data-t="(b\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(t.strings).sort());
  });
  it('제목 번역은 여는 줄 바로 아래, 이후 줄은 본문 문단 번역', () => {
    expect(find('연동 확인')![1]).toEqual({ ko: '연동 확인', en: 'Check before linking', ja: '連携前の確認' });
    expect(find('시작 전에 <strong>준비</strong>하세요.')![1].en).toBe('Prepare <strong>first</strong>.');
  });
  it('목록 항목(중첩 포함)·순서 목록 항목', () => {
    expect(find('계정')![1]).toEqual({ ko: '계정', en: 'Account' });
    expect(find('키')![1]).toEqual({ ko: '키', en: 'Key' });
    expect(find('시크릿')![1]).toEqual({ ko: '시크릿', en: 'Secret', ja: 'シークレット' });
    expect(find('하나')![1]).toEqual({ ko: '하나', en: 'One' });
    expect(t.structure).toMatch(/<li data-t="b\d+"><ul>/);
  });
  it('표 셀(가로형 헤더·행, 세로형 th/td)', () => {
    expect(find('일자')![1]).toEqual({ ko: '일자', en: 'Date' });
    expect(find('내용')![1]).toEqual({ ko: '내용', en: 'Detail' });
    expect(find('중단')![1]).toEqual({ ko: '중단', en: 'Outage' });
    expect(find('업체')![1]).toEqual({ ko: '업체', en: 'Carrier' });
    expect(find('CJ')![1]).toEqual({ ko: 'CJ', en: 'CJ' });
  });
  it('인용·버튼 레이블(URL·스타일은 공통)', () => {
    expect(find('인용문')![1]).toEqual({ ko: '인용문', en: 'Quote' });
    expect(find('추적')![1]).toEqual({ ko: '추적', en: 'Track' });
    expect(find('문의')![1]).toEqual({ ko: '문의', ja: 'お問い合わせ' });
    expect(t.structure).toContain('<p class="btn-group"><a href="https://t.com/|!#-no|" class="btn btn-primary" data-t=');
  });
  it('치환자 수집·언어·해시', () => {
    expect(t.variables).toEqual(['no']);
    expect(t.langsFound.sort()).toEqual(['en', 'ja']);
    const id = find('계정')![0];
    expect(Object.keys(t.sourceHash[id])).toEqual(['en']);
  });
  it('ko 합성 = 번역 줄을 뺀 원문을 parseMarkup 한 결과', () => {
    const koOnly = SRC.split('\n').filter((l) => !/^\s*@(en|ja)\b/.test(l)).join('\n');
    expect(composeForSend(t, 'ko').html).toBe(ensureLinkTargets(md(koOnly).html));
  });
  it('en 합성: 같은 구조에 영어 문자열, 미번역 문자열은 비어 있음, 발송용은 data-t 없음', () => {
    const en = composeForSend(t, 'en').html;
    expect(en).not.toContain('data-t');
    expect(en).toContain('<h3>Check before linking</h3>');
    expect(en).toContain('<li>Key<ul>\n<li>Secret</li>');
    expect(en).toContain('<th>Carrier</th>');
    expect(en).toContain('class="btn btn-primary" target="_blank" rel="noopener noreferrer">Track</a>');
    expect(en).toContain('class="btn btn-secondary" target="_blank" rel="noopener noreferrer"></a>'); // '문의' 는 en 미번역
    // 구조(태그 뼈대)는 언어와 무관하게 동일
    const skeleton = (h: string) => h.replace(/>[^<]*</g, '><');
    expect(skeleton(en)).toBe(skeleton(composeForSend(t, 'ko').html));
    expect(composeForSend(t, 'ja').html).toContain('<h3>連携前の確認</h3>');
  });
  it('fallbackToBase 로 미번역은 기준 언어로 채워진다', () => {
    const en = composeForSend(t, 'en', { fallbackToBase: true }).html;
    expect(en).toContain('class="btn btn-secondary" target="_blank" rel="noopener noreferrer">문의</a>');
  });
});

describe('분해·합성 왕복', () => {
  const SRC = [
    '[강조: 제목 ~~옛~~]',
    '@en Title',
    '문단 `x` ~~취소~~',
    '@en Para ~~del~~',
    '- 가',
    '@en A',
    '  - 나',
    '  @en B',
    '[표: 세로형]',
    '- 키: 값',
    '@en - Key: Val',
    '[/표]',
    '[버튼, 확인, https://a.com/|!#-n|]',
    '@en OK',
    '[/강조]',
  ].join('\n');

  it('parseTxmd → 합성 → decompose → 합성 이 모든 언어에서 동일', () => {
    const t = parseTxmd(SRC);
    expect(t.warnings).toEqual([]);
    for (const lang of ['ko', 'en']) {
      const html = composeForSend(t, lang).html;
      const d = decompose(html, { baseLang: lang });
      // 분해 결과를 같은 언어로 다시 합성하면 원문과 같다
      expect(composeForSend({ structure: d.structure, strings: d.strings }, lang).html).toBe(html);
      // 구조에는 텍스트가 없다
      expect(d.structure.replace(/<[^>]*>/g, '').trim()).toBe('');
    }
  });
  it('미리보기 합성(data-t 유지)에서 발송용 합성 = data-t 만 제거한 결과', () => {
    const t = parseTxmd(SRC);
    const withIds = composeLang(t, 'en', { stripIds: false }).html;
    expect(plain(withIds)).toBe(composeForSend(t, 'en').html);
    expect(withIds).toMatch(/data-t="b\d+"/);
  });
  it('del 은 문자열에 저장되고 합성 때 보존, 알 수 없는 태그는 제거', () => {
    const t = parseTxmd(SRC);
    expect(Object.values(t.strings).some((s) => s.ko === '문단 `x` <del>취소</del>' && s.en === 'Para <del>del</del>')).toBe(true);
    const r = composeForSend(
      { structure: '<p data-t="b001"></p>', strings: { b001: { ko: 'a <del>b</del> <script>x</script>' } } },
      'ko',
    );
    expect(r.html).toBe('<p>a <del>b</del> x</p>');
    expect(r.warnings.map((w) => w.code)).toEqual(['inline-tag-removed']);
  });
  it('원본 호환 경로(parseMarkup)의 콜아웃 중첩 결과를 decompose 하면 문자열 단위가 문서 순서대로 나온다', () => {
    const html = md(read('callout-nested.md')).html;
    const d = decompose(html);
    const ko = Object.values(d.strings).map((s) => s.ko);
    expect(ko[0]).toBe('콜아웃 안의 목록과 서식');
    expect(ko).toContain('연동 전 확인사항');
    expect(ko).toContain('<strong>연동을 시작하기 전에</strong> 아래 항목을 준비해 주세요.');
    expect(ko).toContain('API 인증키 및 시크릿 키');
    expect(ko).toContain('배송 추적하기');
    expect(composeForSend(d, 'ko').html).toBe(ensureLinkTargets(html));
  });
});
