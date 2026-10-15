/**
 * 문자열 편집·상태 계산 — 순수 함수.
 * - 번역 '오래됨'은 sourceHash(번역 당시 기준 원문 해시)와 현재 기준 원문 해시 비교(`findStale`)로 판정한다.
 * - 비기준 언어를 저장하면 그 시점의 기준 원문 해시를 기록(stampHash)한다.
 * - 기준 언어 원문을 고치기 전에, 해시가 없던 번역(수기 입력 등)에도 '고치기 전 원문 해시'를 먼저 기록해
 *   원문이 바뀐 순간 오래됨으로 잡히게 한다.
 */
import { extractPlaceholders, extractRowVars, mergeVars } from '../../markup/compose';
import { findStale, hashText, listBlocks } from '../../markup/ids';
import type { Lang, VariableDef } from '../../markup/types';
import type { Project } from '../../project/model';
import { describeIds, ID_KIND_LABEL, type IdKind } from './ops';

/** 문자열이 아닌 '제목(subject)'을 선택·편집할 때 쓰는 가상 ID */
export const SUBJECT_ID = '__subject';

export type CellState = 'ok' | 'miss' | 'stale';

export function staleSet(p: Project): Set<string> {
  return new Set(findStale(p.strings, p.sourceHash, p.baseLang).map((s) => `${s.id}|${s.lang}`));
}

export function textOf(p: Project, id: string, lang: Lang): string {
  if (id === SUBJECT_ID) return p.subject[lang] ?? '';
  return p.strings[id]?.[lang] ?? '';
}

export function cellState(p: Project, id: string, lang: Lang, stale: Set<string> = staleSet(p)): CellState {
  if (!textOf(p, id, lang).trim()) return 'miss';
  if (id !== SUBJECT_ID && stale.has(`${id}|${lang}`)) return 'stale';
  return 'ok';
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

/* ------------------------------------------------------------------ 그리드 행 */

export interface StringRow {
  id: string;
  /** 종류 라벨(제목/문단/…, 동적 표 행 문구는 표 id 포함) */
  kind: string;
  kindKey: IdKind | 'subject';
  /** 'body' | 'row:<tableId>' | 'subject' */
  scope: string;
}

/** 그리드에 보일 모든 문자열: 제목 → 본문 블록 → 동적 표 행 템플릿 */
export function listStringRows(p: Project): StringRow[] {
  const rows: StringRow[] = [{ id: SUBJECT_ID, kind: '메일 제목', kindKey: 'subject', scope: 'subject' }];
  const kinds = describeIds(p.structure);
  for (const b of listBlocks(p.structure)) {
    const k = kinds.get(b.id) ?? 'other';
    rows.push({ id: b.id, kind: ID_KIND_LABEL[k], kindKey: k, scope: 'body' });
  }
  for (const t of p.dynamicTables ?? []) {
    for (const b of listBlocks(t.rowStructure)) {
      rows.push({ id: b.id, kind: `${ID_KIND_LABEL['row-cell']} (${t.id})`, kindKey: 'row-cell', scope: `row:${t.id}` });
    }
  }
  return rows;
}

export function rowHasProblem(p: Project, id: string, stale: Set<string> = staleSet(p)): boolean {
  // 기준 언어가 비어 있는 블록(예: 비어 있는 새 문단)은 문제로 보지 않는다
  const baseEmpty = !textOf(p, id, p.baseLang).trim();
  return p.langs.some((l) => {
    const s = cellState(p, id, l, stale);
    if (s === 'stale') return true;
    if (s === 'miss') return id === SUBJECT_ID || !baseEmpty;
    return false;
  });
}

/** 언어별 완료율(%) : 기준 언어에 내용이 있는 문자열 중 해당 언어가 채워진(오래됨 제외) 비율 */
export function completion(p: Project, lang: Lang): number {
  const stale = staleSet(p);
  let total = 0;
  let ok = 0;
  for (const r of listStringRows(p)) {
    if (!textOf(p, r.id, p.baseLang).trim()) continue;
    total++;
    if (cellState(p, r.id, lang, stale) === 'ok') ok++;
  }
  return total === 0 ? 100 : Math.round((ok / total) * 100);
}

/* ------------------------------------------------------------------ 편집 */

/** 한 언어의 문자열을 바꾼다. 제목은 SUBJECT_ID. */
export function setText(p: Project, id: string, lang: Lang, text: string): Project {
  if (id === SUBJECT_ID) return syncVariables({ ...p, subject: { ...p.subject, [lang]: text } });
  const prev = p.strings[id] ?? {};
  if (prev[lang] === text) return p;
  const strings = { ...p.strings, [id]: { ...prev, [lang]: text } };
  const sourceHash = { ...p.sourceHash };
  if (lang === p.baseLang) {
    // 원문이 바뀌기 전에, 해시가 없던 번역에 '이전 원문' 해시를 남겨 둔다
    const oldHash = hashText(prev[lang] ?? '');
    const h = { ...(sourceHash[id] ?? {}) };
    for (const [l, t] of Object.entries(prev)) {
      if (l !== lang && t && h[l] === undefined) h[l] = oldHash;
    }
    if (Object.keys(h).length) sourceHash[id] = h;
  } else {
    sourceHash[id] = { ...(sourceHash[id] ?? {}), [lang]: hashText(strings[id][p.baseLang] ?? '') };
  }
  return syncRowVars(syncVariables({ ...p, strings, sourceHash }), id);
}

/** '최신 확인': 오래됨 표시만 해제(현재 기준 원문 해시 기록) */
export function ackStale(p: Project, id: string, lang: Lang): Project {
  if (id === SUBJECT_ID) return p;
  const sourceHash = { ...p.sourceHash, [id]: { ...(p.sourceHash[id] ?? {}), [lang]: hashText(p.strings[id]?.[p.baseLang] ?? '') } };
  return { ...p, sourceHash };
}

/* ------------------------------------------------------------------ 치환자 / 행 변수 동기화 */

/** 본문(구조·문자열)과 제목에서 쓰인 `|!#-name|` 이름(동적 표 표식 제외), 등장 순서 */
export function usedPlaceholders(p: Project): string[] {
  const rowIds = new Set<string>();
  for (const t of p.dynamicTables ?? []) for (const b of listBlocks(t.rowStructure)) rowIds.add(b.id);
  const names = new Set<string>(extractPlaceholders(p.structure));
  for (const b of listBlocks(p.structure)) {
    for (const lang of p.langs) for (const n of extractPlaceholders(p.strings[b.id]?.[lang] ?? '')) names.add(n);
  }
  for (const lang of p.langs) for (const n of extractPlaceholders(p.subject[lang] ?? '')) names.add(n);
  return [...names].filter((n) => !n.startsWith('rows_'));
}

/** 새로 쓰인 치환자를 목록에 추가한다(기존 설명·샘플 보존, 안 쓰는 항목은 지우지 않음 — 사용자가 직접 삭제). */
export function syncVariables(p: Project): Project {
  const used = usedPlaceholders(p);
  const have = new Set(p.variables.map((v) => v.name));
  const add = used.filter((n) => !have.has(n));
  if (!add.length) return p;
  return { ...p, variables: [...p.variables, ...mergeVars([], add)] };
}

/** 행 템플릿 문자열에서 `{{var}}` 를 새로 쓰면 해당 동적 표의 vars 에 선언을 추가한다. */
function syncRowVars(p: Project, id: string): Project {
  const tables = p.dynamicTables ?? [];
  const t = tables.find((x) => listBlocks(x.rowStructure).some((b) => b.id === id));
  if (!t) return p;
  const used = new Set<string>();
  for (const b of listBlocks(t.rowStructure)) for (const lang of p.langs) for (const n of extractRowVars(p.strings[b.id]?.[lang] ?? '')) used.add(n);
  const add = [...used].filter((n) => !t.vars.some((v) => v.name === n));
  if (!add.length) return p;
  const vars: VariableDef[] = [...t.vars, ...mergeVars([], add)];
  return { ...p, dynamicTables: tables.map((x) => (x === t ? { ...t, vars } : x)) };
}

/** 사용 횟수(본문·제목 문자열 전체 기준) */
export function placeholderUsage(p: Project): Record<string, number> {
  const out: Record<string, number> = {};
  const count = (text: string) => {
    for (const n of extractPlaceholders(text)) out[n] = (out[n] ?? 0) + 1;
  };
  count(p.structure);
  for (const b of listBlocks(p.structure)) for (const lang of p.langs) count(p.strings[b.id]?.[lang] ?? '');
  for (const lang of p.langs) count(p.subject[lang] ?? '');
  return out;
}

export function updateVariable(p: Project, name: string, patch: Partial<VariableDef>): Project {
  return { ...p, variables: p.variables.map((v) => (v.name === name ? { ...v, ...patch } : v)) };
}

export function removeVariable(p: Project, name: string): Project {
  return { ...p, variables: p.variables.filter((v) => v.name !== name) };
}
