import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../store';
import { makeProject } from './fixture';

describe('ProjectStore (Dexie / fake-indexeddb)', () => {
  let store: ProjectStore;
  let n = 0;
  beforeEach(() => {
    store = new ProjectStore(`test-db-${++n}`);
  });
  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  it('저장·조회·삭제', async () => {
    const p = makeProject();
    const saved = await store.save(p);
    expect(saved.id).toBe(p.id);
    expect(await store.get(p.id)).toEqual(saved);
    expect(await store.count()).toBe(1);
    await store.delete(p.id);
    expect(await store.get(p.id)).toBeUndefined();
  });

  it('save 는 updatedAt 을 갱신하고(touch:false 면 유지), 같은 id 는 덮어쓴다', async () => {
    const p = makeProject({ updatedAt: 1 });
    const a = await store.save(p);
    expect(a.updatedAt).toBeGreaterThan(1);
    const b = await store.save({ ...a, name: '바뀐 이름' }, { touch: false });
    expect(b.updatedAt).toBe(a.updatedAt);
    expect(await store.count()).toBe(1);
    expect((await store.get(p.id))!.name).toBe('바뀐 이름');
  });

  it('목록은 updatedAt 내림차순', async () => {
    await store.save(makeProject({ id: 'a', name: 'A', updatedAt: 100 }), { touch: false });
    await store.save(makeProject({ id: 'b', name: 'B', updatedAt: 300 }), { touch: false });
    await store.save(makeProject({ id: 'c', name: 'C', updatedAt: 200 }), { touch: false });
    expect((await store.list()).map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(await store.listSummaries()).toEqual([
      expect.objectContaining({ id: 'b', name: 'B', updatedAt: 300 }),
      expect.objectContaining({ id: 'c' }),
      expect.objectContaining({ id: 'a' }),
    ]);
    // 수정하면 맨 앞으로
    await store.save(makeProject({ id: 'a', name: 'A' }));
    expect((await store.list())[0].id).toBe('a');
  });

  it('구조화 복제 후에도 프로젝트 내용이 그대로(동적 표 포함)', async () => {
    const p = makeProject();
    await store.save(p, { touch: false });
    expect(await store.get(p.id)).toEqual(p);
  });
});
