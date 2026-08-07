import templateCSS from '../styles/template.css?inline';

export function getTemplateCSS() {
  return templateCSS;
}

/**
 * 웹(Next.js/Tailwind/shadcn) 프로파일 전용 오버라이드.
 * 이메일 기본 제목 크기(h1 clamp 28~36px)는 브라우저 루트 폰트 기준 절대
 * 크기라 호스트 앱의 타이포 스케일과 무관하게 커 보인다. 호스트 UI 옆에
 * 놓일 때는 --h1/h2/h3-size 토큰만 더 작은 값으로 다시 정의해 덮어쓴다.
 */
export function getWebOverridesCSS() {
  return `:root {
  --h1-size: 1.375rem;
  --h2-size: 0.8125rem;
  --h3-size: 0.9375rem;
}`;
}

export function downloadTemplateCSS(showToast) {
  const blob = new Blob([templateCSS], { type: 'text/css' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template.css';
  a.click();
  URL.revokeObjectURL(url);
  if (showToast) showToast('템플릿 CSS가 다운로드되었습니다.', 'success');
}

export function copyTemplateCSS(showToast) {
  navigator.clipboard.writeText(templateCSS).then(() => {
    if (showToast) showToast('템플릿 CSS가 복사되었습니다.', 'success');
  });
}
