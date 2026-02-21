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
  const dropdown = document.querySelector('.dropdown');
  const trigger = document.getElementById('templateDropdownBtn');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('active');
  });

  // 외부 클릭 시 닫기
  document.addEventListener('click', () => {
    dropdown.classList.remove('active');
  });

  // 메뉴 내부 클릭 시 닫기
  dropdown.querySelectorAll('.dropdown-menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      dropdown.classList.remove('active');
    });
  });
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
export function initAutoSave() {
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
 */
export function updatePreview(frameId, html) {
  const frame = document.getElementById(frameId);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
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
