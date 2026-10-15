/** 초안 점검(경고·오류) — 입력이 멈춘 뒤(250ms) 갱신한다. 컴포넌트 초기화 중에 호출해야 한다($effect 사용). */
import { untrack } from 'svelte';
import { analyzeDraft, type DraftAnalysis } from './draft';
import { studio } from './studio.svelte';

export function useDraftCheck(): { readonly value: DraftAnalysis } {
  let check = $state.raw<DraftAnalysis>(untrack(() => analyzeDraft(studio.draftText, studio.draftKind)));
  $effect(() => {
    const t = studio.draftText;
    const k = studio.draftKind;
    const h = setTimeout(() => (check = analyzeDraft(t, k)), 250);
    return () => clearTimeout(h);
  });
  return {
    get value() {
      return check;
    },
  };
}
