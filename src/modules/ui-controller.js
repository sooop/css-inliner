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
 * 드래그 리사이저 초기화
 */
export function initResizer() {
  const resizer = document.querySelector('.resizer');
  const paneLeft = document.querySelector('.pane-left');
  const paneRight = document.querySelector('.pane-right');
  const container = document.querySelector('.split-panes');

  let isResizing = false;
  let startX = 0;
  let startLeftWidth = 0;

  // 저장된 비율 복원
  const savedRatio = localStorage.getItem('resizer-position-horizontal');
  if (savedRatio) {
    paneLeft.style.flex = savedRatio;
    paneRight.style.flex = String(1 - parseFloat(savedRatio));
  }

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startLeftWidth = paneLeft.offsetWidth;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const containerWidth = container.offsetWidth;
    const newLeftWidth = startLeftWidth + deltaX;
    const ratio = newLeftWidth / containerWidth;

    // 패널 접기
    if (ratio < 0.05) {
      paneLeft.classList.add('collapsed');
      paneRight.classList.remove('collapsed');
      paneLeft.style.flex = '0';
      paneRight.style.flex = '1';
    } else if (ratio > 0.95) {
      paneRight.classList.add('collapsed');
      paneLeft.classList.remove('collapsed');
      paneLeft.style.flex = '1';
      paneRight.style.flex = '0';
    } else {
      paneLeft.classList.remove('collapsed');
      paneRight.classList.remove('collapsed');
      // 최소 너비 제한
      if (newLeftWidth < 300 || newLeftWidth > containerWidth - 300) return;
      paneLeft.style.flex = String(ratio);
      paneRight.style.flex = String(1 - ratio);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // 비율 저장
      const ratio = paneLeft.offsetWidth / container.offsetWidth;
      localStorage.setItem('resizer-position-horizontal', String(ratio));
    }
  });

  // 더블클릭으로 패널 복원
  resizer.addEventListener('dblclick', () => {
    paneLeft.classList.remove('collapsed');
    paneRight.classList.remove('collapsed');
    paneLeft.style.flex = '1';
    paneRight.style.flex = '1';
    localStorage.setItem('resizer-position-horizontal', '0.5');
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
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(tabName).classList.add('active');
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
  document.getElementById('inlineCode').textContent = code;
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
