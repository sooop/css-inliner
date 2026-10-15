/**
 * 미리보기 문서 조립(순수). 엔진이 인라인한 HTML(`bodyOnly`)을 iframe 에 넣을 문서로 감싸고,
 * 치환자 샘플값 표시·클릭 편집용 보조 스타일(발송 HTML 과 무관, iframe 안에서만 쓰임)을 붙인다.
 */
import type { VariableDef } from '../../markup/types';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PLACEHOLDER = /\|!#-([a-zA-Z0-9_가-힣.\-]+)\|/g;

/** `|!#-name|` 을 샘플값으로 바꾼다(HTML 이스케이프, 값이 비었거나 모르는 이름은 그대로). 속성 안 URL 포함. */
export function applySamples(html: string, variables: Pick<VariableDef, 'name' | 'sample'>[]): string {
  const map = new Map(variables.filter((v) => v.sample !== '').map((v) => [v.name, v.sample]));
  return html.replace(PLACEHOLDER, (m, name: string) => (map.has(name) ? escapeHtml(map.get(name)!) : m));
}

/** CSS 속성 선택자용 값 이스케이프 */
export function cssString(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

/** 선택한 블록 ID 를 강조하는 CSS(미리보기 전용). 여러 번 호출해 `<style id="sel">` 의 내용을 교체한다. */
export function selectionCss(id: string | null): string {
  if (!id) return '';
  return `[data-t="${cssString(id)}"]{outline:2px solid #1D6FE0 !important;outline-offset:2px;background-color:rgba(29,111,224,.10) !important}`;
}

export const PREVIEW_BASE_CSS = `
html,body{margin:0;padding:0}
body{background:#fff}
[data-t]{cursor:pointer}
[data-t]:hover{outline:1px dashed #1D6FE0;outline-offset:2px}
[data-miss]::before{content:"(미번역)";color:#B3261E;background:#FCE4E2;padding:0 4px;border-radius:2px;font-style:normal;font-weight:400;font-size:12px}
.__ph{background:#FFF1B8;color:#5A4300;padding:0 2px;border-radius:2px;font-family:ui-monospace,Consolas,monospace;font-size:.9em}
`;

/**
 * 공지 미리보기 전용: 호스트(공지 시스템) 페이지 흉내. 공지 출력은 font-family 를 내보내지 않고 호스트 폰트를 상속하므로
 * 미리보기 문서가 그 역할(폰트·여백·흰 배경)을 한다. 발송·저장 HTML 과 무관하다.
 */
export const NOTICE_HOST_CSS = `body{font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Segoe UI',Arial,sans-serif;padding:28px 36px;background:#fff}`;

/** iframe srcdoc. 스크립트는 넣지 않는다(sandbox 로도 막음) — 클릭 연결은 부모가 contentDocument 로 한다. */
export function buildPreviewDocument(bodyHtml: string, lang: string, kind: 'mail' | 'notice' = 'mail'): string {
  const host = kind === 'notice' ? `<style>${NOTICE_HOST_CSS}</style>` : '';
  return `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${PREVIEW_BASE_CSS}</style>${host}<style id="sel"></style></head><body>${bodyHtml}</body></html>`;
}

/** iframe 문서 후처리: 미번역 표시, 남은 치환자 하이라이트. 단위 테스트를 위해 Document 를 인자로 받는다. */
export function decoratePreview(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('[data-t]'))) {
    if (el.children.length === 0 && (el.textContent ?? '').trim() === '') el.setAttribute('data-miss', '');
  }
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (/\|!#-[^|]+\|/.test(t.data)) targets.push(t);
  }
  for (const t of targets) {
    const frag = doc.createDocumentFragment();
    let last = 0;
    const re = new RegExp(PLACEHOLDER.source, 'g');
    for (const m of t.data.matchAll(re)) {
      if (m.index! > last) frag.append(t.data.slice(last, m.index));
      const span = doc.createElement('span');
      span.className = '__ph';
      span.textContent = m[0];
      frag.append(span);
      last = m.index! + m[0].length;
    }
    if (last < t.data.length) frag.append(t.data.slice(last));
    t.replaceWith(frag);
  }
}
