/**
 * 줄번호가 붙은 텍스트 편집기 (textarea + 줄번호 칸)
 * 줄번호는 줄 요소를 만들지 않고 텍스트 한 덩어리로 그린다.
 */

function countLines(text) {
  let count = 1;
  let index = -1;
  while ((index = text.indexOf('\n', index + 1)) !== -1) count++;
  return count;
}

export function lineNumbers(count) {
  let out = '';
  for (let i = 1; i <= count; i++) out += i + '\n';
  return out;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

export function createEditor(root, { meta } = {}) {
  const textarea = root.querySelector('.editor-input');
  const gutter = root.querySelector('.editor-gutter');
  let renderedLines = 0;

  const refresh = () => {
    const value = textarea.value;
    const lines = countLines(value);
    if (lines !== renderedLines) {
      renderedLines = lines;
      // 가로 스크롤바 높이만큼 여유 줄을 하나 더 둔다
      gutter.textContent = lineNumbers(lines) + '\n';
    }
    if (meta) {
      meta.textContent = value ? `${lines.toLocaleString()}줄 · ${formatBytes(new Blob([value]).size)}` : '';
    }
    gutter.scrollTop = textarea.scrollTop;
  };

  textarea.addEventListener('input', refresh);
  textarea.addEventListener('scroll', () => {
    gutter.scrollTop = textarea.scrollTop;
  }, { passive: true });

  refresh();

  return {
    textarea,
    get value() {
      return textarea.value;
    },
    /** 프로그램이 값을 바꿀 때 (input 이벤트를 내지 않는다) */
    setValue(value) {
      textarea.value = value;
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
      refresh();
    },
    focus() {
      textarea.focus({ preventScroll: true });
    },
    refresh
  };
}
