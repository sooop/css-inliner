/**
 * 불필요한 공백 제거
 */
export function removeWhitespace(html) {
  return html.replace(/>\s+</g, '><').trim();
}

/**
 * Body 내용만 추출
 */
export function extractBody(html) {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : html;
}

/**
 * 특정 CSS 속성이 인라인 스타일로 포함되어야 하는지 판단
 */
export function shouldIncludeProperty(prop, value) {
  if (!value) return false;

  // 1. 'none' 값이어도 명시적으로 포함해야 하는 속성들
  const includeNoneValue = [
    'text-decoration',
    'text-decoration-line',
    'border',
    'outline',
    'list-style',
    'float'
  ];

  if (includeNoneValue.includes(prop) && value === 'none') {
    return true;
  }

  // 2. 레이아웃 관련 속성은 'auto' 등의 값도 포함
  const layoutProps = [
    'display',
    'position',
    'overflow',
    'overflow-x',
    'overflow-y'
  ];

  if (layoutProps.includes(prop)) {
    return value !== 'initial' && value !== 'inherit';
  }

  // 3. 특정 속성의 명백한 기본값만 제외
  if (prop === 'border-style' && value === 'none') return false;
  if (prop === 'border-width' && value === '0px') return false;
  if (prop === 'border-spacing' && value === '0px 0px') return false;

  // 4. 일반적인 기본값 제외
  const defaultValues = ['none', 'auto', 'normal', 'initial', 'inherit'];
  if (defaultValues.includes(value)) return false;

  return true;
}
