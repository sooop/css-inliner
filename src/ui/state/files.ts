/** 브라우저 파일 저장·클립보드 보조(DOM 사용). 단위 테스트 대상이 아니라 얇게 유지한다. */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 클립보드 복사. 권한이 막히면 임시 textarea + execCommand 로 한 번 더 시도. 성공 여부 반환. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 파일명에 쓸 수 없는 문자를 `_` 로 */
export function safeFilename(s: string): string {
  return s.replace(/[\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
}
