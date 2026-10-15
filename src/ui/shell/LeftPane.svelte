<script lang="ts">
  import BlockTree from '../grid/BlockTree.svelte';
  import ProjectList from '../grid/ProjectList.svelte';
  import SnippetList from '../grid/SnippetList.svelte';
  import StringGrid from '../grid/StringGrid.svelte';
  import { studio, type LeftTab } from '../state/studio.svelte';

  let { wide = $bindable(false) }: { wide?: boolean } = $props();

  const tabs: [LeftTab, string][] = [
    ['blocks', '블록'],
    ['strings', '문자열'],
    ['snippets', '스니펫'],
    ['projects', '프로젝트'],
  ];

  function onkey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex(([k]) => k === studio.leftTab);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
    studio.leftTab = n;
    document.getElementById(`ltab-${n}`)?.focus();
  }
</script>

<section class="pane" aria-label="좌측 패널">
  <div class="pane-head tabs" role="tablist" aria-label="좌측 패널 종류">
    {#each tabs as [k, label]}
      <button
        type="button"
        class="tab"
        role="tab"
        id="ltab-{k}"
        aria-selected={studio.leftTab === k}
        aria-controls="lpanel"
        tabindex={studio.leftTab === k ? 0 : -1}
        onclick={() => (studio.leftTab = k)}
        onkeydown={onkey}>{label}</button
      >
    {/each}
  </div>
  <div class="scr" id="lpanel" role="tabpanel" aria-labelledby="ltab-{studio.leftTab}" tabindex="0">
    {#if studio.leftTab === 'blocks'}<BlockTree />
    {:else if studio.leftTab === 'strings'}<StringGrid bind:wide />
    {:else if studio.leftTab === 'snippets'}<SnippetList />
    {:else}<ProjectList />{/if}
  </div>
</section>
