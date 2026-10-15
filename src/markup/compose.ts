import { IdAllocator, listBlocks } from './ids';
import { ensureLinkTargets } from './links';
import type { ComposeSource, DynamicTable, Lang, MarkupWarning, Strings, VariableDef } from './types';

/* ------------------------------------------------------------------ 공통 정규식 */

const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const PLACEHOLDER = /\|!#-([a-zA-Z0-9_가-힣.\-]+)\|/g;
const ROW_VAR = /\{\{([a-zA-Z0-9_가-힣.\-]+)\}\}/g;

export const ALLOWED_INLINE_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'del', 'a', 'br']);

/** 텍스트(또는 HTML)에서 `|!#-name|` 치환자 이름을 등장 순서대로(중복 제거) 추출 */
export function extractPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** 행 템플릿 변수 `{{name}}` 이름 추출(등장 순서, 중복 제거) */
export function extractRowVars(text: string): string[] {
  return [...new Set([...text.matchAll(ROW_VAR)].map((m) => m[1]))];
}

/** 동적 표 표식 치환자 이름: `|!#-rows_<표id>|` */
export function rowsMarker(tableId: string): string {
  return `|!#-rows_${tableId}|`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ 인라인 정화 */

/**
 * 문자열(블록 단위)에 허용되는 인라인 태그만 남긴다: strong / em / del / a / br.
 * 허용된 태그는 원문 그대로 보존(왕복 동일성). 그 외 태그·주석·위험한 a(on* 속성, javascript:)는 제거한다.
 * 태그만 지우고 안의 텍스트는 남긴다.
 */
export function sanitizeInline(raw: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  const html = raw.replace(
    /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g,
    (m, name: string | undefined, attrs: string | undefined) => {
      if (name === undefined) {
        removed.push('<!-- -->');
        return '';
      }
      const lname = name.toLowerCase();
      if (!ALLOWED_INLINE_TAGS.has(lname)) {
        removed.push(lname);
        return '';
      }
      if (lname === 'a' && !m.startsWith('</') && /\son\w+\s*=|href\s*=\s*["']?\s*javascript:/i.test(attrs ?? '')) {
        removed.push('a[unsafe]');
        return '';
      }
      return m;
    },
  );
  return { html, removed };
}

/* ------------------------------------------------------------------ 분해: HTML -> 구조 + 문자열 */

const UNIT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th']);
const BLOCK_INSIDE = /<(table|p|div|ul|ol|h[1-6]|blockquote|tr)\b/i;

export interface DecomposeResult {
  structure: string;
  strings: Strings;
}

/**
 * 텍스트가 들어 있는 완성 HTML 을 구조(data-t 키, 텍스트 없음)와 문자열표로 분해한다.
 * 문자열 단위: h1~h6 / p / li(자기 텍스트, 중첩 목록 제외) / td / th / 버튼(a.btn) 의 안쪽.
 * 안쪽이 비어 있는 요소는 단위로 만들지 않는다.
 */
export function decompose(
  html: string,
  opts: { baseLang?: Lang; alloc?: IdAllocator } = {},
): DecomposeResult {
  const base = opts.baseLang ?? 'ko';
  const alloc = opts.alloc ?? new IdAllocator([...html.matchAll(/data-t="([^"]*)"/g)].map((m) => m[1]));
  const strings: Strings = {};
  let out = '';
  let copyFrom = 0;
  const re = new RegExp(OPEN_TAG.source, 'g');
  let pos = 0;
  while (true) {
    re.lastIndex = pos;
    const m = re.exec(html);
    if (!m) break;
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const openEnd = m.index + m[0].length;
    const isBtn = tag === 'a' && /\bclass\s*=\s*"[^"]*\bbtn\b/.test(attrs);
    if ((!UNIT_TAGS.has(tag) && !isBtn) || /\sdata-t="/.test(attrs)) {
      pos = openEnd;
      continue;
    }
    let contentEnd: number;
    if (tag === 'li') {
      const em = /<(?:ul|ol)\b|<\/li\s*>/i.exec(html.slice(openEnd));
      if (!em) { pos = openEnd; continue; }
      contentEnd = openEnd + em.index;
    } else {
      const em = new RegExp(`</${tag}\\s*>`, 'i').exec(html.slice(openEnd));
      if (!em) { pos = openEnd; continue; }
      contentEnd = openEnd + em.index;
    }
    const content = html.slice(openEnd, contentEnd);
    const container =
      content.trim() === '' ||
      (tag === 'p' && /<a\b[^>]*\bclass\s*=\s*"[^"]*\bbtn\b/.test(content)) ||
      ((tag === 'td' || tag === 'th') && BLOCK_INSIDE.test(content));
    if (container) {
      pos = openEnd;
      continue;
    }
    const id = alloc.next();
    out += html.slice(copyFrom, m.index) + `<${m[1]}${attrs} data-t="${id}">`;
    strings[id] = { [base]: content };
    copyFrom = contentEnd;
    pos = contentEnd;
  }
  out += html.slice(copyFrom);
  return { structure: out, strings };
}

/* ------------------------------------------------------------------ 합성: 구조 + 문자열 -> 언어별 HTML */

export interface ComposeOptions {
  /** 기준 언어(폴백 대상). 기본 'ko' */
  baseLang?: Lang;
  /** 해당 언어 문자열이 비어 있으면 기준 언어 문자열로 대체. 기본 false(빈 문자열) */
  fallbackToBase?: boolean;
  /** data-t / data-rows 속성 제거(발송용). 기본 false */
  stripIds?: boolean;
  /**
   * 동적 표 처리.
   * 'send'(기본): tbody 안에 표식 치환자만 둔다.
   * 'preview': 예시 행(sampleRows)을 행 템플릿에 채워 tbody 를 채운다(예시 행이 없으면 표식 치환자).
   */
  mode?: 'send' | 'preview';
}

export interface ComposeResult {
  html: string;
  warnings: MarkupWarning[];
}

function fillIds(
  structure: string,
  strings: Strings,
  lang: Lang,
  base: Lang,
  opts: ComposeOptions,
  warnings: MarkupWarning[],
): string {
  return structure.replace(OPEN_TAG, (m, tag: string, attrs: string) => {
    const am = /\sdata-t="([^"]*)"/.exec(attrs);
    if (!am) return m;
    const id = am[1];
    let raw = strings[id]?.[lang] ?? '';
    if (!raw && opts.fallbackToBase) raw = strings[id]?.[base] ?? '';
    const { html, removed } = sanitizeInline(raw);
    if (removed.length) {
      warnings.push({
        code: 'inline-tag-removed',
        id,
        lang,
        message: `허용되지 않은 인라인 태그를 제거했습니다 (${id}/${lang}): ${[...new Set(removed)].join(', ')}`,
      });
    }
    const open = opts.stripIds ? `<${tag}${attrs.replace(am[0], '')}>` : m;
    return open + html;
  });
}

/** 예시 행 값을 `{{name}}` 에 채운다(값은 HTML 이스케이프). 값이 없는 변수는 빈 문자열. */
export function fillRowVars(rowHtml: string, values: Record<string, string>): string {
  return rowHtml.replace(ROW_VAR, (_m, name: string) => escapeHtml(values[name] ?? ''));
}

const TBODY_ROWS =
  /<tbody((?:"[^"]*"|'[^']*'|[^'">])*?)\sdata-rows="([^"]*)"((?:"[^"]*"|'[^']*'|[^'">])*)>[\s\S]*?<\/tbody>/g;

/** 구조 + 문자열 -> 언어 하나의 HTML. */
export function composeLang(src: ComposeSource, lang: Lang, opts: ComposeOptions = {}): ComposeResult {
  const base = opts.baseLang ?? 'ko';
  const warnings: MarkupWarning[] = [];
  const tables = new Map((src.dynamicTables ?? []).map((t) => [t.id, t]));
  const mode = opts.mode ?? 'send';

  const filled = fillIds(src.structure, src.strings, lang, base, opts, warnings);
  const composed = filled.replace(TBODY_ROWS, (_m, a1: string, tableId: string, a3: string) => {
    const open = `<tbody${a1}${a3}${opts.stripIds ? '' : ` data-rows="${tableId}"`}>`;
    const t = tables.get(tableId);
    let inner = rowsMarker(tableId);
    if (mode === 'preview' && t && t.sampleRows.length > 0) {
      const row = fillIds(t.rowStructure, src.strings, lang, base, opts, warnings);
      inner = '\n' + t.sampleRows.map((r) => fillRowVars(row, r)).join('\n') + '\n';
    }
    return `${open}${inner}</tbody>`;
  });

  // 모든 링크(버튼·인라인·로고·행 템플릿)에 target="_blank" rel="noopener noreferrer" 보장. 원본(구조·문자열)은 건드리지 않는다.
  return { html: ensureLinkTargets(composed), warnings };
}

/** 발송용: data-t / data-rows 제거, 동적 표는 표식 치환자만 남김 */
export function composeForSend(
  src: ComposeSource,
  lang: Lang,
  opts: Omit<ComposeOptions, 'stripIds' | 'mode'> = {},
): ComposeResult {
  return composeLang(src, lang, { ...opts, stripIds: true, mode: 'send' });
}

/** 편집 미리보기용: data-t 유지(클릭 편집), 동적 표는 예시 행으로 채움 */
export function composePreview(
  src: ComposeSource,
  lang: Lang,
  opts: Omit<ComposeOptions, 'stripIds' | 'mode'> = {},
): ComposeResult {
  return composeLang(src, lang, { ...opts, stripIds: false, mode: 'preview' });
}

/* ------------------------------------------------------------------ 검사: 동적 표 변수 충돌 */

export interface VariableIssue {
  code:
    | 'table-id-duplicate'
    | 'table-id-invalid'
    | 'row-var-collides-with-placeholder'
    | 'marker-collides'
    | 'row-var-mismatch'
    | 'row-var-undeclared';
  message: string;
  tableId?: string;
  name?: string;
}

/** 동적 표별·언어별 행 템플릿에서 쓰인 `{{var}}` 집합 */
export function rowTemplateVars(table: DynamicTable, strings: Strings): Record<Lang, string[]> {
  const out: Record<Lang, Set<string>> = {};
  for (const b of listBlocks(table.rowStructure)) {
    for (const [lang, text] of Object.entries(strings[b.id] ?? {})) {
      for (const v of extractRowVars(text)) (out[lang] ??= new Set()).add(v);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/**
 * 동적 표의 표식/행 변수 이름 충돌·불일치 검출.
 * - 표 id 중복·형식 오류
 * - 행 변수 `{{name}}` 이 본문 치환자 `|!#-name|` 과 같은 이름(이름 공간이 겹치면 안 됨)
 * - 본문에 `|!#-rows_<id>|` 표식을 직접 써서 자동 표식과 충돌
 * - 언어 간 행 변수 집합 불일치
 * - 문자열에는 쓰였지만 vars 에 선언되지 않은 변수
 */
export function findVariableConflicts(src: ComposeSource): VariableIssue[] {
  const issues: VariableIssue[] = [];
  const tables = src.dynamicTables ?? [];
  const rowIds = new Set<string>();
  for (const t of tables) for (const b of listBlocks(t.rowStructure)) rowIds.add(b.id);

  // 본문(행 템플릿 제외) 치환자: 구조(버튼 href 등) + 본문 문자열
  const bodyPlaceholders = new Set<string>(extractPlaceholders(src.structure));
  for (const [id, byLang] of Object.entries(src.strings)) {
    if (rowIds.has(id)) continue;
    for (const text of Object.values(byLang)) for (const p of extractPlaceholders(text)) bodyPlaceholders.add(p);
  }

  const seen = new Set<string>();
  for (const t of tables) {
    if (seen.has(t.id)) issues.push({ code: 'table-id-duplicate', tableId: t.id, message: `동적 표 id 가 중복됩니다: ${t.id}` });
    seen.add(t.id);
    if (!/^[a-zA-Z0-9_-]+$/.test(t.id))
      issues.push({ code: 'table-id-invalid', tableId: t.id, message: `동적 표 id 는 영문·숫자·_·- 만 사용할 수 있습니다: ${t.id}` });
    if (bodyPlaceholders.has(`rows_${t.id}`))
      issues.push({ code: 'marker-collides', tableId: t.id, name: `rows_${t.id}`, message: `본문에 표식 치환자 |!#-rows_${t.id}| 가 이미 쓰였습니다(동적 표 표식과 충돌)` });

    const perLang = rowTemplateVars(t, src.strings);
    const all = new Set<string>(Object.values(perLang).flat());
    for (const v of all) {
      if (bodyPlaceholders.has(v))
        issues.push({ code: 'row-var-collides-with-placeholder', tableId: t.id, name: v, message: `행 변수 {{${v}}} 가 본문 치환자 |!#-${v}| 와 이름이 겹칩니다 (${t.id})` });
      if (!t.vars.some((d) => d.name === v))
        issues.push({ code: 'row-var-undeclared', tableId: t.id, name: v, message: `행 변수 {{${v}}} 가 vars 에 선언되지 않았습니다 (${t.id})` });
    }
    for (const [lang, vars] of Object.entries(perLang)) {
      const missing = [...all].filter((v) => !vars.includes(v));
      if (missing.length)
        issues.push({ code: 'row-var-mismatch', tableId: t.id, message: `행 템플릿(${t.id}/${lang})에 다른 언어에는 있는 변수가 없습니다: ${missing.map((v) => `{{${v}}}`).join(', ')}` });
    }
  }
  return issues;
}

/** 편의: VariableDef 목록 병합(이름 기준, 기존 설명·샘플 유지) */
export function mergeVars(prev: VariableDef[], names: string[]): VariableDef[] {
  const byName = new Map(prev.map((v) => [v.name, v]));
  return names.map((n) => byName.get(n) ?? { name: n, description: '', sample: '' });
}
