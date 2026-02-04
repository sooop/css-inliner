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
  initDragDrop,
  initHistoryModal
} from './modules/ui-controller.js';
import { convertToInline, createPreview } from './modules/css-converter.js';
import {
  getTemplateCSS,
  downloadTemplateCSS,
  copyTemplateCSS
} from './modules/template-manager.js';
import { removeWhitespace, extractBody } from './modules/utils.js';
import {
  saveHistory,
  loadHistoryList,
  loadHistoryItem,
  deleteHistoryItem,
  clearHistory
} from './modules/history-manager.js';

// UI 컨트롤러 초기화
initUIController();
initTheme();
initResizer();
initModal();
initAutoSave();
initKeyboardShortcuts();
initDragDrop();
initHistoryModal(loadHistoryList, loadHistoryItem, deleteHistoryItem, clearHistory, showToast);

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
    // 입력이 없으면 결과 클리어
    updatePreview('previewFrame', '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>');
    updatePreview('inlinePreviewFrame', '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>');
    displayInlineCode('');
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

  // 변환 완료 애니메이션 (오버레이)
  const paneRight = document.querySelector('.pane-right');
  const overlay = document.createElement('div');
  overlay.className = 'success-overlay';
  overlay.innerHTML = '<div class="success-overlay-icon">✓</div>';

  // pane-right에 position: relative 추가 (CSS에서 처리됨)
  paneRight.style.position = 'relative';
  paneRight.appendChild(overlay);

  setTimeout(() => {
    overlay.remove();
  }, 800);

  // 자동 최대화 옵션 확인
  const autoMaximize = localStorage.getItem('auto-maximize-result') === 'true';
  if (autoMaximize) {
    const paneLeft = document.querySelector('.pane-left');
    paneLeft.style.flex = '0.1';
    paneRight.style.flex = '0.9';
  }

  // 이력 저장
  saveHistory({
    htmlInput: htmlInput,
    cssInput: finalCSS,
    options: {
      useBuiltInCSS: useBuiltInCSS,
      bodyOnly: bodyOnly,
      removeWhitespace: document.getElementById('removeWhitespace').checked
    }
  });
});
