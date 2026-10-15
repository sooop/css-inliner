/** 동적 표(서버가 tbody 행을 생성하는 표) 편집 — 순수 함수 */
import { extractRowVars } from '../../markup/compose';
import { listBlocks } from '../../markup/ids';
import type { DynamicTable } from '../../markup/types';
import type { Project } from '../../project/model';
import { attrOf, find, parseTree, walk } from './html-tree';

export function getTable(p: Project, tableId: string): DynamicTable | undefined {
  return (p.dynamicTables ?? []).find((t) => t.id === tableId);
}

function mapTable(p: Project, tableId: string, fn: (t: DynamicTable) => DynamicTable): Project {
  return { ...p, dynamicTables: (p.dynamicTables ?? []).map((t) => (t.id === tableId ? fn(t) : t)) };
}

export interface TableLayout {
  /** 표 머리(th) 문자열 ID — 본문 구조에 있음 */
  headIds: string[];
  /** 행 템플릿 셀 문자열 ID — rowStructure 에 있음 */
  cellIds: string[];
}

/** 본문 구조에서 `tbody[data-rows=id]` 가 든 표의 머리 셀 ID 와, 행 템플릿 셀 ID */
export function tableLayout(p: Project, tableId: string): TableLayout {
  const t = getTable(p, tableId);
  const cellIds = t ? listBlocks(t.rowStructure).map((b) => b.id) : [];
  const roots = parseTree(p.structure);
  const tbody = find(roots, (e) => e.tag === 'tbody' && attrOf(e, 'data-rows') === tableId);
  const headIds: string[] = [];
  let table = tbody?.parent;
  while (table && table.tag !== 'table') table = table.parent;
  if (table) {
    walk(table.children, (e) => {
      if (e.tag !== 'th') return;
      let a = e.parent;
      while (a && a !== table) {
        if (a.tag === 'thead') {
          const id = attrOf(e, 'data-t');
          if (id) headIds.push(id);
          return;
        }
        a = a.parent;
      }
    });
  }
  return { headIds, cellIds };
}

/** 선언돼 있지만 행 템플릿(모든 언어)에서 안 쓰이는 변수 이름 */
export function unusedVars(p: Project, t: DynamicTable): string[] {
  const used = new Set<string>();
  for (const b of listBlocks(t.rowStructure)) for (const l of p.langs) for (const n of extractRowVars(p.strings[b.id]?.[l] ?? '')) used.add(n);
  return t.vars.filter((v) => !used.has(v.name)).map((v) => v.name);
}

export function updateTableVar(p: Project, tableId: string, name: string, patch: { description?: string; sample?: string }): Project {
  return mapTable(p, tableId, (t) => ({ ...t, vars: t.vars.map((v) => (v.name === name ? { ...v, ...patch } : v)) }));
}

export function removeTableVar(p: Project, tableId: string, name: string): Project {
  return mapTable(p, tableId, (t) => ({
    ...t,
    vars: t.vars.filter((v) => v.name !== name),
    sampleRows: t.sampleRows.map((r) => {
      const { [name]: _drop, ...rest } = r;
      return rest;
    }),
  }));
}

export function addSampleRow(p: Project, tableId: string): Project {
  return mapTable(p, tableId, (t) => {
    const last = t.sampleRows[t.sampleRows.length - 1];
    const row = Object.fromEntries(t.vars.map((v) => [v.name, last?.[v.name] ?? v.sample]));
    return { ...t, sampleRows: [...t.sampleRows, row] };
  });
}

export function removeSampleRow(p: Project, tableId: string, index: number): Project {
  return mapTable(p, tableId, (t) => ({ ...t, sampleRows: t.sampleRows.filter((_, i) => i !== index) }));
}

export function setSampleCell(p: Project, tableId: string, index: number, name: string, value: string): Project {
  return mapTable(p, tableId, (t) => ({
    ...t,
    sampleRows: t.sampleRows.map((r, i) => (i === index ? { ...r, [name]: value } : r)),
  }));
}
