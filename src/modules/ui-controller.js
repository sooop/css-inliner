/**
 * UI 컨트롤러 - 사용자 인터랙션 관리
 */

export function initUIController() {
  // 탭 전환
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = tab.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  // 드롭다운 초기화
  initDropdown();
}

/**
 * 드롭다운 메뉴 초기화
 */
function initDropdown() {
  const dropdowns = document.querySelectorAll('.dropdown');
  const closeAll = () => dropdowns.forEach(d => d.classList.remove('active'));

  dropdowns.forEach(dropdown => {
    dropdown.querySelector('.dropdown-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = dropdown.classList.contains('active');
      closeAll();
      dropdown.classList.toggle('active', !wasActive);
    });

    // 메뉴 항목은 동적으로 추가되므로 위임으로 처리
    dropdown.querySelector('.dropdown-menu').addEventListener('click', (e) => {
      if (e.target.closest('button')) closeAll();
    });
  });

  // 외부 클릭 시 닫기
  document.addEventListener('click', closeAll);
}

/**
 * 다크모드 초기화
 */
export function initTheme() {
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = themeToggle.querySelector('.theme-icon');

  // localStorage에서 테마 로드
  const savedTheme = localStorage.getItem('theme-preference') || 'system';
  applyTheme(savedTheme);

  // 토글 버튼
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
  });

  // 시스템 테마 변경 감지
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('theme-preference') === 'system') {
      applyTheme('system');
    }
  });
}

function applyTheme(theme) {
  const themeIcon = document.querySelector('.theme-icon');
  let actualTheme = theme;

  if (theme === 'system') {
    actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', actualTheme);
  themeIcon.textContent = actualTheme === 'dark' ? '☀️' : '🌙';
}

/**
 * 패널 토글 초기화
 */
export function initResizer() {
  const resizer = document.querySelector('.resizer');
  const paneLeft = document.querySelector('.pane-left');

  // 저장된 접힘 상태 복원
  const isCollapsed = localStorage.getItem('panel-left-collapsed') === 'true';
  if (isCollapsed) {
    paneLeft.classList.add('collapsed');
  }

  // 클릭 시 토글
  resizer.addEventListener('click', () => {
    const isCurrentlyCollapsed = paneLeft.classList.contains('collapsed');

    if (isCurrentlyCollapsed) {
      // 펼치기
      paneLeft.classList.remove('collapsed');
      localStorage.setItem('panel-left-collapsed', 'false');
    } else {
      // 접기
      paneLeft.classList.add('collapsed');
      localStorage.setItem('panel-left-collapsed', 'true');
    }
  });
}

/**
 * CSS 모달 초기화
 */
export function initModal() {
  const modal = document.getElementById('cssModal');
  const openBtn = document.getElementById('openCssModalBtn');
  const closeBtn = modal.querySelector('.close-btn');
  const applyBtn = document.getElementById('applyCssBtn');
  const cancelBtn = document.getElementById('cancelCssBtn');
  const cssInput = document.getElementById('cssInput');

  let originalValue = '';

  openBtn.addEventListener('click', () => {
    originalValue = cssInput.value;
    modal.showModal();
  });

  closeBtn.addEventListener('click', () => modal.close());
  cancelBtn.addEventListener('click', () => {
    cssInput.value = originalValue;
    modal.close();
  });

  applyBtn.addEventListener('click', () => {
    localStorage.setItem('css-input-content', cssInput.value);
    modal.close();
  });

  // 외부 클릭 시 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      cssInput.value = originalValue;
      modal.close();
    }
  });
}

/**
 * 이력 모달 열기
 */
export async function openHistoryModal(loadHistoryListFn, loadHistoryItemFn, deleteHistoryItemFn, clearHistoryFn, showToastFn) {
  const modal = document.getElementById('historyModal');
  const historyList = document.getElementById('historyList');

  // 이력 목록 로드
  const items = await loadHistoryListFn();

  // 이력 렌더링
  if (items.length === 0) {
    historyList.innerHTML = '<div class="empty-state">이력이 없습니다</div>';
  } else {
    historyList.innerHTML = items.map(item => {
      const htmlLen = item.htmlInput ? item.htmlInput.length : 0;
      const sizeLabel = htmlLen > 1024 ? `${(htmlLen / 1024).toFixed(1)}KB` : `${htmlLen}B`;
      const optionCount = [item.options.useBuiltInCSS, item.options.bodyOnly, item.options.removeWhitespace].filter(Boolean).length;
      return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-item-header">
          <span class="history-item-time">${formatTimestamp(item.timestamp)}</span>
          <div class="history-item-meta">${sizeLabel} HTML · 옵션 ${optionCount}개</div>
          <button class="history-item-delete" data-id="${item.id}" onclick="event.stopPropagation()">삭제</button>
        </div>
        <div class="history-item-preview">${item.preview || 'HTML 내용 없음'}</div>
        <div class="history-item-options">
          ${item.options.useBuiltInCSS ? '<span class="history-item-badge">내장 CSS</span>' : ''}
          ${item.options.bodyOnly ? '<span class="history-item-badge">Body Only</span>' : ''}
          ${item.options.removeWhitespace ? '<span class="history-item-badge">공백 제거</span>' : ''}
        </div>
      </div>
    `}).join('');

    // 이력 항목 클릭 이벤트
    historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = parseInt(item.getAttribute('data-id'));
        const historyItem = await loadHistoryItemFn(id);

        if (historyItem) {
          // 입력 영역에 복원
          document.getElementById('htmlInput').value = historyItem.htmlInput;
          document.getElementById('cssInput').value = historyItem.cssInput;
          document.getElementById('useBuiltInCSS').checked = historyItem.options.useBuiltInCSS;
          document.getElementById('bodyOnly').checked = historyItem.options.bodyOnly;
          document.getElementById('removeWhitespace').checked = historyItem.options.removeWhitespace;

          // 변환 조건(폭·래퍼·호환 모드)까지 복원해야 같은 결과가 재현된다
          const options = historyItem.options;
          if (options.wrapBody !== undefined) {
            document.getElementById('wrapBody').checked = options.wrapBody;
            localStorage.setItem('wrap-body', options.wrapBody);
          }
          if (options.newTabLinks !== undefined) {
            document.getElementById('newTabLinks').checked = options.newTabLinks;
            localStorage.setItem('new-tab-links', options.newTabLinks);
          }
          if (options.mailSafeLayout !== undefined) {
            document.getElementById('mailSafeLayout').checked = options.mailSafeLayout;
            localStorage.setItem('mail-safe-layout', options.mailSafeLayout);
          }
          if (options.renderWidth) {
            document.getElementById('renderWidth').value = options.renderWidth;
            localStorage.setItem('render-width', options.renderWidth);
          }
          if (options.profile) {
            document.querySelectorAll('.profile-btn').forEach((b) => {
              b.classList.toggle('active', b.getAttribute('data-profile') === options.profile);
            });
            localStorage.setItem('output-profile', options.profile);
          }

          // localStorage에도 저장
          localStorage.setItem('html-input-content', historyItem.htmlInput);
          localStorage.setItem('css-input-content', historyItem.cssInput);
          localStorage.setItem('use-builtin-css', historyItem.options.useBuiltInCSS);

          modal.close();
          showToastFn('이력을 복원했습니다', 'success');
        }
      });
    });

    // 삭제 버튼 클릭 이벤트
    historyList.querySelectorAll('.history-item-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = parseInt(btn.getAttribute('data-id'));
        await deleteHistoryItemFn(id);
        showToastFn('이력을 삭제했습니다', 'success');
        // 모달 다시 열기
        openHistoryModal(loadHistoryListFn, loadHistoryItemFn, deleteHistoryItemFn, clearHistoryFn, showToastFn);
      });
    });
  }

  modal.showModal();
}

/**
 * 이력 모달 초기화
 */
export function initHistoryModal(loadHistoryListFn, loadHistoryItemFn, deleteHistoryItemFn, clearHistoryFn, showToastFn) {
  const modal = document.getElementById('historyModal');
  const openBtn = document.getElementById('openHistoryBtn');
  const closeBtn = document.getElementById('closeHistoryModal');
  const clearBtn = document.getElementById('clearHistoryBtn');

  openBtn.addEventListener('click', () => {
    openHistoryModal(loadHistoryListFn, loadHistoryItemFn, deleteHistoryItemFn, clearHistoryFn, showToastFn);
  });

  closeBtn.addEventListener('click', () => modal.close());

  clearBtn.addEventListener('click', async () => {
    if (confirm('모든 이력을 삭제하시겠습니까?')) {
      await clearHistoryFn();
      showToastFn('모든 이력을 삭제했습니다', 'success');
      modal.close();
    }
  });

  // 외부 클릭 시 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.close();
    }
  });
}

/**
 * 타임스탬프 포맷 (예: 2026-02-05 14:30)
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 자동 저장 초기화
 */
export function initAutoSave(defaultCSS = '') {
  const htmlInput = document.getElementById('htmlInput');
  const cssInput = document.getElementById('cssInput');
  const useBuiltInCSS = document.getElementById('useBuiltInCSS');
  const autoConvert = document.getElementById('autoConvert');

  // 복원
  const savedHTML = localStorage.getItem('html-input-content');
  const savedCSS = localStorage.getItem('css-input-content');
  const savedCheckbox = localStorage.getItem('use-builtin-css');
  const savedAutoConvert = localStorage.getItem('auto-convert');

  if (savedHTML) htmlInput.value = savedHTML;
  if (savedCSS) cssInput.value = savedCSS;
  else if (defaultCSS) cssInput.value = defaultCSS;
  if (savedCheckbox !== null) useBuiltInCSS.checked = savedCheckbox === 'true';
  if (savedAutoConvert !== null) autoConvert.checked = savedAutoConvert === 'true';

  // 자동 저장 (debounce)
  htmlInput.addEventListener('input', debounce(() => {
    localStorage.setItem('html-input-content', htmlInput.value);
  }, 500));

  cssInput.addEventListener('input', debounce(() => {
    localStorage.setItem('css-input-content', cssInput.value);
  }, 500));

  useBuiltInCSS.addEventListener('change', () => {
    localStorage.setItem('use-builtin-css', useBuiltInCSS.checked);
  });

  // 자동변환 설정 저장
  autoConvert.addEventListener('change', () => {
    localStorage.setItem('auto-convert', autoConvert.checked);
  });

  // 붙여넣기 시 자동 변환
  htmlInput.addEventListener('paste', debounce(() => {
    if (autoConvert.checked) {
      document.getElementById('convertBtn').click();
    }
  }, 500));
}

/**
 * 키보드 단축키 초기화
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter: 변환
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('convertBtn').click();
    }

    // Ctrl+K: CSS 모달 열기
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      document.getElementById('openCssModalBtn').click();
    }

    // Ctrl+Shift+C: 코드 복사
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      document.getElementById('copyCodeBtn').click();
    }

    // ?: 단축키 도움말 (textarea/input 포커스 아닐 때)
    if (e.key === '?' && !e.ctrlKey && !e.altKey) {
      const tag = document.activeElement.tagName.toLowerCase();
      if (tag !== 'textarea' && tag !== 'input') {
        e.preventDefault();
        document.getElementById('shortcutsModal').showModal();
      }
    }
  });
}

/**
 * Utility: debounce
 */
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 탭 전환 함수
 */
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => {
    const isActive = tab.getAttribute('data-tab') === tabName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabName);
  });
  document.querySelectorAll('.tab-actions-group').forEach(group => {
    group.hidden = group.dataset.for !== tabName;
  });
}

/**
 * CSS 배지 업데이트
 */
export function updateCssBadge() {
  const badge = document.getElementById('cssBadge');
  if (!badge) return;
  const useBuiltIn = document.getElementById('useBuiltInCSS').checked;
  const cssInput = document.getElementById('cssInput').value.trim();
  const lineCount = cssInput ? cssInput.split('\n').length : 0;

  if (useBuiltIn && !cssInput) {
    badge.textContent = '내장 CSS';
    badge.className = 'css-badge css-badge-builtin';
  } else if (useBuiltIn && cssInput) {
    badge.textContent = `내장 CSS + 커스텀 (${lineCount}줄)`;
    badge.className = 'css-badge css-badge-combined';
  } else if (cssInput) {
    badge.textContent = `커스텀 CSS (${lineCount}줄)`;
    badge.className = 'css-badge css-badge-custom';
  } else {
    badge.textContent = 'CSS 없음';
    badge.className = 'css-badge css-badge-none';
  }
}

/**
 * CSS 파일 로드 핸들러
 */
export function handleCSSFileUpload(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    callback(e.target.result);
  };
  reader.readAsText(file);
}

/**
 * 인라인 코드 복사
 */
export function copyInlineCode() {
  const code = document.getElementById('inlineCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    alert('인라인 코드가 클립보드에 복사되었습니다.');
  });
}

/**
 * 미리보기 업데이트
 *
 * renderWidth를 주면 iframe을 그 폭으로 고정한 뒤 패널 크기에 맞춰 축소해서 보여준다.
 * 변환도 같은 폭에서 이뤄지므로 미디어쿼리·백분율이 미리보기와 결과에서 동일하게 평가된다.
 * (패널을 리사이즈해도 미리보기 레이아웃이 바뀌지 않는다)
 */
export function updatePreview(frameId, html, renderWidth = 0) {
  const frame = document.getElementById(frameId);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  frame.dataset.renderWidth = String(renderWidth || 0);
  applyPreviewScale(frame);
  observePreviewResize(frame);
}

function applyPreviewScale(frame) {
  const renderWidth = Number(frame.dataset.renderWidth || 0);
  const wrapper = frame.parentElement;

  if (!renderWidth || !wrapper) {
    frame.style.flex = '';
    frame.style.width = '';
    frame.style.height = '';
    frame.style.transform = '';
    return;
  }

  const available = wrapper.clientWidth;
  const scale = available > 0 ? Math.min(1, available / renderWidth) : 1;

  frame.style.flex = 'none'; // 래퍼가 flex 컨테이너라 높이를 직접 지정하려면 필요
  frame.style.transformOrigin = 'top left';
  frame.style.width = `${renderWidth}px`;
  frame.style.height = `${wrapper.clientHeight / scale}px`;
  frame.style.transform = `scale(${scale})`;
}

const previewObservers = new WeakMap();

function observePreviewResize(frame) {
  if (previewObservers.has(frame) || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => applyPreviewScale(frame));
  observer.observe(frame.parentElement);
  previewObservers.set(frame, observer);
}

/**
 * 변환 경고 표시
 */
export function renderWarnings(warnings) {
  const banner = document.getElementById('warningBanner');
  if (!banner) return;

  banner.textContent = '';

  if (!warnings || !warnings.length) {
    banner.hidden = true;
    return;
  }

  const warnCount = warnings.filter((w) => w.level === 'warn').length;
  banner.hidden = false;
  banner.classList.toggle('has-warning', warnCount > 0);

  const details = document.createElement('details');
  details.open = warnCount > 0;

  const summary = document.createElement('summary');
  summary.textContent =
    warnCount > 0
      ? `호환성 경고 ${warnCount}건${warnings.length > warnCount ? ` · 참고 ${warnings.length - warnCount}건` : ''}`
      : `참고 ${warnings.length}건`;
  details.appendChild(summary);

  const list = document.createElement('ul');
  for (const warning of warnings) {
    const item = document.createElement('li');
    item.className = `warning-${warning.level}`;
    item.textContent = warning.message;
    list.appendChild(item);
  }
  details.appendChild(list);
  banner.appendChild(details);
}

/**
 * 인라인 코드 표시
 */
export function displayInlineCode(code) {
  const codeElement = document.getElementById('inlineCode');
  if (code && code.trim()) {
    codeElement.textContent = code;
  } else {
    codeElement.innerHTML = '<div class="empty-state">변환 버튼을 클릭하여 결과를 생성하세요</div>';
  }
}

/**
 * 토스트 메시지 표시
 */
export function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

/**
 * 드래그앤드롭 초기화
 */
export function initDragDrop() {
  const paneLeft = document.querySelector('.pane-left');
  const htmlInput = document.getElementById('htmlInput');
  const cssInput = document.getElementById('cssInput');

  ['dragenter', 'dragover'].forEach(eventName => {
    paneLeft.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      paneLeft.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    paneLeft.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      paneLeft.classList.remove('drag-over');
    });
  });

  paneLeft.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (file.name.endsWith('.html')) {
        htmlInput.value = content;
        showToast(`${file.name} 파일을 불러왔습니다.`, 'success');
      } else if (file.name.endsWith('.css')) {
        cssInput.value = content;
        showToast(`${file.name} 파일을 불러왔습니다.`, 'success');
      } else {
        showToast('HTML 또는 CSS 파일만 업로드할 수 있습니다.', 'error');
      }
    };
    reader.readAsText(file);
  });
}
