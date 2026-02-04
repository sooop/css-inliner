import {
  initUIController,
  initTheme,
  initResizer,
  initModal,
  initAutoSave,
  initKeyboardShortcuts,
  handleCSSFileUpload,
  copyInlineCode,
  updatePreview,
  displayInlineCode,
  showToast,
  initDragDrop
} from './modules/ui-controller.js';
import { convertToInline, createPreview } from './modules/css-converter.js';
import {
  getTemplateCSS,
  downloadTemplateCSS,
  copyTemplateCSS
} from './modules/template-manager.js';
import { removeWhitespace, extractBody } from './modules/utils.js';

// UI 컨트롤러 초기화
initUIController();
initTheme();
initResizer();
initModal();
initAutoSave();
initKeyboardShortcuts();
initDragDrop();

// CSS 파일 버튼
document.getElementById('cssFileBtn').addEventListener('click', () => {
  document.getElementById('cssFile').click();
});

// CSS 파일 업로드
document.getElementById('cssFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    handleCSSFileUpload(file, (content) => {
      document.getElementById('cssInput').value = content;
      document.getElementById('useBuiltInCSS').checked = false;
    });
  }
});

// 템플릿 CSS 다운로드
document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  downloadTemplateCSS(showToast);
});

// 템플릿 CSS 복사
document.getElementById('copyTemplateBtn').addEventListener('click', () => {
  copyTemplateCSS(showToast);
});

// 인라인 코드 다운로드 버튼
document.getElementById('downloadCodeBtn').addEventListener('click', () => {
  const code = document.getElementById('inlineCode').textContent;
  if (!code || code.includes('변환 버튼을 클릭')) {
    showToast('다운로드할 콘텐츠가 없습니다.', 'error');
    return;
  }

  const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inline-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('파일이 다운로드되었습니다.', 'success');
});

// 인라인 코드 복사 버튼
document.getElementById('copyCodeBtn').addEventListener('click', () => {
  const code = document.getElementById('inlineCode').textContent;
  if (code && !code.includes('변환 버튼을 클릭')) {
    navigator.clipboard.writeText(code).then(() => {
      showToast('복사되었습니다!', 'success');
    });
  } else {
    showToast('복사할 콘텐츠가 없습니다.', 'error');
  }
});

// 인라인 미리보기 탭 복사 버튼
document.getElementById('copyInlinePreviewBtn').addEventListener('click', () => {
  const code = document.getElementById('inlineCode').textContent;
  if (code && !code.includes('변환 버튼을 클릭')) {
    navigator.clipboard.writeText(code).then(() => {
      showToast('복사되었습니다!', 'success');
    });
  } else {
    showToast('복사할 콘텐츠가 없습니다.', 'error');
  }
});

// 스타일 미리보기 탭 복사 버튼
document.getElementById('copyPreviewBtn').addEventListener('click', () => {
  const code = document.getElementById('inlineCode').textContent;
  if (code && !code.includes('변환 버튼을 클릭')) {
    navigator.clipboard.writeText(code).then(() => {
      showToast('복사되었습니다!', 'success');
    });
  } else {
    showToast('복사할 콘텐츠가 없습니다.', 'error');
  }
});

// 변환 버튼
document.getElementById('convertBtn').addEventListener('click', () => {
  const htmlInput = document.getElementById('htmlInput').value;
  const userCSS = document.getElementById('cssInput').value;
  const useBuiltInCSS = document.getElementById('useBuiltInCSS').checked;

  if (!htmlInput.trim()) {
    showToast('HTML을 입력해주세요.', 'error');
    return;
  }

  // CSS 결합
  const finalCSS = useBuiltInCSS ? getTemplateCSS() + '\n' + userCSS : userCSS;

  // 스타일 미리보기 생성
  const previewHTML = createPreview(htmlInput, finalCSS);
  updatePreview('previewFrame', previewHTML);

  // 인라인 변환
  const bodyOnly = document.getElementById('bodyOnly').checked;
  let result = convertToInline(htmlInput, finalCSS, {
    bodyOnly: bodyOnly || !htmlInput.includes('<html')
  });

  // 공백 제거
  if (document.getElementById('removeWhitespace').checked) {
    result = removeWhitespace(result);
  }

  // 인라인 미리보기 생성
  const inlinePreviewHTML = bodyOnly || !htmlInput.includes('<html')
    ? `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${result}</body></html>`
    : result;
  updatePreview('inlinePreviewFrame', inlinePreviewHTML);

  // 인라인 코드 표시
  displayInlineCode(result);

  // 변환 완료 애니메이션
  const paneRight = document.querySelector('.pane-right');
  paneRight.classList.remove('flash-success');
  void paneRight.offsetWidth; // reflow 강제
  paneRight.classList.add('flash-success');

  setTimeout(() => {
    paneRight.classList.remove('flash-success');
  }, 600);

  // 자동 최대화 옵션 확인
  const autoMaximize = localStorage.getItem('auto-maximize-result') === 'true';
  if (autoMaximize) {
    const paneLeft = document.querySelector('.pane-left');
    paneLeft.style.flex = '0.1';
    paneRight.style.flex = '0.9';
  }
});
