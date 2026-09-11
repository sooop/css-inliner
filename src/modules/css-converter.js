import {
  shouldIncludeProperty,
  isFullDocument,
  parseSelectorList,
  parseDeclarations,
  specificityOf,
  splitTopLevel,
  isDefaultish
} from './utils.js';

/**
 * 인라인 변환 기본값.
 *
 * renderWidth: 변환용 iframe의 실제 렌더 폭. 미디어쿼리 평가 기준이자
 *   미리보기와 결과를 일치시키는 기준이 된다(미리보기도 같은 폭으로 렌더).
 *   인라인 스타일에는 미디어쿼리를 담을 수 없으므로, 좁은 폭에서 변환해
 *   모바일 분기를 굳혀 버리는 사고를 막도록 넉넉한 폭을 기본값으로 둔다.
 */
export const DEFAULT_RENDER_WIDTH = 1000;

/** 브라우저가 렌더를 마칠 때까지 기다리는 리소스 대기 상한(ms) */
const RESOURCE_TIMEOUT = 4000;

/** Gmail이 메시지를 잘라내는 임계치(102KB)에 대한 경고선 */
const CLIP_WARN_BYTES = 92 * 1024;
const CLIP_LIMIT_BYTES = 102 * 1024;

/**
 * 상속 속성 중 메일 클라이언트에서 상속이 끊기기 쉬워 자손에 다시 적어주는 것들.
 * (특히 table/td 안에서 Outlook·일부 웹메일이 폰트 상속을 잃는다)
 */
const INHERITED_TO_PROPAGATE = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'white-space'
];

/** 조상이 선언했을 때만 자손으로 전파한다(선언되지 않은 UA 기본값은 전파하지 않음) */
const PROPAGATE_SOURCE = new Set(INHERITED_TO_PROPAGATE);

/** 레이아웃 제거 모드(mailSafeLayout)에서 통째로 버리는 속성 */
const MODERN_LAYOUT_PROPS = new Set([
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction', 'flex-wrap', 'flex-flow',
  'justify-content', 'justify-items', 'justify-self',
  'align-items', 'align-content', 'align-self',
  'order', 'gap', 'row-gap', 'column-gap',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'grid-column', 'grid-row', 'grid-area',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'place-items', 'place-content', 'place-self'
]);

const MODERN_DISPLAY_FALLBACK = {
  flex: 'block',
  'inline-flex': 'inline-block',
  grid: 'block',
  'inline-grid': 'inline-block'
};

/** 백분율을 그대로 두는 편이 안전한(= 폭·높이 기준) 속성 */
const PERCENT_SAFE_PROPS = new Set([
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'top', 'right', 'bottom', 'left', 'flex-basis', 'text-indent',
  'background-position', 'background-size', 'border-radius'
]);

/** var()/calc() 등 계산이 필요한 함수 — 이런 값은 computed로 대체한다 */
const NEEDS_COMPUTED_FN = /\b(var|calc|clamp|min|max|env|attr)\(/i;
/** 폰트 크기에 의존하는 상대 단위 — computed로 대체한다 */
const RELATIVE_UNIT = /(?:^|[\s(,+\-*/])[-+]?(?:\d*\.)?\d+(em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vmin|vmax|vi|vb|svw|svh|lvw|lvh|dvw|dvh)\b/i;
/** CSS 전역 키워드 — 실제 값으로 풀어야 한다 */
const GLOBAL_KEYWORD = /^(inherit|initial|unset|revert|revert-layer)$/i;

/**
 * 계산값을 물어봐도 shorthand로는 답을 못 얻는 경우가 있어(4면이 다른 border 등)
 * 대신 채워 넣을 longhand 목록. 여기 없는 shorthand는 계산값이 그대로 나온다.
 */
/** shorthand를 풀 때 굳이 적을 필요가 없는 파트별 기본값 */
const DEFAULT_PART_VALUES = {
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'background-position': '0% 0%',
  'background-size': 'auto',
  'background-repeat': 'repeat',
  'list-style-image': 'none',
  'list-style-position': 'outside',
  'text-decoration-style': 'solid',
  'flex-grow': '0',
  'flex-shrink': '1',
  'flex-basis': 'auto'
};

const SHORTHAND_PARTS = {
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat'],
  border: ['border-width', 'border-style', 'border-color'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  inset: ['top', 'right', 'bottom', 'left']
};

/** 상태 의사 클래스(인라인 불가) */
const STATE_PSEUDO = /:(hover|active|focus|focus-within|focus-visible|visited|link|any-link|target|checked|indeterminate|disabled|enabled|placeholder-shown|autofill|user-invalid|user-valid|invalid|valid|required|optional|in-range|out-of-range|read-only|read-write|default|open|modal|popover-open|playing|paused)\b/i;
/** 의사 요소(인라인 불가) */
const PSEUDO_ELEMENT = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button|details-content)\b/i;

/**
 * CSS 규칙을 소스 순서대로 수집한다.
 * 미디어쿼리는 "현재 렌더 폭"에서 실제로 매칭되는 것만 취한다.
 */
function collectRules(doc, win, css, warnings) {
  const rules = [];
  let order = 0;
  // CORS로 못 읽는 시트에 기대지 않고 원본 CSS에서 직접 확인한다(변환마다 결과가 달라지지 않도록)
  let sawWebFont = /@import\b|@font-face\b/i.test(css || '');
  const skippedMedia = new Set();

  const walk = (list) => {
    if (!list) return;
    for (const rule of list) {
      if (rule instanceof win.CSSStyleRule || rule.type === 1) {
        rules.push({ selector: rule.selectorText, style: rule.style, order: order++ });
      } else if (rule instanceof win.CSSMediaRule || rule.type === 4) {
        const condition = rule.conditionText || (rule.media && rule.media.mediaText) || '';
        let matches = true;
        try {
          matches = win.matchMedia(condition).matches;
        } catch {
          matches = true;
        }
        if (matches) walk(rule.cssRules);
        else if (!/^\s*(print|speech)\s*$/i.test(condition)) skippedMedia.add(condition);
      } else if (rule instanceof win.CSSSupportsRule || rule.type === 12) {
        let supported = true;
        try {
          supported = win.CSS.supports(rule.conditionText);
        } catch {
          supported = true;
        }
        if (supported) walk(rule.cssRules);
      } else if (rule instanceof win.CSSImportRule || rule.type === 3) {
        try {
          walk(rule.styleSheet && rule.styleSheet.cssRules);
        } catch {
          // 교차 출처 스타일시트(구글 폰트 등)는 읽을 수 없다
          sawWebFont = true;
        }
      } else if (rule.type === 5 || (win.CSSFontFaceRule && rule instanceof win.CSSFontFaceRule)) {
        sawWebFont = true;
      } else if (rule.cssRules) {
        // @layer, @container 등은 내부 규칙을 그대로 훑는다
        walk(rule.cssRules);
      }
    }
  };

  for (const sheet of doc.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      sawWebFont = true;
    }
  }

  if (skippedMedia.size) {
    warnings.push({
      level: 'info',
      code: 'media-query',
      message: `현재 렌더 폭에서 적용되지 않은 미디어쿼리 ${skippedMedia.size}건이 있습니다(${[...skippedMedia].slice(0, 3).join(', ')}). 인라인 스타일에는 미디어쿼리를 담을 수 없으므로 수신자가 다른 폭에서 열어도 이 분기는 적용되지 않습니다. 실제로 보게 할 폭으로 "폭" 값을 맞추세요.`
    });
  }

  if (sawWebFont) {
    warnings.push({
      level: 'info',
      code: 'web-font',
      message:
        '웹폰트(@import/@font-face)가 사용되었습니다. 대부분의 메일 클라이언트는 웹폰트를 무시하므로 수신자 화면에서는 폴백 폰트로 보이고 줄바꿈·높이가 달라질 수 있습니다.'
    });
  }

  return rules;
}

/**
 * 요소별 "선언된 속성" 집합을 만든다.
 * 값은 raw 선언값이며, cascade(우선순위 → !important → 소스 순서)로 승자를 고른다.
 */
function buildDeclarationMap(doc, rules, warnings) {
  const map = new Map(); // Element -> Map<prop, {value, important, spec, order}>
  const seen = { pseudoElement: new Set(), statePseudo: new Set() };

  const put = (el, prop, value, important, spec, order) => {
    let props = map.get(el);
    if (!props) map.set(el, (props = new Map()));
    const prev = props.get(prop);
    if (
      !prev ||
      (important && !prev.important) ||
      (important === prev.important && (spec > prev.spec || (spec === prev.spec && order >= prev.order)))
    ) {
      props.set(prop, { value, important, spec, order });
    }
  };

  for (const rule of rules) {
    const declarations = parseDeclarations(rule.style.cssText);
    if (!declarations.length) continue;

    for (const single of parseSelectorList(rule.selector)) {
      if (PSEUDO_ELEMENT.test(single)) {
        // box-sizing 리셋처럼 content가 없는 의사 요소 규칙은 잃어도 티가 나지 않는다.
        // 실제로 사라지는 것은 content로 만들어 낸 기호·아이콘이다.
        if (declarations.some((d) => d.prop === 'content')) seen.pseudoElement.add(single);
        continue;
      }
      if (STATE_PSEUDO.test(single)) {
        seen.statePseudo.add(single);
        continue;
      }

      let matched;
      try {
        matched = doc.querySelectorAll(single);
      } catch {
        continue; // 브라우저가 이해 못 하는 셀렉터
      }
      if (!matched.length) continue;

      const spec = specificityOf(single);
      for (const el of matched) {
        for (const { prop, value, important } of declarations) {
          put(el, prop, value, important, spec, rule.order);
        }
      }
    }
  }

  // HTML에 원래 있던 인라인 style은 가장 높은 우선순위로 덮어쓴다
  for (const el of doc.querySelectorAll('[style]')) {
    for (const { prop, value, important } of parseDeclarations(el.getAttribute('style'))) {
      put(el, prop, value, important, 1e6, 1e9);
    }
  }

  if (seen.pseudoElement.size) {
    warnings.push({
      level: 'warn',
      code: 'pseudo-element',
      message: `의사 요소의 content ${seen.pseudoElement.size}건은 인라인으로 옮길 수 없어 결과에서 사라집니다(기호·아이콘 등): ${[...seen.pseudoElement].slice(0, 5).join(', ')}`
    });
  }
  if (seen.statePseudo.size) {
    warnings.push({
      level: 'info',
      code: 'state-pseudo',
      message: `:hover 등 상태 스타일 ${seen.statePseudo.size}건은 인라인 대상이 아닙니다(메일에서는 대부분 동작하지 않습니다).`
    });
  }

  return map;
}

/**
 * raw 선언값과 computed 값 중 무엇을 쓸지 결정한다.
 *
 * 원칙: 원본 CSS가 쓴 값을 그대로 유지하되, 브라우저의 계산이 필요한 값
 * (var()/calc(), rem·em 같은 상대 단위, 전역 키워드)만 computed로 대체한다.
 * 이렇게 하면 `width: 100%`가 px로 박제되거나, 숫자 line-height가 특정
 * 폰트 크기 기준 px로 굳어버리는 문제가 생기지 않는다.
 */
function resolveValue(prop, raw, computedValue, profile) {
  const value = (raw || '').trim();
  if (!value) return computedValue;

  if (GLOBAL_KEYWORD.test(value)) return computedValue;
  if (NEEDS_COMPUTED_FN.test(value)) return computedValue;
  if (RELATIVE_UNIT.test(value)) return computedValue;

  // 메일 클라이언트(특히 Outlook)는 단위 없는 line-height를 제대로 처리하지 못한다
  if (prop === 'line-height' && profile === 'email' && /^[\d.]+$/.test(value)) {
    return computedValue;
  }

  if (value.includes('%') && !PERCENT_SAFE_PROPS.has(prop)) return computedValue;

  return value;
}

/**
 * 요소 하나의 최종 인라인 선언을 만든다.
 */
function buildInlineStyle(el, ownDecls, inheritedProps, computed, options, parentEffective) {
  const { profile, mailSafeLayout, skipRedundantInherited } = options;
  const out = new Map();

  const put = (prop, value) => {
    if (!shouldIncludeProperty(prop, value, { profile, mailSafeLayout })) return;
    if (mailSafeLayout) {
      if (MODERN_LAYOUT_PROPS.has(prop)) return;
      if (prop === 'display' && MODERN_DISPLAY_FALLBACK[value]) {
        value = MODERN_DISPLAY_FALLBACK[value];
      }
    }
    out.set(prop, value);
  };

  const add = (prop, rawValue) => {
    const needsComputed = NEEDS_COMPUTED_FN.test(rawValue || '');
    const value = resolveValue(prop, rawValue, computed.get(prop) || '', profile);

    // `background: var(--x)`의 계산값은 repeat/scroll/padding-box까지 달린 긴 형태라
    // 구형 메일 파서가 통째로 버릴 수 있다. 이런 shorthand는 longhand로 풀어 쓴다.
    const mustExpand = !value || (prop === 'background' && needsComputed);
    if (mustExpand && SHORTHAND_PARTS[prop]) {
      for (const part of SHORTHAND_PARTS[prop]) {
        const partValue = computed.get(part);
        if (!partValue || isDefaultish(partValue)) continue;
        if (partValue === DEFAULT_PART_VALUES[part]) continue;
        put(part, partValue);
      }
      return;
    }
    put(prop, value);
  };

  if (ownDecls) {
    for (const [prop, decl] of ownDecls) add(prop, decl.value);
  }

  // 조상이 선언한 상속 속성을 이 요소의 계산값으로 다시 적어준다.
  // (계산값은 오염되지 않은 스냅샷이므로 line-height가 자기 폰트 크기 기준으로 나온다)
  for (const prop of inheritedProps) {
    if (out.has(prop)) continue;
    const value = computed.get(prop);
    if (isDefaultish(value)) continue; // 기본값을 굳이 다시 적어 용량만 늘리지 않는다
    if (!shouldIncludeProperty(prop, value, { profile, mailSafeLayout })) continue;
    if (mailSafeLayout && MODERN_LAYOUT_PROPS.has(prop)) continue;
    // 조상에서 내려오는 값과 같다면 다시 적을 이유가 없다(웹 프로파일)
    if (skipRedundantInherited && parentEffective && parentEffective.get(prop) === value) continue;
    out.set(prop, value);
  }

  expandBorderBoxValues(out);
  normalizeBorders(out);

  let style = '';
  for (const [prop, value] of out) style += `${prop}: ${value}; `;
  return { style: style.trim(), declarations: out };
}

/**
 * 변환용 iframe을 만들고 HTML/CSS를 실제 폭으로 렌더한다.
 * document.write로 CSS를 문자열 연결하지 않으므로 CSS 안의 `</style>`에도 안전하다.
 */
function createRenderFrame(renderWidth) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:absolute;left:-20000px;top:0;width:${renderWidth}px;height:1200px;border:0;`;
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>');
  doc.close();
  return { frame, doc };
}

/** 웹폰트와 이미지가 실제로 로드된 뒤 측정해야 폭·줄바꿈이 맞는다 */
async function waitForResources(frame, doc) {
  const timeout = new Promise((resolve) => setTimeout(resolve, RESOURCE_TIMEOUT));

  const fonts = doc.fonts ? doc.fonts.ready.catch(() => {}) : Promise.resolve();
  const images = Promise.all(
    [...doc.images].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          })
    )
  );

  // 문서에 딸려 온 외부 스타일시트도 적용된 뒤에 측정해야 한다
  const sheets = Promise.all(
    [...doc.querySelectorAll('link[rel~="stylesheet"]')].map((link) =>
      link.sheet
        ? Promise.resolve()
        : new Promise((resolve) => {
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', resolve, { once: true });
          })
    )
  );

  await Promise.race([Promise.all([fonts, images, sheets]), timeout]);

  // 세로 스크롤바가 생기면 렌더 폭이 줄어 미디어쿼리·백분율 계산이 틀어진다.
  // 콘텐츠 전체 높이로 프레임을 키워 스크롤바를 없앤다.
  const needed = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
  if (needed > frame.clientHeight) {
    frame.style.height = `${needed + 200}px`;
    doc.body.offsetHeight; // 강제 리플로우
  }
}

/**
 * body에 적용된 스타일을 살릴 래퍼를 만든다.
 * body.innerHTML만 반환하면 max-width·여백·배경이 통째로 사라지기 때문이다.
 */
function buildBodyWrapper(doc, bodyStyle, innerHTML, profile, bodyMetrics) {
  const decls = new Map();
  for (const { prop, value } of parseDeclarations(bodyStyle)) {
    decls.set(prop, value);
  }
  if (!decls.size) return innerHTML;

  const take = (props) => {
    const picked = [];
    for (const prop of props) {
      if (decls.has(prop)) {
        picked.push(`${prop}: ${decls.get(prop)}`);
        decls.delete(prop);
      }
    }
    return picked;
  };

  const outerProps = take(['background', 'background-color', 'background-image']);
  const padding = take(['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
  const margin = take(['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']);

  // 이메일 래퍼는 여백을 바깥 td로 옮기는데, 그러면 body의 border-box 계산이 깨진다.
  // (border-box에서 max-width는 여백을 포함한 값이지만 안쪽 div에는 여백이 없다)
  // 같은 폭이 나오도록 max-width를 콘텐츠 폭으로 환산해 둔다.
  const maxWidth = decls.get('max-width');
  if (
    profile === 'email' &&
    maxWidth &&
    bodyMetrics &&
    bodyMetrics.boxSizing === 'border-box' &&
    maxWidth.endsWith('px')
  ) {
    const contentWidth = parseFloat(maxWidth) - bodyMetrics.horizontalPadding - bodyMetrics.horizontalBorder;

    // 렌더 폭이 좁아 max-width가 발동하지 않았다면 측정값은 뷰포트 기준이라 쓸 수 없다.
    // 그때만 계산식으로 대신한다.
    const measured = bodyMetrics.measuredContentWidth;
    const usable = measured >= contentWidth - 1 ? measured : contentWidth;
    if (usable > 0) decls.set('max-width', `${Math.round(usable * 1000) / 1000}px`);
  }

  const inner = [...decls].map(([prop, value]) => `${prop}: ${value}`);

  // 값에 따옴표가 들어가는 font-family 같은 속성이 있으므로
  // 문자열을 이어 붙이지 않고 DOM으로 만들어 직렬화를 브라우저에 맡긴다.
  if (profile === 'email') {
    // 메일에서는 표 기반 래퍼가 가장 안전하다.
    // 바깥 table이 배경, td가 여백, 안쪽 div가 폭 제한과 타이포를 맡는다.
    const table = doc.createElement('table');
    table.setAttribute('role', 'presentation');
    table.setAttribute('cellpadding', '0');
    table.setAttribute('cellspacing', '0');
    table.setAttribute('border', '0');
    table.setAttribute('style', ['width: 100%', ...outerProps].join('; ') + ';');

    const row = doc.createElement('tr');
    const cell = doc.createElement('td');
    cell.setAttribute('align', 'center');
    cell.setAttribute(
      'style',
      [...padding, 'text-align: center', '-webkit-text-size-adjust: 100%', '-ms-text-size-adjust: 100%'].join('; ') + ';'
    );

    const box = doc.createElement('div');
    // 원본 margin을 먼저 두고 좌우만 auto로 덮어 중앙 정렬한다(상하 여백은 보존된다)
    box.setAttribute(
      'style',
      [...margin, ...inner, 'margin-left: auto', 'margin-right: auto', 'text-align: left'].join('; ') + ';'
    );
    box.innerHTML = innerHTML;

    cell.appendChild(box);
    row.appendChild(cell);
    table.appendChild(row);
    return table.outerHTML;
  }

  const box = doc.createElement('div');
  box.setAttribute('style', [...outerProps, ...padding, ...margin, ...inner].join('; ') + ';');
  box.innerHTML = innerHTML;
  return box.outerHTML;
}

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * `border-width: 2px 2px 4px` 처럼 면마다 값이 다른 형태를 면별 longhand로 펼친다.
 * 이어서 normalizeBorders가 `border-bottom: 4px dashed red` 같은 익숙한 모양으로 묶는다.
 */
function expandBorderBoxValues(out) {
  for (const kind of ['width', 'style', 'color']) {
    const key = `border-${kind}`;
    const value = out.get(key);
    if (!value) continue;

    const parts = splitTopLevel(value);
    if (parts.length < 2) continue;

    const order = [...out.keys()];
    const shorthandIndex = order.indexOf(key);
    const sideValues = [parts[0], parts[1], parts[2] ?? parts[0], parts[3] ?? parts[1]];

    out.delete(key);
    BORDER_SIDES.forEach((side, i) => {
      const sideKey = `border-${side}-${kind}`;
      // 이 면을 따로 선언한 쪽이 더 뒤라면 그 값을 그대로 둔다
      const existingIndex = order.indexOf(sideKey);
      if (existingIndex > shorthandIndex) return;
      out.set(sideKey, sideValues[i]);
    });
  }
}

/**
 * 브라우저가 풀어 놓은 border longhand를 다시 묶는다.
 *
 * `border: none; border-bottom: 1px solid X` 처럼 shorthand 뒤에 개별 선언이
 * 오면 브라우저는 cssText에서도 shorthand를 풀어 `border-top-width: medium`,
 * `border-top-color: currentcolor` 같은 값을 남긴다. medium·currentcolor는
 * 메일 클라이언트에서 해석이 제각각이라 면 단위로 다시 합쳐 준다.
 */
function normalizeBorders(out) {
  for (const prop of [
    'border-image',
    'border-image-source',
    'border-image-slice',
    'border-image-width',
    'border-image-outset',
    'border-image-repeat'
  ]) {
    out.delete(prop);
  }

  const order = [...out.keys()];
  const indexOf = (key) => order.indexOf(key);
  const borderIndex = out.has('border') ? indexOf('border') : -1;

  for (const side of BORDER_SIDES) {
    const shorthand = `border-${side}`;
    const width = `${shorthand}-width`;
    const style = `${shorthand}-style`;
    const color = `${shorthand}-color`;

    if (!(out.has(width) && out.has(style) && out.has(color))) continue;

    const longIndex = Math.max(indexOf(width), indexOf(style), indexOf(color));

    // 나중에 선언된 `border`가 이 면을 덮는 경우에는 longhand를 버린다
    if (borderIndex > longIndex) {
      out.delete(width);
      out.delete(style);
      out.delete(color);
      continue;
    }

    const shorthandIndex = out.has(shorthand) ? indexOf(shorthand) : -1;
    const value =
      shorthandIndex > longIndex
        ? out.get(shorthand)
        : out.get(style) === 'none'
          ? 'none'
          : `${out.get(width)} ${out.get(style)} ${out.get(color)}`;

    out.delete(width);
    out.delete(style);
    out.delete(color);
    out.delete(shorthand);
    out.set(shorthand, value);
  }

  // 네 면이 같으면 하나로 줄인다
  const sideValues = BORDER_SIDES.map((side) => out.get(`border-${side}`));
  if (!out.has('border') && sideValues.every((v) => v !== undefined && v === sideValues[0])) {
    for (const side of BORDER_SIDES) out.delete(`border-${side}`);
    out.set('border', sideValues[0]);
  }
}

/** 메일에서 이미지 폭이 무너지지 않도록 렌더된 폭을 width 속성으로 고정한다 */
function pinImageWidths(doc, declMap, warnings) {
  let pinned = 0;
  let unknown = 0;

  for (const img of doc.images) {
    const decls = declMap.get(img);
    const hasCssWidth = decls && (decls.has('width') || decls.has('max-width'));
    const rendered = Math.round(img.getBoundingClientRect().width);

    if (!img.getAttribute('width') && rendered > 0) {
      img.setAttribute('width', String(rendered));
      pinned++;
    }
    if (!rendered && !hasCssWidth) unknown++;
  }

  if (unknown) {
    warnings.push({
      level: 'warn',
      code: 'image-size',
      message: `크기를 확인할 수 없는 이미지 ${unknown}개가 있습니다(로드 실패 또는 외부 URL). Outlook은 max-width를 무시하므로 원본 크기로 표시될 수 있습니다.`
    });
  }
  return pinned;
}

/** 결과물에서 메일 호환성 위험을 찾아 경고로 모은다 */
function auditResult(doc, declMap, options, warnings) {
  const { profile, mailSafeLayout } = options;
  if (profile !== 'email') return;

  const counts = { modernLayout: 0, fixedPos: 0, bgImage: 0, borderBoxPercent: 0 };

  for (const [el, decls] of declMap) {
    const display = decls.get('display');
    if (display && /(^|\s)(inline-)?(flex|grid)\b/.test(display.value)) counts.modernLayout++;

    const position = decls.get('position');
    if (position && /(fixed|absolute|sticky)/.test(position.value)) counts.fixedPos++;

    const bg = decls.get('background-image') || decls.get('background');
    if (bg && /url\(/i.test(bg.value)) counts.bgImage++;

    const width = decls.get('width');
    const boxSizing = decls.get('box-sizing');
    const padding = decls.get('padding') || decls.get('padding-left');
    if (width && width.value.includes('%') && padding && boxSizing && boxSizing.value === 'border-box') {
      counts.borderBoxPercent++;
    }
  }

  if (counts.modernLayout && !mailSafeLayout) {
    warnings.push({
      level: 'warn',
      code: 'modern-layout',
      message: `flex/grid 레이아웃을 쓰는 요소 ${counts.modernLayout}개가 그대로 남았습니다. Outlook 데스크톱은 이를 무시해 가로 배치가 세로로 쌓입니다. "메일 호환 레이아웃" 옵션을 켜면 block 기반으로 바꿔 미리보기와 실제를 맞출 수 있습니다.`
    });
  }
  if (counts.fixedPos) {
    warnings.push({
      level: 'warn',
      code: 'positioning',
      message: `position: absolute/fixed/sticky 요소 ${counts.fixedPos}개가 있습니다. 메일 클라이언트 대부분이 무시하거나 제거합니다.`
    });
  }
  if (counts.bgImage) {
    warnings.push({
      level: 'info',
      code: 'background-image',
      message: `배경 이미지 ${counts.bgImage}건은 Outlook 데스크톱에서 표시되지 않습니다. 배경색 폴백을 함께 지정하세요.`
    });
  }
  if (counts.borderBoxPercent) {
    warnings.push({
      level: 'info',
      code: 'box-sizing',
      message: `백분율 폭 + 여백을 box-sizing: border-box 전제로 쓴 요소 ${counts.borderBoxPercent}개가 있습니다. Outlook은 box-sizing을 지원하지 않아 폭이 넓게 계산됩니다.`
    });
  }
}

/**
 * HTML과 CSS를 받아서 인라인 스타일이 적용된 HTML을 반환한다.
 *
 * 계산된 스타일을 통째로 덤프하지 않고, 원본 CSS가 실제로 "선언한" 속성만
 * 옮긴다. 값이 계산을 필요로 할 때에만 getComputedStyle을 참조한다.
 *
 * @returns {Promise<{html: string, warnings: Array, stats: Object}>}
 */
export async function convertToInline(html, css, options = {}) {
  const {
    bodyOnly = false,
    profile = 'email',
    renderWidth = DEFAULT_RENDER_WIDTH,
    wrapBody = true,
    mailSafeLayout = false
  } = options;

  const warnings = [];
  const fullDocument = isFullDocument(html);
  const shouldReturnBodyOnly = bodyOnly || !fullDocument;

  const { frame, doc } = createRenderFrame(renderWidth);
  const win = frame.contentWindow;

  try {
    const style = doc.createElement('style');
    style.textContent = css || '';
    doc.head.appendChild(style);

    // @import로 불러오는 스타일시트(웹폰트 등)는 로딩을 기다릴 방법이 없어
    // 측정 시점마다 폰트 메트릭이 달라진다. 같은 URL을 link로도 걸어 대기 대상에 넣는다.
    for (const match of (css || '').matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?/gi)) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = match[1];
      doc.head.appendChild(link);
    }

    // 완전한 문서가 들어오면 body 내용만 떼어 같은 조건에서 렌더한다
    let htmlToConvert = html;
    if (fullDocument) {
      const parsed = new DOMParser().parseFromString(html, 'text/html');

      // 문서에 딸린 <style>과 body 속성(class 등)을 살려야 셀렉터가 원본대로 매칭된다
      if (parsed.head) {
        for (const node of parsed.head.children) {
          if (node.tagName === 'STYLE' || node.tagName === 'LINK' || node.tagName === 'META') {
            doc.head.appendChild(doc.importNode(node, true));
          }
        }
      }
      if (parsed.body) {
        for (const attr of parsed.body.attributes) {
          doc.body.setAttribute(attr.name, attr.value);
        }
        htmlToConvert = parsed.body.innerHTML;
      }
    }
    doc.body.innerHTML = htmlToConvert;

    await waitForResources(frame, doc);
    doc.body.offsetHeight; // 강제 리플로우

    const rules = collectRules(doc, win, css, warnings);
    const declMap = buildDeclarationMap(doc, rules, warnings);

    const elements = [doc.body, ...doc.body.querySelectorAll('*')];

    // 조상이 선언한 상속 속성을 미리 접어 내려둔다.
    // 메일에서는 표 안에서 폰트 상속이 끊기는 클라이언트가 있어 자손마다 다시 적고,
    // 웹에서는 조상과 값이 다른 요소에만 적어 호스트 스타일 상속을 최대한 살린다.
    const inheritedFromAncestors = new Map();
    const propagate = true;
    {
      const descend = (el, fromAncestors) => {
        const own = declMap.get(el);
        const next = new Set(fromAncestors);
        if (own) {
          for (const prop of own.keys()) {
            if (PROPAGATE_SOURCE.has(prop)) next.add(prop);
          }
        }
        for (const child of el.children) {
          inheritedFromAncestors.set(child, next);
          descend(child, next);
        }
      };
      descend(doc.body, new Set());
    }

    // 1패스: 필요한 계산값을 "문자열로 복사"해 둔다.
    // getComputedStyle이 돌려주는 객체는 살아 있어서, 2패스에서 부모에 style을
    // 써 넣는 순간 자식의 값이 부모의 절대값으로 바뀌어 버린다.
    // (숫자 line-height가 부모 폰트 크기 기준 px로 굳던 문제의 원인)
    const computedSnapshot = new Map();
    for (const el of elements) {
      const live = win.getComputedStyle(el);
      const needed = new Set(INHERITED_TO_PROPAGATE);
      const own = declMap.get(el);
      if (own) {
        for (const prop of own.keys()) {
          needed.add(prop);
          for (const part of SHORTHAND_PARTS[prop] || []) needed.add(part);
        }
      }
      const snapshot = new Map();
      for (const prop of needed) snapshot.set(prop, live.getPropertyValue(prop));
      computedSnapshot.set(el, snapshot);
    }

    // 2패스: 스냅샷을 근거로 style을 써 넣는다
    const opts = { profile, mailSafeLayout, skipRedundantInherited: profile !== 'email' };
    const effectiveInherited = new Map();
    let bodyStyle = '';

    for (const el of elements) {
      const inherited = propagate ? inheritedFromAncestors.get(el) || new Set() : new Set();
      const parentEffective = effectiveInherited.get(el.parentElement);
      const { style: inline, declarations } = buildInlineStyle(
        el,
        declMap.get(el),
        inherited,
        computedSnapshot.get(el),
        opts,
        parentEffective
      );

      // 이 요소가 자손에게 물려주게 될 상속값을 기록해 둔다
      const handDown = new Map(parentEffective || []);
      for (const prop of INHERITED_TO_PROPAGATE) {
        if (declarations.has(prop)) handDown.set(prop, declarations.get(prop));
      }
      effectiveInherited.set(el, handDown);

      if (el === doc.body) {
        bodyStyle = inline;
        continue; // body는 래퍼로 따로 처리한다
      }
      if (inline) el.setAttribute('style', inline);
      else el.removeAttribute('style');
    }

    if (profile === 'email') pinImageWidths(doc, declMap, warnings);
    auditResult(doc, declMap, opts, warnings);

    // 결과 조립
    let result;
    if (shouldReturnBodyOnly) {
      result = doc.body.innerHTML;
      if (wrapBody && bodyStyle) {
        const bodyComputed = win.getComputedStyle(doc.body);
        const px = (value) => parseFloat(value) || 0;

        // 계산값 문자열은 소수점이 반올림돼 있어 폭이 미세하게 어긋난다.
        // 빈 블록을 넣어 body의 실제 콘텐츠 폭을 직접 잰다.
        const probe = doc.createElement('div');
        doc.body.appendChild(probe);
        const measuredContentWidth = probe.getBoundingClientRect().width;
        probe.remove();

        const bodyMetrics = {
          boxSizing: bodyComputed.boxSizing,
          horizontalPadding: px(bodyComputed.paddingLeft) + px(bodyComputed.paddingRight),
          horizontalBorder: px(bodyComputed.borderLeftWidth) + px(bodyComputed.borderRightWidth),
          measuredContentWidth
        };
        result = buildBodyWrapper(doc, bodyStyle, result, profile, bodyMetrics);
      } else if (bodyStyle) {
        warnings.push({
          level: 'warn',
          code: 'body-style-dropped',
          message:
            'body에 적용된 스타일(폭 제한·바깥 여백·배경)이 결과에서 빠졌습니다. "본문 래퍼 생성" 옵션을 켜면 유지됩니다.'
        });
      }
    } else {
      if (bodyStyle) doc.body.setAttribute('style', bodyStyle);
      result = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    }

    const bytes = new Blob([result]).size;
    if (bytes >= CLIP_LIMIT_BYTES) {
      warnings.push({
        level: 'warn',
        code: 'gmail-clip',
        message: `출력 크기가 ${(bytes / 1024).toFixed(0)}KB로 Gmail의 클리핑 한계(102KB)를 넘었습니다. 본문이 잘리고 "전체 메시지 보기"가 표시됩니다.`
      });
    } else if (bytes >= CLIP_WARN_BYTES) {
      warnings.push({
        level: 'info',
        code: 'gmail-clip-near',
        message: `출력 크기가 ${(bytes / 1024).toFixed(0)}KB입니다. Gmail은 102KB를 넘으면 본문을 잘라냅니다.`
      });
    }

    return {
      html: result,
      warnings,
      stats: {
        bytes,
        elements: elements.length - 1,
        renderWidth,
        profile,
        wrapped: shouldReturnBodyOnly && wrapBody && !!bodyStyle
      }
    };
  } finally {
    frame.remove();
  }
}

/**
 * 미리보기 생성 (외부 CSS 적용)
 */
export function createPreview(html, css) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${css}</style>
</head>
<body>${html}</body>
</html>`;
}
