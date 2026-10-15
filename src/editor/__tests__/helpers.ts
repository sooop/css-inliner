import type { Schema } from '@milkdown/kit/prose/model';
import { createTxmdEditor, type EditorHandle } from '../create';

let handle: EditorHandle | null = null;

/** 실제 Milkdown 에디터(jsdom)를 한 번 만들어 스키마를 얻는다 */
export async function getEditor(): Promise<EditorHandle> {
  if (handle) return handle;
  const root = document.createElement('div');
  document.body.appendChild(root);
  handle = await createTxmdEditor({ root, txmd: '' });
  return handle;
}

export async function getSchema(): Promise<Schema> {
  return (await getEditor()).view.state.schema;
}
