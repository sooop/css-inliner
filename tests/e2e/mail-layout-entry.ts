import { convertToInline } from '../../src/engine/css-converter';
import { renderProject } from '../../src/project';
import { makeProject } from '../../src/project/__tests__/fixture';
import { wrapShell } from '../../src/markup/shell';

/** 셸(wrapShell)로 감싼 프로젝트를 renderProject 로 변환해 언어별 발송 HTML 을 돌려준다. */
(window as any).__ml = {
  async render(css: string): Promise<Record<string, string>> {
    const base = makeProject();
    const shell = wrapShell(base.structure, {
      headerTag: { ko: '배송 안내', en: 'Shipping notice', ja: '発送のお知らせ' },
    });
    const project = makeProject({ structure: shell.structure, strings: { ...base.strings, ...shell.strings } });
    const r = await renderProject(project, { inline: convertToInline as any, css });
    const out: Record<string, string> = {};
    for (const [lang, v] of Object.entries(r.locales as Record<string, { html: string }>)) out[lang] = v.html;
    return out;
  },
};
