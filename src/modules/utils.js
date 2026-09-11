/**
 * 불필요한 공백 제거
 */
export function removeWhitespace(html) {
  return html.replace(/>\s+</g, '><').trim();
}

/**
 * 입력이 완전한 HTML 문서인지 판별한다.
 * 단순 문자열 포함 검사는 본문 텍스트의 "<body"에도 반응하므로 태그 형태로 검사한다.
 */
export function isFullDocument(html) {
  return /<\s*(!doctype\s+html|html[\s/>]|head[\s/>]|body[\s/>])/i.test(html || '');
}

/**
 * Body 내용만 추출
 */
export function extractBody(html) {
  if (!isFullDocument(html)) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc && doc.body) return doc.body.innerHTML;
  } catch {
    /* 파싱 실패 시 정규식으로 폴백 */
  }
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : html;
}

/**
 * 셀렉터 목록을 콤마로 분리한다. `:is(a, b)`나 속성 셀렉터 안의 콤마는 건드리지 않는다.
 */
export function parseSelectorList(selectorText) {
  const out = [];
  let depth = 0;
  let quote = null;
  let buf = '';

  for (const ch of selectorText || '') {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;

    if (ch === ',' && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * 셀렉터 명시도를 하나의 정수로 환산한다(id:10000, class/attr/의사클래스:100, 타입:1).
 * `:is()`/`:not()` 내부까지 엄밀히 따지지는 않는 근사값이지만,
 * 같은 속성의 cascade 승자를 고르는 데에는 충분하다.
 */
export function specificityOf(selector) {
  let s = (selector || '').replace(/\\./g, '_').replace(/'[^']*'|"[^"]*"/g, "''");

  // :where()는 명시도에 기여하지 않는다
  s = s.replace(/:where\([^)]*\)/gi, ' ');

  const ids = (s.match(/#[\w-]+/g) || []).length;
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length;

  const clean = s.replace(/\[[^\]]*\]/g, ' ');
  const pseudoElements = (clean.match(/::[\w-]+/g) || []).length;
  const withoutPseudoElements = clean.replace(/::[\w-]+/g, ' ');
  const pseudoClasses = (withoutPseudoElements.match(/:[\w-]+/g) || []).length;
  const classes = (withoutPseudoElements.match(/\.[\w-]+/g) || []).length;

  const types = (
    withoutPseudoElements
      .replace(/:[\w-]+(\([^)]*\))?/g, ' ')
      .replace(/[.#][\w-]+/g, ' ')
      .match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*/g) || []
  ).length;

  return ids * 10000 + (classes + attrs + pseudoClasses) * 100 + types + pseudoElements;
}

/**
 * 선언 블록(cssText)을 속성 단위로 나눈다.
 *
 * CSSStyleDeclaration을 그대로 순회하면 브라우저가 shorthand를 longhand로 모두
 * 풀어버린다(`border` 하나가 border-image-* 5개까지 늘어나고, `white-space`는
 * white-space-collapse/text-wrap-mode로, `border-spacing`은 -webkit-* 로 바뀐다).
 * 메일 클라이언트가 모르는 이름이 섞이고 용량도 불어나므로,
 * 저자가 쓴 속성명과 순서가 살아 있는 cssText를 직접 읽는다.
 */
export function parseDeclarations(cssText) {
  const out = [];
  let depth = 0;
  let quote = null;
  let buf = '';

  const flush = () => {
    const chunk = buf.trim();
    buf = '';
    if (!chunk) return;
    const idx = chunk.indexOf(':');
    if (idx < 0) return;

    const prop = chunk.slice(0, idx).trim().toLowerCase();
    let value = chunk.slice(idx + 1).trim();
    let important = false;

    const bang = value.match(/!\s*important\s*$/i);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index).trim();
    }
    if (prop && value) out.push({ prop, value, important });
  };

  for (const ch of cssText || '') {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ';' && depth === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

/**
 * CSS 값을 최상위 공백 기준으로 나눈다. `rgb(0, 0, 0)` 같은 함수 안은 건드리지 않는다.
 */
export function splitTopLevel(value) {
  const out = [];
  let depth = 0;
  let quote = null;
  let buf = '';

  for (const ch of value || '') {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (/\s/.test(ch) && depth === 0) {
      if (buf) out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** 항상 인라인에서 제외하는 속성 */
const ALWAYS_BLOCKED = new Set([
  'content', // 의사 요소 전용 — 일반 요소에 넣으면 의미가 없다
  'all',
  'src',
  'unicode-range',
  'font-display'
]);

/**
 * 메일에서는 무시되거나 해를 끼치는 속성.
 * 여기 있는 것들은 빼야 인라인 미리보기와 실제 수신 화면이 같아진다.
 */
const EMAIL_BLOCKED = new Set([
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'animation',
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',
  'transform',
  'transform-origin',
  'transform-style',
  'perspective',
  'filter',
  'backdrop-filter',
  'cursor',
  'will-change',
  'user-select',
  'pointer-events',
  'appearance',
  'resize',
  'scroll-behavior',
  'touch-action',
  'isolation',
  'mix-blend-mode',
  'contain'
]);

/**
 * 웹(호스트 프로젝트 삽입) 프로파일에서 제외하는 속성.
 * 폰트만 호스트 값을 상속받게 한다. font-size/line-height/color는 헤딩 위계와
 * 버튼·콜아웃 라벨 가독성이 인라인 style에만 의존하므로 유지한다.
 */
const WEB_BLOCKED = new Set(['font-family']);

/** 상속 전파 시 굳이 적을 필요가 없는 기본값 */
const DEFAULTISH = new Set([
  'normal',
  'auto',
  'none',
  'static',
  'visible',
  'start',
  '0px',
  '0',
  'initial',
  'currentcolor'
]);

export function isDefaultish(value) {
  return DEFAULTISH.has(String(value || '').trim().toLowerCase());
}

/**
 * 특정 CSS 속성이 인라인 스타일로 포함되어야 하는지 판단한다.
 *
 * 이 함수는 "원본 CSS가 선언한 속성"에만 호출된다. 따라서 값이 기본값처럼
 * 보인다는 이유로 버리지 않는다 — `text-transform: none`처럼 부모의 상속을
 * 명시적으로 해제하는 선언이 사라지면 결과가 원본과 달라지기 때문이다.
 * 걸러내는 것은 인라인으로 옮길 수 없거나 대상 환경에서 무의미한 속성뿐이다.
 */
export function shouldIncludeProperty(prop, value, options = {}) {
  const { profile = 'email', mailSafeLayout = false } = options;

  if (!prop) return false;
  if (prop.startsWith('--')) return false; // 커스텀 프로퍼티는 인라인해도 참조가 없다
  if (ALWAYS_BLOCKED.has(prop)) return false;
  if (profile === 'email' && EMAIL_BLOCKED.has(prop)) return false;
  if (profile === 'web' && WEB_BLOCKED.has(prop)) return false;
  if (mailSafeLayout && prop === 'box-shadow') return false;

  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(v)) return false;

  return true;
}
