import templateCSS from '../styles/template.css?inline';

export function getTemplateCSS() {
  return templateCSS;
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
