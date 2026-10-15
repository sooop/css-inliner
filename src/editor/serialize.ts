/**
 * 에디터 문서(ProseMirror) -> .txmd 텍스트.
 *
 * 정규화: 블록 사이는 빈 줄 한 줄, 빈 문단·빈 제목·빈 목록 항목은 출력하지 않고, 목록 들여쓰기는 2칸, 순서 목록은 1.2.3.
 * 의미(= parseTxmd 결과)는 보존한다. 번역 줄(`txmd_trans`)은 앞 블록 바로 아래에 붙여 쓰고(번역 대상 블록 규칙),
 * 연결되지 않았던 줄(orphan)은 빈 줄로 띄워 그대로 '무시되는 줄'로 남긴다.
 */
import type { Node as PMNode, Mark } from '@milkdown/kit/prose/model';
import { normalizeVariables } from '../markup/parser';

interface Ctx {
  inCallout: boolean;
}

/* ------------------------------------------------------------------ 인라인 */

interface Item {
  text: string;
  marks: { key: string; rank: number; open: string; close: string; ws?: boolean }[];
}

const MARK_RANK: Record<string, number> = { link: 0, strong: 1, emphasis: 2, strike_through: 3 };

function markInfo(m: Mark): Item['marks'][number] | null {
  switch (m.type.name) {
    case 'strong':
      return { key: 'strong', rank: 1, open: '**', close: '**' };
    case 'emphasis':
      return { key: 'emphasis', rank: 2, open: '*', close: '*' };
    case 'strike_through':
      return { key: 'strike_through', rank: 3, open: '~~', close: '~~', ws: true };
    case 'link':
      return { key: `link:${m.attrs.href}`, rank: 0, open: '[', close: `](${m.attrs.href})` };
    default:
      return null; // 알 수 없는 마크는 텍스트만 남긴다
  }
}

function leafText(n: PMNode): string | null {
  switch (n.type.name) {
    case 'text':
      return (n.text ?? '').replace(/\n/g, ' ');
    case 'placeholder':
      return `|!#-${n.attrs.name}|`;
    case 'rowvar':
      return `{{${n.attrs.name}}}`;
    default:
      return null;
  }
}

/** 같은 마크가 이어지는 구간(run)을 찾아 가장 긴 것을 바깥에 둔다(동률이면 link > strong > em > del) */
function renderItems(items: Item[]): string {
  let out = '';
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (!it.marks.length) {
      out += it.text;
      i++;
      continue;
    }
    let best: { key: string; rank: number; open: string; close: string; ws?: boolean } | null = null;
    let bestLen = 0;
    for (const m of it.marks) {
      let j = i;
      while (j < items.length && items[j].marks.some((x) => x.key === m.key)) j++;
      const len = j - i;
      if (len > bestLen || (len === bestLen && best && m.rank < best.rank)) {
        best = m;
        bestLen = len;
      }
    }
    const run = items.slice(i, i + bestLen).map((x) => ({ text: x.text, marks: x.marks.filter((mm) => mm.key !== best!.key) }));
    let inner = renderItems(run);
    let pre = '';
    let post = '';
    if (best!.ws) {
      // `~~ x~~` 는 취소선으로 인식되지 않는다: 안쪽 양끝 공백은 바깥으로
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
      pre = m[1];
      inner = m[2];
      post = m[3];
    }
    out += inner ? `${pre}${best!.open}${inner}${best!.close}${post}` : pre + post;
    i += bestLen;
  }
  return out;
}

/** 인라인 컨테이너 -> 줄 배열(hardbreak 로 나뉨). 빈 줄은 버린다 */
export function inlineLines(node: PMNode): string[] {
  const lines: string[] = [];
  let cur: Item[] = [];
  const flush = () => {
    const s = renderItems(cur).trim();
    if (s) lines.push(s);
    cur = [];
  };
  node.forEach((c) => {
    if (c.type.name === 'hardbreak') {
      flush();
      return;
    }
    const t = leafText(c);
    if (t === null || t === '') return;
    const marks: Item['marks'] = [];
    for (const m of c.marks) {
      const info = markInfo(m);
      if (info) marks.push(info);
    }
    marks.sort((a, b) => a.rank - b.rank);
    cur.push({ text: t, marks });
  });
  flush();
  return lines;
}

const inlineOne = (node: PMNode) => inlineLines(node).join(' ');

/* ------------------------------------------------------------------ 블록 */

const transLines = (n: PMNode): string[] => ((n.attrs.lines as string[]) ?? []).map((s) => s.trim()).filter(Boolean);

function csvField(s: string): string {
  const esc = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return s.includes(',') ? `"${esc}"` : esc;
}

function serButtonGroup(n: PMNode): string {
  const lines: string[] = [];
  n.forEach((c) => {
    const name = c.type.name;
    if (name === 'button') {
      const label = inlineOne(c);
      if (!label) return;
      const url = String(c.attrs.url ?? '#');
      const style = String(c.attrs.style ?? '').trim();
      let s = `[버튼, ${csvField(label)}`;
      if (style || url !== '#') s += `, ${csvField(url)}`;
      if (style) s += `, ${csvField(style)}`;
      lines.push(s + ']');
    } else if (name === 'txmd_trans') lines.push(...transLines(c));
    else if (name === 'txmd_raw') lines.push(...c.textContent.split('\n').map((x) => x.trim()).filter(Boolean));
  });
  return lines.join('\n');
}

function serList(list: PMNode, indent: string): string[] {
  const ordered = list.type.name === 'ordered_list';
  const out: string[] = [];
  let n = 0;
  list.forEach((item) => {
    const kids: PMNode[] = [];
    item.forEach((k) => kids.push(k));
    const head = kids[0];
    const text = head && head.type.name === 'paragraph' ? inlineOne(head) : '';
    if (!text) return;
    n++;
    out.push(`${indent}${ordered ? `${n}.` : '-'} ${text}`);
    const nested = kids.slice(1).filter((k) => k.type.name === 'bullet_list' || k.type.name === 'ordered_list');
    let nj = 0;
    for (const k of kids.slice(1)) {
      const name = k.type.name;
      if (name === 'txmd_trans') out.push(...transLines(k).map((l) => indent + l));
      else if (name === 'bullet_list' || name === 'ordered_list') {
        // 같은 항목 안의 목록이 둘 이상이면 들여쓰기를 줄여 가며 써야 한 목록으로 합쳐지지 않는다(파서의 규칙)
        out.push(...serList(k, indent + ' '.repeat(2 * (nested.length - nj))));
        nj++;
      }
    }
  });
  return out;
}

function serTable(n: PMNode, ctx: Ctx): string {
  const horizontal = n.type.name === 'table_h';
  const lines: string[] = [];
  const dyn = horizontal && !ctx.inCallout && /^[A-Za-z0-9_-]+$/.test(String(n.attrs.dyn ?? '')) ? String(n.attrs.dyn) : null;
  lines.push(`[표: ${horizontal ? '가로형' : '세로형'}${dyn ? `, 동적: ${dyn}` : ''}]`);
  let first = true;
  n.forEach((c) => {
    const name = c.type.name;
    if (name === 'table_row') {
      const cells: string[] = [];
      c.forEach((cell) => cells.push(inlineOne(cell)));
      if (horizontal) {
        if (first) lines.push(`{${cells.join('| ')}}`);
        else lines.push(`- ${cells.join('| ')}`);
        first = false;
      } else {
        const [h, v] = [cells[0] ?? '', cells.slice(1).join(' ')];
        if (!h && !v) return;
        lines.push(`- ${h}:${v ? ' ' + v : ''}`);
      }
    } else if (name === 'txmd_trans') lines.push(...transLines(c));
    else if (name === 'txmd_raw') lines.push(...c.textContent.split('\n').map((x) => x.trim()).filter(Boolean));
  });
  lines.push('[/표]');
  return lines.join('\n');
}

function serCallout(n: PMNode, ctx: Ctx): string {
  const kind = String(n.attrs.kind ?? '정보');
  const head: string[] = [];
  const body: PMNode[] = [];
  let title = '';
  let i = 0;
  n.forEach((c) => {
    if (i === 0 && c.type.name === 'callout_title') title = inlineOne(c);
    else if (i === 1 && c.type.name === 'txmd_trans' && !c.attrs.orphan && head.length === 0) head.push(...transLines(c));
    else body.push(c);
    i++;
  });
  const lines = [`[${kind}${title ? `: ${title}` : ''}]`, ...head];
  const parts = serChildren(body, { inCallout: true });
  let out = lines.join('\n');
  if (parts.length) out += '\n\n' + parts.join('\n\n');
  return out + `\n[/${kind}]`;
}

function serBlock(n: PMNode, ctx: Ctx): string {
  switch (n.type.name) {
    case 'paragraph':
      return inlineLines(n).join('\n');
    case 'heading': {
      const t = inlineOne(n);
      if (!t) return '';
      const level = ctx.inCallout ? 3 : Math.min(3, Math.max(1, Number(n.attrs.level) || 1));
      return `${'#'.repeat(level)} ${t}`;
    }
    case 'blockquote': {
      const lines: string[] = [];
      const tl: string[] = [];
      n.forEach((c) => {
        if (c.type.name === 'paragraph') lines.push(...inlineLines(c));
        else if (c.type.name === 'txmd_trans') tl.push(...transLines(c));
      });
      if (!lines.length) return '';
      return [...lines.map((l) => `> ${l}`), ...tl].join('\n');
    }
    case 'bullet_list':
    case 'ordered_list':
      return serList(n, '').join('\n');
    case 'hr':
      return '---';
    case 'callout':
      return serCallout(n, ctx);
    case 'table_h':
    case 'table_v':
      return serTable(n, ctx);
    case 'button_group':
      return serButtonGroup(n);
    case 'txmd_raw':
      return n.textContent
        .split('\n')
        .map((x) => x.trimEnd())
        .filter((x) => x.trim())
        .join('\n');
    default:
      return '';
  }
}

/** 블록 목록 -> 출력 조각들(조각 사이는 빈 줄). 번역 줄 노드는 앞 조각에 붙인다 */
function serChildren(children: PMNode[] | PMNode, ctx: Ctx): string[] {
  const list: PMNode[] = [];
  if (Array.isArray(children)) list.push(...children);
  else children.forEach((c) => list.push(c));
  const parts: string[] = [];
  let attachable = false;
  for (const c of list) {
    const name = c.type.name;
    if (name === 'txmd_trans') {
      const lines = transLines(c);
      if (!lines.length) continue;
      if (!c.attrs.orphan && attachable && parts.length) parts[parts.length - 1] += '\n' + lines.join('\n');
      else {
        parts.push(lines.join('\n'));
        attachable = false;
      }
      continue;
    }
    const s = serBlock(c, ctx);
    if (!s) {
      attachable = false;
      continue;
    }
    parts.push(s);
    attachable = name === 'paragraph' || name === 'heading' || name === 'blockquote';
  }
  return parts;
}

/** 문서 -> .txmd. `{x}` 단일 중괄호는 파서가 치환자로 바꾸므로 출력에서도 미리 바꿔 둔다(왕복 고정점) */
export function docToTxmd(doc: PMNode): string {
  const parts = serChildren(doc, { inCallout: false });
  const text = parts.join('\n\n');
  return text ? normalizeVariables(text) + '\n' : '';
}
