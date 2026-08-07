import { shouldIncludeProperty } from './utils.js';

/**
 * CSS 속성 목록 - 인라인화할 속성들
 */
const PROPERTIES_TO_INLINE = [
  // Layout & Sizing
  'display', 'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',

  // Box Model
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'border-collapse', 'border-spacing',
  'box-sizing', 'box-shadow',

  // Flexbox Container
  'flex-direction', 'flex-wrap', 'flex-flow',
  'justify-content', 'align-items', 'align-content',

  // Flexbox Item
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-self', 'order',

  // Grid Container
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows',
  'grid-template-areas', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',

  // Grid Item
  'grid-column', 'grid-row', 'grid-area',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',

  // Gap (Flexbox & Grid)
  'gap', 'row-gap', 'column-gap',

  // Background
  'background', 'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat',

  // Typography
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'text-align', 'text-decoration', 'text-transform', 'text-decoration-thickness', 'text-underline-offset',
  'letter-spacing', 'word-spacing', 'text-indent', 'text-overflow',
  'vertical-align', 'white-space', 'word-wrap', 'word-break',

  // List
  'list-style', 'list-style-type', 'list-style-position', 'list-style-image',

  // Positioning
  'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'float', 'clear',

  // Overflow
  'overflow', 'overflow-x', 'overflow-y',

  // Image & Media
  'object-fit', 'object-position', 'aspect-ratio',

  // Visual Effects
  'cursor', 'opacity', 'visibility',
  'transition', 'transform'
];

/**
 * 출력 프로파일별로 인라인 대상에서 제외할 속성.
 * web: Next.js/Tailwind/shadcn 같은 호스트 프로젝트에 삽입할 때, 폰트만
 * 호스트 값을 상속받도록 font-family를 뺀다. font-size/line-height/color는
 * 헤딩 위계와 버튼·콜아웃 라벨의 흰 글자 가독성이 인라인 style 하나에만
 * 의존하므로(외부 스타일시트 없이 붙여넣는 용도라) 유지한다.
 */
const PROFILE_EXCLUDED_PROPERTIES = {
  email: [],
  web: ['font-family']
};

function getInlineProperties(profile) {
  const excluded = PROFILE_EXCLUDED_PROPERTIES[profile] || PROFILE_EXCLUDED_PROPERTIES.email;
  return excluded.length
    ? PROPERTIES_TO_INLINE.filter((prop) => !excluded.includes(prop))
    : PROPERTIES_TO_INLINE;
}

/**
 * 요소와 그 자식들에 계산된 스타일을 인라인으로 적용
 */
function applyComputedStyles(element, properties) {
  if (element.nodeType !== 1) return;

  const elementWindow = element.ownerDocument.defaultView;
  const computed = elementWindow.getComputedStyle(element);
  let inlineStyle = '';

  for (let prop of properties) {
    const value = computed.getPropertyValue(prop);

    if (shouldIncludeProperty(prop, value)) {
      inlineStyle += `${prop}: ${value}; `;
    }
  }

  if (inlineStyle) {
    element.setAttribute('style', inlineStyle);
  }

  // 자식 요소들에 재귀적으로 적용
  for (let child of element.children) {
    applyComputedStyles(child, properties);
  }
}

/**
 * HTML과 CSS를 받아서 인라인 스타일이 적용된 HTML 반환
 */
export function convertToInline(html, css, options = {}) {
  const { bodyOnly = false, profile = 'email' } = options;
  const properties = getInlineProperties(profile);

  // 입력 HTML에서 body 내용만 추출 (완전한 HTML 문서인 경우)
  let htmlToConvert = html;
  let shouldReturnBodyOnly = bodyOnly;

  if (html.includes('<body')) {
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    htmlToConvert = match ? match[1] : html;
    shouldReturnBodyOnly = true;
  }

  // 임시 iframe 생성
  const tempFrame = document.createElement('iframe');
  tempFrame.style.display = 'none';
  document.body.appendChild(tempFrame);

  const tempDoc = tempFrame.contentDocument;
  tempDoc.open();
  tempDoc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>${css}</style>
    </head>
    <body>${htmlToConvert}</body>
    </html>
  `);
  tempDoc.close();

  // 리플로우 강제 실행 (스타일 완전 계산 보장)
  tempDoc.body.offsetHeight;

  // 인라인 스타일 적용
  applyComputedStyles(tempDoc.body, properties);

  // 결과 추출
  let result;
  if (shouldReturnBodyOnly || !html.includes('<html')) {
    result = tempDoc.body.innerHTML;
  } else {
    const serializer = new XMLSerializer();
    result = '<!DOCTYPE html>\n' + serializer.serializeToString(tempDoc.documentElement);
  }

  // 정리
  document.body.removeChild(tempFrame);

  return result;
}

/**
 * 미리보기 생성 (외부 CSS 적용)
 */
export function createPreview(html, css) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>${css}</style>
    </head>
    <body>${html}</body>
    </html>
  `;
}
