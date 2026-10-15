<script lang="ts">
  import type { DraftAnalysis } from '../state/draft';
  import { studio } from '../state/studio.svelte';

  let { check }: { check: DraftAnalysis } = $props();
  const empty = $derived(studio.draftText.trim() === '');
</script>

<div class="di" data-draft-issues>
  {#if studio.draftError}
    <p class="banner ban-err" role="alert">{studio.draftError}</p>
  {:else if check.error && !empty}
    <p class="banner ban-err" role="alert">{check.error}</p>
  {/if}
  {#if empty}
    <p class="note">초안을 입력하면 블록 수·번역 줄·해석 경고가 여기에 표시됩니다. 비어 있으면 프로젝트를 만들 수 없습니다.</p>
  {:else if !check.error}
    <p class="note" data-draft-summary>
      블록 {check.blockCount}개{#if check.langsFound.length} · 번역 줄 있음: {check.langsFound.join('·')} (초기 번역으로 들어갑니다){:else} · 번역 줄(@en/@ja) 없음 — en·ja 는 미번역으로 시작합니다{/if}
    </p>
  {/if}
  {#if check.warnings.length}
    <details class="banner ban-warn" open data-draft-warnings>
      <summary>초안 해석 경고 {check.warnings.length}건 (만들기는 막지 않습니다)</summary>
      <ul>{#each check.warnings as w}<li>{w}</li>{/each}</ul>
    </details>
  {/if}
</div>

<style>
  .di {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .di p {
    margin: 0;
  }
  ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }
</style>
