/** textarea 안의 인라인 HTML(strong/em/del/a/br) 편집 도우미 — 순수 함수 */

export interface TextEdit {
  text: string;
  selStart: number;
  selEnd: number;
}

/** 선택 영역을 `<tag>…</tag>` 로 감싼다. 선택이 없으면 빈 태그 쌍을 넣고 커서를 가운데에 둔다. */
export function wrapSelection(text: string, start: number, end: number, tag: 'strong' | 'em' | 'del'): TextEdit {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const before = text.slice(0, start);
  const mid = text.slice(start, end);
  const after = text.slice(end);
  return { text: before + open + mid + close + after, selStart: start + open.length, selEnd: start + open.length + mid.length };
}

/** 선택 영역(또는 기본 문구)을 링크로 감싼다. */
export function wrapLink(text: string, start: number, end: number, href = 'https://'): TextEdit {
  const open = `<a href="${href}">`;
  const mid = text.slice(start, end) || '링크 문구';
  const out = text.slice(0, start) + open + mid + '</a>' + text.slice(end);
  return { text: out, selStart: start + open.length, selEnd: start + open.length + mid.length };
}

/** 커서 위치(선택 대체)에 문자열 삽입 */
export function insertAt(text: string, start: number, end: number, ins: string): TextEdit {
  const out = text.slice(0, start) + ins + text.slice(end);
  const pos = start + ins.length;
  return { text: out, selStart: pos, selEnd: pos };
}
