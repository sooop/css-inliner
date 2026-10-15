/**
 * 링크 새 창 보장.
 *
 * 메일 안의 링크(버튼 `a.btn`, 문자열 안 인라인 `<a href>`, 로고 링크, 행 템플릿 안 링크)는
 * 항상 `target="_blank"` + `rel="noopener noreferrer"` 를 가져야 한다. 구조·문자열 원본에는 쓰지 않고
 * 합성(compose)·렌더·번들 검증 단계에서 보장한다(편집·번역·ID 이어받기·sourceHash 에 영향 없음).
 *
 * 제외(target 을 붙이지 않는 href): `mailto:` `tel:` `sms:` 와 페이지 내 앵커 `#…`
 *   - mailto/tel/sms 는 메일 앱·전화 앱을 여는 동작이라 새 창이 무의미하고, 일부 클라이언트에서 빈 창이 남는다.
 *   - `#…` 는 같은 문서 안 이동이라 새 창이면 오히려 깨진다.
 * 치환자 href(`|!#-url|`, `{{var}}` 포함)·상대 경로·`http(s)://` 는 외부 링크로 보고 붙인다.
 * href 가 없는 `<a>`(앵커 이름 등)는 건드리지 않는다.
 */

const A_OPEN = /<a(\s(?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTR = /\s+([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
const NO_TARGET_HREF = /^(?:mailto:|tel:|sms:|#)/i;

interface Attr {
  name: string;
  value: string | undefined;
  start: number;
  end: number;
}

function parseAttrs(attrs: string): Attr[] {
  const out: Attr[] = [];
  for (const m of attrs.matchAll(ATTR)) {
    let value = m[2];
    if (value !== undefined && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    out.push({ name: m[1].toLowerCase(), value, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** 이 href 값이 target 보장 대상인가 */
export function needsLinkTarget(href: string): boolean {
  return !NO_TARGET_HREF.test(href.trim());
}

function hasRelTokens(rel: string | undefined): boolean {
  const t = (rel ?? '').toLowerCase().split(/\s+/);
  return t.includes('noopener') && t.includes('noreferrer');
}

function fixOpenTag(attrs: string): string {
  const list = parseAttrs(attrs);
  const href = list.find((a) => a.name === 'href');
  if (!href || !needsLinkTarget(href.value ?? '')) return attrs;
  const target = list.find((a) => a.name === 'target');
  const rel = list.find((a) => a.name === 'rel');
  const targetOk = !!target && (target.value ?? '') === '_blank';
  const relOk = !!rel && hasRelTokens(rel.value);
  if (targetOk && relOk) return attrs;

  // 뒤에서부터 치환해 앞쪽 오프셋이 어긋나지 않게 한다.
  let out = attrs;
  const edits: { a: Attr; text: string }[] = [];
  if (target && !targetOk) edits.push({ a: target, text: ' target="_blank"' });
  if (rel && !relOk) {
    const have = (rel.value ?? '').split(/\s+/).filter(Boolean);
    const lower = have.map((x) => x.toLowerCase());
    for (const need of ['noopener', 'noreferrer']) if (!lower.includes(need)) have.push(need);
    edits.push({ a: rel, text: ` rel="${have.join(' ')}"` });
  }
  edits.sort((x, y) => y.a.start - x.a.start);
  for (const e of edits) out = out.slice(0, e.a.start) + e.text + out.slice(e.a.end);
  if (!target) out += ' target="_blank"';
  if (!rel) out += ' rel="noopener noreferrer"';
  return out;
}

/** HTML 안의 모든 `<a href>`(제외 대상 제외)에 target="_blank" 와 rel="noopener noreferrer" 를 보장한다. 멱등. */
export function ensureLinkTargets(html: string): string {
  return html.replace(A_OPEN, (m, attrs: string) => {
    const fixed = fixOpenTag(attrs);
    return fixed === attrs ? m : `<a${fixed}>`;
  });
}

/** target/rel 보장이 빠진 `<a href>` 여는 태그 목록(검증용). 비어 있으면 통과. */
export function findLinksMissingTarget(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(A_OPEN)) {
    if (fixOpenTag(m[1]) !== m[1]) bad.push(m[0].length > 120 ? m[0].slice(0, 117) + '...' : m[0]);
  }
  return bad;
}
