import type { Lang, SourceHash, Strings, DynamicTable } from './types';

/** `b001` 형식 블록 ID 발급기. 기존 ID 를 알려주면 겹치지 않게 이어서 발급한다. */
export class IdAllocator {
  private n = 0;
  constructor(existing: Iterable<string> = []) {
    for (const id of existing) this.reserve(id);
  }
  reserve(id: string): void {
    const m = /^b(\d+)$/.exec(id);
    if (m) this.n = Math.max(this.n, parseInt(m[1], 10));
  }
  next(): string {
    this.n += 1;
    return formatId(this.n);
  }
}

export function formatId(n: number): string {
  return 'b' + String(n).padStart(3, '0');
}

/** 비암호화 53비트 해시(cyrb53) -> 14자리 hex. 동기 순수 함수라 node/브라우저 어디서나 같은 값이 나온다. */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const v = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return v.toString(16).padStart(14, '0');
}

const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

export interface BlockRef {
  id: string;
  tag: string;
}

/** structure 안의 data-t 블록을 문서 순서대로 나열 */
export function listBlocks(structure: string): BlockRef[] {
  const out: BlockRef[] = [];
  for (const m of structure.matchAll(OPEN_TAG)) {
    const am = /\sdata-t="([^"]*)"/.exec(m[2]);
    if (am) out.push({ id: am[1], tag: m[1].toLowerCase() });
  }
  return out;
}

/** structure 의 data-t 값을 매핑표로 일괄 치환(한 번의 패스라 새 ID 와 옛 ID 가 겹쳐도 안전) */
export function renameIds(structure: string, map: Map<string, string>): string {
  return structure.replace(OPEN_TAG, (m, tag: string, attrs: string) => {
    const am = /\sdata-t="([^"]*)"/.exec(attrs);
    if (!am) return m;
    const to = map.get(am[1]);
    if (to === undefined) return m;
    return `<${tag}${attrs.replace(am[0], ` data-t="${to}"`)}>`;
  });
}

/** 기준 언어 원문이 바뀐 뒤 갱신되지 않은 번역(id, lang) 목록. 해시가 기록되지 않은 번역은 '알 수 없음'이라 오래됨으로 보지 않는다. */
export function findStale(
  strings: Strings,
  sourceHash: SourceHash,
  baseLang: Lang,
): { id: string; lang: Lang }[] {
  const out: { id: string; lang: Lang }[] = [];
  for (const [id, byLang] of Object.entries(strings)) {
    const cur = hashText(byLang[baseLang] ?? '');
    for (const [lang, text] of Object.entries(byLang)) {
      if (lang === baseLang || !text) continue;
      const was = sourceHash[id]?.[lang];
      if (was !== undefined && was !== cur) out.push({ id, lang });
    }
  }
  return out;
}

/** 번역을 저장할 때 호출: 그 시점의 기준 원문 해시를 기록 */
export function stampHash(
  sourceHash: SourceHash,
  strings: Strings,
  id: string,
  lang: Lang,
  baseLang: Lang,
): void {
  (sourceHash[id] ??= {})[lang] = hashText(strings[id]?.[baseLang] ?? '');
}

/** 해시가 없는 비기준 언어 번역에 현재 기준 원문 해시를 채운다(새로 파싱한 직후용). 새 객체를 반환. */
export function stampMissing(sourceHash: SourceHash, strings: Strings, baseLang: Lang): SourceHash {
  const out: SourceHash = {};
  for (const [id, h] of Object.entries(sourceHash)) out[id] = { ...h };
  for (const [id, byLang] of Object.entries(strings)) {
    for (const [lang, text] of Object.entries(byLang)) {
      if (lang === baseLang || !text) continue;
      if (out[id]?.[lang] === undefined) (out[id] ??= {})[lang] = hashText(byLang[baseLang] ?? '');
    }
  }
  return out;
}

export interface IdState {
  structure: string;
  strings: Strings;
  sourceHash?: SourceHash;
  dynamicTables?: DynamicTable[];
}

export interface InheritReport {
  kept: string[]; // 태그·기준 원문이 모두 같아 ID 를 그대로 이어받음
  changed: string[]; // 같은 자리(같은 태그)라 ID 를 이어받았지만 기준 원문이 달라짐
  added: string[]; // 새 ID 발급
  removed: string[]; // 이전에 있었으나 사라짐(번역도 폐기)
}

function allBlocks(s: IdState): BlockRef[] {
  const out = listBlocks(s.structure);
  for (const t of s.dynamicTables ?? []) out.push(...listBlocks(t.rowStructure));
  return out;
}

/**
 * 초안을 다시 파싱했을 때 이전 프로젝트의 블록 ID 와 번역을 이어받는다.
 *
 * 1) 태그+기준 원문이 같은 블록끼리 LCS 로 정렬(앵커) -> 같은 ID
 * 2) 앵커 사이 빈틈에서 같은 태그의 블록을 순서대로 짝지어 ID 를 이어받음(원문이 바뀐 블록 = '오래됨' 후보)
 * 3) 짝이 없는 새 블록은 이어서 새 ID 를 발급
 * 번역(비기준 언어)은 새 파싱 결과에 있으면 그것을, 없으면 이전 것을 이어받는다.
 */
export function inheritIds(
  prev: IdState,
  next: IdState,
  baseLang: Lang,
): IdState & { sourceHash: SourceHash; report: InheritReport } {
  const oldB = allBlocks(prev);
  const newB = allBlocks(next);
  const text = (st: IdState, id: string) => st.strings[id]?.[baseLang] ?? '';
  const SEP = '\u0000';
  const keyOld = oldB.map((b) => b.tag + SEP + text(prev, b.id));
  const keyNew = newB.map((b) => b.tag + SEP + text(next, b.id));

  const n = oldB.length;
  const m = newB.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = keyOld[i] === keyNew[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const anchors: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (keyOld[i] === keyNew[j]) {
      anchors.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  const map = new Map<string, string>(); // 새 파싱 ID -> 최종 ID
  const report: InheritReport = { kept: [], changed: [], added: [], removed: [] };
  const usedOld = new Set<string>();
  for (const [i, j] of anchors) {
    map.set(newB[j].id, oldB[i].id);
    usedOld.add(oldB[i].id);
    report.kept.push(oldB[i].id);
  }

  const bounds: [number, number][] = [...anchors, [n, m]];
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of bounds) {
    let oi = pi;
    for (let j = pj; j < aj; j++) {
      for (let i = oi; i < ai; i++) {
        if (oldB[i].tag === newB[j].tag) {
          map.set(newB[j].id, oldB[i].id);
          usedOld.add(oldB[i].id);
          report.changed.push(oldB[i].id);
          oi = i + 1;
          break;
        }
      }
    }
    pi = ai + 1;
    pj = aj + 1;
  }

  const alloc = new IdAllocator([...oldB.map((b) => b.id), ...map.values()]);
  for (const b of newB) {
    if (!map.has(b.id)) {
      const id = alloc.next();
      map.set(b.id, id);
      report.added.push(id);
    }
  }
  for (const b of oldB) if (!usedOld.has(b.id)) report.removed.push(b.id);

  const strings: Strings = {};
  const sourceHash: SourceHash = {};
  for (const b of newB) {
    const fin = map.get(b.id)!;
    const fresh = next.strings[b.id] ?? {};
    const old = prev.strings[fin] ?? {};
    const merged: Record<Lang, string> = { ...fresh };
    const hashes: Record<Lang, string> = {};
    const baseNow = fresh[baseLang] ?? '';
    for (const lang of new Set([...Object.keys(old), ...Object.keys(fresh)])) {
      if (lang === baseLang) continue;
      if (fresh[lang]) {
        merged[lang] = fresh[lang];
        hashes[lang] = hashText(baseNow);
      } else if (old[lang]) {
        merged[lang] = old[lang];
        hashes[lang] = prev.sourceHash?.[fin]?.[lang] ?? hashText(old[baseLang] ?? '');
      }
    }
    strings[fin] = merged;
    if (Object.keys(hashes).length) sourceHash[fin] = hashes;
  }

  return {
    structure: renameIds(next.structure, map),
    strings,
    sourceHash,
    dynamicTables: (next.dynamicTables ?? []).map((t) => ({ ...t, rowStructure: renameIds(t.rowStructure, map) })),
    report,
  };
}
