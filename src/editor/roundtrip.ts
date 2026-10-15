/**
 * 왕복 보존 검사. `.txmd -> 에디터 문서 -> .txmd` 가 의미를 보존하는지 parseTxmd 결과로 비교한다.
 * 에디터는 이 검사를 통과한 입력만 WYSIWYG 로 연다(실패하면 원문 textarea 로 폴백).
 */
import { Node as PMNode, type Schema } from '@milkdown/kit/prose/model';
import { parseTxmd, type TxmdResult } from '../markup/parser';
import { loadTxmd, type J } from './load';
import { docToTxmd, inlineLines } from './serialize';

export interface RoundTripOptions {
  langs?: string[];
}

const tidy = (s: string) => s.replace(/\s+$/g, '').replace(/^\s+/g, '');

/** 비교용 정규형: 문자열 앞뒤 공백 무시(HTML 렌더링에 영향이 없다), 경고는 제외 */
function norm(r: TxmdResult) {
  const strings: Record<string, Record<string, string>> = {};
  for (const [id, byLang] of Object.entries(r.strings)) {
    strings[id] = {};
    for (const [lang, text] of Object.entries(byLang)) strings[id][lang] = tidy(text);
  }
  return {
    structure: r.structure.replace(/\s+/g, ' ').trim(),
    strings,
    dynamicTables: r.dynamicTables.map((t) => ({
      id: t.id,
      rowStructure: t.rowStructure.replace(/\s+/g, ' ').trim(),
      vars: t.vars,
      sampleRows: t.sampleRows,
    })),
    includeHeader: r.includeHeader,
    langsFound: [...r.langsFound].sort(),
    variables: [...r.variables].sort(),
  };
}

/** 두 .txmd 가 같은 파싱 결과를 내는가. 다르면 첫 차이 위치를 알려 준다 */
export function sameMeaning(a: string, b: string, opts: RoundTripOptions = {}): { ok: boolean; diff?: string } {
  const langs = opts.langs;
  const na = norm(parseTxmd(a, { langs }));
  const nb = norm(parseTxmd(b, { langs }));
  const ja = JSON.stringify(na);
  const jb = JSON.stringify(nb);
  if (ja === jb) return { ok: true };
  for (const k of Object.keys(na) as (keyof typeof na)[]) {
    if (JSON.stringify(na[k]) !== JSON.stringify(nb[k])) {
      return { ok: false, diff: `${k}: ${JSON.stringify(na[k]).slice(0, 160)} ≠ ${JSON.stringify(nb[k]).slice(0, 160)}` };
    }
  }
  return { ok: false, diff: 'unknown' };
}

export interface RoundTripResult {
  ok: boolean;
  /** 에디터를 거쳐 나온 .txmd (정규화됨) */
  out: string;
  reason?: string;
}

/** 입력을 문서로 읽고 다시 써서 의미가 같은지, 그리고 한 번 더 왕복해도 같은 글인지(고정점) 확인 */
export function verifyRoundTrip(txmd: string, schema: Schema, opts: RoundTripOptions = {}): RoundTripResult {
  let out = '';
  try {
    const doc = PMNode.fromJSON(schema, loadTxmd(txmd, opts) as unknown as Record<string, unknown>);
    doc.check();
    out = docToTxmd(doc);
    const same = sameMeaning(txmd, out, opts);
    if (!same.ok) return { ok: false, out, reason: `의미가 달라짐 — ${same.diff}` };
    const out2 = docToTxmd(PMNode.fromJSON(schema, loadTxmd(out, opts) as unknown as Record<string, unknown>));
    if (out2 !== out) return { ok: false, out, reason: '두 번째 왕복에서 글이 달라짐(불안정)' };
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out, reason: '에디터 문서로 바꾸지 못함 — ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** 마크업으로 다시 읽으면 다른 블록이 되는 줄(목록 기호·제목·인용·번역 줄 등으로 시작하는 문단) */
function riskyLine(line: string, langs: string[]): boolean {
  const t = line.trim();
  if (/^(#{1,6}\s|>|[-*]\s|\d+\.\s|\[(표:|버튼,|정보|경고|강조|\/)|(---|\*\*\*|___)$)/.test(t)) return true;
  const m = /^@([A-Za-z][A-Za-z0-9_-]*)(\s|$)/.exec(t);
  return !!m && langs.includes(m[1]);
}

/** 편집 후 현재 문서가 안전하게 저장되는지: 직렬화 결과를 다시 읽어 같은 .txmd 가 되는가 */
export function verifyDocStable(doc: PMNode, schema: Schema, opts: RoundTripOptions = {}): { ok: boolean; out: string; reason?: string } {
  const out = docToTxmd(doc);
  const langs = opts.langs ?? ['en', 'ja'];
  let risky: string | null = null;
  doc.descendants((n) => {
    if (risky) return false;
    if (n.type.name === 'paragraph') {
      for (const l of inlineLines(n)) if (riskyLine(l, langs)) risky = l;
    }
    return !risky;
  });
  if (risky) return { ok: false, out, reason: `문단 "${String(risky).slice(0, 30)}" 은(는) 마크업 문법(목록·제목·인용·번역 줄 등)으로 다시 읽힙니다` };
  try {
    const again = PMNode.fromJSON(schema, loadTxmd(out, opts) as unknown as Record<string, unknown>);
    const out2 = docToTxmd(again);
    if (out2 !== out) return { ok: false, out, reason: '다시 읽으면 글이 달라집니다(번역 줄·목록 기호처럼 마크업으로 해석되는 글이 있는지 확인하세요)' };
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type { J };
