import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyLogoUrl,
  buildBundle,
  buildHandoffMd,
  computeChecksum,
  exportBundle,
  GMAIL_CLIP_BYTES,
  hasErrors,
  maxRowsWithin,
  renderProject,
  restoreProject,
  sha256Hex,
  validateProject,
  verifyBundle,
} from '../index';
import { makeFakeInline, makeProject } from './fixture';
import { wrapShell } from '../../markup/shell';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('sha256', () => {
  it('표준 벡터와 UTF-8 이 node crypto 와 일치', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const s = '배송 시작 안내 ' + 'あ'.repeat(200) + 'x'.repeat(55);
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

describe('maxRowsWithin', () => {
  it('한도 내 최대 행 수', () => {
    expect(maxRowsWithin(2000, 100, 10000)).toBe(80);
    expect(maxRowsWithin(10000, 100, 10000)).toBe(0);
    expect(maxRowsWithin(20000, 100, 10000)).toBe(0);
    expect(maxRowsWithin(0, 0)).toBe(Infinity);
    expect(maxRowsWithin(1024, 1024)).toBe(101);
  });
});

describe('renderProject', () => {
  it('언어별 본문: 표식 1개, data-t 없음, 로고 base64 유지', async () => {
    const { inline } = makeFakeInline();
    const r = await renderProject(makeProject(), { inline });
    for (const lang of ['ko', 'en', 'ja']) {
      const html = r.locales[lang].html;
      expect(html.split('|!#-rows_orders|').length - 1).toBe(1);
      expect(html).not.toMatch(/data-t|data-rows/);
      expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
      expect(html).not.toContain('{{');
    }
    expect(r.locales.en.html).toContain('Your shipment is on its way');
    expect(r.locales.ko.subject).toContain('|!#-order_no|');
  });

  it('행 템플릿: 언어별 인라인 적용 <tr>…</tr> 한 줄 + {{var}}, 열 수', async () => {
    const { inline } = makeFakeInline();
    const r = await renderProject(makeProject(), { inline });
    const t = r.dynamicTables[0];
    expect(t.marker).toBe('|!#-rows_orders|');
    expect(t.columns).toBe(2);
    expect(t.rowTemplates.ko).toBe('<tr style="height: 20px;"><td style="padding: 4px;">{{name}}</td><td style="padding: 4px;">{{qty}}개</td></tr>');
    expect(t.rowTemplates.en).toContain('{{qty}} pcs');
    expect(t.rowTemplates.ja).toContain('{{qty}}個');
    for (const row of Object.values(t.rowTemplates)) expect(row).not.toMatch(/\n/);
  });

  it('인라인 호출: 언어마다 본문 + 행 템플릿 2회, info 경고는 제외', async () => {
    const { inline, calls } = makeFakeInline((h) => ({ html: h, warnings: [{ level: 'warn', code: 'positioning', message: '위치 지정' }] }));
    const r = await renderProject(makeProject(), { inline, css: 'p{color:red}' });
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.css === 'p{color:red}')).toBe(true);
    expect(r.warnings.every((w) => w.code === 'positioning')).toBe(true);
    expect(r.warnings).toHaveLength(6);
  });

  it('동적 표가 없으면 언어당 1회만 인라인', async () => {
    const { inline, calls } = makeFakeInline();
    const p = makeProject({ dynamicTables: [], structure: '<p data-t="b001"></p>', strings: { b001: { ko: 'a', en: 'b', ja: 'c' } } });
    const r = await renderProject(p, { inline });
    expect(calls).toHaveLength(3);
    expect(r.dynamicTables).toEqual([]);
    // 동적 표가 없어도 언어별 발송 HTML 은 반드시 생성되어야 한다(회귀: continue 가 locales 대입 앞에 있었음)
    expect(Object.keys(r.locales).sort()).toEqual([...p.langs].sort());
    for (const lang of p.langs) expect(r.locales[lang].html.length).toBeGreaterThan(0);
  });

  it('자리표시 행을 잃은 변환기는 marker-lost 경고', async () => {
    // 인라인 전 표식은 <tr data-rows-slot> 자리표시로 바뀌므로, 이를 제거하는 변환기가 표식 유실을 흉내낸다.
    const r = await renderProject(makeProject(), {
      inline: async (html) => ({ html: html.replace(/<tr[^>]*data-rows-slot[^>]*>[\s\S]*?<\/tr>/g, ''), warnings: [] }),
    });
    expect(codes(r.warnings)).toContain('marker-lost');
  });

  it('인라인 전 자리표시 행이 인라인 후 tbody 직속 표식으로 복원된다(표 밖 이동 없음)', async () => {
    const seen: string[] = [];
    const { inline } = makeFakeInline();
    const r = await renderProject(makeProject(), {
      inline: async (html, css, o) => {
        seen.push(html);
        return inline(html, css, o);
      },
    });
    expect(seen[0]).toContain('<tr data-rows-slot="orders"><td></td></tr>');
    expect(seen[0]).not.toContain('|!#-rows_orders|');
    expect(r.locales.ko.html).toMatch(/<tbody[^>]*>\|!#-rows_orders\|<\/tbody>/);
    expect(r.warnings.filter((w) => w.code === 'marker-lost')).toEqual([]);
  });

  it('셸 래퍼: 언어별 lang 속성이 ko/en/ja 로 다르고, data-tx-shell 표식은 최종 본문에 남지 않는다', async () => {
    const { inline, calls } = makeFakeInline();
    const base = makeProject();
    const shell = wrapShell(base.structure, { baseLang: 'ko', footerBlocks: [] });
    const p = makeProject({ structure: shell.structure });
    const r = await renderProject(p, { inline });
    for (const lang of ['ko', 'en', 'ja'] as const) {
      expect(r.locales[lang].html).toMatch(new RegExp(`^<table\\b[^>]*\\slang="${lang}"`));
      expect(r.locales[lang].html).not.toContain('data-tx-shell');
    }
    // 행 템플릿 합성(B 경로)에도 같은 언어 lang 이 들어간다
    expect(calls.some((c) => /<table\b[^>]*\slang="en"/.test(c.html))).toBe(true);
    expect(calls.some((c) => /<table\b[^>]*\slang="ja"/.test(c.html))).toBe(true);
    expect(calls.every((c) => !c.html.includes('data-tx-shell'))).toBe(true);
  });

  it('셸이 없는 구조는 setShellLang 이 무동작(lang 속성을 새로 달지 않음)', async () => {
    const { inline } = makeFakeInline();
    const r = await renderProject(makeProject(), { inline });
    expect(r.locales.en.html).not.toMatch(/<table[^>]*\slang=/);
  });

  it('verifyBundle: 표식이 표 밖(tbody 직속 아님)에 있으면 오류', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    const rendered = await renderProject(p, { inline });
    const b = buildBundle(p, rendered, new Date('2026-10-14T09:00:00.000Z'));
    const bad = structuredClone(b) as any;
    bad.locales.ko.html = bad.locales.ko.html.replace(/<tbody([^>]*)>\|!#-rows_orders\|<\/tbody>/, '</table>|!#-rows_orders|<table><tbody$1></tbody>');
    const fixed = { ...bad, checksum: computeChecksum(bad) };
    const v = verifyBundle(fixed);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toContain('<tbody> 직속에 있지 않습니다');
  });

  it('applyLogoUrl: logoUrl 이 있을 때만 로고 img 의 data: src 를 대체', () => {
    const h = '<img class="logo" src="data:image/png;base64,AAA"><img class="hero" src="data:image/png;base64,BBB">';
    expect(applyLogoUrl(h, '')).toBe(h);
    expect(applyLogoUrl(h, 'https://cdn.example.com/logo.png')).toBe(
      '<img class="logo" src="https://cdn.example.com/logo.png"><img class="hero" src="data:image/png;base64,BBB">',
    );
  });

  it('settings.logoUrl 이 있으면 번들 본문에서 base64 대신 URL', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    p.settings.logoUrl = 'https://cdn.example.com/logo.png';
    const r = await renderProject(p, { inline });
    expect(r.locales.ko.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(r.locales.ko.html).not.toContain('base64');
  });
});

describe('validateProject', () => {
  it('정상 프로젝트는 오류·경고 없음', () => {
    expect(validateProject(makeProject())).toEqual([]);
  });

  it('미번역(빈 문자열) = 경고, 제목 포함', () => {
    const p = makeProject();
    p.strings.b001.ja = '';
    p.subject.en = '  ';
    const i = validateProject(p).filter((x) => x.code === 'untranslated');
    expect(i.map((x) => [x.level, x.lang, x.blockId])).toEqual(expect.arrayContaining([['warning', 'ja', 'b001'], ['warning', 'en', undefined]]));
  });

  it('치환자 집합 불일치(본문·제목) = 오류', () => {
    const p = makeProject();
    p.strings.b002.en = 'Hello.';
    p.subject.ja = '発送';
    const i = validateProject(p).filter((x) => x.code === 'placeholder-mismatch');
    expect(i.map((x) => x.lang).sort()).toEqual(['en', 'ja']);
    expect(i.every((x) => x.level === 'error')).toBe(true);
  });

  it('|!#- 형식 깨짐: 닫는 | 누락 / 허용 외 문자 = 오류', () => {
    const p = makeProject();
    p.strings.b002.ko = '<strong>|!#-cust_nm</strong>님';
    p.strings.b002.en = 'Hello |!#-cust nm|.';
    const i = validateProject(p).filter((x) => x.code === 'marker-malformed');
    expect(i).toHaveLength(2);
    expect(i[0].message).toContain('닫는 | 누락');
    expect(i[1].message).toContain('허용 외 문자');
  });

  it('대소문자만 다른 중복 = 오류', () => {
    const p = makeProject();
    p.strings.b003.ko = '주문번호 |!#-Order_No|';
    p.strings.b003.en = 'Order |!#-Order_No|';
    p.strings.b003.ja = '注文 |!#-Order_No|';
    expect(codes(validateProject(p))).toContain('marker-case-duplicate');
  });

  it('행 변수 선언·사용 불일치 = 오류', () => {
    const p = makeProject();
    p.dynamicTables[0].vars.push({ name: 'extra', description: '', sample: '' });
    p.strings.b007.en = '{{qty}} pcs {{ghost}}';
    const c = codes(validateProject(p));
    expect(c).toContain('row-var-unused');
    expect(c).toContain('row-var-undeclared');
    expect(c).toContain('row-var-lang-mismatch');
  });

  it('표식·행 변수 이름 충돌 = 오류', () => {
    const p = makeProject();
    p.strings.b002.ko += ' |!#-qty|';
    p.strings.b002.en += ' |!#-qty|';
    p.strings.b002.ja += ' |!#-qty|';
    expect(codes(validateProject(p))).toContain('row-var-collides-with-placeholder');
    const q = makeProject();
    q.strings.b003.ko += ' |!#-rows_orders|';
    expect(codes(validateProject(q))).toContain('marker-collides');
  });

  it('ko 원문 변경 후 미갱신 번역 = 경고', () => {
    const p = makeProject();
    p.sourceHash = { b001: { en: 'deadbeef' } };
    const i = validateProject(p);
    expect(i).toEqual([expect.objectContaining({ level: 'warning', code: 'stale-translation', lang: 'en', blockId: 'b001' })]);
    expect(hasErrors(i)).toBe(false);
  });

  it('허용 외 인라인 태그 = 경고', () => {
    const p = makeProject();
    p.strings.b001.en = '<span>Your</span> shipment';
    const i = validateProject(p);
    expect(i).toEqual([expect.objectContaining({ level: 'warning', code: 'inline-tag-removed', lang: 'en', blockId: 'b001' })]);
  });

  it('인라인 변환 경고 = 경고, Gmail 102KB 초과 = 경고(행 수 입력)', async () => {
    const { inline } = makeFakeInline((h) => ({ html: h, warnings: [{ level: 'warn', code: 'modern-layout', message: 'flex' }] }));
    const p = makeProject();
    const rendered = await renderProject(p, { inline });
    const none = validateProject(p, { rendered });
    expect(none.every((x) => x.level === 'warning')).toBe(true);
    expect(codes(none)).toContain('inline-warning');
    expect(codes(none)).not.toContain('gmail-clip');

    const big = validateProject(p, { rendered, expectedRows: { orders: 5000 } });
    const clip = big.filter((x) => x.code === 'gmail-clip');
    expect(clip.map((x) => x.lang)).toEqual(['ko', 'en', 'ja']);
    expect(clip[0].message).toContain('최대');
    expect(clip[0].level).toBe('warning');
    expect(GMAIL_CLIP_BYTES).toBe(104448);
  });
});

describe('번들', () => {
  const now = new Date('2026-10-14T00:00:00.000Z');

  it('exportBundle: 오류가 없으면 번들과 JSON', async () => {
    const { inline } = makeFakeInline();
    const r = await exportBundle(makeProject(), { inline, now });
    expect(r.blocked).toBe(false);
    expect(r.bundle!.schema).toBe('tx-mail-bundle');
    expect(r.bundle!.version).toBe(1);
    expect(r.bundle!.templateCode).toBe('SHIP_START');
    expect(r.bundle!.generatedAt).toBe('2026-10-14T00:00:00.000Z');
    expect(verifyBundle(JSON.parse(r.json!))).toEqual({ ok: true, errors: [] });
  });

  it('templateCode 가 없어도 내보내기·검증 가능', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    delete p.templateCode;
    const r = await exportBundle(p, { inline, now });
    expect(r.bundle).toBeDefined();
    expect('templateCode' in r.bundle!).toBe(false);
    expect(verifyBundle(JSON.parse(r.json!)).ok).toBe(true);
  });

  it('오류가 있으면 차단, force 면 오류를 안고 내보내기', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    p.strings.b002.ja = '안녕 |!#-extra|';
    const blocked = await exportBundle(p, { inline, now });
    expect(blocked.blocked).toBe(true);
    expect(blocked.bundle).toBeUndefined();
    expect(blocked.issues.some((i) => i.level === 'error')).toBe(true);
    const forced = await exportBundle(p, { inline, now, force: true });
    expect(forced.blocked).toBe(false);
    expect(forced.hasErrors).toBe(true);
    expect(forced.bundle).toBeDefined();
  });

  it('왕복: 프로젝트 → 번들(JSON) → source 복원 = 동일', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    const r = await exportBundle(p, { inline, now });
    const restored = restoreProject(JSON.parse(r.json!));
    expect(restored).toEqual(p);
  });

  it('검증: 체크섬 변조·스키마 위반·표식 누락을 잡는다', async () => {
    const { inline } = makeFakeInline();
    const rendered = await renderProject(makeProject(), { inline });
    const b = buildBundle(makeProject(), rendered, now);
    expect(verifyBundle(b).ok).toBe(true);

    const tampered = JSON.parse(JSON.stringify(b));
    tampered.locales.ko.html += ' ';
    expect(verifyBundle(tampered).errors).toEqual(['checksum 불일치(내용이 변경되었거나 손상됨)']);

    const badSchema = JSON.parse(JSON.stringify(b));
    badSchema.version = 2;
    delete badSchema.name;
    const v = verifyBundle(badSchema);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toMatch(/schema:/);

    const noMarker = JSON.parse(JSON.stringify(b));
    noMarker.locales.en.html = noMarker.locales.en.html.replace('|!#-rows_orders|', '');
    noMarker.checksum = computeChecksum(noMarker);
    expect(verifyBundle(noMarker).errors.join('\n')).toContain('0회');

    const leak = JSON.parse(JSON.stringify(b));
    leak.locales.ja.html = leak.locales.ja.html.replace('<h1', '<h1 data-t="b001"');
    leak.checksum = computeChecksum(leak);
    expect(verifyBundle(leak).errors.join('\n')).toContain('data-t');

    const badTpl = JSON.parse(JSON.stringify(b));
    badTpl.dynamicTables[0].rowTemplates.en = '<tr><td>{{nope}}</td></tr>';
    badTpl.checksum = computeChecksum(badTpl);
    expect(verifyBundle(badTpl).errors.join('\n')).toContain('vars 가 일치하지 않습니다');
  });

  it('체크섬은 키 순서와 무관', async () => {
    const { inline } = makeFakeInline();
    const rendered = await renderProject(makeProject(), { inline });
    const b = buildBundle(makeProject(), rendered, now);
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof b;
    expect(computeChecksum(reordered)).toBe(b.checksum);
  });
});

describe('buildHandoffMd', () => {
  it('표식·행 템플릿·변수·예시 행·렌더 결과·확정 사항·범위 밖 항목을 담는다', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    const rendered = await renderProject(p, { inline });
    const md = buildHandoffMd(p, rendered);
    expect(md).toContain('`|!#-rows_orders|`');
    expect(md).toContain('열 수: 2');
    expect(md).toContain('| `{{name}}` | 상품명 | 무선 이어폰 |');
    expect(md).toContain('{{qty}} pcs');
    expect(md).toContain('{{qty}}個');
    // 예시 행(이스케이프 적용 렌더)
    expect(md).toContain('케이블 &lt;3m&gt; &amp; &quot;세트&quot;');
    expect(md).toContain('무선 이어폰</td>');
    expect(md).toContain('메일 처리 워커 담당');
    expect(md).toContain('**확정:** 서버는 `rows_` 접두 치환자(`|!#-rows_<표id>|`)를 지우거나 오류로 처리하지 않고 **그대로 통과**시킵니다.');
    expect(md).toContain('워커 담당 영역이며 이 문서 범위 밖');
    expect(md).toContain('이 규약은 값 이스케이프를 요구하지 않는다(워커 담당 영역)');
    expect(md).not.toContain('확인 필요');
    expect(md).not.toContain('미확정');
    expect(md).not.toContain('워커 책임');
    expect(md).toMatch(/\| ko \| \d+ \| \d+ \| \d+ \|/);
    expect(md).toContain('참고(권장)');
  });

  it('동적 표가 없으면 짧은 문서', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject({ dynamicTables: [], structure: '<p data-t="b001"></p>', strings: { b001: { ko: 'a', en: 'b', ja: 'c' } } });
    const rendered = await renderProject(p, { inline });
    expect(buildHandoffMd(p, rendered)).toContain('동적 표가 없습니다');
  });
});

describe('docs 산출물', () => {
  it('docs/example-bundle.json 은 verifyBundle 을 통과하고 example-handoff.md 와 동기화되어 있다', async () => {
    const { readFileSync } = await import('node:fs');
    const bundle = JSON.parse(readFileSync('docs/example-bundle.json', 'utf8'));
    expect(verifyBundle(bundle)).toEqual({ ok: true, errors: [] });
    const { inline } = makeFakeInline();
    const p = makeProject();
    const rendered = await renderProject(p, { inline });
    const md = readFileSync('docs/example-handoff.md', 'utf8').replace(/\r\n/g, '\n');
    expect(md).toBe(buildHandoffMd(p, rendered));
  });
});
