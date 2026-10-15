/**
 * `+ 초안` : .txmd → parseTxmd → wrapShell → (빈 프로젝트에 대한) planDraft → 새 프로젝트.
 *
 * 현재 UI 흐름은 '초안으로 새 프로젝트 만들기'뿐이다(createProjectFromDraft / analyzeDraft).
 * 기존 프로젝트에 재적용하는 경로 — planDraft 의 inheritIds 연동(ID·번역 이어받기)·DraftPlan(변경 요약)·shellOptionsFrom —
 * 은 현재 UI 에서 쓰지 않는다(변환 확인 단계 삭제). 나중에 '초안 재적용' 기능이 필요할 때를 위해 순수 함수로 남겨 두며,
 * 단위 테스트(state.test.ts·roundtrip.test.ts)가 동작을 고정한다. planDraft 는 새 프로젝트 생성(빈 프로젝트에 적용)과 샘플 프로젝트 생성에도 쓰인다.
 */
import { inheritIds } from '../../markup/ids';
import { parseTxmd } from '../../markup/parser';
import { wrapShell, type ShellOptions } from '../../markup/shell';
import type { DynamicTable } from '../../markup/types';
import type { Project, ProjectKind } from '../../project/model';
import { createProject, projectKind } from '../../project/model';
import { attrOf, hasClass, parseTree, walk } from './html-tree';
import { stripTags, syncVariables } from './strings';

export interface DraftItem {
  kind: 'added' | 'changed' | 'removed';
  id: string;
  label: string;
}

export interface DraftPlan {
  /** 적용했을 때의 프로젝트(아직 저장·반영되지 않음) */
  next: Project;
  items: DraftItem[];
  counts: { added: number; changed: number; removed: number; kept: number };
  /** parseTxmd 가 낸 경고 */
  warnings: string[];
  /** 변경이 전혀 없음 */
  unchanged: boolean;
  /** 이전 프로젝트에 이어받을 블록이 있었는가(없으면 첫 변환) */
  hadBlocks: boolean;
}

function shortLabel(text: string): string {
  const t = stripTags(text).replace(/\s+/g, ' ').trim();
  return t.length > 36 ? t.slice(0, 36) + '…' : t || '(빈 문구)';
}

function mergeTable(prev: DynamicTable | undefined, next: DynamicTable): DynamicTable {
  if (!prev) return next;
  const vars = next.vars.map((v) => {
    const old = prev.vars.find((x) => x.name === v.name);
    return old ? { ...v, description: v.description || old.description, sample: v.sample || old.sample } : v;
  });
  return { ...next, vars, sampleRows: next.sampleRows.length ? next.sampleRows : prev.sampleRows };
}

function sameStrings(a: Project['strings'], b: Project['strings']): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((id) => {
    const x = a[id];
    const y = b[id] ?? {};
    const ls = new Set([...Object.keys(x), ...Object.keys(y)]);
    return [...ls].every((l) => (x[l] ?? '') === (y[l] ?? ''));
  });
}

/**
 * 이전 프로젝트의 셸(헤더 태그·푸터) 문구를 그대로 다시 쓰도록 옵션을 만든다.
 * ID 는 넘기지 않는다: 새 파싱 ID 와 겹칠 수 있어, 이어받기는 inheritIds(LCS)에 맡긴다.
 * 앱에서 푸터를 고쳤더라도 재변환이 기본 푸터로 되돌리지 않게 하기 위함. 셸이 없던 프로젝트는 기본 셸.
 */
export function shellOptionsFrom(p: Project): ShellOptions {
  if (!/\sdata-tx-shell(?=[\s=>]|$)/.test(p.structure)) return { baseLang: p.baseLang };
  const footer: string[] = [];
  let headerTag: string | undefined;
  walk(parseTree(p.structure), (e) => {
    const id = attrOf(e, 'data-t');
    if (!id) return;
    if (e.tag === 'p' && hasClass(e, 'mail-footer-line')) footer.push(id);
    if (e.tag === 'td' && hasClass(e, 'mail-tag')) headerTag = id;
  });
  const opts: ShellOptions = {
    baseLang: p.baseLang,
    footerBlocks: footer.map((id) => ({ ...(p.strings[id] ?? {}) })),
  };
  if (headerTag) opts.headerTag = { ...(p.strings[headerTag] ?? {}) };
  return opts;
}

/** 현재 UI 미사용(초안 재적용용으로 보존) — 새 프로젝트 생성은 빈 프로젝트에 대해 이 함수를 그대로 호출한다. */
export function planDraft(p: Project, txmd: string): DraftPlan {
  const langs = p.langs.filter((l) => l !== p.baseLang);
  const parsed = parseTxmd(txmd, { baseLang: p.baseLang, langs });
  const prevIds = { structure: p.structure, strings: p.strings, sourceHash: p.sourceHash, dynamicTables: p.dynamicTables };
  // 공지는 셸(로고 헤더·푸터·표 래퍼) 없이 본문 조각만 쓴다 -> 셸 문자열도 없다.
  const shell = projectKind(p) === 'notice' ? { structure: parsed.structure, strings: {} } : wrapShell(parsed.structure, shellOptionsFrom(p));
  const inh = inheritIds(prevIds, { structure: shell.structure, strings: { ...parsed.strings, ...shell.strings }, dynamicTables: parsed.dynamicTables }, p.baseLang);
  const { report } = inh;

  const dynamicTables = (inh.dynamicTables ?? []).map((t) => mergeTable((p.dynamicTables ?? []).find((x) => x.id === t.id), t));
  const next = syncVariables({
    ...p,
    structure: inh.structure,
    strings: inh.strings,
    sourceHash: inh.sourceHash,
    dynamicTables,
    draftMarkup: txmd,
  });

  const base = p.baseLang;
  const items: DraftItem[] = [
    ...report.added.map((id) => ({ kind: 'added' as const, id, label: shortLabel(inh.strings[id]?.[base] ?? '') })),
    ...report.changed.map((id) => ({ kind: 'changed' as const, id, label: shortLabel(inh.strings[id]?.[base] ?? '') })),
    ...report.removed.map((id) => ({ kind: 'removed' as const, id, label: shortLabel(p.strings[id]?.[base] ?? '') })),
  ];
  const counts = { added: report.added.length, changed: report.changed.length, removed: report.removed.length, kept: report.kept.length };
  const hadBlocks = Object.keys(p.strings).length > 0;
  return {
    next,
    items,
    counts,
    warnings: parsed.warnings,
    unchanged:
      counts.added + counts.changed + counts.removed === 0 &&
      next.structure === p.structure &&
      sameStrings(next.strings, p.strings),
    hadBlocks,
  };
}

/* ------------------------------------------------------------------ 새 프로젝트 만들기(현재 UI 흐름) */

export const DRAFT_LANGS = ['ko', 'en', 'ja'];

/** 초안의 첫 제목(`# …`~`###### …`)에서 뽑은 이름 후보. 마크다운 강조 기호는 벗긴다. 없으면 ''. */
export function draftTitle(txmd: string): string {
  const m = /^#{1,6} +(.+?) *$/m.exec(txmd);
  return m ? m[1].replace(/(\*\*|~~|__)/g, '').replace(/\s+/g, ' ').trim() : '';
}

export interface DraftAnalysis {
  /** 만들 수 없는 이유(빈 초안·해석 실패). null 이면 만들 수 있다 */
  error: string | null;
  /** parseTxmd 경고(만들기를 막지 않는다) */
  warnings: string[];
  /** 문자열(블록) 수 — 푸터 등 자동 셸 제외 */
  blockCount: number;
  /** 초안에 번역 줄이 있는 언어 */
  langsFound: string[];
}

/** 만들기 전 점검: 초안을 해석해 경고·오류를 모은다(프로젝트를 만들지 않는다). */
export function analyzeDraft(txmd: string, kind: ProjectKind = 'mail'): DraftAnalysis {
  if (txmd.trim() === '') return { error: '초안이 비어 있습니다. 내용을 입력하세요.', warnings: [], blockCount: 0, langsFound: [] };
  try {
    const r = parseTxmd(txmd, { baseLang: 'ko', langs: DRAFT_LANGS.filter((l) => l !== 'ko') });
    const blockCount = Object.keys(r.strings).length;
    if (blockCount === 0) return { error: '초안에서 문자열(블록)을 찾지 못했습니다.', warnings: r.warnings, blockCount, langsFound: r.langsFound };
    if (kind === 'notice') {
      // 동적 표: 서버가 행을 채우는 메일 전용 기능이라 공지에서는 만들기 단계에서 막는다(정적 표로 조용히 바꾸면 의도와 다른 결과가 된다).
      if (r.dynamicTables.length > 0) {
        const ids = r.dynamicTables.map((t) => t.id).join(', ');
        return { error: `공지에는 동적 표를 쓸 수 없습니다(${ids}). 초안의 [표: …, 동적: …] 선언을 지우고 정적 표로 쓰세요.`, warnings: r.warnings, blockCount, langsFound: r.langsFound };
      }
      // 치환자는 만들기를 막지 않고 경고만 한다(만든 뒤 검사 오류로 내보내기가 막힌다).
      const warnings = r.variables.length ? [...r.warnings, `공지에는 치환자를 쓸 수 없습니다: ${r.variables.map((v) => `|!#-${v}|`).join(', ')} — 만들 수는 있지만 검사 오류로 내보내기가 막힙니다.`] : r.warnings;
      return { error: null, warnings, blockCount, langsFound: r.langsFound };
    }
    return { error: null, warnings: r.warnings, blockCount, langsFound: r.langsFound };
  } catch (e) {
    return { error: '초안을 해석하지 못했습니다: ' + (e instanceof Error ? e.message : String(e)), warnings: [], blockCount: 0, langsFound: [] };
  }
}

/**
 * 초안으로 새 프로젝트를 만든다(순수 — 저장하지 않는다). 빈 프로젝트에 planDraft 를 적용하므로 `@en/@ja` 줄은 초기 번역이 된다.
 * 빈 초안·해석 실패는 예외. `draftMarkup`(마지막 초안)은 참고용으로 프로젝트에 남는다.
 */
export function createProjectFromDraft(txmd: string, info: { name: string; templateCode?: string; kind?: ProjectKind }): { project: Project; warnings: string[] } {
  const kind: ProjectKind = info.kind === 'notice' ? 'notice' : 'mail';
  const a = analyzeDraft(txmd, kind);
  if (a.error) throw new Error(a.error);
  const code = info.templateCode?.trim();
  const blank = createProject({ name: info.name, ...(code ? { templateCode: code } : {}), ...(kind === 'notice' ? { kind } : {}), subject: { ko: '', en: '', ja: '' } });
  const plan = planDraft(blank, txmd);
  return { project: plan.next, warnings: [...plan.warnings, ...a.warnings.filter((w) => !plan.warnings.includes(w))] };
}
