/**
 * Milkdown 에디터 생성. 초기 문서는 JSON(load.ts)으로 직접 넣는다 — remark 파서를 거치지 않는다.
 */
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { loadTxmd, type J, type LoadOptions } from './load';
import { buildPlugins, type EditorHooks } from './plugins';
import { docToTxmd } from './serialize';

export interface EditorHandle {
  view: EditorView;
  /** 현재 문서를 .txmd 로 */
  toTxmd(): string;
  destroy(): Promise<void>;
}

export interface CreateOptions extends EditorHooks {
  root: HTMLElement;
  /** 시작 문서(JSON). 없으면 txmd 를 읽는다 */
  doc?: J;
  txmd?: string;
  load?: LoadOptions;
  ariaLabel?: string;
}

/** 문서 끝이 문단이 아니면 입력 자리를 위해 빈 문단을 하나 붙인다(직렬화에서는 무시됨) */
export function withTrailingParagraph(doc: J): J {
  const last = doc.content?.[doc.content.length - 1];
  if (last && last.type !== 'paragraph') return { ...doc, content: [...doc.content!, { type: 'paragraph' }] };
  return doc;
}

export async function createTxmdEditor(opts: CreateOptions): Promise<EditorHandle> {
  const doc = withTrailingParagraph(opts.doc ?? loadTxmd(opts.txmd ?? '', opts.load));
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, opts.root);
      ctx.set(defaultValueCtx, { type: 'json', value: doc as unknown as Record<string, never> });
      ctx.set(editorViewOptionsCtx, {
        attributes: {
          'aria-label': opts.ariaLabel ?? '초안 에디터',
          'aria-multiline': 'true',
          lang: 'ko',
          spellcheck: 'false',
          class: 'tx-pm',
        },
      });
    })
    .use(buildPlugins({ onDoc: opts.onDoc, onState: opts.onState, onKeyDown: opts.onKeyDown }))
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    view,
    toTxmd: () => docToTxmd(view.state.doc as PMNode),
    destroy: async () => {
      await editor.destroy();
    },
  };
}
