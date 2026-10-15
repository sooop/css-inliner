/** 실제 엔진(convertToInline) 어댑터. iframe 을 만드는 무거운 작업이라 호출을 한 줄로 세워 동시에 여러 개가 돌지 않게 한다. */
import { convertToInline } from '../../engine/css-converter';
import templateCss from '../../styles/template.css?inline';
import type { InlineFn } from '../../project/render';
import type { Project } from '../../project/model';

let chain: Promise<unknown> = Promise.resolve();

export const inlineFn: InlineFn = (html, css, opts) => {
  const run = chain.then(() => convertToInline(html, css, opts));
  chain = run.catch(() => undefined);
  return run as ReturnType<InlineFn>;
};

/** 인라인에 쓸 CSS = 템플릿 CSS + 프로젝트 사용자 CSS */
export function cssFor(p: Project): string {
  return templateCss + '\n' + (p.settings.customCss ?? '');
}
