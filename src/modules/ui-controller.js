/**
 * UI 컨트롤러 - 화면 부품 (탭, 드롭다운, 테마, 분할선, 옵션, 토스트, 미리보기, 코드, 상태줄)
 */
import { highlightHTML } from './highlight.js';
import { lineNumbers, formatBytes } from './editor.js';

export const $ = (id) => document.getElementById(id);

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* 저장소를 못 써도 앱은 그대로 동작한다 */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }
};
export { store };

/* --- 토스트 --- */

export function showToast(message, type = 'success', duration = 2600) {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  while (container.children.length > 3) container.firstElementChild.remove();

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

/* --- 복사 / 저장 --- */

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 폴백으로 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* --- 탭 --- */

const tabListeners = [];

function moveIndicator(tablist, animate = true) {
  const active = tablist.querySelector('.tab.active');
  const indicator = tablist.querySelector('.tab-indicator');
  if (!active || !indicator) return;
  tablist.classList.toggle('no-anim', !animate);
  indicator.style.setProperty('--x', `${active.offsetLeft + 10}px`);
  indicator.style.setProperty('--w', `${Math.max(0, active.offsetWidth - 20)}px`);
  if (!animate) {
    // 강제 리플로우 뒤 다시 애니메이션 허용
    void indicator.offsetWidth;
    tablist.classList.remove('no-anim');
  }
}

export function switchTab(group, panelId) {
  const tablist = document.querySelector(`.tabs[data-tabs="${group}"]`);
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('.tab')];
  if (!tabs.some((tab) => tab.dataset.tab === panelId)) return;

  for (const tab of tabs) {
    const isActive = tab.dataset.tab === panelId;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.tabIndex = isActive ? 0 : -1;
    $(tab.dataset.tab).classList.toggle('active', isActive);
  }
  moveIndicator(tablist);
  for (const listener of tabListeners) listener(group, panelId);
}

export function activeTab(group) {
  const active = document.querySelector(`.tabs[data-tabs="${group}"] .tab.active`);
  return active ? active.dataset.tab : null;
}

export function onTabChange(listener) {
  tabListeners.push(listener);
}

export function initTabs() {
  document.querySelectorAll('.tabs').forEach((tablist) => {
    const group = tablist.dataset.tabs;
    const tabs = [...tablist.querySelectorAll('.tab')];

    tablist.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) switchTab(group, tab.dataset.tab);
    });

    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      e.preventDefault();
      const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      switchTab(group, next.dataset.tab);
      next.focus();
    });

    tabs.forEach((tab) => {
      tab.tabIndex = tab.classList.contains('active') ? 0 : -1;
    });

    moveIndicator(tablist, false);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => moveIndicator(tablist, false));
      tabs.forEach((tab) => observer.observe(tab));
    }
  });
}

/* --- 드롭다운 --- */

export function initDropdowns() {
  const dropdowns = [...document.querySelectorAll('.dropdown')];
  const setOpen = (dropdown, open) => {
    dropdown.classList.toggle('active', open);
    dropdown.querySelector('.dropdown-trigger').setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const closeAll = () => dropdowns.forEach((d) => setOpen(d, false));

  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector('.dropdown-trigger');
    const menu = dropdown.querySelector('.dropdown-menu');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = dropdown.classList.contains('active');
      closeAll();
      setOpen(dropdown, !wasActive);
      if (!wasActive) menu.querySelector('button')?.focus({ preventScroll: true });
    });

    // 메뉴 항목은 동적으로 추가되므로 위임으로 처리
    menu.addEventListener('click', (e) => {
      if (e.target.closest('button')) closeAll();
    });

    dropdown.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('active')) {
        e.stopPropagation();
        closeAll();
        trigger.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...menu.querySelectorAll('button')];
      if (!items.length || !dropdown.classList.contains('active')) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    });
  });

  document.addEventListener('click', closeAll);
}

/* --- 테마 --- */

export function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const resolve = (pref) => (pref === 'light' || pref === 'dark' ? pref : media.matches ? 'dark' : 'light');
  const apply = (pref) => document.documentElement.setAttribute('data-theme', resolve(pref));

  apply(store.get('theme-preference'));

  $('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    store.set('theme-preference', next);
  });

  media.addEventListener('change', () => {
    const pref = store.get('theme-preference');
    if (pref !== 'light' && pref !== 'dark') apply('system');
  });
}

/* --- 분할선: 끌어서 폭 조절, 클릭으로 입력 패널 접기/펼치기 --- */

export function initResizer() {
  const split = $('split');
  const resizer = $('resizer');
  const paneLeft = $('paneLeft');
  const MIN = 22;
  const MAX = 78;

  const setRatio = (percent, save = true) => {
    const clamped = Math.min(MAX, Math.max(MIN, percent));
    split.style.setProperty('--left', `${clamped}%`);
    resizer.setAttribute('aria-valuenow', String(Math.round(clamped)));
    if (save) store.set('split-ratio', clamped.toFixed(1));
    return clamped;
  };
  const getRatio = () => parseFloat(split.style.getPropertyValue('--left')) || 50;

  const setCollapsed = (collapsed) => {
    paneLeft.classList.toggle('collapsed', collapsed);
    paneLeft.inert = collapsed;
    resizer.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    store.set('panel-left-collapsed', collapsed);
  };

  resizer.setAttribute('aria-valuemin', String(MIN));
  resizer.setAttribute('aria-valuemax', String(MAX));
  const saved = parseFloat(store.get('split-ratio'));
  setRatio(Number.isFinite(saved) ? saved : 50, false);
  setCollapsed(store.get('panel-left-collapsed') === 'true');

  let drag = null;

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { startX: e.clientX, moved: false };
    resizer.setPointerCapture(e.pointerId);
  });

  resizer.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) < 4) return;
      drag.moved = true;
      split.classList.add('dragging');
      if (paneLeft.classList.contains('collapsed')) setCollapsed(false);
    }
    const rect = split.getBoundingClientRect();
    setRatio(((e.clientX - rect.left) / rect.width) * 100, false);
  });

  const end = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (resizer.hasPointerCapture(e.pointerId)) resizer.releasePointerCapture(e.pointerId);
    split.classList.remove('dragging');
    if (moved) store.set('split-ratio', getRatio().toFixed(1));
    else if (e.type === 'pointerup') setCollapsed(!paneLeft.classList.contains('collapsed'));
  };
  resizer.addEventListener('pointerup', end);
  resizer.addEventListener('pointercancel', end);

  resizer.addEventListener('dblclick', () => {
    setCollapsed(false);
    setRatio(50);
  });

  resizer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setCollapsed(!paneLeft.classList.contains('collapsed'));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (paneLeft.classList.contains('collapsed')) setCollapsed(false);
      setRatio(getRatio() + (e.key === 'ArrowRight' ? 2 : -2));
    }
  });
}

/* --- 접히는 옵션 묶음 --- */

export function initOptionsPanel() {
  const root = $('options');
  const toggle = $('optionsToggle');
  const summary = $('optionsSummary');
  const inputs = [...root.querySelectorAll('.options-grid input[type="checkbox"]')];

  const setOpen = (open) => {
    root.dataset.open = open ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    summary.setAttribute('aria-expanded', open ? 'true' : 'false');
    store.set('options-open', open);
  };
  const flip = () => setOpen(root.dataset.open !== 'true');

  let lastLabels = '';
  const renderSummary = () => {
    const labels = inputs.filter((input) => input.checked).map((input) => input.dataset.optionLabel);
    const key = labels.join('|');
    if (key === lastLabels && summary.childElementCount) return;
    const previous = new Set(lastLabels.split('|'));
    lastLabels = key;
    summary.textContent = '';
    if (!labels.length) {
      summary.textContent = '옵션';
      return;
    }
    for (const label of labels) {
      const chip = document.createElement('span');
      chip.className = 'option-chip';
      chip.textContent = label;
      // 새로 켜진 것만 등장 애니메이션
      if (previous.has(label)) chip.style.animation = 'none';
      summary.appendChild(chip);
    }
  };

  toggle.addEventListener('click', flip);
  summary.addEventListener('click', flip);
  // 요약 영역을 눌러도 입력창 포커스(모바일 키보드)를 빼앗지 않는다
  summary.addEventListener('pointerdown', (e) => e.preventDefault());
  summary.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flip();
    }
  });
  inputs.forEach((input) => input.addEventListener('change', renderSummary));

  setOpen(store.get('options-open') === 'true');
  renderSummary();
  return { renderSummary };
}

/* --- CSS 배지 --- */

export function updateCssBadge() {
  const badge = $('cssBadge');
  const useBuiltIn = $('useBuiltInCSS').checked;
  const css = $('cssInput').value.trim();
  const lines = css ? css.split('\n').length : 0;

  if (useBuiltIn && !css) {
    badge.textContent = '내장';
    badge.dataset.kind = 'builtin';
  } else if (useBuiltIn) {
    badge.textContent = `내장 + ${lines}줄`;
    badge.dataset.kind = 'combined';
  } else if (css) {
    badge.textContent = `${lines}줄`;
    badge.dataset.kind = 'custom';
  } else {
    badge.textContent = '없음';
    badge.dataset.kind = 'none';
  }
}

/* --- 파일 드롭 --- */

// 확장자 또는 MIME 중 하나만 맞아도 통과. 판별 불가(확장자 없고 type 빈 값)는 통과시키고 읽은 뒤 판단한다.
export function matchesFile(file, { exts = [], mimes = [] } = {}) {
  if (!exts.length && !mimes.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (exts.some((ext) => name.endsWith(ext))) return true;
  if (type && mimes.some((m) => (m.endsWith('/*') ? type.startsWith(m.slice(0, -1)) : type === m))) return true;
  return !type && !/\.[^./\\]+$/.test(name);
}

const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function bindDropZone(el, onFiles) {
  let depth = 0;
  const mark = (on) => el.toggleAttribute('data-dragover', on);

  el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth++;
    mark(true);
  });
  el.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) mark(false);
  });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    mark(false);
    const files = Array.from(e.dataTransfer.files); // await 전에 복사
    if (files.length) onFiles(files);
  });
}

// 영역 밖에 놓아도 브라우저가 파일을 열어 앱을 벗어나지 않게 한다
export function guardWindowDrops() {
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (type === 'dragover') e.dataTransfer.dropEffect = 'none';
    });
  }
}

/* --- 미리보기 ---
 * iframe 을 변환과 같은 폭으로 고정한 뒤 패널 크기에 맞춰 축소해서 보여 준다.
 * 변환도 같은 폭에서 이뤄지므로 미디어쿼리·백분율이 미리보기와 결과에서 동일하게 평가된다.
 */

const previewObservers = new WeakMap();

function applyPreviewScale(frame) {
  const renderWidth = Number(frame.dataset.renderWidth || 0);
  const wrapper = frame.parentElement;
  if (!renderWidth || !wrapper) return;

  const available = wrapper.clientWidth;
  const height = wrapper.clientHeight;
  if (!available || !height) return; // 숨은 탭 — 보이게 되면 ResizeObserver 가 다시 부른다

  const scale = Math.min(1, available / renderWidth);
  const offset = Math.max(0, (available - renderWidth * scale) / 2);

  frame.style.transformOrigin = 'top left';
  frame.style.width = `${renderWidth}px`;
  frame.style.height = `${height / scale}px`;
  frame.style.transform = `translateX(${offset}px) scale(${scale})`;
  frame.dataset.scale = String(scale);
  updateZoomBadge();
}

export function updatePreview(frameId, html, renderWidth = 0) {
  const frame = $(frameId);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  frame.dataset.renderWidth = String(renderWidth || 0);
  applyPreviewScale(frame);

  if (!previewObservers.has(frame) && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => applyPreviewScale(frame));
    observer.observe(frame.parentElement);
    previewObservers.set(frame, observer);
  }
}

export function updateZoomBadge() {
  const badge = $('zoomBadge');
  const panel = document.querySelector('#outputPanels > .tab-panel.active');
  const frame = panel && panel.querySelector('.preview-frame');
  const width = frame ? Number(frame.dataset.renderWidth || 0) : 0;
  if (!frame || !width) {
    badge.hidden = true;
    return;
  }
  const scale = Number(frame.dataset.scale || 1);
  badge.textContent = scale < 0.995 ? `${width}px · ${Math.round(scale * 100)}%` : `${width}px`;
  badge.hidden = false;
}

/* --- 경고 --- */

let warningKey = '';

export function renderWarnings(warnings) {
  const chip = $('warningChip');
  const panel = $('warningPanel');
  const list = $('warningList');
  const items = warnings || [];

  list.textContent = '';
  if (!items.length) {
    chip.hidden = true;
    panel.hidden = true;
    warningKey = '';
    return;
  }

  // 경고를 먼저, 참고를 뒤에
  const sorted = [...items].sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1));
  for (const warning of sorted) {
    const item = document.createElement('li');
    item.className = `warning-${warning.level}`;
    const text = document.createElement('span');
    text.textContent = warning.message;
    item.appendChild(text);
    list.appendChild(item);
  }

  const warnCount = items.filter((w) => w.level === 'warn').length;
  const infoCount = items.length - warnCount;
  chip.textContent = [warnCount ? `경고 ${warnCount}` : '', infoCount ? `참고 ${infoCount}` : '']
    .filter(Boolean)
    .join(' · ');
  chip.classList.toggle('has-warning', warnCount > 0);
  chip.hidden = false;

  const open = store.get('warnings-open') !== 'false';
  panel.hidden = !open;
  chip.setAttribute('aria-expanded', open ? 'true' : 'false');

  // 내용이 달라졌을 때만 주의를 끈다
  const key = items.map((w) => w.code || w.message).join('|');
  if (key !== warningKey) {
    warningKey = key;
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }
}

export function initWarnings() {
  const chip = $('warningChip');
  const panel = $('warningPanel');
  chip.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    store.set('warnings-open', open);
  });
}

/* --- 코드 보기 --- */

export function displayCode(code) {
  const body = $('inlineCode');
  const gutter = $('codeGutter');
  if (!code) {
    body.textContent = '';
    gutter.textContent = '';
    return;
  }
  body.innerHTML = highlightHTML(code);
  let lines = 1;
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) lines++;
  gutter.textContent = lineNumbers(lines) + '\n';
  body.scrollTop = 0;
  body.scrollLeft = 0;
  gutter.scrollTop = 0;
}

export function initCodeView() {
  const view = $('codeView');
  const body = $('inlineCode');
  const gutter = $('codeGutter');
  const toggle = $('wrapToggle');

  body.addEventListener('scroll', () => {
    gutter.scrollTop = body.scrollTop;
  }, { passive: true });

  const setWrap = (wrap) => {
    view.classList.toggle('wrap', wrap);
    toggle.setAttribute('aria-pressed', wrap ? 'true' : 'false');
    store.set('code-wrap', wrap);
  };
  toggle.addEventListener('click', () => setWrap(!view.classList.contains('wrap')));
  setWrap(store.get('code-wrap') === 'true');
}

/* --- 상태줄: 크기 게이지 --- */

export const GMAIL_CLIP_BYTES = 102 * 1024;

export function updateGauge(bytes) {
  const gauge = $('sizeGauge');
  if (!bytes) {
    gauge.dataset.level = 'idle';
    $('sizeLabel').textContent = '–';
    $('sizeFill').style.setProperty('--ratio', '0');
    return;
  }
  const ratio = bytes / GMAIL_CLIP_BYTES;
  gauge.dataset.level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
  $('sizeLabel').textContent = formatBytes(bytes);
  $('sizeFill').style.setProperty('--ratio', String(Math.min(1, ratio)));
}
