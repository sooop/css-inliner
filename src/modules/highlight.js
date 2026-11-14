/**
 * 결과 HTML 구문 강조 — 외부 라이브러리 없이 태그·속성·문자열·주석만 구분한다.
 */

// 이보다 큰 결과는 강조하지 않고 그대로 보여 준다 (span 수가 너무 많아진다)
export const HIGHLIGHT_LIMIT = 300 * 1024;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeHTML = (text) => text.replace(/[&<>]/g, (ch) => ESCAPES[ch]);

const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^\s<>\/]*(?:"[^"]*"|'[^']*'|[^<>"'])*>/g;
const TAG = /^(<\/?)([^\s<>\/]+)([\s\S]*?)(\/?>)$/;
const ATTR = /([^\s"'=<>\/]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s"'<>]+)?|(\s+|\/)/g;

function highlightAttrs(source) {
  let out = '';
  ATTR.lastIndex = 0;
  let match;
  let guard = 0;
  while ((match = ATTR.exec(source)) && guard++ < 100000) {
    if (match[0] === '') {
      ATTR.lastIndex++;
      continue;
    }
    if (match[4] !== undefined) {
      out += escapeHTML(match[4]);
      continue;
    }
    out += `<span class="t-attr">${escapeHTML(match[1])}</span>`;
    if (match[2]) out += `<span class="t-pun">${escapeHTML(match[2])}</span>`;
    if (match[3]) out += `<span class="t-str">${escapeHTML(match[3])}</span>`;
  }
  return out;
}

export function highlightHTML(source) {
  if (source.length > HIGHLIGHT_LIMIT) return escapeHTML(source);

  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(source))) {
    if (match.index > last) out += escapeHTML(source.slice(last, match.index));
    const token = match[0];
    last = match.index + token.length;

    if (token.startsWith('<!--')) {
      out += `<span class="t-com">${escapeHTML(token)}</span>`;
    } else if (token.startsWith('<!')) {
      out += `<span class="t-pun">${escapeHTML(token)}</span>`;
    } else {
      const parts = TAG.exec(token);
      if (!parts) {
        out += escapeHTML(token);
        continue;
      }
      out +=
        `<span class="t-pun">${escapeHTML(parts[1])}</span>` +
        `<span class="t-tag">${escapeHTML(parts[2])}</span>` +
        highlightAttrs(parts[3]) +
        `<span class="t-pun">${escapeHTML(parts[4])}</span>`;
    }
  }
  if (last < source.length) out += escapeHTML(source.slice(last));
  return out;
}
