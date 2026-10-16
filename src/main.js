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
  initHistoryModal,
  updateCssBadge,
  renderWarnings
} from './modules/ui-controller.js';
import { convertToInline, createPreview, createInlinePreview, previewViewportWidth, DEFAULT_RENDER_WIDTH } from './modules/css-converter.js';
import {
  getTemplateCSS,
  getWebOverridesCSS,
  downloadTemplateCSS,
  copyTemplateCSS
} from './modules/template-manager.js';
import { removeWhitespace } from './modules/utils.js';
import { SAMPLES, DEFAULT_SAMPLE_ID, getSample } from './modules/sample-manager.js';
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

// 샘플 HTML — 저장된 입력이 없으면 기본 샘플로 시작한다
{
  const htmlTextarea = document.getElementById('htmlInput');
  const sampleMenu = document.getElementById('sampleMenu');

  const loadSample = (sample) => {
    htmlTextarea.value = sample.html;
    htmlTextarea.classList.remove('input-error');
    localStorage.setItem('html-input-content', sample.html);
    showToast(`'${sample.label}' 샘플을 불러왔습니다.`, 'success');
  };

  for (const sample of SAMPLES) {
    const btn = document.createElement('button');
    btn.textContent = sample.label;
    btn.addEventListener('click', () => {
      const current = htmlTextarea.value.trim();
      const isSample = SAMPLES.some(s => s.html.trim() === current);
      if (current && !isSample && !confirm('입력한 HTML이 샘플로 대체됩니다. 계속할까요?')) return;
      loadSample(sample);
    });
    sampleMenu.appendChild(btn);
  }

  if (!htmlTextarea.value.trim()) htmlTextarea.value = getSample(DEFAULT_SAMPLE_ID).html;
}

// CSS 배지 초기 업데이트
updateCssBadge();

// 출력 프로파일 (이메일 / 웹) 토글
// 이력 복원이 버튼 상태만 바꿔도 반영되도록 DOM을 단일 출처로 삼는다
function getProfile() {
  const active = document.querySelector('.profile-btn.active');
  return active ? active.getAttribute('data-profile') : 'email';
}

function applyProfile(profile) {
  document.querySelectorAll('.profile-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-profile') === profile);
  });
  localStorage.setItem('output-profile', profile);
}
applyProfile(localStorage.getItem('output-profile') || 'email');

document.getElementById('profileToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.profile-btn');
  if (!btn) return;
  applyProfile(btn.getAttribute('data-profile'));
});

// 변환 옵션 복원/저장
const wrapBodyInput = document.getElementById('wrapBody');
const mailSafeLayoutInput = document.getElementById('mailSafeLayout');
const renderWidthInput = document.getElementById('renderWidth');
const newTabLinksInput = document.getElementById('newTabLinks');

const savedWrapBody = localStorage.getItem('wrap-body');
if (savedWrapBody !== null) wrapBodyInput.checked = savedWrapBody === 'true';
const savedMailSafe = localStorage.getItem('mail-safe-layout');
if (savedMailSafe !== null) mailSafeLayoutInput.checked = savedMailSafe === 'true';
const savedNewTab = localStorage.getItem('new-tab-links');
if (savedNewTab !== null) newTabLinksInput.checked = savedNewTab === 'true';
const savedRenderWidth = localStorage.getItem('render-width');
if (savedRenderWidth) renderWidthInput.value = savedRenderWidth;

wrapBodyInput.addEventListener('change', () => {
  localStorage.setItem('wrap-body', wrapBodyInput.checked);
});
mailSafeLayoutInput.addEventListener('change', () => {
  localStorage.setItem('mail-safe-layout', mailSafeLayoutInput.checked);
});
newTabLinksInput.addEventListener('change', () => {
  localStorage.setItem('new-tab-links', newTabLinksInput.checked);
});
renderWidthInput.addEventListener('change', () => {
  localStorage.setItem('render-width', renderWidthInput.value);
});

function getRenderWidth() {
  const value = parseInt(renderWidthInput.value, 10);
  if (!Number.isFinite(value)) return DEFAULT_RENDER_WIDTH;
  return Math.min(1600, Math.max(320, value));
}

// 단축키 모달
const shortcutsModal = document.getElementById('shortcutsModal');
document.getElementById('shortcutsBtn').addEventListener('click', () => shortcutsModal.showModal());
document.getElementById('closeShortcutsModal').addEventListener('click', () => shortcutsModal.close());
document.getElementById('closeShortcutsOkBtn').addEventListener('click', () => shortcutsModal.close());
shortcutsModal.addEventListener('click', (e) => { if (e.target === shortcutsModal) shortcutsModal.close(); });

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
      updateCssBadge();
    });
  }
});

// 내장 CSS 체크박스 변경 시 배지 업데이트
document.getElementById('useBuiltInCSS').addEventListener('change', updateCssBadge);
document.getElementById('cssInput').addEventListener('input', updateCssBadge);

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

// HTML textarea 에러 상태 해제
document.getElementById('htmlInput').addEventListener('input', () => {
  document.getElementById('htmlInput').classList.remove('input-error');
});

// 변환 버튼
document.getElementById('convertBtn').addEventListener('click', () => {
  const htmlInput = document.getElementById('htmlInput').value;
  const htmlTextarea = document.getElementById('htmlInput');
  const convertBtn = document.getElementById('convertBtn');

  if (!htmlInput.trim()) {
    showToast('HTML 입력이 필요합니다.', 'error');
    htmlTextarea.classList.add('input-error');
    htmlTextarea.focus();
    return;
  }

  runConversion(htmlInput, convertBtn);
});

async function runConversion(htmlInput, convertBtn) {
  // 로딩 상태 시작
  convertBtn.disabled = true;
  convertBtn.classList.add('loading');
  convertBtn.textContent = '변환 중...';

  try {
    const userCSS = document.getElementById('cssInput').value;
    const useBuiltInCSS = document.getElementById('useBuiltInCSS').checked;
    const renderWidth = getRenderWidth();
    const profile = getProfile();

    // CSS 결합 (웹 프로파일은 제목 크기 오버라이드를 템플릿 뒤에 덧붙임)
    const webOverrides = profile === 'web' ? '\n' + getWebOverridesCSS() : '';
    const finalCSS = useBuiltInCSS ? getTemplateCSS() + webOverrides + '\n' + userCSS : userCSS;

    // 스타일 미리보기 생성 (변환과 동일한 폭으로 렌더)
    const previewHTML = createPreview(htmlInput, finalCSS, renderWidth);
    updatePreview('previewFrame', previewHTML, previewViewportWidth(renderWidth));

    // 인라인 변환
    const bodyOnly = document.getElementById('bodyOnly').checked;
    const conversion = await convertToInline(htmlInput, finalCSS, {
      bodyOnly,
      profile,
      renderWidth,
      wrapBody: wrapBodyInput.checked,
      mailSafeLayout: mailSafeLayoutInput.checked,
      newTabLinks: newTabLinksInput.checked
    });

    let result = conversion.html;

    // 공백 제거
    if (document.getElementById('removeWhitespace').checked) {
      result = removeWhitespace(result);
    }

    // 인라인 미리보기 생성
    const inlinePreviewHTML = createInlinePreview(result, renderWidth, {
      hasWrapper: !bodyOnly
    });
    updatePreview('inlinePreviewFrame', inlinePreviewHTML, previewViewportWidth(renderWidth));

    // 인라인 코드 표시
    displayInlineCode(result);
    renderWarnings(conversion.warnings);

    // empty state 숨기기
    document.getElementById('emptyInlinePreview').style.display = 'none';
    document.getElementById('emptyPreview').style.display = 'none';

    // 변환 완료 애니메이션 (오버레이)
    const paneRight = document.querySelector('.pane-right');
    const overlay = document.createElement('div');
    overlay.className = 'success-overlay';
    overlay.innerHTML = '<div class="success-overlay-icon">✓</div>';
    paneRight.appendChild(overlay);
    setTimeout(() => overlay.remove(), 800);

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
        removeWhitespace: document.getElementById('removeWhitespace').checked,
        profile,
        renderWidth,
        wrapBody: wrapBodyInput.checked,
        newTabLinks: newTabLinksInput.checked,
        mailSafeLayout: mailSafeLayoutInput.checked
      }
    });
  } catch (error) {
    console.error(error);
    showToast(`변환에 실패했습니다: ${error.message}`, 'error');
  } finally {
    // 로딩 상태 해제
    convertBtn.disabled = false;
    convertBtn.classList.remove('loading');
    convertBtn.textContent = '변환';
  }
}
