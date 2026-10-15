import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { extractRowVars } from '../markup/compose';
import { findLinksMissingTarget } from '../markup/links';
import type { Lang, VariableDef } from '../markup/types';
import schema from '../../docs/bundle.schema.json';
import { projectKind, type Project } from './model';
import { renderProject, type InlineFn, type RenderedProject } from './render';
import { sha256Hex } from './sha256';
import { hasErrors, validateProject, type Issue, type ValidateOptions } from './validate';

export const BUNDLE_SCHEMA = 'tx-mail-bundle';
export const BUNDLE_VERSION = 1;

export interface BundleDynamicTable {
  id: string;
  marker: string;
  columns: number;
  vars: VariableDef[];
  sampleRows: Record<string, string>[];
  rowTemplates: Record<Lang, string>;
}

export interface Bundle {
  schema: typeof BUNDLE_SCHEMA;
  version: typeof BUNDLE_VERSION;
  templateCode?: string;
  name: string;
  generatedAt: string;
  baseLang: Lang;
  langs: Lang[];
  variables: VariableDef[];
  locales: Record<Lang, { subject: string; html: string }>;
  dynamicTables: BundleDynamicTable[];
  source: Project;
  checksum: string;
}

/* ------------------------------------------------------------------ 체크섬 */

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

/** 키를 재귀 정렬한 공백 없는 JSON. `checksum` 필드는 제외하고 계산한다. */
export function canonicalJson(bundle: Omit<Bundle, 'checksum'> | Bundle): string {
  const { checksum: _c, ...rest } = bundle as Bundle;
  return JSON.stringify(canonical(rest));
}

export function computeChecksum(bundle: Omit<Bundle, 'checksum'> | Bundle): string {
  return 'sha256:' + sha256Hex(canonicalJson(bundle));
}

/* ------------------------------------------------------------------ 생성 */

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 렌더 결과(+프로젝트)로 번들 조립. 동기, 검사 없음. */
export function buildBundle(project: Project, rendered: RenderedProject, now: Date = new Date()): Bundle {
  const tables: BundleDynamicTable[] = rendered.dynamicTables.map((t) => ({
    id: t.id,
    marker: t.marker,
    columns: t.columns,
    vars: clone(t.vars),
    sampleRows: clone(t.sampleRows),
    rowTemplates: { ...t.rowTemplates },
  }));
  const body: Omit<Bundle, 'checksum'> = {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_VERSION,
    ...(project.templateCode ? { templateCode: project.templateCode } : {}),
    name: project.name,
    generatedAt: now.toISOString(),
    baseLang: project.baseLang,
    langs: [...project.langs],
    variables: clone(project.variables),
    locales: clone(rendered.locales),
    dynamicTables: tables,
    source: clone(project),
  };
  return { ...body, checksum: computeChecksum(body) };
}

export interface ExportOptions extends ValidateOptions {
  inline: InlineFn;
  css?: string;
  /** 오류가 있어도 번들을 만든다. 기본 false */
  force?: boolean;
  now?: Date;
}

export interface ExportResult {
  /** 오류가 있고 force 가 아니면 undefined */
  bundle?: Bundle;
  /** 번들을 JSON 문자열로 직렬화한 것(파일 저장·클립보드 공통). bundle 이 있을 때만 */
  json?: string;
  issues: Issue[];
  /** 오류(level:'error')가 하나라도 있었는가 */
  hasErrors: boolean;
  /** 오류 때문에 내보내기가 막혔는가(= hasErrors && !force) */
  blocked: boolean;
  rendered: RenderedProject;
}

/** 렌더 -> 검사 -> (오류가 없거나 force 면) 번들 생성. */
export async function exportBundle(project: Project, opts: ExportOptions): Promise<ExportResult> {
  if (projectKind(project) === 'notice') throw new Error('공지 프로젝트는 번들을 만들지 않습니다(공지 HTML 을 내보내세요)');
  const rendered = await renderProject(project, { inline: opts.inline, css: opts.css });
  const issues = validateProject(project, { rendered, expectedRows: opts.expectedRows, limitBytes: opts.limitBytes });
  const errors = hasErrors(issues);
  const blocked = errors && !opts.force;
  if (blocked) return { issues, hasErrors: errors, blocked, rendered };
  const bundle = buildBundle(project, rendered, opts.now);
  return { bundle, json: JSON.stringify(bundle, null, 2), issues, hasErrors: errors, blocked, rendered };
}

/* ------------------------------------------------------------------ 복원 */

/** 번들의 source 로 프로젝트를 복원한다(항상 메일)(검증은 하지 않는다 — 필요하면 verifyBundle 을 먼저). */
export function restoreProject(bundle: Bundle): Project {
  // 번들은 메일 전용이다: source 에 kind 가 있어도(손으로 만든 번들 등) 무시해 항상 메일로 복원한다.
  const { kind: _kind, ...rest } = clone(bundle.source);
  return rest;
}

/* ------------------------------------------------------------------ 검증 */

let validator: ReturnType<Ajv2020['compile']> | undefined;
function getValidator() {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    validator = ajv.compile(schema);
  }
  return validator;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/** `<tbody>` 직속에 표식만 있는 형태(공백 허용). 표 밖으로 밀려난 표식은 매칭되지 않는다. */
function directTbodyMarkerRe(marker: string): RegExp {
  return new RegExp(`<tbody\\b[^>]*>\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/tbody\\s*>`, 'i');
}

/** JSON Schema + 의미 검증(언어 키·표식 1회·tbody 직속 위치·행 변수) + 체크섬 재계산. */
export function verifyBundle(input: unknown): VerifyResult {
  const errors: string[] = [];
  const v = getValidator();
  if (!v(input)) {
    for (const e of v.errors ?? []) errors.push(`schema: ${e.instancePath || '/'} ${e.message ?? ''}`.trim());
    return { ok: false, errors };
  }
  const b = input as Bundle;
  if (!b.langs.includes(b.baseLang)) errors.push(`baseLang(${b.baseLang}) 이 langs 에 없습니다`);
  if (!sameSet(Object.keys(b.locales), b.langs)) errors.push('locales 의 언어 키가 langs 와 다릅니다');

  const ids = new Set<string>();
  for (const t of b.dynamicTables) {
    if (ids.has(t.id)) errors.push(`동적 표 id 중복: ${t.id}`);
    ids.add(t.id);
    if (t.marker !== `|!#-rows_${t.id}|`) errors.push(`marker 가 id 와 맞지 않습니다: ${t.id}`);
    if (!sameSet(Object.keys(t.rowTemplates), b.langs)) errors.push(`rowTemplates 의 언어 키가 langs 와 다릅니다: ${t.id}`);
    const declared = t.vars.map((x) => x.name);
    for (const [lang, tpl] of Object.entries(t.rowTemplates)) {
      const used = extractRowVars(tpl);
      if (!sameSet(used, declared)) errors.push(`행 템플릿 {{var}} 와 vars 가 일치하지 않습니다: ${t.id}/${lang}`);
    }
    for (const [lang, loc] of Object.entries(b.locales)) {
      const n = loc.html.split(t.marker).length - 1;
      if (n !== 1) {
        errors.push(`표식 ${t.marker} 가 locales.${lang}.html 에 ${n}회 있습니다(1회여야 함)`);
      } else if (!directTbodyMarkerRe(t.marker).test(loc.html)) {
        // 표 밖(foster parenting 등)으로 밀려난 표식은 워커가 행을 넣을 자리가 없다.
        errors.push(`표식 ${t.marker} 가 locales.${lang}.html 의 해당 표 <tbody> 직속에 있지 않습니다(표 밖이면 안 됨)`);
      }
    }
  }
  for (const [lang, loc] of Object.entries(b.locales)) {
    if (/\sdata-(?:t|rows)\s*=/.test(loc.html)) errors.push(`locales.${lang}.html 에 data-t/data-rows 가 남아 있습니다`);
  }
  // 링크 새 창 규칙: 제외 대상(mailto/tel/sms/#) 이 아닌 모든 <a href> 는 target="_blank" + rel 에 noopener noreferrer
  const linkWhere: [string, string][] = Object.entries(b.locales).map(([lang, loc]) => [`locales.${lang}.html`, loc.html]);
  for (const t of b.dynamicTables)
    for (const [lang, tpl] of Object.entries(t.rowTemplates)) linkWhere.push([`dynamicTables.${t.id}.rowTemplates.${lang}`, tpl]);
  for (const [where, html] of linkWhere) {
    const bad = findLinksMissingTarget(html);
    if (bad.length) errors.push(`${where} 에 target="_blank" rel="noopener noreferrer" 가 없는 링크가 ${bad.length}개 있습니다: ${bad[0]}`);
  }
  if (computeChecksum(b) !== b.checksum) errors.push('checksum 불일치(내용이 변경되었거나 손상됨)');
  return { ok: errors.length === 0, errors };
}

