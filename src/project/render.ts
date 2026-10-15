import { composeForSend, composeLang, rowsMarker, extractRowVars } from '../markup/compose';
import { ensureLinkTargets } from '../markup/links';
import { setShellLang } from '../markup/shell';
import { listBlocks } from '../markup/ids';
import type { DynamicTable, Lang, VariableDef } from '../markup/types';
import type { Project } from './model';

/** convertToInline 과 호환되는 주입형 변환기. 브라우저(iframe)가 필요한 실제 엔진은 앱이, 테스트는 fake 를 넘긴다. */
export interface InlineOptions {
  bodyOnly: boolean;
  profile: 'email' | 'web';
  renderWidth: number;
  mailSafeLayout: boolean;
}
export interface InlineWarning {
  level?: string;
  code?: string;
  message: string;
}
export type InlineFn = (
  html: string,
  css: string,
  opts: InlineOptions,
) => Promise<{ html: string; warnings?: InlineWarning[] }>;

export interface RenderWarning {
  lang?: Lang;
  code: string;
  message: string;
}

export interface RenderedTable {
  id: string;
  marker: string;
  /** 행 1개의 셀(td/th) 수. 언어 공통 */
  columns: number;
  vars: VariableDef[];
  sampleRows: Record<string, string>[];
  /** 언어별 `<tr>…</tr>` 한 줄(인라인 스타일 적용, `{{var}}` 포함) */
  rowTemplates: Record<Lang, string>;
}

export interface RenderedProject {
  locales: Record<Lang, { subject: string; html: string }>;
  dynamicTables: RenderedTable[];
  /** 인라인 변환 경고(info 제외)와 렌더 중 발견한 문제 */
  warnings: RenderWarning[];
}

export interface RenderOptions {
  inline: InlineFn;
  /** 인라인에 쓸 CSS(템플릿 CSS + 사용자 CSS). 기본은 project.settings.customCss */
  css?: string;
}

/**
 * `settings.logoUrl` 이 있으면 로고 `<img>`(class 에 logo 가 있거나 data-logo 속성) 의 `data:` src 를 URL 로 대체한다.
 * 비어 있으면 base64 를 그대로 둔다(번들에도 로고 base64 포함이 기본).
 */
export function applyLogoUrl(html: string, logoUrl: string): string {
  if (!logoUrl) return html;
  return html.replace(/<img\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi, (m, attrs: string) => {
    const isLogo = /\bdata-logo\b/.test(attrs) || /\bclass\s*=\s*["'][^"']*\blogo\b/.test(attrs);
    if (!isLogo) return m;
    return m.replace(/(\ssrc\s*=\s*)(["'])data:[^"']*\2/i, (_s, p1: string, q: string) => `${p1}${q}${logoUrl}${q}`);
  });
}

/** 모든 `<tbody>` 의 안쪽 HTML 을 여는 순서대로(중첩 허용 — 래퍼 표 안에 표가 있는 구조) 반환 */
function tbodyInners(html: string): string[] {
  const out: string[] = [];
  const stack: { idx: number; start: number }[] = [];
  const re = /<tbody\b(?:"[^"]*"|'[^']*'|[^'">])*>|<\/tbody\s*>/gi;
  for (const m of html.matchAll(re)) {
    if (m[0][1] !== '/') {
      stack.push({ idx: out.length, start: m.index! + m[0].length });
      out.push('');
    } else {
      const top = stack.pop();
      if (top) out[top.idx] = html.slice(top.start, m.index);
    }
  }
  return out;
}

function oneLine(tr: string): string {
  return tr.replace(/\r?\n\s*/g, '').trim();
}

function countCells(row: string): number {
  return (row.match(/<(td|th)\b/gi) ?? []).length;
}

/** 합성에 쓸 행 변수 자리표시 행: 모든 변수를 `{{name}}` 그대로 채운다(fillRowVars 는 `{{` 를 이스케이프하지 않는다). */
function placeholderRow(t: DynamicTable, rowVarsInTemplate: string[]): Record<string, string> {
  const names = new Set([...t.vars.map((v) => v.name), ...rowVarsInTemplate]);
  return Object.fromEntries([...names].map((n) => [n, `{{${n}}}`]));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 표식 자리표시 행 패턴. 인라인 엔진의 속성 순서·style 삽입·따옴표 변화에 견디도록 속성 전체를 느슨하게 본다.
 * 표식을 tbody 직속 텍스트로 두면 HTML 파서가 표 밖(<table> 앞)으로 옮기므로(foster parenting),
 * 인라인 전에는 `<tr data-rows-slot="id"><td></td></tr>` 로 바꿔 표 문맥을 유지하고, 인라인 후 다시 표식으로 되돌린다.
 */
function slotTrRe(tableId: string): RegExp {
  return new RegExp(`<tr\\b[^>]*data-rows-slot=["']${escapeRe(tableId)}["'][^>]*>[\\s\\S]*?<\\/tr\\s*>`, 'i');
}

/** 발송용 합성 본문의 `<tbody>표식</tbody>` 를 인라인 전 자리표시 행으로 바꾼다. */
function toSlots(html: string, tableIds: string[]): string {
  let out = html;
  for (const id of tableIds) {
    const re = new RegExp(`(<tbody\\b[^>]*>)\\s*${escapeRe(rowsMarker(id))}\\s*(<\\/tbody\\s*>)`, 'gi');
    out = out.replace(re, `$1<tr data-rows-slot="${id}"><td></td></tr>$2`);
  }
  return out;
}

/** 인라인 후 자리표시 행을 표식 치환자로 되돌린다(tbody 안 텍스트). 자리표시가 없으면 그대로. */
function fromSlot(html: string, tableId: string): string {
  return html.replace(slotTrRe(tableId), rowsMarker(tableId));
}

/**
 * 인라인 엔진이 `<a>` 의 target/rel 을 바꾸지 않았는지 확인하고(compose 에서 이미 보장됨), 빠져 있으면 복구한다.
 * 복구가 일어나면 경고(link-target-restored)로 남긴다 — 정상 경로에서는 발생하지 않아야 한다.
 */
export function guardLinks(html: string, lang: Lang, pass: string, warnings: RenderWarning[]): string {
  const fixed = ensureLinkTargets(html);
  if (fixed !== html) {
    warnings.push({ lang, code: 'link-target-restored', message: `[${pass}] 인라인 변환 후 링크의 target/rel 이 빠져 있어 복구했습니다 (${lang})` });
  }
  return fixed;
}

/**
 * 프로젝트 -> 언어별 인라인 완료 본문 + 동적 표 행 템플릿.
 *
 * 언어마다 인라인을 2회 돌린다.
 *  A) 발송용 합성(동적 표 tbody 에는 표식만; 인라인 전 자리표시 행으로 치환, 인라인 후 표식으로 복원) -> locales[lang].html
 *  B) 모든 동적 표에 `{{var}}` 자리표시 예시 행 1개를 넣은 합성 -> 실제 표 문맥(클래스·자손 선택자)에서 인라인된 행을 얻는다
 *  A 에서 표식이 들어 있는 tbody 의 순번을 찾고, B 의 같은 순번 tbody 안쪽(`<tr>…</tr>`)을 행 템플릿으로 추출한다.
 *  (인라인 엔진이 DOM 직렬화를 하므로 두 결과의 tbody 순번은 일치한다.)
 */
export async function renderProject(project: Project, opts: RenderOptions): Promise<RenderedProject> {
  const css = opts.css ?? project.settings.customCss ?? '';
  const inlineOpts: InlineOptions = {
    bodyOnly: true,
    profile: project.settings.profile,
    renderWidth: project.settings.renderWidth,
    mailSafeLayout: project.settings.mailSafeLayout,
  };
  const baseLang = project.baseLang;
  const tables = project.dynamicTables ?? [];
  const warnings: RenderWarning[] = [];
  const locales: RenderedProject['locales'] = {};
  const rowTemplates: Record<string, Record<Lang, string>> = Object.fromEntries(tables.map((t) => [t.id, {}]));

  const pushInline = (lang: Lang, ws: InlineWarning[] | undefined, pass: string) => {
    for (const w of ws ?? []) {
      if (w.level === 'info') continue;
      warnings.push({ lang, code: w.code ?? 'inline-warning', message: `[${pass}] ${w.message}` });
    }
  };

  for (const lang of project.langs) {
    const a = composeForSend(project, lang, { baseLang });
    const sendHtml = toSlots(applyLogoUrl(setShellLang(a.html, lang), project.settings.logoUrl), tables.map((t) => t.id));
    const resA = await opts.inline(sendHtml, css, inlineOpts);
    pushInline(lang, resA.warnings, '본문');
    const htmlA = guardLinks(resA.html, lang, '본문', warnings);
    let restored = htmlA;

    if (tables.length === 0) {
      // 동적 표가 없으면 행 템플릿 추출(B 경로)이 필요 없다. 본문(A)만 그대로 싣는다.
      locales[lang] = { subject: project.subject[lang] ?? '', html: restored };
      continue;
    }
    const synthetic: DynamicTable[] = tables.map((t) => {
      const used = listBlocks(t.rowStructure).flatMap((b) => extractRowVars(project.strings[b.id]?.[lang] ?? ''));
      return { ...t, sampleRows: [placeholderRow(t, used)] };
    });
    const b = composeLang({ structure: project.structure, strings: project.strings, dynamicTables: synthetic }, lang, {
      baseLang,
      stripIds: true,
      mode: 'preview',
    });
    const resB = await opts.inline(applyLogoUrl(setShellLang(b.html, lang), project.settings.logoUrl), css, inlineOpts);
    pushInline(lang, resB.warnings, '행 템플릿');

    const innersA = tbodyInners(htmlA);
    const innersB = tbodyInners(guardLinks(resB.html, lang, '행 템플릿', warnings));
    for (const t of tables) {
      const marker = rowsMarker(t.id);
      const slot = slotTrRe(t.id);
      const idx = innersA.findIndex((s) => slot.test(s) && !/<tbody\b/i.test(s));
      const row = idx >= 0 && idx < innersB.length ? oneLine(innersB[idx]) : '';
      if (idx < 0) {
        warnings.push({ lang, code: 'marker-lost', message: `인라인 결과에서 표식 ${marker} 를 찾지 못했습니다 (${t.id}/${lang})` });
      } else if (!/^<tr\b[\s\S]*<\/tr>$/i.test(row)) {
        warnings.push({ lang, code: 'row-template-malformed', message: `행 템플릿을 <tr>…</tr> 로 추출하지 못했습니다 (${t.id}/${lang})` });
      }
      rowTemplates[t.id][lang] = row;
      restored = fromSlot(restored, t.id);
    }
    locales[lang] = { subject: project.subject[lang] ?? '', html: restored };
  }

  const dynamicTables: RenderedTable[] = tables.map((t) => {
    const first = Object.values(rowTemplates[t.id]).find((r) => r) ?? '';
    return {
      id: t.id,
      marker: rowsMarker(t.id),
      columns: countCells(first),
      vars: t.vars,
      sampleRows: t.sampleRows,
      rowTemplates: rowTemplates[t.id],
    };
  });
  return { locales, dynamicTables, warnings };
}
