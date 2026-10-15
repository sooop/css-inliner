import { describe, expect, it } from 'vitest';
import { buildBundle, computeChecksum, exportBundle, renderProject, validateProject, verifyBundle } from '../index';
import { makeFakeInline, makeProject } from './fixture';
import { findLinksMissingTarget } from '../../markup/links';

const T = 'target="_blank" rel="noopener noreferrer"';

/** 링크(버튼·인라인·mailto·#)와 행 템플릿 안 링크를 가진 프로젝트 */
function linkProject() {
  const p = makeProject();
  return {
    ...p,
    structure: p.structure.replace(
      '<h1 data-t="b001"></h1>',
      '<h1 data-t="b001"></h1><p><a href="https://t.com/|!#-order_no|" class="btn btn-primary" data-t="b008"></a></p>' +
        '<p data-t="b009"></p>',
    ),
    strings: {
      ...p.strings,
      b008: { ko: '추적', en: 'Track', ja: '追跡' },
      b009: {
        ko: '<a href="https://a.test">링크</a> <a href="mailto:a@b.c">메일</a> <a href="#x">앵커</a>',
        en: '<a href="https://a.test" target="_self">link</a> <a href="mailto:a@b.c">mail</a> <a href="#x">anchor</a>',
        ja: '<a href="https://a.test" rel="nofollow">リンク</a> <a href="mailto:a@b.c">メール</a> <a href="#x">アンカー</a>',
      },
      b006: { ko: '<a href="{{url}}">{{name}}</a>', en: '<a href="{{url}}">{{name}}</a>', ja: '<a href="{{url}}">{{name}}</a>' },
    },
    dynamicTables: p.dynamicTables!.map((t) => ({
      ...t,
      vars: [...t.vars, { name: 'url', description: '링크', sample: 'https://r.test/1' }],
      sampleRows: t.sampleRows.map((r) => ({ ...r, url: 'https://r.test/1' })),
    })),
  };
}

describe('링크 target 보장(render/bundle)', () => {
  it('본문·행 템플릿의 모든 링크가 보장되고 제외 대상은 그대로', async () => {
    const { inline } = makeFakeInline();
    const r = await renderProject(linkProject(), { inline });
    for (const lang of ['ko', 'en', 'ja']) {
      const h = r.locales[lang].html;
      expect(findLinksMissingTarget(h)).toEqual([]);
      expect(h).toContain('href="mailto:a@b.c">');
      expect(h).toContain('href="#x">');
      expect(h).toMatch(new RegExp(`<a href="https://t.com/\|!#-order_no\|" class="btn btn-primary" ${T}>`));
      const row = r.dynamicTables[0].rowTemplates[lang];
      expect(row).toContain(`<a href="{{url}}" ${T}>{{name}}</a>`);
    }
    expect(r.locales.en.html).toContain('target="_blank" rel="noopener noreferrer">link</a>');
    expect(r.locales.ja.html).toContain('rel="nofollow noopener noreferrer" target="_blank">リンク');
    expect(r.warnings.filter((w) => w.code === 'link-target-restored')).toEqual([]);
  });

  it('엔진이 target/rel 을 지우면 복구하고 경고(link-target-restored)로 남긴다', async () => {
    const fake = makeFakeInline((html) => ({ html: html.replace(/ target="_blank"| rel="noopener noreferrer"/g, '') }));
    const p = linkProject();
    const r = await renderProject(p, { inline: fake.inline });
    expect(findLinksMissingTarget(r.locales.ko.html)).toEqual([]);
    expect(findLinksMissingTarget(r.dynamicTables[0].rowTemplates.ko)).toEqual([]);
    expect(r.warnings.some((w) => w.code === 'link-target-restored')).toBe(true);
    const issues = validateProject(p, { rendered: r });
    expect(issues.some((i) => i.code === 'link-target-restored' && i.level === 'warning')).toBe(true);
  });

  it('exportBundle 결과는 verifyBundle 을 통과하고, 링크에서 target 을 지우면 verifyBundle 이 오류', async () => {
    const { inline } = makeFakeInline();
    const r = await exportBundle(linkProject(), { inline, now: new Date('2026-10-14T09:00:00.000Z') });
    expect(r.hasErrors).toBe(false);
    expect(verifyBundle(JSON.parse(r.json!))).toEqual({ ok: true, errors: [] });

    const bad = structuredClone(r.bundle!) as any;
    bad.locales.ko.html = bad.locales.ko.html.replace(' target="_blank"', '');
    const v1 = verifyBundle({ ...bad, checksum: computeChecksum(bad) });
    expect(v1.ok).toBe(false);
    expect(v1.errors.join('\n')).toContain('locales.ko.html');

    const bad2 = structuredClone(r.bundle!) as any;
    bad2.dynamicTables[0].rowTemplates.en = bad2.dynamicTables[0].rowTemplates.en.replace(' rel="noopener noreferrer"', '');
    const v2 = verifyBundle({ ...bad2, checksum: computeChecksum(bad2) });
    expect(v2.ok).toBe(false);
    expect(v2.errors.join('\n')).toContain('rowTemplates.en');
  });

  it('링크가 없거나 제외 대상뿐이면 통과', async () => {
    const { inline } = makeFakeInline();
    const p = makeProject();
    const b = buildBundle(p, await renderProject(p, { inline }), new Date('2026-10-14T09:00:00.000Z'));
    expect(verifyBundle(b).ok).toBe(true);
  });
});
