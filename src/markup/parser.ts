/**
 * TracX Logis 마크업 파서 (sample/skills/tx-html-generator/scripts/tx_markdown_parser.py 의 TypeScript 포팅)
 *
 * - 브라우저 DOM 에 의존하지 않는 순수 문자열 처리.
 * - parseMarkup(): 원본과 같은 HTML 을 낸다(아래 '의도적 수정' 제외). 골든 테스트로 검증.
 * - parseTxmd(): 다국어 마크업(.txmd). 기준 언어 구조(data-t 키, 텍스트 없음) + 문자열표로 파싱. 명세는 TXMD.md.
 *
 * 원본 대비 의도적 수정(그 외는 동일 동작):
 *  1. 변수(`|!#-x|`, `{{x}}`)와 링크 URL 안의 `_`/`*` 가 강조로 오인되던 버그 수정(원본: `|!#-cust_nm|` -> `|!#-cust<em>nm|`).
 *  2. `_강조_` 는 단어 경계에서만 인식(원본은 snake_case_word 도 기울임 처리).
 *  3. 중첩 순서 목록(`   1. x`)에서 원본은 무한 루프 -> 정상적으로 중첩 <ol> 생성. 진행 없는 재귀 방지 가드 추가.
 *  4. `[버튼,레이블]`(쉼표 뒤 공백 없음)에서 원본은 레이블 첫 글자를 잘라먹음 -> 정상 파싱.
 *  5. 레이블에 인라인 서식(`**굵게**`)이 있는 단일 버튼은 원본 후처리 정규식이 <p> 로 못 감쌈 -> 항상 감쌈.
 *  6. `{{x}}` 는 단일 중괄호 변수 변환(`{x}` -> `|!#-x|`)의 대상이 아니다(동적 표 행 변수 보호).
 *  8. 콜아웃 본문에 표·목록·버튼·인용·구분선을 쓸 수 있고 `~~취소선~~` 을 지원한다(확장, 원본엔 없음 — TXMD.md §4).
 *  7. wrapMain 옵션: 원본은 항상 <main> 으로 감싸 템플릿의 <main> 과 3중 중첩됨(sample.html 버그). parseTxmd 기본은 감싸지 않음.
 */

import { IdAllocator } from './ids';
import type { DynamicTable, Lang, Strings, SourceHash, VariableDef } from './types';
import { stampMissing } from './ids';
import { extractPlaceholders, extractRowVars } from './compose';

/* ------------------------------------------------------------------ 상수 */

const CALLOUT_TYPES = '정보|경고|강조';
const CALLOUT_START = new RegExp(`^\\[(${CALLOUT_TYPES})(?::\\s*([^\\]]*))?\\]`);
const CALLOUT_SIMPLE = new RegExp(`^\\[(${CALLOUT_TYPES})(?::|\\])`);
const HR_LINES = ['---', '***', '___'];
const VAR_NAME = 'a-zA-Z0-9_가-힣.\\-';

const CALLOUT_CSS: Record<string, string> = { 정보: 'info', 경고: 'warn', 강조: 'accent' };

type Trans = Record<Lang, string[]>;

/* ------------------------------------------------------------------ 인라인 */

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const TOKEN_RE = new RegExp(`\\|!#-[${VAR_NAME}]+\\||\\{\\{[${VAR_NAME}]+\\}\\}`, 'g');
const S_OPEN = '';
const S_CLOSE = '';

/** `{변수}` -> `|!#-변수|`. `{{변수}}`(행 변수)는 건드리지 않는다. */
export function normalizeVariables(text: string): string {
  return text.replace(new RegExp(`(?<!\\{)\\{([${VAR_NAME}]+)\\}(?!\\})`, 'g'), '|!#-$1|');
}

/** 변수 토큰은 이스케이프·강조 처리에서 보호하고, 링크 URL 도 강조 처리에서 보호한다. */
export function parseInline(text: string): string {
  const keep: string[] = [];
  const stash = (s: string) => {
    keep.push(s);
    return `${S_OPEN}${keep.length - 1}${S_CLOSE}`;
  };

  // 1) 변수 보호 (이스케이프도 면제)
  let t = text.replace(TOKEN_RE, (m) => stash(m));
  // 2) 이스케이프
  t = htmlEscape(t);
  // 3) 링크 URL 보호 ([text](url) -> [text](SENT))
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => `[${label}](${stash(url)})`);
  // 3-2) 본문 속 맨 URL 도 강조·취소선 처리에서 보호 (https://a.com/~x/_y_/*z*)
  t = t.replace(/https?:\/\/[^\s<>\[\])]+/g, (m) => stash(m));

  // 4) 강조
  const B = '(?<![\\p{L}\\p{N}_])';
  const A = '(?![\\p{L}\\p{N}_])';
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(new RegExp(`${B}___(.+?)___${A}`, 'gu'), '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(new RegExp(`${B}__(.+?)__${A}`, 'gu'), '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  t = t.replace(new RegExp(`${B}_(.+?)_${A}`, 'gu'), '<em>$1</em>');
  // 취소선: `~~` 쌍. 안쪽 양끝이 공백이면 인식하지 않고(`a ~~ b ~~ c`), `~~~` 이상 연속은 건드리지 않는다.
  t = t.replace(/(?<!~)~~(?=[^\s~])(.+?)(?<=[^\s~])~~(?!~)/g, '<del>$1</del>');

  // 5) 링크
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 6) 복원 (중첩 복원 대비 반복)
  const restore = new RegExp(`${S_OPEN}(\\d+)${S_CLOSE}`, 'g');
  for (let i = 0; i < 3; i++) t = t.replace(restore, (_m, n: string) => keep[Number(n)]);
  return t;
}

/* ------------------------------------------------------------------ 파서 본체 */

export interface ParseOptions {
  /** 번역 줄(`@en …`)로 인식할 비기준 언어 코드. parseMarkup 은 항상 [] */
  langs?: Lang[];
  baseLang?: Lang;
  /** 전체를 <main> 으로 감쌀지. parseMarkup 기본 true(원본 동일), parseTxmd 기본 false */
  wrapMain?: boolean;
  /** 구조 모드(data-t + 문자열표) 사용 여부 — 내부용 */
  structured?: boolean;
}

interface Unit {
  attr: string;
  finish(lines: string[], trans: Trans, joiner: string): string;
}

interface ButtonSpec {
  label: string;
  url: string;
  style: string;
}

class Parser {
  readonly structured: boolean;
  readonly base: Lang;
  readonly langs: Set<Lang>;
  readonly alloc = new IdAllocator();
  readonly strings: Strings = {};
  readonly warnings: string[] = [];
  readonly dynamicTables: DynamicTable[] = [];
  includeHeader = false;

  constructor(opts: ParseOptions) {
    this.structured = !!opts.structured;
    this.base = opts.baseLang ?? 'ko';
    this.langs = new Set(opts.langs ?? []);
  }

  /** 콜아웃 본문은 부분 배열로 파싱하므로, 경고의 줄 번호를 원문 기준으로 맞추기 위한 오프셋 */
  lineBase = 0;
  /** 0 기반 배열 인덱스 -> 원문 1 기반 줄 번호 */
  ln(idx: number): number {
    return idx + 1 + this.lineBase;
  }

  warn(msg: string): void {
    this.warnings.push(msg);
  }

  /* ---- 번역 줄 */

  transMatch(raw: string): { lang: Lang; text: string } | null {
    if (this.langs.size === 0) return null;
    const m = /^@([A-Za-z][A-Za-z0-9_-]*)(?:[ \t]+(.*))?$/.exec(raw.trim());
    if (m && this.langs.has(m[1])) return { lang: m[1], text: (m[2] ?? '').trim() };
    return null;
  }

  addTrans(t: Trans, lang: Lang, text: string): void {
    (t[lang] ??= []).push(text);
  }

  /** idx 부터 연속된 번역 줄을 소비해 trans 에 담고 다음 인덱스를 반환 */
  eatTrans(lines: string[], idx: number, trans: Trans): number {
    while (idx < lines.length) {
      const t = this.transMatch(lines[idx]);
      if (!t) break;
      this.addTrans(trans, t.lang, t.text);
      idx++;
    }
    return idx;
  }

  newUnit(): Unit {
    if (!this.structured) {
      return { attr: '', finish: (lines, _t, joiner) => lines.map(parseInline).join(joiner) };
    }
    const id = this.alloc.next();
    return {
      attr: ` data-t="${id}"`,
      finish: (lines, trans, joiner) => {
        const rec: Record<Lang, string> = { [this.base]: lines.map(parseInline).join(joiner) };
        for (const [lang, ls] of Object.entries(trans)) rec[lang] = ls.map(parseInline).join(joiner);
        this.strings[id] = rec;
        return '';
      },
    };
  }

  /** 단일 텍스트 요소 한 개: `<tag attr>content</tag>` */
  simple(tag: string, lines: string[], trans: Trans, joiner = '<br/>'): string {
    const u = this.newUnit();
    return `<${tag}${u.attr}>${u.finish(lines, trans, joiner)}</${tag}>`;
  }

  /* ---- 제목 / 인용 / 목록 */

  parseHeading(line: string, trans: Trans = {}): string | null {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!m) return null;
    return this.simple(`h${m[1].length}`, [m[2]], trans);
  }

  parseBlockquote(lines: string[], start: number): [string, number] {
    const quote: string[] = [];
    const trans: Trans = {};
    let idx = start;
    while (idx < lines.length && lines[idx].startsWith('>')) {
      const content = lines[idx].slice(1).trim();
      if (content) {
        const t = this.transMatch(content);
        if (t) this.addTrans(trans, t.lang, t.text);
        else quote.push(content);
      }
      idx++;
    }
    if (quote.length) {
      idx = this.eatTrans(lines, idx, trans);
      return [`<blockquote>${this.simple('p', quote, trans, '<br>')}</blockquote>`, idx - start];
    }
    return ['', 0];
  }

  parseList(lines: string[], start: number): [string, number] {
    const first = lines[start];
    const ordered = /^\s*\d+\.\s+/.test(first); // 수정 3: 원본은 선행 공백을 허용하지 않아 중첩 순서 목록에서 무한 루프
    const tag = ordered ? 'ol' : 'ul';
    const baseIndent = /^(\s*)/.exec(first)![1].length;
    interface Item { unit: Unit; text: string; trans: Trans; nested: string }
    const items: Item[] = [];
    let idx = start;

    while (idx < lines.length) {
      const line = lines[idx];
      if (!line.trim()) break;

      const t = this.transMatch(line);
      if (t && items.length) {
        this.addTrans(items[items.length - 1].trans, t.lang, t.text);
        idx++;
        continue;
      }

      const cur = /^(\s*)/.exec(line)![1].length;
      if (cur < baseIndent) break;

      if (cur === baseIndent) {
        const m = ordered ? /^\s*\d+\.\s+(.+)$/.exec(line) : /^\s*[-*]\s+(.+)$/.exec(line);
        if (!m) break;
        items.push({ unit: this.newUnit(), text: m[1], trans: {}, nested: '' });
        idx++;
      } else {
        const [nested, consumed] = this.parseList(lines, idx);
        if (consumed === 0) break; // 수정 3: 진행 없는 재귀 방지
        if (items.length) items[items.length - 1].nested += nested;
        idx += consumed;
      }
    }

    const body = items
      .map((it) => `<li${it.unit.attr}>${it.unit.finish([it.text], it.trans, '<br/>')}${it.nested}</li>`)
      .join('\n');
    return [`<${tag}>\n${body}\n</${tag}>`, idx - start];
  }

  /* ---- 표 */

  private splitCells(s: string): string[] {
    return s.trim().split('|').map((c) => c.trim());
  }

  /** 번역 줄 텍스트에서 선택적인 선행 '-' 와 헤더 중괄호를 제거 */
  private transRowBody(text: string, isHeader: boolean): string {
    let s = text.trim();
    if (isHeader) {
      if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1);
    } else if (s.startsWith('-')) {
      s = s.slice(1).trim();
    }
    return s;
  }

  parseTableHorizontal(lines: string[], start: number, dynId: string | null): [string, number] {
    let idx = start;
    const headerLine = lines[idx].trim();
    if (!(headerLine.startsWith('{') && headerLine.endsWith('}'))) return ['', 0];

    const headers = headerLine.slice(1, -1).split('|').map((h) => h.trim());
    const headerTrans: Trans = {};
    idx++;

    interface Row { cells: string[]; trans: Trans }
    const rows: Row[] = [];
    const sampleRows: Record<string, string>[] = [];
    const varDesc = new Map<string, string>();
    const colCount = headers.length;

    while (idx < lines.length) {
      const line = lines[idx].trim();

      if (line === '[/표]') {
        idx++;
        break;
      }
      if (/^#{1,2}\s+/.test(line)) {
        this.warn(`경고: 가로형 테이블의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line ${this.ln(idx)})`);
        break;
      }

      if (dynId !== null) {
        const sm = /^@sample(?:[ \t]+(.*))?$/.exec(line);
        if (sm) {
          const rec: Record<string, string> = {};
          for (const part of (sm[1] ?? '').split('|')) {
            const eq = part.indexOf('=');
            if (eq > 0) rec[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
          }
          sampleRows.push(rec);
          idx++;
          continue;
        }
        const vm = /^@var[ \t]+(\S+)(?:[ \t]+(.*))?$/.exec(line);
        if (vm) {
          varDesc.set(vm[1], (vm[2] ?? '').trim());
          idx++;
          continue;
        }
      }

      const tr = this.transMatch(line);
      if (tr) {
        if (rows.length === 0) this.addTrans(headerTrans, tr.lang, tr.text);
        else this.addTrans(rows[rows.length - 1].trans, tr.lang, tr.text);
        idx++;
        continue;
      }

      if (line.startsWith('-')) {
        rows.push({ cells: this.splitCells(line.slice(1)), trans: {} });
      }
      idx++;
    }

    if (idx === lines.length) {
      const last = lines.length ? lines[lines.length - 1].trim() : '';
      if (last !== '[/표]') this.warn("경고: 가로형 테이블의 종료 태그 '[/표]'가 파일 끝까지 없습니다");
    }
    if (rows.length === 0) this.warn('경고: 빈 가로형 테이블이 생성됩니다');

    // 동적 표: 행 템플릿은 1개만 사용
    let useRows = rows;
    if (dynId !== null && rows.length > 1) {
      this.warn(`경고: 동적 표 '${dynId}' 는 행 템플릿 1개만 사용합니다 (나머지 ${rows.length - 1}행 무시)`);
      useRows = rows.slice(0, 1);
    }

    /** trans 의 줄들을 셀 배열로 환산: 언어 -> 열별 텍스트 */
    const cellTrans = (trans: Trans, isHeader: boolean, what: string): Record<Lang, string[]> => {
      const out: Record<Lang, string[]> = {};
      for (const [lang, ls] of Object.entries(trans)) {
        if (ls.length > 1) this.warn(`경고: ${what}의 '@${lang}' 줄이 여러 개입니다 - 첫 줄만 사용됩니다`);
        let cells = this.splitCells(this.transRowBody(ls[0], isHeader));
        if (cells.length !== colCount) {
          this.warn(`경고: ${what}의 '@${lang}' 칼럼 수 불일치 (헤더: ${colCount}, 번역: ${cells.length}) - 자동 보정됨`);
          while (cells.length < colCount) cells.push('');
          cells = cells.slice(0, colCount);
        }
        out[lang] = cells;
      }
      return out;
    };
    const cellOf = (ct: Record<Lang, string[]>, i: number): Trans => {
      const t: Trans = {};
      for (const [lang, cells] of Object.entries(ct)) t[lang] = [cells[i]];
      return t;
    };

    const hct = cellTrans(headerTrans, true, '헤더');
    let html = `<table class="table-horizontal">\n<thead>\n<tr>\n`;
    headers.forEach((h, i) => {
      const u = this.newUnit();
      html += `<th${u.attr}>${u.finish([h], cellOf(hct, i), '<br/>')}</th>\n`;
    });
    html += '</tr>\n</thead>\n';

    const renderRow = (row: Row, n: number): string => {
      const cells = row.cells;
      if (cells.length !== colCount) {
        this.warn(`경고: 칼럼 수 불일치 (헤더: ${colCount}, 데이터: ${cells.length}) - 자동 보정됨`);
        while (cells.length < colCount) cells.push('');
        if (cells.length > colCount) cells.length = colCount;
      }
      const rct = cellTrans(row.trans, false, `${n}번째 행`);
      let r = '<tr>\n';
      cells.forEach((c, i) => {
        const u = this.newUnit();
        r += `<td${u.attr}>${u.finish([c], cellOf(rct, i), '<br/>')}</td>\n`;
      });
      return r + '</tr>';
    };

    if (dynId === null) {
      html += '<tbody>\n';
      useRows.forEach((row, i) => {
        html += renderRow(row, i + 1) + '\n';
      });
      html += '</tbody>\n</table>';
    } else {
      let rowStructure = '';
      if (useRows.length) rowStructure = renderRow(useRows[0], 1);
      else this.warn(`경고: 동적 표 '${dynId}' 에 행 템플릿이 없습니다`);
      html += this.structured
        ? `<tbody data-rows="${dynId}"></tbody>\n</table>`
        : `<tbody>|!#-rows_${dynId}|</tbody>\n</table>`;
      if (this.structured) this.registerDynamic(dynId, rowStructure, sampleRows, varDesc);
    }
    return [html, idx - start];
  }

  private registerDynamic(
    id: string,
    rowStructure: string,
    sampleRows: Record<string, string>[],
    varDesc: Map<string, string>,
  ): void {
    if (this.dynamicTables.some((t) => t.id === id)) this.warn(`경고: 동적 표 id '${id}' 가 중복됩니다`);
    const perLang: Record<Lang, Set<string>> = {};
    const order: string[] = [];
    for (const m of rowStructure.matchAll(/data-t="([^"]*)"/g)) {
      for (const [lang, text] of Object.entries(this.strings[m[1]] ?? {})) {
        for (const v of extractRowVars(text)) {
          (perLang[lang] ??= new Set()).add(v);
          if (!order.includes(v)) order.push(v);
        }
      }
    }
    for (const [lang, set] of Object.entries(perLang)) {
      const missing = order.filter((v) => !set.has(v));
      if (missing.length)
        this.warn(`경고: 동적 표 '${id}' 의 '${lang}' 행 템플릿에 변수가 빠졌습니다: ${missing.map((v) => `{{${v}}}`).join(', ')}`);
    }
    const vars: VariableDef[] = order.map((name) => ({
      name,
      description: varDesc.get(name) ?? '',
      sample: sampleRows[0]?.[name] ?? '',
    }));
    for (const name of varDesc.keys())
      if (!order.includes(name)) this.warn(`경고: 동적 표 '${id}' 의 @var '${name}' 는 행 템플릿에서 쓰이지 않습니다`);
    this.dynamicTables.push({ id, rowStructure, vars, sampleRows });
  }

  parseTableVertical(lines: string[], start: number): [string, number] {
    let idx = start;
    interface Row { header: string; value: string; trans: Trans }
    const rows: Row[] = [];

    while (idx < lines.length) {
      const line = lines[idx].trim();
      if (line === '[/표]') {
        idx++;
        break;
      }
      if (/^#{1,2}\s+/.test(line)) {
        this.warn(`경고: 세로형 테이블의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line ${this.ln(idx)})`);
        break;
      }
      if (!line) {
        idx++;
        continue;
      }
      const tr = this.transMatch(line);
      if (tr) {
        if (rows.length) this.addTrans(rows[rows.length - 1].trans, tr.lang, tr.text);
        else this.warn(`경고: 세로형 테이블 첫 행보다 앞선 번역 줄이 무시되었습니다 (line ${this.ln(idx)})`);
        idx++;
        continue;
      }
      if (line.startsWith('-')) {
        const [h, v] = this.splitKV(line.slice(1).trim());
        rows.push({ header: h, value: v, trans: {} });
        idx++;
      } else {
        idx++;
      }
    }

    if (idx === lines.length) {
      const last = lines.length ? lines[lines.length - 1].trim() : '';
      if (last !== '[/표]') this.warn("경고: 세로형 테이블의 종료 태그 '[/표]'가 파일 끝까지 없습니다");
    }
    if (rows.length === 0) this.warn('경고: 빈 세로형 테이블이 생성됩니다');

    let html = '<table class="table-vertical">\n';
    for (const row of rows) {
      const hT: Trans = {};
      const vT: Trans = {};
      for (const [lang, ls] of Object.entries(row.trans)) {
        if (ls.length > 1) this.warn(`경고: 세로형 행 '${row.header}' 의 '@${lang}' 줄이 여러 개입니다 - 첫 줄만 사용됩니다`);
        const [h, v] = this.splitKV(this.transRowBody(ls[0], false));
        hT[lang] = [h];
        vT[lang] = [v];
      }
      const uh = this.newUnit();
      const uv = this.newUnit();
      html += '<tr>\n';
      html += `<th${uh.attr}>${uh.finish([row.header], hT, '<br/>')}</th>\n`;
      html += `<td${uv.attr}>${uv.finish([row.value], vT, '<br/>')}</td>\n`;
      html += '</tr>\n';
    }
    html += '</table>';
    return [html, idx - start];
  }

  /** 가장 먼저 나타나는 구분자(파이프가 콜론보다 우선) 기준으로 헤더/값 분리 */
  private splitKV(content: string): [string, string] {
    const colon = content.indexOf(':');
    const pipe = content.indexOf('|');
    if (colon === -1 && pipe === -1) return [content.trim(), ''];
    const pos = pipe !== -1 && (colon === -1 || pipe < colon) ? pipe : colon;
    return [content.slice(0, pos).trim(), content.slice(pos + 1).trim()];
  }

  parseTable(lines: string[], start: number, inCallout = false): [string, number] {
    const m = /^\[표:\s*(가로형|세로형)(?:\s*,\s*동적\s*:\s*([A-Za-z0-9_-]+))?\s*\]/.exec(lines[start]);
    if (!m) return ['', 0];
    let dynId = m[2] ?? null;
    if (inCallout && dynId !== null) {
      this.warn(`경고: 콜아웃 안에서는 동적 표를 지원하지 않습니다 ('${dynId}' 는 정적 표로 처리, line ${this.ln(start)})`);
      dynId = null;
    }
    if (m[1] === '가로형') {
      const [html, consumed] = this.parseTableHorizontal(lines, start + 1, dynId);
      return [html, consumed + 1];
    }
    if (dynId !== null) this.warn(`경고: 세로형 표는 동적 표를 지원하지 않습니다 ('${dynId}' 는 정적 표로 처리)`);
    dynId = null;
    const [html, consumed] = this.parseTableVertical(lines, start + 1);
    return [html, consumed + 1];
  }

  /* ---- 버튼 */

  detectButtonStyle(label: string): string {
    const l = label.toLowerCase();
    if (['신청', '등록', '확인', '구매', '결제', '시작', '추적', '완료'].some((k) => l.includes(k))) return 'primary';
    if (['취소', '삭제', '중단', '거부', '해지', '차단'].some((k) => l.includes(k))) return 'warn';
    if (['나중에', '건너뛰기', '선택', '건너뛰'].some((k) => l.includes(k))) return 'outline';
    return 'secondary';
  }

  /** 콤마 구분, 큰따옴표 안 콤마 허용, 백슬래시 이스케이프 */
  parseCsvLike(text: string): string[] {
    const params: string[] = [];
    let cur = '';
    let inQ = false;
    let esc = false;
    for (const ch of text) {
      if (esc) {
        cur += ch;
        esc = false;
      } else if (ch === '\\') esc = true;
      else if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) {
        params.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur || params.length) params.push(cur.trim());
    return params;
  }

  parseButtonSpec(raw: string): ButtonSpec | null {
    const line = raw.trim();
    if (!line.startsWith('[버튼,') || !line.endsWith(']')) return null;
    const params = this.parseCsvLike(line.slice('[버튼,'.length, -1).trim()); // 수정 4
    if (!params.length) return null;
    const label = params[0] ?? '';
    const url = params.length > 1 ? params[1] : '#';
    const style = params.length > 2 ? params[2] : '';
    if (!label) return null;
    return { label, url, style: style.trim() ? style.trim() : this.detectButtonStyle(label) };
  }

  /* ---- 콜아웃 */

  parseCallout(lines: string[], start: number, inCallout = false): [string, number] {
    const first = lines[start].trim();
    const m = CALLOUT_START.exec(first);
    if (!m) return ['', 0];
    const type = m[1];
    const title = m[2] ? m[2].trim() : null;

    if (inCallout) {
      // 콜아웃 안의 콜아웃은 인용으로 낮춘다(원본 동작). 경고는 골든(원본 stderr) 보존을 위해 .txmd 경로에서만 낸다.
      if (this.structured) this.warn(`경고: 콜아웃 안의 콜아웃 '${type}' 은 지원하지 않아 인용으로 처리되었습니다 (line ${this.ln(start)})`);
      let idx = start + 1;
      const bq: string[] = [];
      const trans: Trans = {};
      while (idx < lines.length) {
        const line = lines[idx];
        if (line.trim() === `[/${type}]`) {
          idx++;
          break;
        }
        if (!/^\[\/(정보|경고|강조)\]/.test(line.trim())) {
          const t = this.transMatch(line);
          if (t) this.addTrans(trans, t.lang, t.text);
          else bq.push(line);
        }
        idx++;
      }
      if (bq.length) {
        const content = bq.filter((l) => l.trim()).map((l) => l.trim());
        return [`<blockquote>${this.simple('p', content, trans, '<br>')}</blockquote>`, idx - start];
      }
      return ['', idx - start];
    }

    // 제목 바로 아래 번역 줄 = 제목 번역
    const titleTrans: Trans = {};
    let idx = this.eatTrans(lines, start + 1, titleTrans);
    if (!title && Object.keys(titleTrans).length) {
      this.warn(`경고: 제목 없는 콜아웃 '${type}'(line ${this.ln(start)}) 아래의 번역 줄이 무시되었습니다`);
    }

    const bodyStart = idx;
    const contentLines: string[] = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.trim() === `[/${type}]`) {
        idx++;
        break;
      }
      if (/^#{1,2}\s+/.test(line.trim())) {
        this.warn(`경고: 콜아웃 '${type}'의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line ${this.ln(idx)})`);
        break;
      }
      contentLines.push(line);
      idx++;
    }
    if (idx === lines.length) {
      const last = lines.length ? lines[lines.length - 1].trim() : '';
      if (last !== `[/${type}]`) this.warn(`경고: 콜아웃 '${type}'의 종료 태그가 파일 끝까지 없습니다`);
    }

    const titleUnit = title ? this.newUnit() : null; // 제목 ID 가 본문보다 앞서도록 먼저 발급
    const savedBase = this.lineBase;
    this.lineBase = savedBase + bodyStart;
    const contentHtml = this.parseBlocks(contentLines, true).join('\n');
    this.lineBase = savedBase;
    if (!contentLines.length || !contentLines.join('').trim()) {
      this.warn(`경고: 빈 콜아웃 '${type}'이 생성됩니다`);
    }

    let html = `<div class="callout callout-${CALLOUT_CSS[type]}">\n`;
    if (title && titleUnit) {
      html += `<h3${titleUnit.attr}>${titleUnit.finish([title], titleTrans, '<br/>')}</h3>\n`;
    }
    html += contentHtml;
    html += '\n</div>';
    return [html, idx - start];
  }

  /** 번역 줄이 모인 뒤 제목 요소 생성 (parseHeading 은 유닛을 즉시 발급하므로 여기서는 발급 전 호출) */
  private headingWith(line: string, trans: Trans): string {
    const m = /^(#{1,3})\s+(.+)$/.exec(line)!;
    return this.simple(`h${m[1].length}`, [m[2]], trans);
  }

  /* ---- 문단 */

  parseParagraphBlock(lines: string[], start: number): [string, number] {
    const pLines: string[] = [];
    const trans: Trans = {};
    let idx = start;
    while (idx < lines.length) {
      const stripped = lines[idx].trim();
      if (!stripped) break;
      if (
        stripped.startsWith('#') ||
        stripped.startsWith('[표:') ||
        stripped.startsWith('[버튼,') ||
        CALLOUT_SIMPLE.test(stripped) ||
        stripped.startsWith('>') ||
        /^(\s*)[-*]\s+/.test(stripped) ||
        /^(\s*)\d+\.\s+/.test(stripped) ||
        HR_LINES.includes(stripped)
      )
        break;
      const t = this.transMatch(stripped);
      if (t) this.addTrans(trans, t.lang, t.text);
      else pLines.push(stripped);
      idx++;
    }
    if (pLines.length) return [this.simple('p', pLines, trans), idx - start];
    return ['', 0];
  }

  /** 연속된 버튼 줄 -> `<p>` 한 개(여러 개면 btn-group). 버튼 줄이 아니면 null */
  parseButtons(lines: string[], idx: number): [string, number] | null {
    const specs: { spec: ButtonSpec; trans: Trans }[] = [];
    let b = idx;
    let last: { spec: ButtonSpec; trans: Trans } | null = null;
    while (b < lines.length) {
      const bl = lines[b].trim();
      if (!bl) break;
      const t = this.transMatch(bl);
      if (t) {
        if (last) this.addTrans(last.trans, t.lang, t.text);
        b++;
        continue;
      }
      if (!bl.startsWith('[버튼,')) break;
      const spec = this.parseButtonSpec(bl);
      last = spec ? { spec, trans: {} } : null;
      if (last) specs.push(last);
      b++;
    }
    if (!specs.length) return null;
    const anchors = specs.map(({ spec, trans }) => {
      const u = this.newUnit();
      return `<a href="${spec.url}" class="btn btn-${spec.style}"${u.attr}>${u.finish([spec.label], trans, '<br/>')}</a>`;
    });
    const html = specs.length > 1 ? `<p class="btn-group">${anchors.join('')}</p>` : `<p>${anchors[0]}</p>`;
    return [html, b - idx];
  }

  /**
   * 블록 목록 파싱. 최상위(inCallout=false)와 콜아웃 본문(inCallout=true)이 같은 블록 문법을 쓴다.
   * 콜아웃 본문의 차이: 안쪽 콜아웃은 인용으로 낮추고, 동적 표는 정적 표로 처리한다.
   */
  parseBlocks(lines: string[], inCallout: boolean): string[] {
    const blocks: string[] = [];
    let idx = 0;

    while (idx < lines.length) {
      const line = lines[idx].trim();
      if (!line) {
        idx++;
        continue;
      }

      if (HR_LINES.includes(line)) {
        blocks.push('<hr>');
        idx++;
        continue;
      }

      if (this.transMatch(line)) {
        this.warn(
          inCallout
            ? `경고: 번역 대상 블록이 없는 번역 줄이 콜아웃 안에서 무시되었습니다 (line ${this.ln(idx)})`
            : `경고: 번역 대상 블록이 없는 번역 줄이 무시되었습니다 (line ${this.ln(idx)})`,
        );
        idx++;
        continue;
      }

      if (line.startsWith('[표:')) {
        const [html, consumed] = this.parseTable(lines, idx, inCallout);
        if (html) {
          blocks.push(html);
          idx += consumed;
          continue;
        }
      }

      if (CALLOUT_SIMPLE.test(line)) {
        const [html, consumed] = this.parseCallout(lines, idx, inCallout);
        if (html) {
          blocks.push(html);
          idx += consumed;
          continue;
        }
        if (inCallout && consumed > 0) {
          idx += consumed; // 내용이 빈 안쪽 콜아웃: 여는~닫는 줄을 통째로 건너뜀
          continue;
        }
      }

      if (line.startsWith('[버튼,')) {
        const r = this.parseButtons(lines, idx);
        if (r) {
          blocks.push(r[0]);
          idx += r[1];
          continue;
        }
      }

      if (line.startsWith('>')) {
        const [html, consumed] = this.parseBlockquote(lines, idx);
        if (html) {
          blocks.push(html);
          idx += consumed;
          continue;
        }
      }

      if (/^(\s*)[-*]\s+/.test(line) || /^(\s*)\d+\.\s+/.test(line)) {
        const [html, consumed] = this.parseList(lines, idx);
        if (html) {
          blocks.push(html);
          idx += consumed;
          continue;
        }
      }

      if (/^(#{1,3})\s+(.+)$/.test(line)) {
        const trans: Trans = {};
        const next = this.eatTrans(lines, idx + 1, trans);
        blocks.push(this.headingWith(line, trans));
        idx = next;
        continue;
      }

      const [ph, consumed] = this.parseParagraphBlock(lines, idx);
      if (ph) {
        blocks.push(ph);
        idx += consumed;
        continue;
      }

      idx++;
    }
    return blocks;
  }

  /* ---- 전체 */

  parse(input: string, wrapMain: boolean): string {
    // 원본은 파일을 universal newline 으로 읽는다
    let text = input.replace(/\r\n?/g, '\n');
    text = normalizeVariables(text);

    if (text.includes('[헤더]')) {
      this.includeHeader = true;
      text = text.split('[헤더]\n').join('');
    }

    const lines = text.split('\n');
    const blocks = this.parseBlocks(lines, false);

    let html = blocks.join('\n');
    if (wrapMain) html = `<main>\n${html}\n</main>`;
    if (this.includeHeader && !this.structured) html = `<!--HEADER_PLACEHOLDER-->${html}`;
    return html;
  }
}

/* ------------------------------------------------------------------ 공개 API */

export interface MarkupResult {
  html: string;
  warnings: string[];
}

/** 원본 파서와 같은 형태의 HTML 을 반환. 경고는 원본의 stderr 메시지와 같은 문자열. */
export function parseMarkup(markup: string, opts: { wrapMain?: boolean } = {}): MarkupResult {
  const p = new Parser({ structured: false });
  const html = p.parse(markup, opts.wrapMain ?? true);
  return { html, warnings: p.warnings };
}

export interface TxmdResult {
  /** 기준 언어 구조: data-t 키만 있고 텍스트 없음 */
  structure: string;
  /** 블록 ID -> {기준언어, 번역…} */
  strings: Strings;
  /** 번역 줄이 있던 문자열의 '번역 당시 기준 원문 해시' */
  sourceHash: SourceHash;
  dynamicTables: DynamicTable[];
  /** 구조·문자열에서 발견된 `|!#-name|` 치환자 이름(동적 표 표식 제외) */
  variables: string[];
  /** `[헤더]` 마커 존재 여부 */
  includeHeader: boolean;
  baseLang: Lang;
  /** 번역이 하나라도 있는 언어(기준 제외) */
  langsFound: Lang[];
  warnings: string[];
}

export function parseTxmd(
  txmd: string,
  opts: { baseLang?: Lang; langs?: Lang[]; wrapMain?: boolean } = {},
): TxmdResult {
  const baseLang = opts.baseLang ?? 'ko';
  const langs = (opts.langs ?? ['en', 'ja']).filter((l) => l !== baseLang);
  const p = new Parser({ structured: true, baseLang, langs });
  const structure = p.parse(txmd, opts.wrapMain ?? false);

  const found = new Set<Lang>();
  const names = new Set<string>(extractPlaceholders(structure));
  for (const byLang of Object.values(p.strings)) {
    for (const [lang, text] of Object.entries(byLang)) {
      if (lang !== baseLang) found.add(lang);
      for (const n of extractPlaceholders(text)) names.add(n);
    }
  }
  for (const t of p.dynamicTables) names.delete(`rows_${t.id}`);

  return {
    structure,
    strings: p.strings,
    sourceHash: stampMissing({}, p.strings, baseLang),
    dynamicTables: p.dynamicTables,
    variables: [...names],
    includeHeader: p.includeHeader,
    baseLang,
    langsFound: [...found],
    warnings: p.warnings,
  };
}
