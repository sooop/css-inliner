/**
 * History Manager - 변환 이력 관리 (IndexedDB)
 */
import Dexie from 'dexie';

// IndexedDB 데이터베이스 초기화
const db = new Dexie('CSSInlinerHistory');
db.version(1).stores({
  history: '++id, timestamp, htmlInput, cssInput, options'
});

/**
 * 새 이력 저장
 * @param {Object} data - { htmlInput, cssInput, options }
 */
export async function saveHistory(data) {
  try {
    const historyItem = {
      timestamp: Date.now(),
      htmlInput: data.htmlInput,
      cssInput: data.cssInput,
      options: data.options,
      preview: generatePreview(data.htmlInput)
    };

    await db.history.add(historyItem);
  } catch (error) {
    console.error('이력 저장 실패:', error);
  }
}

/**
 * 이력 목록 조회 (최신순)
 * @param {number} limit - 가져올 개수 (기본값: 50)
 */
export async function loadHistoryList(limit = 50) {
  try {
    const items = await db.history
      .orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray();
    return items;
  } catch (error) {
    console.error('이력 로드 실패:', error);
    return [];
  }
}

/**
 * 특정 이력 항목 로드
 * @param {number} id - 이력 ID
 */
export async function loadHistoryItem(id) {
  try {
    return await db.history.get(id);
  } catch (error) {
    console.error('이력 항목 로드 실패:', error);
    return null;
  }
}

/**
 * 특정 이력 항목 삭제
 * @param {number} id - 이력 ID
 */
export async function deleteHistoryItem(id) {
  try {
    await db.history.delete(id);
  } catch (error) {
    console.error('이력 삭제 실패:', error);
  }
}

/**
 * 전체 이력 삭제
 */
export async function clearHistory() {
  try {
    await db.history.clear();
  } catch (error) {
    console.error('전체 이력 삭제 실패:', error);
  }
}

/**
 * HTML 미리보기 생성 (최대 100자)
 */
function generatePreview(html) {
  const stripped = html.replace(/<[^>]*>/g, '').trim();
  return stripped.length > 100 ? stripped.substring(0, 100) + '...' : stripped;
}

/**
 * 이력 개수 조회
 */
export async function getHistoryCount() {
  try {
    return await db.history.count();
  } catch (error) {
    console.error('이력 개수 조회 실패:', error);
    return 0;
  }
}
