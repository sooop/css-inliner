/**
 * .txmd 텍스트 -> 에디터 문서(ProseMirror JSON).
 *
 * `src/markup/parser.ts` 의 Parser.parseBlocks 와 같은 분기 순서·같은 경계 규칙으로 줄을 읽는다(파서는 수정하지 않고
 * 규칙만 미러링). 파서가 '조용히 무시하는 줄'과 번역 줄(`@en …`), `@var`/`@sample` 줄은 버리지 않고 불투명 노드
 * (`txmd_raw`, `txmd_trans`)로 보존한다. 인라인은 파서의 `parseInline` 이 만든 HTML 을 그대로 마크로 옮겨,
 * 인라인 문법 해석이 파서와 어긋나지 않게 한다.
 *
 * 파서의 문법이 바뀌면 이 파일의 정규식·분기도 함께 바꿔야 한다(왕복 테스트가 어긋남을 잡는다).
 */
import { normalizeVariables, parseInline } from '../markup/parser';

export interface J {
  type: string;
  attrs?: Record<string, unknown>;
  content?: J[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface LoadOptions {
  /** 번역 줄로 인식할 비기준 언어 코드(기본 ['en','ja'] — parseTxmd 와 같다) */
  langs?: string[];
}

const CALLOUT_TYPES = '정보|경고|강조';
const CALLOUT_START = new RegExp(`^\\[(${CALLOUT_TYPES})(?::\\s*([^\\]]*))?\\]`);
const CALLOUT_SIMPLE = new RegExp(`^\\[(${CALLOUT_TYPES})(?::|\\])`);
const HR_LINES = ['---', '***', '___'];
const VAR_NAME = 'a-zA-Z0-9_가-힣.\\-';
const TOKEN_SPLIT = new RegExp(`(\\|!#-[${VAR_NAME}]+\\||\\{\\{[${VAR_NAME}]+\\}\\})`);

/* ------------------------------------------------------------------ 인라인 */

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };
const unescapeHtml = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27);/g, (_m, e: string) => ENT[e]);

type MarkJ = { type: string; attrs?: Record<string, unknown> };

/** 한 줄의 마크업 인라인 텍스트 -> 인라인 노드(text/placeholder/rowvar + 마크). 해석은 파서의 parseInline 을 따른다. */
export function inlineFromRaw(raw: string): J[] {
  const html = parseInline(raw);
  const out: J[] = [];
  const stack: MarkJ[] = [];
  const emitText = (chunk: string) => {
    if (!chunk) return;
    chunk.split(TOKEN_SPLIT).forEach((part, i) => {
      if (!part) return;
      // 잘못 겹친 서식(`**a *b** c*`)에서 같은 마크가 두 번 쌓이지 않게 한다
      const seen = new Set<string>();
      const uniq = stack.filter((m) => {
        const k = m.type;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      const marks = uniq.length ? uniq.map((m) => ({ ...m })) : undefined;
      if (i % 2 === 1) {
        if (part.startsWith('{{')) out.push({ type: 'rowvar', attrs: { name: part.slice(2, -2) }, ...(marks ? { marks } : {}) });
        else out.push({ type: 'placeholder', attrs: { name: part.slice(4, -1) }, ...(marks ? { marks } : {}) });
      } else {
        const t = unescapeHtml(part);
        if (t) out.push({ type: 'text', text: t, ...(marks ? { marks } : {}) });
      }
    });
  };
  const MARK_OF: Record<string, string> = { strong: 'strong', em: 'emphasis', del: 'strike_through' };
  const re = /<(\/?)(strong|em|del)>|<a href="([^"]*)">|<\/a>/g;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    emitText(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2]) {
      const type = MARK_OF[m[2]];
      if (m[1]) {
        const at = stack.map((x) => x.type).lastIndexOf(type);
        if (at >= 0) stack.splice(at, 1);
      } else stack.push({ type });
    } else if (m[3] !== undefined) {
      stack.push({ type: 'link', attrs: { href: unescapeHtml(m[3]) } });
    } else {
      const at = stack.map((x) => x.type).lastIndexOf('link');
      if (at >= 0) stack.splice(at, 1);
    }
  }
  emitText(html.slice(last));
  return out;
}

/* ------------------------------------------------------------------ 블록 */

const lineText = (s: string): J[] => [{ type: 'text', text: s }];

class Loader {
  readonly langs: Set<string>;
  constructor(langs: string[]) {
    this.langs = new Set(langs);
  }

  transMatch(raw: string): { lang: string; text: string; line: string } | null {
    if (this.langs.size === 0) return null;
    const t = raw.trim();
    const m = /^@([A-Za-z][A-Za-z0-9_-]*)(?:[ \t]+(.*))?$/.exec(t);
    if (m && this.langs.has(m[1])) return { lang: m[1], text: (m[2] ?? '').trim(), line: t };
    return null;
  }

  trans(lines: string[], orphan = false): J {
    return { type: 'txmd_trans', attrs: { lines, orphan } };
  }

  raw(text: string): J {
    return { type: 'txmd_raw', content: text ? lineText(text) : [] };
  }

  /** 여러 줄(`\n` 은 hardbreak)로 이뤄진 문단 */
  para(lines: string[]): J {
    const content: J[] = [];
    lines.forEach((l, i) => {
      if (i) content.push({ type: 'hardbreak' });
      content.push(...inlineFromRaw(l));
    });
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
  }

  /** idx 부터 연속된 번역 줄 */
  eatTrans(lines: string[], idx: number, into: string[]): number {
    while (idx < lines.length) {
      const t = this.transMatch(lines[idx]);
      if (!t) break;
      into.push(t.line);
      idx++;
    }
    return idx;
  }

  /* ---- 인용 */

  parseBlockquote(lines: string[], start: number): [J[], number] {
    const quote: string[] = [];
    const trans: string[] = [];
    let idx = start;
    while (idx < lines.length && lines[idx].startsWith('>')) {
      const content = lines[idx].slice(1).trim();
      if (content) {
        const t = this.transMatch(content);
        if (t) trans.push(t.line);
        else quote.push(content);
      }
      idx++;
    }
    if (!quote.length) return [[], 0];
    idx = this.eatTrans(lines, idx, trans);
    const body: J[] = [this.para(quote)];
    if (trans.length) body.push(this.trans(trans));
    return [[{ type: 'blockquote', content: body }], idx - start];
  }

  /* ---- 목록 */

  parseList(lines: string[], start: number): [J | null, number] {
    const first = lines[start];
    const ordered = /^\s*\d+\.\s+/.test(first);
    const baseIndent = /^(\s*)/.exec(first)![1].length;
    interface Item { text: string; trans: string[]; nested: J[] }
    const items: Item[] = [];
    let idx = start;

    while (idx < lines.length) {
      const line = lines[idx];
      if (!line.trim()) break;
      const t = this.transMatch(line);
      if (t && items.length) {
        items[items.length - 1].trans.push(t.line);
        idx++;
        continue;
      }
      const cur = /^(\s*)/.exec(line)![1].length;
      if (cur < baseIndent) break;
      if (cur === baseIndent) {
        const m = ordered ? /^\s*\d+\.\s+(.+)$/.exec(line) : /^\s*[-*]\s+(.+)$/.exec(line);
        if (!m) break;
        items.push({ text: m[1], trans: [], nested: [] });
        idx++;
      } else {
        const [nested, consumed] = this.parseList(lines, idx);
        if (consumed === 0) break;
        if (items.length && nested) items[items.length - 1].nested.push(nested);
        idx += consumed;
      }
    }
    if (!items.length) return [null, 0];

    const content: J[] = items.map((it, i) => {
      const body: J[] = [this.para([it.text.replace(/\s+$/, '')])];
      if (it.trans.length) body.push(this.trans(it.trans));
      body.push(...it.nested);
      return {
        type: 'list_item',
        attrs: { label: ordered ? `${i + 1}.` : '•', listType: ordered ? 'ordered' : 'bullet', spread: false },
        content: body,
      };
    });
    return [{ type: ordered ? 'ordered_list' : 'bullet_list', attrs: ordered ? { order: 1, spread: false } : { spread: false }, content }, idx - start];
  }

  /* ---- 표 */

  private splitCells(s: string): string[] {
    return s.trim().split('|').map((c) => c.trim());
  }

  private cell(text: string): J {
    const c = inlineFromRaw(text);
    return c.length ? { type: 'table_cell', content: c } : { type: 'table_cell' };
  }

  private splitKV(content: string): [string, string] {
    const colon = content.indexOf(':');
    const pipe = content.indexOf('|');
    if (colon === -1 && pipe === -1) return [content.trim(), ''];
    const pos = pipe !== -1 && (colon === -1 || pipe < colon) ? pipe : colon;
    return [content.slice(0, pos).trim(), content.slice(pos + 1).trim()];
  }

  /** 표 본문의 '그 밖의 줄'을 보존용 노드로 모은다(연속하는 줄은 한 노드) */
  private pushAux(children: J[], kind: 'trans' | 'raw', text: string) {
    const lastNode = children[children.length - 1];
    if (kind === 'trans') {
      if (lastNode?.type === 'txmd_trans') (lastNode.attrs!.lines as string[]).push(text);
      else children.push(this.trans([text]));
    } else if (lastNode?.type === 'txmd_raw') {
      lastNode.content = [{ type: 'text', text: (lastNode.content?.[0]?.text ?? '') + '\n' + text }];
    } else children.push(this.raw(text));
  }

  parseTableHorizontal(lines: string[], start: number, dynId: string | null): [J | null, number] {
    let idx = start;
    const headerLine = lines[idx]?.trim() ?? '';
    if (!(headerLine.startsWith('{') && headerLine.endsWith('}'))) return [null, 0];
    const headers = headerLine.slice(1, -1).split('|').map((h) => h.trim());
    const colCount = headers.length;
    idx++;

    const children: J[] = [{ type: 'table_row', attrs: { head: true }, content: headers.map((h) => this.cell(h)) }];
    while (idx < lines.length) {
      const line = lines[idx].trim();
      if (line === '[/표]') {
        idx++;
        break;
      }
      if (/^#{1,2}\s+/.test(line)) break;
      if (!line) {
        idx++;
        continue;
      }
      const tr = this.transMatch(line);
      if (tr) {
        this.pushAux(children, 'trans', tr.line);
        idx++;
        continue;
      }
      if (line.startsWith('-')) {
        const cells = this.splitCells(line.slice(1));
        while (cells.length < colCount) cells.push('');
        cells.length = colCount;
        children.push({ type: 'table_row', attrs: { head: false }, content: cells.map((c) => this.cell(c)) });
      } else {
        // @var / @sample (동적 표) 와 파서가 무시하는 줄
        this.pushAux(children, 'raw', line);
      }
      idx++;
    }
    return [{ type: 'table_h', attrs: { dyn: dynId }, content: children }, idx - start];
  }

  parseTableVertical(lines: string[], start: number): [J | null, number] {
    let idx = start;
    const children: J[] = [];
    while (idx < lines.length) {
      const line = lines[idx].trim();
      if (line === '[/표]') {
        idx++;
        break;
      }
      if (/^#{1,2}\s+/.test(line)) break;
      if (!line) {
        idx++;
        continue;
      }
      const tr = this.transMatch(line);
      if (tr) {
        this.pushAux(children, 'trans', tr.line);
        idx++;
        continue;
      }
      if (line.startsWith('-')) {
        const [h, v] = this.splitKV(line.slice(1).trim());
        children.push({ type: 'table_row', attrs: { head: false }, content: [this.cell(h), this.cell(v)] });
      } else {
        this.pushAux(children, 'raw', line);
      }
      idx++;
    }
    if (!children.some((c) => c.type === 'table_row')) children.push({ type: 'table_row', attrs: { head: false }, content: [this.cell(''), this.cell('')] });
    return [{ type: 'table_v', content: children }, idx - start];
  }

  parseTable(lines: string[], start: number, inCallout: boolean): [J | null, number] {
    // 파서는 trim 하지 않은 줄에 정규식을 적용한다(들여쓴 `[표:` 는 표로 인식되지 않고 줄이 버려진다)
    const m = /^\[표:\s*(가로형|세로형)(?:\s*,\s*동적\s*:\s*([A-Za-z0-9_-]+))?\s*\]/.exec(lines[start]);
    if (!m) return [null, 0];
    let dynId = m[2] ?? null;
    if (inCallout) dynId = null;
    if (m[1] === '가로형') {
      const [node, consumed] = this.parseTableHorizontal(lines, start + 1, dynId);
      return node ? [node, consumed + 1] : [null, consumed + 1];
    }
    const [node, consumed] = this.parseTableVertical(lines, start + 1);
    return [node, consumed + 1];
  }

  /* ---- 버튼 */

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

  parseButtonSpec(raw: string): { label: string; url: string; style: string } | null {
    const line = raw.trim();
    if (!line.startsWith('[버튼,') || !line.endsWith(']')) return null;
    const params = this.parseCsvLike(line.slice('[버튼,'.length, -1).trim());
    if (!params.length) return null;
    const label = params[0] ?? '';
    if (!label) return null;
    return { label, url: params.length > 1 ? params[1] : '#', style: params.length > 2 ? params[2].trim() : '' };
  }

  parseButtons(lines: string[], idx: number): [J, number] | null {
    const children: J[] = [];
    let b = idx;
    let last = false; // 직전 줄이 유효한 버튼이었는가(번역 줄은 그 버튼에만 붙는다)
    let count = 0;
    while (b < lines.length) {
      const bl = lines[b].trim();
      if (!bl) break;
      const t = this.transMatch(bl);
      if (t) {
        if (last) this.pushAux(children, 'trans', t.line);
        else this.pushAux(children, 'raw', t.line); // 파서는 버튼이 없는 번역 줄을 조용히 버린다
        b++;
        continue;
      }
      if (!bl.startsWith('[버튼,')) break;
      const spec = this.parseButtonSpec(bl);
      last = !!spec;
      if (spec) {
        count++;
        children.push({ type: 'button', attrs: { url: spec.url, style: spec.style }, content: inlineFromRaw(spec.label) });
      } else this.pushAux(children, 'raw', bl);
      b++;
    }
    if (!count) return null;
    return [{ type: 'button_group', content: children }, b - idx];
  }

  /* ---- 콜아웃 */

  parseCallout(lines: string[], start: number, inCallout: boolean): { node: J | null; consumed: number } {
    const first = lines[start].trim();
    const m = CALLOUT_START.exec(first);
    if (!m) return { node: null, consumed: 0 };
    const type = m[1];
    const title = m[2] ? m[2].trim() : '';

    if (inCallout) {
      // 안쪽 콜아웃 -> 인용(파서와 같다)
      let idx = start + 1;
      const bq: string[] = [];
      const trans: string[] = [];
      while (idx < lines.length) {
        const line = lines[idx];
        if (line.trim() === `[/${type}]`) {
          idx++;
          break;
        }
        if (!/^\[\/(정보|경고|강조)\]/.test(line.trim())) {
          const t = this.transMatch(line);
          if (t) trans.push(t.line);
          else bq.push(line);
        }
        idx++;
      }
      if (bq.length) {
        const content = bq.filter((l) => l.trim()).map((l) => l.trim());
        const body: J[] = [this.para(content)];
        if (trans.length) body.push(this.trans(trans));
        return { node: { type: 'blockquote', content: body }, consumed: idx - start };
      }
      return { node: null, consumed: idx - start };
    }

    const titleTrans: string[] = [];
    let idx = this.eatTrans(lines, start + 1, titleTrans);
    const contentLines: string[] = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.trim() === `[/${type}]`) {
        idx++;
        break;
      }
      if (/^#{1,2}\s+/.test(line.trim())) break;
      contentLines.push(line);
      idx++;
    }
    const body = this.parseBlocks(contentLines, true);
    const content: J[] = [{ type: 'callout_title', ...(title ? { content: inlineFromRaw(title) } : {}) }];
    if (titleTrans.length) content.push(this.trans(titleTrans));
    content.push(...body);
    return { node: { type: 'callout', attrs: { kind: type }, content }, consumed: idx - start };
  }

  /* ---- 문단 */

  parseParagraphBlock(lines: string[], start: number): [J[], number] {
    const pLines: string[] = [];
    const trans: string[] = [];
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
      if (t) trans.push(t.line);
      else pLines.push(stripped);
      idx++;
    }
    if (!pLines.length) return [[], 0];
    const out: J[] = [this.para(pLines)];
    if (trans.length) out.push(this.trans(trans));
    return [out, idx - start];
  }

  /* ---- 블록 목록 */

  parseBlocks(lines: string[], inCallout: boolean): J[] {
    const blocks: J[] = [];
    const skipped = new WeakSet<J>();
    const pushOrphan = (text: string) => {
      const lastNode = blocks[blocks.length - 1];
      if (lastNode?.type === 'txmd_trans' && lastNode.attrs!.orphan) (lastNode.attrs!.lines as string[]).push(text);
      else blocks.push(this.trans([text], true));
    };
    let idx = 0;
    while (idx < lines.length) {
      const line = lines[idx].trim();
      if (!line) {
        idx++;
        continue;
      }
      if (HR_LINES.includes(line)) {
        blocks.push({ type: 'hr' });
        idx++;
        continue;
      }
      const tm = this.transMatch(line);
      if (tm) {
        pushOrphan(tm.line);
        idx++;
        continue;
      }
      if (line.startsWith('[표:')) {
        const [node, consumed] = this.parseTable(lines, idx, inCallout);
        if (node) {
          blocks.push(node);
          idx += consumed;
          continue;
        }
      }
      if (CALLOUT_SIMPLE.test(line)) {
        const r = this.parseCallout(lines, idx, inCallout);
        if (r.node) {
          blocks.push(r.node);
          idx += r.consumed;
          continue;
        }
        if (inCallout && r.consumed > 0) {
          idx += r.consumed;
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
        const [nodes, consumed] = this.parseBlockquote(lines, idx);
        if (nodes.length) {
          blocks.push(...nodes);
          idx += consumed;
          continue;
        }
      }
      if (/^(\s*)[-*]\s+/.test(line) || /^(\s*)\d+\.\s+/.test(line)) {
        const [node, consumed] = this.parseList(lines, idx);
        if (node && consumed > 0) {
          blocks.push(node);
          idx += consumed;
          continue;
        }
      }
      if (/^(#{1,3})\s+(.+)$/.test(line)) {
        const m = /^(#{1,3})\s+(.+)$/.exec(line)!;
        const trans: string[] = [];
        const next = this.eatTrans(lines, idx + 1, trans);
        blocks.push({ type: 'heading', attrs: { level: m[1].length }, content: inlineFromRaw(m[2]) });
        if (trans.length) blocks.push(this.trans(trans));
        idx = next;
        continue;
      }
      const [nodes, consumed] = this.parseParagraphBlock(lines, idx);
      if (nodes.length) {
        blocks.push(...nodes);
        idx += consumed;
        continue;
      }
      // 파서가 해석하지 못해 건너뛰는 줄 — 버리지 않고 원문 그대로 보존
      const lastNode = blocks[blocks.length - 1];
      const rawLine = lines[idx].replace(/\s+$/, ''); // 들여쓰기는 그대로 둔다(들여쓴 `> x` 는 파서가 버리는 줄이라 들여쓰기가 의미를 가른다)
      if (lastNode && skipped.has(lastNode)) {
        lastNode.content = [{ type: 'text', text: (lastNode.content![0].text ?? '') + '\n' + rawLine }];
      } else {
        const raw = this.raw(rawLine);
        skipped.add(raw);
        blocks.push(raw);
      }
      idx++;
    }
    return blocks;
  }
}

/** .txmd 전체 -> 문서 JSON. 파서의 전처리(개행 정규화 → `{x}` 치환자 → `[헤더]` 제거)를 그대로 따른다. */
export function loadTxmd(input: string, opts: LoadOptions = {}): J {
  let text = input.replace(/\r\n?/g, '\n');
  text = normalizeVariables(text);
  let header = false;
  if (text.includes('[헤더]')) {
    // 마커가 실제로 제거된 경우에만 표식 노드를 남긴다(줄 끝이 아닌 곳의 '[헤더]' 는 글자로 남는다 — 파서와 같다)
    const parts = text.split('[헤더]\n');
    header = parts.length > 1;
    text = parts.join('');
  }
  const loader = new Loader(opts.langs ?? ['en', 'ja']);
  const blocks = loader.parseBlocks(text.split('\n'), false);
  if (header) blocks.unshift(loader.raw('[헤더]'));
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  return { type: 'doc', content: blocks };
}
