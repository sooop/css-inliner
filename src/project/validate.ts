import {
  extractPlaceholders,
  extractRowVars,
  fillRowVars,
  findVariableConflicts,
  sanitizeInline,
} from '../markup/compose';
import { findStale, listBlocks } from '../markup/ids';
import { findLinksMissingTarget } from '../markup/links';
import type { Lang } from '../markup/types';
import { projectKind, type Project } from './model';
import type { RenderedProject } from './render';
import { byteLength, GMAIL_CLIP_BYTES, maxRowsWithin } from './size';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  lang?: Lang;
  blockId?: string;
  tableId?: string;
  message: string;
}

export interface ValidateOptions {
  /** renderProject 결과. 있으면 인라인 변환 경고와 Gmail 102KB 검사를 수행한다. */
  rendered?: RenderedProject;
  /** 동적 표별 예상 행 수(표 id -> 행 수). 없으면 0 으로 보고 기본 HTML 크기만 검사 */
  expectedRows?: Record<string, number>;
  /** 잘림 한도(바이트). 기본 102*1024 */
  limitBytes?: number;
  /** true 면 번역 관련 검사(미번역·원문 변경 후 미갱신)를 결과에서 뺀다. */
  ignoreTranslation?: boolean;
}

const MARKER_START = '|!#-';
const PLACEHOLDER_AT = /\|!#-[a-zA-Z0-9_가-힣.\-]+\|/y;

function bodyBlockIds(p: Project): string[] {
  return listBlocks(p.structure).map((b) => b.id);
}
function rowBlockIds(p: Project): string[] {
  return (p.dynamicTables ?? []).flatMap((t) => listBlocks(t.rowStructure).map((b) => b.id));
}
function setDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x));
}

/** 행 템플릿 1개의 바이트(값을 채운 상태 추정). 예시 행 첫 줄 → 변수 sample → `{{var}}` 그대로 순. */
export function estimateRowBytes(
  rowTemplate: string,
  vars: { name: string; sample: string }[],
  sampleRows: Record<string, string>[],
): number {
  const values: Record<string, string> = Object.fromEntries(vars.map((v) => [v.name, v.sample]));
  Object.assign(values, sampleRows[0] ?? {});
  return byteLength(fillRowVars(rowTemplate, values));
}

/** 1) 미번역 — 기준 언어에 내용이 있는 블록이 다른 언어에서 비어 있음. 제목 포함. */
function untranslatedIssues(p: Project, allIds: string[]): Issue[] {
  const issues: Issue[] = [];
  const base = p.baseLang;
  const textOf = (id: string, lang: Lang) => p.strings[id]?.[lang] ?? '';
  for (const lang of p.langs) {
    for (const id of allIds) {
      if (textOf(id, base).trim() !== '' && textOf(id, lang).trim() === '') {
        issues.push({ level: 'warning', code: 'untranslated', lang, blockId: id, message: `미번역: ${id}/${lang} 문자열이 비어 있습니다` });
      }
    }
    if ((p.subject[lang] ?? '').trim() === '') {
      issues.push({ level: 'warning', code: 'untranslated', lang, message: `미번역: 제목(${lang})이 비어 있습니다` });
    }
  }
  return issues;
}

/** 5) 기준 언어 원문 변경 후 미갱신 번역(경고) */
function staleIssues(p: Project, allIds: string[]): Issue[] {
  const idSet = new Set(allIds);
  const base = p.baseLang;
  return findStale(p.strings, p.sourceHash, base)
    .filter((s) => idSet.has(s.id))
    .map((s) => ({ level: 'warning' as const, code: 'stale-translation', lang: s.lang, blockId: s.id, message: `${base} 원문이 바뀐 뒤 번역이 갱신되지 않았습니다 (${s.id}/${s.lang})` }));
}

/** 6) 허용 외 인라인 태그 제거(경고) */
function inlineTagIssues(p: Project, allIds: string[]): Issue[] {
  const issues: Issue[] = [];
  for (const id of allIds) {
    for (const lang of p.langs) {
      const { removed } = sanitizeInline(p.strings[id]?.[lang] ?? '');
      if (removed.length) {
        issues.push({ level: 'warning', code: 'inline-tag-removed', lang, blockId: id, message: `허용되지 않은 인라인 태그가 제거됩니다 (${id}/${lang}): ${[...new Set(removed)].join(', ')}` });
      }
    }
  }
  return issues;
}

/** 공지 본문·제목에 남으면 안 되는 치환자: 메일 치환자 `|!#-` 시작과 행 변수 `{{name}}` */
const NOTICE_FORBIDDEN = /\|!#-|\{\{[a-zA-Z0-9_가-힣.\-]+\}\}/;
/** 공지 출력에 남으면 안 되는 메일 셸·편집용 흔적: 셸 표식, `mail`/`mail-*` 클래스, data-t/data-rows, 주석 */
const NOTICE_LEFTOVER = /\sdata-tx-shell\b|\sclass\s*=\s*["'](?:[^"']*\s)?mail(?:-[\w-]+)?(?:\s[^"']*)?["']|\sdata-(?:t|rows)\s*=|<!--/i;

/**
 * 공지(kind: 'notice') 검사. 메일 전용 규칙(언어 간 치환자 집합·표식 형식·동적 표·Gmail 크기)은 건너뛰고,
 * 치환자 금지·동적 표 금지·출력의 셸/링크 규칙을 본다. 미번역·오래됨·인라인 태그 제거는 메일과 같다.
 */
function validateNotice(p: Project, opts: ValidateOptions): Issue[] {
  const issues: Issue[] = [];
  const bodyIds = bodyBlockIds(p);
  const textOf = (id: string, lang: Lang) => p.strings[id]?.[lang] ?? '';
  issues.push(...untranslatedIssues(p, bodyIds));

  // 치환자 금지: 구조·문자열·제목 어디에도 `|!#-` / `{{x}}` 가 있으면 안 된다.
  let found = false;
  const forbid = (text: string, where: { lang?: Lang; blockId?: string; label: string }) => {
    const m = NOTICE_FORBIDDEN.exec(text);
    if (!m) return;
    found = true;
    const shown = m[0] === '|!#-' ? text.slice(m.index, m.index + 20) : m[0];
    issues.push({
      level: 'error',
      code: 'notice-placeholder',
      lang: where.lang,
      blockId: where.blockId,
      message: `공지에는 치환자를 쓸 수 없습니다(${where.label}): "${shown}"`,
    });
  };
  forbid(p.structure, { label: '구조' });
  for (const lang of p.langs) {
    for (const id of bodyIds) forbid(textOf(id, lang), { lang, blockId: id, label: `${id}/${lang}` });
    forbid(p.subject[lang] ?? '', { lang, label: `제목/${lang}` });
  }
  if ((p.dynamicTables ?? []).length > 0) {
    issues.push({
      level: 'error',
      code: 'notice-dynamic-table',
      tableId: p.dynamicTables[0].id,
      message: `공지에는 동적 표를 쓸 수 없습니다: ${p.dynamicTables.map((t) => t.id).join(', ')} (초안에서 동적 선언을 지우세요)`,
    });
  }
  if (/\sdata-tx-shell\b/.test(p.structure)) {
    issues.push({ level: 'error', code: 'notice-shell', message: '공지 구조에 메일 셸(data-tx-shell)이 들어 있습니다. 공지는 셸 없이 본문만 씁니다.' });
  }

  issues.push(...staleIssues(p, bodyIds), ...inlineTagIssues(p, bodyIds));

  const r = opts.rendered;
  if (r) {
    for (const w of r.warnings) {
      const code = w.code === 'link-target-restored' || w.code === 'notice-wrapper-missing' ? w.code : 'inline-warning';
      issues.push({ level: 'warning', code, lang: w.lang, message: w.message });
    }
    for (const lang of p.langs) {
      const html = r.locales[lang]?.html;
      if (html === undefined) continue;
      if (!found && NOTICE_FORBIDDEN.test(html)) {
        issues.push({ level: 'error', code: 'notice-placeholder', lang, message: `공지 출력(${lang})에 치환자(|!#-…| 또는 {{…}})가 남아 있습니다` });
      }
      if (NOTICE_LEFTOVER.test(html)) {
        issues.push({ level: 'error', code: 'notice-leftover', lang, message: `공지 출력(${lang})에 메일 셸·편집용 흔적(mail 클래스·data-t·주석 등)이 남아 있습니다` });
      }
      const bad = findLinksMissingTarget(html);
      if (bad.length) {
        issues.push({ level: 'error', code: 'notice-link-target', lang, message: `공지 출력(${lang})에 target="_blank" rel="noopener noreferrer" 가 없는 링크가 ${bad.length}개 있습니다: ${bad[0]}` });
      }
    }
  }
  return issues;
}

/** 번역 관련 검사 코드 — `ignoreTranslation` 으로 끌 수 있다. */
export const TRANSLATION_CODES: readonly string[] = ['untranslated', 'stale-translation'];

export function validateProject(p: Project, opts: ValidateOptions = {}): Issue[] {
  const all = validateProjectAll(p, opts);
  return opts.ignoreTranslation ? all.filter((i) => !TRANSLATION_CODES.includes(i.code)) : all;
}

function validateProjectAll(p: Project, opts: ValidateOptions): Issue[] {
  if (projectKind(p) === 'notice') return validateNotice(p, opts);
  const issues: Issue[] = [];
  const base = p.baseLang;
  const bodyIds = bodyBlockIds(p);
  const allIds = [...bodyIds, ...rowBlockIds(p)];
  const textOf = (id: string, lang: Lang) => p.strings[id]?.[lang] ?? '';

  // 1) 미번역(빈 문자열): 기준 언어에 내용이 있는 블록이 다른 언어에서 비어 있음. 제목 포함.
  issues.push(...untranslatedIssues(p, allIds));

  // 2) 언어 간 치환자 `|!#-x|` 집합. 본문(구조+문자열)과 제목을 각각 기준 언어와 비교.
  const bodyPh = (lang: Lang): Set<string> => {
    const s = new Set<string>(extractPlaceholders(p.structure));
    for (const id of bodyIds) for (const n of extractPlaceholders(textOf(id, lang))) s.add(n);
    return s;
  };
  const subjectPh = (lang: Lang): Set<string> => new Set(extractPlaceholders(p.subject[lang] ?? ''));
  const phSet = (lang: Lang): Set<string> => new Set([...bodyPh(lang), ...subjectPh(lang)]);
  for (const [label, get] of [['본문', bodyPh], ['제목', subjectPh]] as const) {
    const basePh = get(base);
    for (const lang of p.langs) {
      if (lang === base) continue;
      const cur = get(lang);
      const missing = setDiff(basePh, cur);
      const extra = setDiff(cur, basePh);
      if (missing.length || extra.length) {
        const parts = [
          missing.length ? `${base}에만 있음: ${missing.map((n) => `|!#-${n}|`).join(', ')}` : '',
          extra.length ? `${lang}에만 있음: ${extra.map((n) => `|!#-${n}|`).join(', ')}` : '',
        ].filter(Boolean);
        issues.push({ level: 'error', code: 'placeholder-mismatch', lang, message: `치환자 집합 불일치(${label}/${lang}): ${parts.join(' / ')}` });
      }
    }
  }

  // 3) `|!#-` 형식 깨짐 + 대소문자만 다른 중복
  const scan = (text: string, where: { lang?: Lang; blockId?: string; label: string }) => {
    let i = text.indexOf(MARKER_START);
    while (i >= 0) {
      PLACEHOLDER_AT.lastIndex = i;
      if (!PLACEHOLDER_AT.test(text)) {
        const rest = text.slice(i + MARKER_START.length);
        const shown = /^[^|\s<]*/.exec(rest)?.[0] ?? '';
        const closed = /^[^|\n<]*\|/.test(rest);
        issues.push({
          level: 'error',
          code: 'marker-malformed',
          lang: where.lang,
          blockId: where.blockId,
          message: `치환자 형식 깨짐(${where.label}): ${closed ? '허용 외 문자 포함' : '닫는 | 누락'} — "|!#-${shown}"`,
        });
      }
      i = text.indexOf(MARKER_START, i + MARKER_START.length);
    }
  };
  scan(p.structure, { label: '구조' });
  for (const lang of p.langs) {
    for (const id of bodyIds) scan(textOf(id, lang), { lang, blockId: id, label: `${id}/${lang}` });
    scan(p.subject[lang] ?? '', { lang, label: `제목/${lang}` });
  }
  const names = new Set<string>(p.variables.map((v) => v.name));
  for (const lang of p.langs) for (const n of phSet(lang)) names.add(n);
  const byLower = new Map<string, Set<string>>();
  for (const n of names) {
    const k = n.toLowerCase();
    let set = byLower.get(k);
    if (!set) byLower.set(k, (set = new Set()));
    set.add(n);
  }
  for (const set of byLower.values()) {
    if (set.size > 1) {
      issues.push({ level: 'error', code: 'marker-case-duplicate', message: `대소문자만 다른 치환자 이름이 중복됩니다: ${[...set].join(', ')}` });
    }
  }

  // 4) 동적 표: 행 템플릿 {{var}} ↔ vars, 언어 간 일치, 표식·변수 충돌, id 형식
  for (const v of findVariableConflicts(p)) {
    const code = v.code === 'row-var-mismatch' ? 'row-var-lang-mismatch' : v.code;
    issues.push({ level: 'error', code, tableId: v.tableId, message: v.message });
  }
  for (const t of p.dynamicTables ?? []) {
    const used = new Set<string>();
    for (const b of listBlocks(t.rowStructure))
      for (const lang of p.langs) for (const n of extractRowVars(textOf(b.id, lang))) used.add(n);
    for (const d of t.vars) {
      if (!used.has(d.name)) {
        issues.push({ level: 'error', code: 'row-var-unused', tableId: t.id, message: `vars 에 선언된 {{${d.name}}} 가 행 템플릿에서 쓰이지 않습니다 (${t.id})` });
      }
    }
  }

  // 5) 기준 언어 원문 변경 후 미갱신 번역(경고)  6) 허용 외 인라인 태그 제거(경고)
  issues.push(...staleIssues(p, allIds), ...inlineTagIssues(p, allIds));

  // 7) 인라인 변환 경고 + Gmail 크기 (렌더 결과가 있을 때)
  const r = opts.rendered;
  if (r) {
    for (const w of r.warnings) {
      const code = w.code === 'marker-lost' || w.code === 'row-template-malformed' || w.code === 'link-target-restored' ? w.code : 'inline-warning';
      issues.push({ level: 'warning', code, lang: w.lang, message: w.message });
    }
    const limit = opts.limitBytes ?? GMAIL_CLIP_BYTES;
    const expected = opts.expectedRows ?? {};
    for (const lang of p.langs) {
      const html = r.locales[lang]?.html;
      if (html === undefined) continue;
      const baseBytes = byteLength(html);
      const rowBytes = new Map(
        r.dynamicTables.map((t) => [t.id, estimateRowBytes(t.rowTemplates[lang] ?? '', t.vars, t.sampleRows)]),
      );
      const rowsTotal = r.dynamicTables.reduce((s, t) => s + rowBytes.get(t.id)! * (expected[t.id] ?? 0), 0);
      const total = baseBytes + rowsTotal;
      if (total > limit) {
        const detail = r.dynamicTables
          .map((t) => {
            const others = rowsTotal - rowBytes.get(t.id)! * (expected[t.id] ?? 0);
            const max = maxRowsWithin(baseBytes + others, rowBytes.get(t.id)!, limit);
            return `${t.id}: 행당 약 ${rowBytes.get(t.id)}B, 예상 ${expected[t.id] ?? 0}행, 한도 내 최대 ${Number.isFinite(max) ? max : '제한 없음'}행`;
          })
          .join('; ');
        issues.push({
          level: 'warning',
          code: 'gmail-clip',
          lang,
          message: `Gmail 잘림 위험(${lang}): 본문 ${baseBytes}B${rowsTotal ? ` + 행 ${rowsTotal}B` : ''} = ${total}B > ${limit}B${detail ? ` (${detail})` : ''}`,
        });
      }
    }
  }
  return issues;
}

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.level === 'error');
