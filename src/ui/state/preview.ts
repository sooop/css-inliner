/** 미리보기 파이프라인: 구조+문자열 합성(composePreview) → 로고 URL → 실제 인라인 엔진. */
import { composeLang, composePreview, rowsMarker } from '../../markup/compose';
import { listBlocks } from '../../markup/ids';
import { setShellLang } from '../../markup/shell';
import type { Project } from '../../project/model';
import { projectKind } from '../../project/model';
import { renderNoticeFragment } from '../../project/notice';
import { applyLogoUrl } from '../../project/render';
import { cssFor, inlineFn } from './inline';

export interface PreviewResult {
  /** 인라인 완료된 `<body>` 안쪽 HTML(data-t 유지) */
  html: string;
  warnings: { level?: string; code?: string; message: string }[];
}

/** 미리보기에 영향을 주는 입력만 모은 키(같으면 다시 변환하지 않는다) */
export function previewKey(p: Project, lang: string, showMarkers: boolean): string {
  return JSON.stringify([projectKind(p), lang, showMarkers, p.baseLang, p.structure, p.strings, p.dynamicTables, p.settings]);
}

/**
 * 발송용 표식 보기: `<tbody data-rows="x">|!#-rows_x|</tbody>` 의 텍스트는 인라인 엔진(DOM)에서 표 밖으로 튀어나가므로
 * 미리보기에서는 표식을 행 1개(`<tr><td colspan>`)로 감싼다. 발송 HTML(renderProject)은 건드리지 않는다.
 */
export function wrapMarkersInRow(html: string, p: Project): string {
  let out = html;
  for (const t of p.dynamicTables ?? []) {
    const cols = Math.max(1, listBlocks(t.rowStructure).length);
    const m = rowsMarker(t.id);
    out = out.split(m).join(`<tr><td colspan="${cols}">${m}</td></tr>`);
  }
  return out;
}

export async function renderPreviewHtml(p: Project, lang: string, showMarkers: boolean): Promise<PreviewResult> {
  if (projectKind(p) === 'notice') {
    // 공지: web 프로파일·셸 없음. 출력과 같은 경로(임시 래퍼 → 인라인 → 래퍼 제거)이고 data-t 만 남겨 클릭 편집을 살린다.
    const r = await renderNoticeFragment(p, lang, { inline: inlineFn, css: cssFor(p), stripIds: false });
    return { html: r.html, warnings: r.warnings };
  }
  const opts = { baseLang: p.baseLang };
  const composed = showMarkers
    ? composeLang(p, lang, { ...opts, stripIds: false, mode: 'send' })
    : composePreview(p, lang, opts);
  const html = setShellLang(showMarkers ? wrapMarkersInRow(composed.html, p) : composed.html, lang);
  const res = await inlineFn(applyLogoUrl(html, p.settings.logoUrl), cssFor(p), {
    bodyOnly: true,
    profile: p.settings.profile,
    renderWidth: p.settings.renderWidth,
    mailSafeLayout: p.settings.mailSafeLayout,
  });
  return { html: res.html, warnings: (res.warnings ?? []).filter((w) => w.level !== 'info') };
}
