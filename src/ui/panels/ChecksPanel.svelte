<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import type { Issue } from '../../project';

  function navigable(i: Issue): boolean {
    return !!(i.blockId || i.tableId || i.code === 'untranslated');
  }
  const status = $derived(
    studio.analysis.status === 'running'
      ? '변환 검사 실행 중…'
      : studio.analysisFresh
        ? '변환 검사: 최신 (인라인 경고·Gmail 크기 포함)'
        : studio.analysis.status === 'error'
          ? `변환 검사 실패: ${studio.analysis.error}`
          : '변환 검사: 아직 반영되지 않음 (인라인 경고·Gmail 크기 제외)',
  );
</script>

<div class="drow" style="margin-bottom:8px">
  <span class="badge b-err">오류 {studio.errorCount}</span><span class="badge b-warn">경고 {studio.warningCount}</span>
  <span class="sp"></span>
  <button type="button" class="btn sm" disabled={studio.analysis.status === 'running' || studio.analysisFresh} onclick={() => studio.runAnalysis()}>변환 검사 실행</button>
</div>
<label class="drow" style="margin-bottom:6px">
  <input type="checkbox" checked={studio.ignoreTranslation} onchange={(e) => studio.setIgnoreTranslation(e.currentTarget.checked)} />
  <span>번역 경고 끄기 (미번역·오래됨)</span>
</label>
<p class="note" style="margin-bottom:8px">{status}</p>
{#if studio.issues.length === 0}
  <div class="banner ban-ok">모든 검사를 통과했습니다.</div>
{:else}
  <ul class="list">
    {#each [...studio.issues].sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1)) as i}
      <li class="chk-i {i.level === 'error' ? 'err' : 'warn'}">
        <span class="badge {i.level === 'error' ? 'b-err' : 'b-warn'}">{i.level === 'error' ? '오류' : '경고'}</span>
        <span class="m">{i.message}</span>
        {#if navigable(i)}<button type="button" class="btn sm" onclick={() => studio.goToIssue(i)}>이동</button>{/if}
      </li>
    {/each}
  </ul>
{/if}
