/** Gmail 은 본문이 약 102KB(102*1024 바이트)를 넘으면 잘라 "메시지 전체 보기" 뒤로 숨긴다. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * 한도 안에 들어가는 최대 행 수.
 * @param baseBytes 행을 뺀 나머지 HTML 바이트(표식 치환자 포함, 다른 동적 표 예상 행 포함 가능)
 * @param rowBytes 행 1개(`<tr>…</tr>` 값이 채워진 상태 기준)의 바이트
 * 기본 HTML 만으로 한도를 넘으면 0. rowBytes 가 0 이하면 제한 없음(Infinity).
 */
export function maxRowsWithin(baseBytes: number, rowBytes: number, limit: number = GMAIL_CLIP_BYTES): number {
  if (rowBytes <= 0) return Infinity;
  if (baseBytes >= limit) return 0;
  return Math.floor((limit - baseBytes) / rowBytes);
}
