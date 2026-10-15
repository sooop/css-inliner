// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseTxmd } from '../parser';
import { composeForSend, composeLang, composePreview } from '../compose';
import { ensureLinkTargets, findLinksMissingTarget } from '../links';

const T = 'target="_blank" rel="noopener noreferrer"';

describe('ensureLinkTargets', () => {
  it('href 가 있는 a 에 target/rel 을 붙인다(버튼·인라인)', () => {
    expect(ensureLinkTargets('<a href="https://x.test" class="btn btn-primary">a</a>')).toBe(
      `<a href="https://x.test" class="btn btn-primary" ${T}>a</a>`,
    );
    expect(ensureLinkTargets('<p>x <a href="/rel/path">y</a></p>')).toBe(`<p>x <a href="/rel/path" ${T}>y</a></p>`);
  });
  it('치환자·{{var}} href 도 외부 링크로 본다', () => {
    expect(ensureLinkTargets('<a href="|!#-url|">a</a>')).toContain(T);
    expect(ensureLinkTargets('<a href="{{link}}">a</a>')).toContain(T);
    expect(ensureLinkTargets('<a href="https://t.com/?no=|!#-n|">a</a>')).toContain(T);
  });
  it('mailto/tel/sms/#앵커는 제외, href 없는 a 는 건드리지 않는다', () => {
    for (const h of ['mailto:a@b.c', 'tel:+8210', 'sms:010', '#top', ' MAILTO:a@b.c']) {
      const s = `<a href="${h}">a</a>`;
      expect(ensureLinkTargets(s)).toBe(s);
    }
    expect(ensureLinkTargets('<a name="x">a</a>')).toBe('<a name="x">a</a>');
    expect(ensureLinkTargets('<abbr title="x">a</abbr><a>b</a>')).toBe('<abbr title="x">a</abbr><a>b</a>');
  });
  it('다른 target 은 _blank 로 정규화, rel 은 병합', () => {
    expect(ensureLinkTargets('<a href="https://x" target="_self">a</a>')).toBe(`<a href="https://x" target="_blank" rel="noopener noreferrer">a</a>`);
    expect(ensureLinkTargets('<a href="https://x" rel="nofollow">a</a>')).toBe(
      '<a href="https://x" rel="nofollow noopener noreferrer" target="_blank">a</a>',
    );
    expect(ensureLinkTargets('<a href="https://x" rel="noopener" target="_blank">a</a>')).toBe(
      '<a href="https://x" rel="noopener noreferrer" target="_blank">a</a>',
    );
    expect(ensureLinkTargets("<a rel='NoReferrer' href='https://x' target>a</a>")).toContain('rel="NoReferrer noopener"');
  });
  it('이미 충족하면 그대로(멱등)', () => {
    const once = ensureLinkTargets('<a href="https://x" target="_self" rel="nofollow">a</a><a href="/y">b</a>');
    expect(ensureLinkTargets(once)).toBe(once);
    const ok = `<a href="https://x" ${T}>a</a>`;
    expect(ensureLinkTargets(ok)).toBe(ok);
  });
  it('다른 속성 값 안의 target= 문자열이나 data-target 에 속지 않는다', () => {
    const out = ensureLinkTargets('<a href="https://x" data-target="y" title="a target=b">a</a>');
    expect(out).toBe(`<a href="https://x" data-target="y" title="a target=b" ${T}>a</a>`);
  });
  it('findLinksMissingTarget', () => {
    expect(findLinksMissingTarget(`<a href="https://x" ${T}>a</a><a href="mailto:a@b">m</a>`)).toEqual([]);
    expect(findLinksMissingTarget('<a href="https://x">a</a><a href="#t">b</a>')).toHaveLength(1);
  });
});

describe('compose 가 링크를 보장한다', () => {
  const SRC = [
    '# 제목',
    '',
    '문단 [링크](https://a.test/x) 와 [메일](mailto:a@b.c) 와 [앵커](#top) 와 [변수](|!#-url|)',
    '',
    '[버튼, 하나, https://t.com/|!#-no|, primary]',
    '[버튼, 둘, https://u.com, secondary]',
    '',
    '[정보: 안내]',
    '콜아웃 안 [링크](https://c.test)',
    '',
    '[버튼, 콜아웃 버튼, https://cb.test, primary]',
    '[/정보]',
  ].join('\n');
  const t = parseTxmd(SRC);

  it('파서 출력(구조·문자열)에는 target 이 없다(원본 불변)', () => {
    expect(t.structure).not.toContain('target=');
    expect(JSON.stringify(t.strings)).not.toContain('target=');
  });
  it('발송용·미리보기 모두 버튼·그룹·콜아웃 버튼·인라인 링크에 붙고 제외 대상은 그대로', () => {
    for (const html of [composeForSend(t, 'ko').html, composePreview(t, 'ko').html, composeLang(t, 'ko').html]) {
      expect(findLinksMissingTarget(html)).toEqual([]);
      expect(html.match(/target="_blank"/g)?.length).toBe(6);
      expect(html).toContain('href="mailto:a@b.c">');
      expect(html).toContain('href="#top">');
      expect(html).toMatch(/<a href="\|!#-url\|" target="_blank" rel="noopener noreferrer">/);
      expect(html).toMatch(/<a [^>]*class="btn btn-primary"[^>]*target="_blank" rel="noopener noreferrer"/);
    }
  });
  it('문자열에 이미 다른 target/rel 이 있어도 정규화', () => {
    const r = composeForSend(
      { structure: '<p data-t="b001"></p>', strings: { b001: { ko: '<a href="https://x" target="_top" rel="nofollow">a</a>' } } },
      'ko',
    );
    expect(r.html).toBe('<p><a href="https://x" target="_blank" rel="nofollow noopener noreferrer">a</a></p>');
  });
  it('행 템플릿(미리보기 예시 행)과 {{var}} href 에도 적용', () => {
    const src = {
      structure: '<table><tbody data-rows="o"></tbody></table>',
      strings: { b001: { ko: '<a href="{{url}}">{{name}}</a>' } },
      dynamicTables: [
        {
          id: 'o',
          rowStructure: '<tr><td data-t="b001"></td></tr>',
          vars: [
            { name: 'url', description: '', sample: '' },
            { name: 'name', description: '', sample: '' },
          ],
          sampleRows: [{ url: 'https://r.test/1', name: 'n' }],
        },
      ],
    };
    const prev = composePreview(src, 'ko').html;
    expect(prev).toContain(`<a href="https://r.test/1" ${T}>n</a>`);
    const ph = composeLang(
      { ...src, dynamicTables: [{ ...src.dynamicTables[0], sampleRows: [{ url: '{{url}}', name: '{{name}}' }] }] },
      'ko',
      { mode: 'preview', stripIds: true },
    ).html;
    expect(ph).toContain(`<a href="{{url}}" ${T}>{{name}}</a>`);
  });
  it('합성 결과에 다시 적용해도 동일(멱등)', () => {
    const h = composeForSend(t, 'ko').html;
    expect(ensureLinkTargets(h)).toBe(h);
  });
  it('셸 로고 링크도 rel 이 보장된다', () => {
    const r = composeForSend({ structure: '<td><a href="https://l.test" target="_blank"><img></a></td>', strings: {} }, 'ko');
    expect(r.html).toContain(`<a href="https://l.test" target="_blank" rel="noopener noreferrer">`);
  });
});
