import {
  $,
  store,
  initTabs,
  switchTab,
  activeTab,
  onTabChange,
  initDropdowns,
  initTheme,
  initResizer,
  initOptionsPanel,
  initWarnings,
  initCodeView,
  updateCssBadge,
  updatePreview,
  updateZoomBadge,
  updateGauge,
  displayCode,
  renderWarnings,
  showToast,
  copyText,
  downloadText,
  bindDropZone,
  guardWindowDrops,
  matchesFile
} from './modules/ui-controller.js';
import { createEditor } from './modules/editor.js';
import { initHistoryDrawer } from './modules/history-drawer.js';
import {
  convertToInline,
  createPreview,
  createInlinePreview,
  previewViewportWidth,
  DEFAULT_RENDER_WIDTH
} from '../engine/css-converter';
import {
  getTemplateCSS,
  getWebOverridesCSS,
  downloadTemplateCSS
} from './modules/template-manager.js';
import { removeWhitespace } from '../engine/utils';
import { SAMPLES } from './modules/sample-manager.js';
import { saveHistory, HISTORY_LIMIT } from './modules/history-manager.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const AUTOSAVE_DELAY = 1500;
const REPLACE_WINDOW = 90 * 1000;
const TYPING_DEBOUNCE = 600;

/* --------------------------------------------------------------------------
   초기화
   -------------------------------------------------------------------------- */

initTheme();
initTabs();
initDropdowns();
initResizer();
initWarnings();
initCodeView();
guardWindowDrops();

const htmlEditor = createEditor($('htmlEditor'), { meta: $('htmlMeta') });
const cssEditor = createEditor($('cssEditor'), { meta: $('cssMeta') });

const convertBtn = $('convertBtn');
const paneRight = $('paneRight');
const useBuiltInCSS = $('useBuiltInCSS');
const autoConvert = $('autoConvert');
const renderWidthInput = $('renderWidth');
const profileToggle = $('profileToggle');

// 예전 버전이 남긴 입력 자동 복원 값 — 이제 항상 빈 화면으로 시작한다
store.remove('html-input-content');

/* --- 설정 복원 (입력과 무관한 값만 기억한다) --- */

const OPTION_KEYS = {
  autoConvert: 'auto-convert',
  removeWhitespace: 'remove-whitespace',
  bodyOnly: 'body-only',
  wrapBody: 'wrap-body',
  newTabLinks: 'new-tab-links',
  mailSafeLayout: 'mail-safe-layout',
  useBuiltInCSS: 'use-builtin-css'
};

for (const [id, key] of Object.entries(OPTION_KEYS)) {
  const input = $(id);
  const saved = store.get(key);
  if (saved === 'true' || saved === 'false') input.checked = saved === 'true';
  input.addEventListener('change', () => {
    store.set(key, input.checked);
    onSettingChange();
  });
}

const optionsPanel = initOptionsPanel();

function clampWidth(value) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return DEFAULT_RENDER_WIDTH;
  return Math.min(1600, Math.max(320, number));
}

renderWidthInput.value = clampWidth(store.get('render-width') || DEFAULT_RENDER_WIDTH);
renderWidthInput.addEventListener('change', () => {
  renderWidthInput.value = clampWidth(renderWidthInput.value);
  store.set('render-width', renderWidthInput.value);
  onSettingChange();
});

function getProfile() {
  return profileToggle.dataset.value === 'web' ? 'web' : 'email';
}

function applyProfile(profile) {
  const value = profile === 'web' ? 'web' : 'email';
  profileToggle.dataset.value = value;
  profileToggle.querySelectorAll('.profile-btn').forEach((btn) => {
    const active = btn.dataset.profile === value;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  store.set('output-profile', value);
}
applyProfile(store.get('output-profile'));

profileToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.profile-btn');
  if (!btn || btn.dataset.profile === getProfile()) return;
  applyProfile(btn.dataset.profile);
  onSettingChange();
});

// 사용자 CSS 는 여러 메일에 걸쳐 쓰는 스타일시트라 계속 기억한다
cssEditor.setValue(store.get('css-input-content') || '');
updateCssBadge();

/* --------------------------------------------------------------------------
   상태
   -------------------------------------------------------------------------- */

const state = {
  result: '', // 마지막 변환 결과
  convertedKey: '', // 그 결과를 만든 입력+설정
  busy: false,
  queued: false,
  dirty: false, // 사용자가 입력을 바꿨는가 (샘플·이력에서 불러온 직후는 false)
  autosaveId: null, // 직전 자동 저장 항목 (타이핑 중간 상태를 교체하기 위해)
  autosaveAt: 0,
  notifiedLimit: false
};

function readInput() {
  return {
    htmlInput: htmlEditor.value,
    cssInput: cssEditor.value,
    useBuiltInCSS: useBuiltInCSS.checked
  };
}

function currentKey() {
  return JSON.stringify([
    htmlEditor.value,
    cssEditor.value,
    useBuiltInCSS.checked,
    getProfile(),
    clampWidth(renderWidthInput.value),
    $('removeWhitespace').checked,
    $('bodyOnly').checked,
    $('wrapBody').checked,
    $('newTabLinks').checked,
    $('mailSafeLayout').checked
  ]);
}

function updateStale() {
  const stale = !!state.result && !state.busy && currentKey() !== state.convertedKey;
  $('staleFlag').hidden = !stale;
  convertBtn.classList.toggle('attention', stale);
}

/* --------------------------------------------------------------------------
   변환
   -------------------------------------------------------------------------- */

let busyTimer = 0;
let doneTimer = 0;

function setBusy(busy) {
  clearTimeout(busyTimer);
  if (busy) {
    // 금방 끝나는 변환은 로딩 표시를 띄우지 않는다
    busyTimer = setTimeout(() => {
      clearTimeout(doneTimer);
      convertBtn.dataset.state = 'busy';
      convertBtn.setAttribute('aria-busy', 'true');
      paneRight.classList.add('is-busy');
      $('convertProgress').classList.add('active');
    }, 150);
  } else {
    if (convertBtn.dataset.state === 'busy') delete convertBtn.dataset.state;
    convertBtn.removeAttribute('aria-busy');
    paneRight.classList.remove('is-busy');
    $('convertProgress').classList.remove('active');
  }
}

function showDone() {
  clearTimeout(doneTimer);
  convertBtn.dataset.state = 'done';
  doneTimer = setTimeout(() => {
    if (convertBtn.dataset.state === 'done') delete convertBtn.dataset.state;
  }, 900);
}

function clearResult() {
  state.result = '';
  state.convertedKey = '';
  displayCode('');
  renderWarnings([]);
  updateGauge(0);
  $('statsLabel').textContent = '';
  $('emptyState').classList.remove('gone');
  $('zoomBadge').hidden = true;
  $('copyCodeBtn').disabled = true;
  $('downloadCodeBtn').disabled = true;
  updateStale();
}

async function convert({ manual = false } = {}) {
  const html = htmlEditor.value;

  if (!html.trim()) {
    if (manual) {
      const editor = $('htmlEditor');
      editor.classList.remove('input-error');
      void editor.offsetWidth;
      editor.classList.add('input-error');
      switchTab('input', 'panel-html');
      htmlEditor.focus();
      showToast('HTML을 입력하세요', 'error');
    } else if (state.result) {
      clearResult();
    }
    return;
  }

  // 변환은 한 번에 하나만. 도중에 들어온 요청은 끝난 뒤 최신 입력으로 한 번만 다시 돈다
  if (state.busy) {
    state.queued = true;
    return;
  }

  state.busy = true;
  setBusy(true);
  const key = currentKey();
  let ok = false;

  try {
    const userCSS = cssEditor.value;
    const renderWidth = clampWidth(renderWidthInput.value);
    const profile = getProfile();
    const bodyOnly = $('bodyOnly').checked;

    // CSS 결합 (웹 프로파일은 제목 크기 오버라이드를 템플릿 뒤에 덧붙임)
    const webOverrides = profile === 'web' ? '\n' + getWebOverridesCSS() : '';
    const finalCSS = useBuiltInCSS.checked ? getTemplateCSS() + webOverrides + '\n' + userCSS : userCSS;

    const conversion = await convertToInline(html, finalCSS, {
      bodyOnly,
      profile,
      renderWidth,
      wrapBody: $('wrapBody').checked,
      mailSafeLayout: $('mailSafeLayout').checked,
      newTabLinks: $('newTabLinks').checked
    });

    let result = conversion.html;
    if ($('removeWhitespace').checked) result = removeWhitespace(result);

    // 미리보기 두 가지 (변환과 동일한 폭으로 렌더)
    const viewport = previewViewportWidth(renderWidth);
    updatePreview('previewFrame', createPreview(html, finalCSS, renderWidth), viewport);
    updatePreview('inlinePreviewFrame', createInlinePreview(result, renderWidth, { hasWrapper: !bodyOnly }), viewport);

    displayCode(result);
    renderWarnings(conversion.warnings);

    const bytes = new Blob([result]).size;
    updateGauge(bytes);
    const stats = conversion.stats || {};
    $('statsLabel').textContent = [
      Number.isFinite(stats.elements) ? `요소 ${stats.elements.toLocaleString()}개` : '',
      profile === 'web' ? '웹' : '이메일'
    ]
      .filter(Boolean)
      .join(' · ');

    state.result = result;
    state.convertedKey = key;
    $('emptyState').classList.add('gone');
    $('copyCodeBtn').disabled = false;
    $('downloadCodeBtn').disabled = false;
    updateZoomBadge();

    paneRight.classList.remove('flash');
    void paneRight.offsetWidth;
    paneRight.classList.add('flash');
    ok = true;
  } catch (error) {
    console.error(error);
    showToast(`변환하지 못했습니다: ${error.message}`, 'error', 4000);
  } finally {
    state.busy = false;
    setBusy(false);
    if (ok && manual) showDone();
    updateStale();
  }

  if (ok) scheduleAutosave();

  if (state.queued) {
    state.queued = false;
    convert();
  }
}

let autoTimer = 0;
function scheduleConvert(delay) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => convert(), delay);
}

function onSettingChange() {
  optionsPanel.renderSummary();
  updateStale();
  if (autoConvert.checked && htmlEditor.value.trim()) scheduleConvert(120);
}

/* --------------------------------------------------------------------------
   이력 자동 저장
   -------------------------------------------------------------------------- */

let autosaveTimer = 0;

async function persistHistory() {
  clearTimeout(autosaveTimer);
  if (!state.dirty || !htmlEditor.value.trim()) return;

  const now = Date.now();
  // 타이핑 중간 상태가 쌓이지 않게, 방금 저장한 항목이 있으면 그 항목을 교체한다
  const replaceId = state.autosaveId && now - state.autosaveAt < REPLACE_WINDOW ? state.autosaveId : null;
  const outcome = await saveHistory(readInput(), { replaceId });
  state.dirty = false;

  if (outcome.tooLarge) {
    showToast('HTML이 너무 커서 이력에 저장하지 않았습니다', 'info', 4000);
    return;
  }
  if (outcome.skipped) return;
  if (outcome.cssDropped) showToast('CSS가 너무 커서 이력에는 HTML만 저장했습니다', 'info', 4000);
  if (outcome.pruned && !state.notifiedLimit) {
    state.notifiedLimit = true;
    showToast(`이력은 ${HISTORY_LIMIT}건까지 보관하며 오래된 것부터 정리됩니다`, 'info', 4000);
  }

  state.autosaveId = outcome.id;
  state.autosaveAt = now;
  historyDrawer.refreshCount();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (state.dirty) autosaveTimer = setTimeout(persistHistory, AUTOSAVE_DELAY);
}

// 입력을 통째로 바꾸기 직전에, 지금 입력이 이력에 남도록 한다
async function beforeReplace() {
  await persistHistory();
  state.autosaveId = null; // 이후 저장은 새 항목으로
}

/* --------------------------------------------------------------------------
   입력 이벤트
   -------------------------------------------------------------------------- */

let pasted = false;

function onUserInput() {
  state.dirty = true;
  clearTimeout(autosaveTimer);
  updateStale();
  if (autoConvert.checked) {
    scheduleConvert(pasted ? 60 : TYPING_DEBOUNCE);
  }
  pasted = false;
}

htmlEditor.textarea.addEventListener('paste', () => {
  pasted = true;
  state.autosaveId = null; // 붙여넣기는 다른 입력으로 본다
});
htmlEditor.textarea.addEventListener('input', () => {
  $('htmlEditor').classList.remove('input-error');
  onUserInput();
});

let cssSaveTimer = 0;
function rememberCSS() {
  clearTimeout(cssSaveTimer);
  cssSaveTimer = setTimeout(() => store.set('css-input-content', cssEditor.value), 400);
}

cssEditor.textarea.addEventListener('paste', () => {
  pasted = true;
});
cssEditor.textarea.addEventListener('input', () => {
  updateCssBadge();
  rememberCSS();
  onUserInput();
});
useBuiltInCSS.addEventListener('change', () => {
  updateCssBadge();
  state.dirty = true;
});

convertBtn.addEventListener('click', () => {
  clearTimeout(autoTimer);
  convert({ manual: true });
});

/* --- 프로그램이 입력을 바꾸는 경로 (샘플, 파일, 이력, 비우기) --- */

async function replaceHTML(value, { dirty }) {
  await beforeReplace();
  htmlEditor.setValue(value);
  $('htmlEditor').classList.remove('input-error');
  state.dirty = dirty;
  switchTab('input', 'panel-html');
  if (value.trim()) convert();
  else clearResult();
}

function replaceCSS(value) {
  cssEditor.setValue(value);
  store.set('css-input-content', value);
  updateCssBadge();
}

// 샘플
for (const sample of SAMPLES) {
  const btn = document.createElement('button');
  btn.setAttribute('role', 'menuitem');
  btn.textContent = sample.label;
  btn.addEventListener('click', () => replaceHTML(sample.html, { dirty: false }));
  $('sampleMenu').appendChild(btn);
}

// 비우기
$('clearHtmlBtn').addEventListener('click', async () => {
  if (!htmlEditor.value) return htmlEditor.focus();
  await replaceHTML('', { dirty: false });
  htmlEditor.focus();
});
$('clearCssBtn').addEventListener('click', () => {
  if (cssEditor.value) {
    replaceCSS('');
    state.dirty = true;
    onSettingChange();
  }
  cssEditor.focus();
});

/* --- 파일 열기: 버튼과 드롭이 같은 함수로 모인다 --- */

const FILE_ACCEPT = { exts: ['.html', '.htm', '.txt', '.css'], mimes: ['text/*'] };
const isCSSFile = (file) => file.name.toLowerCase().endsWith('.css') || file.type === 'text/css';

async function openFiles(files, target) {
  const accepted = files.filter((file) => matchesFile(file, FILE_ACCEPT));
  if (!accepted.length) {
    showToast('HTML 또는 CSS 파일만 열 수 있습니다', 'error');
    return;
  }

  // HTML 하나, CSS 하나까지 받는다. 판별이 안 되는 파일은 놓은 자리의 편집기로 간다
  const picked = {};
  for (const file of accepted) {
    const kind = isCSSFile(file) ? 'css' : /\.(html?|txt)$/i.test(file.name) ? 'html' : target;
    if (!picked[kind]) picked[kind] = file;
  }
  const used = Object.values(picked);
  if (used.length < files.length) showToast(`${used.map((f) => f.name).join(', ')}만 열었습니다`, 'info');

  for (const file of used) {
    if (file.size > MAX_FILE_BYTES) {
      showToast(`${file.name}: 2MB를 넘는 파일은 열 수 없습니다`, 'error', 4000);
      return;
    }
  }

  try {
    if (picked.css) {
      const text = await picked.css.text();
      const turnedOff = useBuiltInCSS.checked;
      replaceCSS(text);
      // 가져온 파일은 완결된 스타일시트로 보고 내장 CSS 를 끈다
      useBuiltInCSS.checked = false;
      store.set(OPTION_KEYS.useBuiltInCSS, false);
      updateCssBadge();
      state.dirty = true;
      if (!picked.html) {
        switchTab('input', 'panel-css');
        onSettingChange();
        if (!autoConvert.checked && htmlEditor.value.trim()) convert();
      }
      showToast(turnedOff ? `${picked.css.name} 적용 · 내장 CSS 끔` : `${picked.css.name} 적용`);
    }
    if (picked.html) {
      const text = await picked.html.text();
      await replaceHTML(text, { dirty: true });
    }
  } catch {
    showToast('파일을 읽지 못했습니다', 'error');
  }
}

for (const [buttonId, inputId, target] of [
  ['htmlFileBtn', 'htmlFile', 'html'],
  ['cssFileBtn', 'cssFile', 'css']
]) {
  $(buttonId).addEventListener('click', () => $(inputId).click());
  $(inputId).addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ''; // 같은 파일을 연달아 열 수 있게
    if (files.length) openFiles(files, target);
  });
}
bindDropZone($('htmlEditor'), (files) => openFiles(files, 'html'));
bindDropZone($('cssEditor'), (files) => openFiles(files, 'css'));

/* --- 템플릿 CSS --- */

$('downloadTemplateBtn').addEventListener('click', () => downloadTemplateCSS());
$('copyTemplateBtn').addEventListener('click', async () => {
  const ok = await copyText(getTemplateCSS());
  showToast(ok ? '템플릿 CSS를 복사했습니다' : '복사하지 못했습니다', ok ? 'success' : 'error');
});

/* --------------------------------------------------------------------------
   결과 동작
   -------------------------------------------------------------------------- */

let copiedTimer = 0;
$('copyCodeBtn').addEventListener('click', async () => {
  if (!state.result) return;
  const ok = await copyText(state.result);
  if (!ok) return showToast('복사하지 못했습니다', 'error');
  const btn = $('copyCodeBtn');
  btn.classList.add('copied');
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1400);
  showToast('인라인 코드를 복사했습니다');
});

$('downloadCodeBtn').addEventListener('click', () => {
  if (!state.result) return;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  downloadText(state.result, `inline-${stamp}.html`, 'text/html;charset=utf-8');
});

onTabChange((group, panelId) => {
  if (group === 'output') {
    $('wrapToggle').hidden = panelId !== 'code';
    // 숨어 있던 미리보기는 보이는 순간 ResizeObserver 가 크기를 맞춘다
    requestAnimationFrame(updateZoomBadge);
  } else if (group === 'input') {
    (panelId === 'panel-css' ? cssEditor : htmlEditor).refresh();
  }
});

/* --------------------------------------------------------------------------
   이력
   -------------------------------------------------------------------------- */

const historyDrawer = initHistoryDrawer({
  async onLoad(item) {
    await beforeReplace();
    // 입력만 복원한다. 변환 옵션은 지금 화면의 설정을 그대로 쓴다
    replaceCSS(item.cssInput);
    useBuiltInCSS.checked = !!item.useBuiltInCSS;
    store.set(OPTION_KEYS.useBuiltInCSS, useBuiltInCSS.checked);
    updateCssBadge();
    await replaceHTML(item.htmlInput, { dirty: false });
  }
});

/* --------------------------------------------------------------------------
   단축키
   -------------------------------------------------------------------------- */

const shortcutsModal = $('shortcutsModal');
$('shortcutsBtn').addEventListener('click', () => shortcutsModal.showModal());
$('closeShortcutsModal').addEventListener('click', () => shortcutsModal.close());
shortcutsModal.addEventListener('click', (e) => {
  if (e.target === shortcutsModal) shortcutsModal.close();
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key === 'Enter') {
    e.preventDefault();
    convertBtn.click();
  } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const next = activeTab('input') === 'panel-html' ? 'panel-css' : 'panel-html';
    switchTab('input', next);
    (next === 'panel-css' ? cssEditor : htmlEditor).focus();
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    $('copyCodeBtn').click();
  } else if (e.key === '?' && !mod && !e.altKey) {
    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag !== 'textarea' && tag !== 'input' && !shortcutsModal.open) {
      e.preventDefault();
      shortcutsModal.showModal();
    }
  }
});

/* --- 모바일: 키보드가 올라와도 편집기가 보이는 영역 안에 들어오게 --- */
if (window.visualViewport) {
  const syncViewport = () => {
    document.documentElement.style.setProperty('--vvh', `${window.visualViewport.height}px`);
  };
  window.visualViewport.addEventListener('resize', syncViewport);
  syncViewport();
}

// 창을 닫거나 숨길 때 저장 대기 중인 입력을 놓치지 않는다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistHistory();
});

htmlEditor.focus();
