/**
 * 구조 HTML(`Project.structure`, `DynamicTable.rowStructure`)을 문자열 위치 기반으로 다루는 최소 트리.
 *
 * DOMParser 로 파싱해 다시 직렬화하면 untouched 영역까지 바뀐다(`<br/>` → `<br>`, tbody 자동 삽입, 엔티티 정규화).
 * 구조는 문자열 그대로 보존해야 하므로(번들 source·해시 안정성) 위치만 계산하고 문자열을 잘라 붙인다.
 * 입력은 파서/앱이 만든 정형 HTML 이라고 가정하되, 짝이 안 맞는 태그는 관대하게 넘어간다.
 */

export interface El {
  tag: string;
  /** 여는 태그의 속성 문자열(앞 공백 포함) */
  attrs: string;
  /** 여는 태그 시작 ~ 닫는 태그 끝(배타) */
  start: number;
  end: number;
  /** 안쪽 범위(배타). void 요소는 start==innerStart==innerEnd... 로 비어 있음 */
  innerStart: number;
  innerEnd: number;
  children: El[];
  parent?: El;
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'source', 'area', 'base', 'embed', 'param', 'track']);
const TOKEN = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

export function parseTree(html: string): El[] {
  const roots: El[] = [];
  const stack: El[] = [];
  const re = new RegExp(TOKEN.source, 'g');
  for (const m of html.matchAll(re)) {
    if (m[2] === undefined) continue; // 주석
    const tag = m[2].toLowerCase();
    const at = m.index!;
    const to = at + m[0].length;
    if (m[1]) {
      // 닫는 태그: 스택에서 같은 이름을 찾아 거기까지 닫는다(없으면 무시)
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i < 0) continue;
      while (stack.length > i + 1) {
        const lost = stack.pop()!;
        lost.innerEnd = at;
        lost.end = at;
      }
      const el = stack.pop()!;
      el.innerEnd = at;
      el.end = to;
      continue;
    }
    const selfClosing = /\/\s*$/.test(m[3]);
    const el: El = { tag, attrs: m[3], start: at, end: to, innerStart: to, innerEnd: to, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) {
      el.parent = parent;
      parent.children.push(el);
    } else roots.push(el);
    if (!VOID.has(tag) && !selfClosing) stack.push(el);
  }
  for (const el of stack) {
    el.innerEnd = html.length;
    el.end = html.length;
  }
  return roots;
}

export function attrOf(el: El, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(el.attrs);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** 값이 없는 불리언 속성(`<td data-blocks>`)도 인식 */
export function hasAttr(el: El, name: string): boolean {
  return new RegExp('\\s' + name + '(?=[\\s=/]|$)', 'i').test(el.attrs);
}

export function hasClass(el: El, cls: string): boolean {
  const c = attrOf(el, 'class');
  return !!c && c.split(/\s+/).includes(cls);
}

export function walk(els: El[], fn: (el: El) => void): void {
  for (const e of els) {
    fn(e);
    walk(e.children, fn);
  }
}

export function find(els: El[], pred: (el: El) => boolean): El | undefined {
  for (const e of els) {
    if (pred(e)) return e;
    const f = find(e.children, pred);
    if (f) return f;
  }
  return undefined;
}

export function descendantsOf(el: El): El[] {
  const out: El[] = [];
  walk(el.children, (e) => out.push(e));
  return out;
}

/** 속성 값 안의 큰따옴표를 이스케이프(구조에 쓰는 href 등) */
export function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function unescAttr(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
