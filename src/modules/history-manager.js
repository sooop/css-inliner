/**
 * History Manager - 변환 이력 (IndexedDB, 쓸 수 없으면 메모리)
 *
 * 이력은 입력(HTML, 사용자 CSS, 내장 CSS 사용 여부)만 담는다. 변환 옵션은 설정이므로
 * 항목에 넣지 않는다 — 불러오면 입력만 복원하고 현재 화면의 옵션으로 다시 변환한다.
 * 같은 입력은 해시로 묶어 한 건만 남긴다.
 */
import Dexie from 'dexie';
import { getTemplateCSS, getWebOverridesCSS } from './template-manager.js';

export const HISTORY_LIMIT = 300;
export const MAX_FIELD_CHARS = 200000;

const EXPORT_APP = 'css-inline-converter';

/* --- 입력 정규화와 해시 --- */

function normalizeText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').trim();
}

// cyrb53 — 동기 해시. crypto.subtle 은 file:// 등에서 막힐 수 있어 쓰지 않는다
function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function inputHash({ htmlInput, cssInput, useBuiltInCSS }) {
  return hashString(
    `${useBuiltInCSS ? 1 : 0}\u0000${normalizeText(htmlInput)}\u0000${normalizeText(cssInput)}`
  );
}

function generatePreview(html) {
  const text = String(html)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 120 ? text.slice(0, 120) + '…' : text;
}

function makeRecord(input, timestamp = Date.now()) {
  const record = {
    timestamp,
    htmlInput: String(input.htmlInput ?? ''),
    cssInput: String(input.cssInput ?? ''),
    useBuiltInCSS: !!input.useBuiltInCSS
  };
  record.hash = inputHash(record);
  record.preview = generatePreview(record.htmlInput);
  return record;
}

/**
 * 예전 버전은 "내장 CSS + 사용자 CSS"를 합쳐 저장했다. 그대로 불러오면 내장 CSS 가
 * 사용자 칸에 들어가 두 번 적용되므로, 앞부분이 현재 템플릿과 같으면 떼어 낸다.
 * 템플릿이 그 사이 바뀌어 떼어 낼 수 없으면 합쳐진 CSS 를 그대로 두고 내장 CSS 를 끈다(결과 동일).
 */
function migrateLegacy(old) {
  const options = old.options || {};
  let css = String(old.cssInput ?? '');
  let useBuiltInCSS = !!options.useBuiltInCSS;

  if (useBuiltInCSS) {
    const template = getTemplateCSS();
    if (css.startsWith(template)) {
      css = css.slice(template.length);
      const overrides = '\n' + getWebOverridesCSS();
      if (css.startsWith(overrides)) css = css.slice(overrides.length);
      if (css.startsWith('\n')) css = css.slice(1);
    } else {
      useBuiltInCSS = false;
    }
  }

  return makeRecord({ htmlInput: old.htmlInput, cssInput: css, useBuiltInCSS }, old.timestamp || Date.now());
}

/* --- 저장소 --- */

const db = new Dexie('CSSInlinerHistory');
db.version(1).stores({
  history: '++id, timestamp, htmlInput, cssInput, options'
});
db.version(2)
  .stores({ history: '++id, timestamp, hash' })
  .upgrade(async (tx) => {
    const table = tx.table('history');
    const all = await table.toArray();
    all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const seen = new Set();
    const next = [];
    for (const old of all) {
      if (!old || typeof old.htmlInput !== 'string') continue;
      const record = migrateLegacy(old);
      if (seen.has(record.hash)) continue;
      seen.add(record.hash);
      next.push(record);
    }
    await table.clear();
    if (next.length) await table.bulkAdd(next.slice(0, HISTORY_LIMIT));
  });

// IndexedDB 를 쓸 수 없으면 조용히 메모리로 내려간다
let memory = null;
let memorySeq = 0;

async function withStore(dbFn, memFn) {
  if (!memory) {
    try {
      return await dbFn(db.history);
    } catch (error) {
      console.warn('IndexedDB 를 쓸 수 없어 메모리에 보관합니다:', error);
      memory = [];
    }
  }
  return memFn(memory);
}

async function prune() {
  return withStore(
    async (table) => {
      const count = await table.count();
      if (count <= HISTORY_LIMIT) return 0;
      const keys = await table.orderBy('timestamp').limit(count - HISTORY_LIMIT).primaryKeys();
      await table.bulkDelete(keys);
      return keys.length;
    },
    (list) => {
      if (list.length <= HISTORY_LIMIT) return 0;
      list.sort((a, b) => b.timestamp - a.timestamp);
      return list.splice(HISTORY_LIMIT).length;
    }
  );
}

/**
 * 이력 저장 (같은 입력이면 시각만 갱신)
 * @param {{htmlInput: string, cssInput: string, useBuiltInCSS: boolean}} input
 * @param {{replaceId?: number|null}} [opts] 직전 자동 저장 항목을 새로 더하지 않고 교체할 때
 * @returns {Promise<{id: number|null, skipped: boolean, tooLarge?: boolean, cssDropped: boolean, pruned: number}>}
 */
export async function saveHistory(input, { replaceId = null } = {}) {
  const outcome = { id: null, skipped: false, cssDropped: false, pruned: 0 };
  if (!normalizeText(input.htmlInput)) return { ...outcome, skipped: true };
  if (input.htmlInput.length > MAX_FIELD_CHARS) return { ...outcome, skipped: true, tooLarge: true };

  let cssInput = input.cssInput || '';
  if (cssInput.length > MAX_FIELD_CHARS) {
    cssInput = '';
    outcome.cssDropped = true;
  }
  const record = makeRecord({ ...input, cssInput });

  outcome.id = await withStore(
    async (table) => {
      const existing = await table.where('hash').equals(record.hash).first();
      if (existing) {
        await table.update(existing.id, { timestamp: record.timestamp });
        if (replaceId && replaceId !== existing.id) await table.delete(replaceId);
        return existing.id;
      }
      if (replaceId && (await table.get(replaceId))) {
        await table.put({ ...record, id: replaceId });
        return replaceId;
      }
      return table.add(record);
    },
    (list) => {
      const existing = list.find((item) => item.hash === record.hash);
      if (existing) {
        existing.timestamp = record.timestamp;
        if (replaceId && replaceId !== existing.id) {
          const index = list.findIndex((item) => item.id === replaceId);
          if (index >= 0) list.splice(index, 1);
        }
        return existing.id;
      }
      const target = replaceId ? list.find((item) => item.id === replaceId) : null;
      if (target) {
        Object.assign(target, record);
        return target.id;
      }
      record.id = ++memorySeq;
      list.push(record);
      return record.id;
    }
  );

  outcome.pruned = await prune();
  return outcome;
}

/** 전체 이력 (최신순) */
export async function listHistory() {
  return withStore(
    (table) => table.orderBy('timestamp').reverse().toArray(),
    (list) => [...list].sort((a, b) => b.timestamp - a.timestamp)
  );
}

export async function deleteHistoryItem(id) {
  return withStore(
    (table) => table.delete(id),
    (list) => {
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list.splice(index, 1);
    }
  );
}

export async function clearHistory() {
  return withStore(
    (table) => table.clear(),
    (list) => {
      list.length = 0;
    }
  );
}

export async function getHistoryCount() {
  return withStore(
    (table) => table.count(),
    (list) => list.length
  );
}

/** 내보내기용 객체 */
export async function exportHistory() {
  const items = await listHistory();
  return {
    app: EXPORT_APP,
    version: 1,
    exportedAt: new Date().toISOString(),
    history: items.map(({ timestamp, htmlInput, cssInput, useBuiltInCSS }) => ({
      timestamp,
      htmlInput,
      cssInput,
      useBuiltInCSS
    }))
  };
}

/**
 * 가져오기 — 병합하고 같은 입력은 건너뛴다
 * @param {string} text 내보낸 JSON 문자열
 * @returns {Promise<{added: number, duplicate: number, rejected: number}>}
 */
export async function importHistory(text) {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : data && Array.isArray(data.history) ? data.history : null;
  if (!rows) throw new Error('format');

  const existing = new Set((await listHistory()).map((item) => item.hash));
  const summary = { added: 0, duplicate: 0, rejected: 0 };
  const fresh = [];

  for (const row of rows) {
    const valid =
      row &&
      typeof row.htmlInput === 'string' &&
      normalizeText(row.htmlInput) &&
      row.htmlInput.length <= MAX_FIELD_CHARS &&
      (row.cssInput === undefined || typeof row.cssInput === 'string') &&
      (row.cssInput || '').length <= MAX_FIELD_CHARS;
    if (!valid) {
      summary.rejected++;
      continue;
    }
    // 예전 형식(options 포함)은 같은 규칙으로 옮긴다
    const timestamp = Number.isFinite(row.timestamp) ? row.timestamp : Date.now();
    const record = row.options
      ? migrateLegacy({ ...row, timestamp })
      : makeRecord({ htmlInput: row.htmlInput, cssInput: row.cssInput || '', useBuiltInCSS: !!row.useBuiltInCSS }, timestamp);
    if (existing.has(record.hash)) {
      summary.duplicate++;
      continue;
    }
    existing.add(record.hash);
    fresh.push(record);
  }

  if (fresh.length) {
    await withStore(
      (table) => table.bulkAdd(fresh),
      (list) => {
        for (const record of fresh) list.push({ ...record, id: ++memorySeq });
      }
    );
    summary.added = fresh.length;
    await prune();
  }
  return summary;
}
