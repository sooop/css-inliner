/**
 * 이력 서랍 — 검색, 불러오기, 삭제, 내보내기/가져오기
 * 닫혀 있는 동안에는 목록을 그리지 않는다.
 */
import {
  listHistory,
  deleteHistoryItem,
  clearHistory,
  getHistoryCount,
  exportHistory,
  importHistory,
  HISTORY_LIMIT
} from './history-manager.js';
import { $, showToast, copyText, downloadText, bindDropZone, matchesFile } from './ui-controller.js';
import { formatBytes } from './editor.js';

const PAGE = 40;

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === now.toDateString()) return `오늘 ${time}`;
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}-`;
  return `${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

// 일치 부분을 <mark> 로 감싼 조각을 만든다 (사용자 입력은 textContent 로만 넣는다)
function appendHighlighted(parent, text, words) {
  if (!words.length) {
    parent.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    let best = -1;
    let bestWord = '';
    for (const word of words) {
      const index = lower.indexOf(word, cursor);
      if (index !== -1 && (best === -1 || index < best)) {
        best = index;
        bestWord = word;
      }
    }
    if (best === -1) break;
    if (best > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, best)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(best, best + bestWord.length);
    parent.appendChild(mark);
    cursor = best + bestWord.length;
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
}

// 제목에 일치가 없으면 원문에서 일치 주변을 잘라 보여 준다
function titleFor(item, words) {
  const preview = item.preview || '(텍스트 없음)';
  if (!words.length || words.some((word) => preview.toLowerCase().includes(word))) return preview;
  for (const source of [item.htmlInput, item.cssInput]) {
    const index = source.toLowerCase().indexOf(words[0]);
    if (index !== -1) {
      const start = Math.max(0, index - 30);
      return (start ? '…' : '') + source.slice(start, index + 90).replace(/\s+/g, ' ');
    }
  }
  return preview;
}

export function initHistoryDrawer({ onLoad }) {
  const drawer = $('historyDrawer');
  const backdrop = $('drawerBackdrop');
  const openBtn = $('openHistoryBtn');
  const list = $('historyList');
  const search = $('historySearch');
  const countBadge = $('historyCount');
  const foot = $('historyFoot');
  const confirmBar = $('historyConfirm');
  const importBox = $('historyImport');
  const importText = $('historyImportText');
  const app = $('app');

  let items = [];
  let shown = PAGE;
  let isOpen = false;
  let lastFocus = null;
  let lastCount = -1;

  async function refreshCount() {
    const count = await getHistoryCount();
    countBadge.hidden = count === 0;
    countBadge.textContent = String(count);
    if (lastCount !== -1 && count > lastCount) {
      countBadge.classList.remove('bump');
      void countBadge.offsetWidth;
      countBadge.classList.add('bump');
    }
    lastCount = count;
    return count;
  }

  function render() {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = words.length
      ? items.filter((item) => {
          const haystack = `${item.htmlInput}\n${item.cssInput}`.toLowerCase();
          return words.every((word) => haystack.includes(word));
        })
      : items;

    list.textContent = '';
    if (!matched.length) {
      const empty = document.createElement('div');
      empty.className = 'drawer-empty';
      empty.textContent = items.length ? '일치하는 이력이 없습니다' : '이력이 없습니다';
      list.appendChild(empty);
      return;
    }

    matched.slice(0, shown).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.style.setProperty('--i', String(index));

      const title = document.createElement('div');
      title.className = 'history-item-title';
      appendHighlighted(title, titleFor(item, words), words);

      const meta = document.createElement('div');
      meta.className = 'history-item-meta';
      const cssLines = item.cssInput.trim() ? item.cssInput.trim().split('\n').length : 0;
      const cssLabel = [item.useBuiltInCSS ? '내장 CSS' : '', cssLines ? `CSS ${cssLines}줄` : '']
        .filter(Boolean)
        .join(' + ');
      meta.textContent = [
        formatTime(item.timestamp),
        `${item.htmlInput.split('\n').length}줄`,
        formatBytes(new Blob([item.htmlInput]).size),
        cssLabel
      ]
        .filter(Boolean)
        .join(' · ');

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';
      const remove = document.createElement('button');
      remove.className = 'icon-btn sm';
      remove.setAttribute('aria-label', '삭제');
      remove.title = '삭제';
      remove.innerHTML =
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
      remove.addEventListener('click', async (e) => {
        e.stopPropagation();
        row.classList.add('removing');
        await deleteHistoryItem(item.id);
        items = items.filter((other) => other.id !== item.id);
        refreshCount();
        setTimeout(render, 180);
      });
      actions.appendChild(remove);

      const load = () => {
        close();
        onLoad(item);
      };
      row.addEventListener('click', load);
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          load();
        }
      });

      row.append(title, meta, actions);
      list.appendChild(row);
    });

    if (matched.length > shown) {
      const more = document.createElement('button');
      more.className = 'btn btn-sm history-more';
      more.textContent = `더 보기 (${matched.length - shown})`;
      more.addEventListener('click', () => {
        shown += PAGE;
        render();
      });
      list.appendChild(more);
    }
  }

  async function reload() {
    items = await listHistory();
    shown = PAGE;
    render();
    refreshCount();
  }

  function showFoot(which) {
    foot.hidden = which !== 'main';
    confirmBar.hidden = which !== 'confirm';
    importBox.hidden = which !== 'import';
  }

  async function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    search.value = '';
    showFoot('main');
    drawer.hidden = false;
    backdrop.hidden = false;
    app.inert = true;
    openBtn.setAttribute('aria-expanded', 'true');
    // 다음 프레임에 클래스를 붙여 슬라이드 인
    requestAnimationFrame(() => {
      drawer.classList.add('open');
      backdrop.classList.add('open');
    });
    await reload();
    search.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    app.inert = false;
    openBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (isOpen) return;
      drawer.hidden = true;
      backdrop.hidden = true;
      list.textContent = '';
      items = [];
    }, 260);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  openBtn.addEventListener('click', () => (isOpen ? close() : open()));
  $('closeHistoryBtn').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (!foot.hidden) close();
    else showFoot('main');
  });

  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      shown = PAGE;
      render();
    }, 120);
  });

  /* 전체 삭제 — 화면 안에서 한 번 더 확인 */
  $('clearHistoryBtn').addEventListener('click', () => {
    if (!items.length) return;
    showFoot('confirm');
    $('clearHistoryCancel').focus();
  });
  $('clearHistoryCancel').addEventListener('click', () => showFoot('main'));
  $('clearHistoryConfirm').addEventListener('click', async () => {
    await clearHistory();
    showFoot('main');
    await reload();
    showToast('이력을 모두 삭제했습니다');
  });

  /* 내보내기 */
  const exportJSON = async () => JSON.stringify(await exportHistory(), null, 2);
  $('historyExportBtn').addEventListener('click', async () => {
    if (!items.length) return showToast('내보낼 이력이 없습니다', 'error');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(await exportJSON(), `css-inliner-history-${stamp}.json`, 'application/json');
  });
  $('historyCopyJsonBtn').addEventListener('click', async () => {
    if (!items.length) return showToast('내보낼 이력이 없습니다', 'error');
    const ok = await copyText(await exportJSON());
    showToast(ok ? 'JSON을 복사했습니다' : '복사하지 못했습니다', ok ? 'success' : 'error');
  });

  /* 가져오기 — 파일 선택, 드롭, 붙여넣기가 같은 함수로 모인다 */
  async function runImport(text) {
    try {
      const summary = await importHistory(text);
      showToast(`추가 ${summary.added}, 중복 ${summary.duplicate}, 제외 ${summary.rejected}`, 'info', 4000);
      const count = await getHistoryCount();
      if (summary.added && count >= HISTORY_LIMIT) {
        showToast(`이력은 ${HISTORY_LIMIT}건까지 보관하며 오래된 것부터 정리됩니다`, 'info', 4000);
      }
      importText.value = '';
      showFoot('main');
      await reload();
    } catch {
      showToast('가져올 수 없는 형식입니다. 내보낸 JSON 파일이 필요합니다', 'error', 4000);
    }
  }

  async function importFiles(files) {
    const file = files.find((f) => matchesFile(f, { exts: ['.json'], mimes: ['application/json', 'text/*'] }));
    if (!file) return showToast('JSON 파일만 가져올 수 있습니다', 'error');
    if (files.length > 1) showToast('첫 파일만 가져왔습니다', 'info');
    try {
      await runImport(await file.text());
    } catch {
      showToast('파일을 읽지 못했습니다', 'error');
    }
  }

  $('historyImportBtn').addEventListener('click', () => {
    showFoot('import');
    importText.focus();
  });
  $('historyImportCancel').addEventListener('click', () => showFoot('main'));
  $('historyImportApply').addEventListener('click', () => {
    if (!importText.value.trim()) return importText.focus();
    runImport(importText.value);
  });
  $('historyImportFileBtn').addEventListener('click', () => $('historyImportFile').click());
  $('historyImportFile').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length) importFiles(files);
  });
  bindDropZone(importBox, importFiles);
  bindDropZone(list, (files) => {
    showFoot('import');
    importFiles(files);
  });

  // 다른 탭에서 바뀐 내용을 반영한다
  window.addEventListener('focus', () => {
    if (isOpen) reload();
    else refreshCount();
  });

  refreshCount();
  return { open, close, refreshCount, isOpen: () => isOpen };
}
