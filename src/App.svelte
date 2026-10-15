<script lang="ts">
  import { onMount } from 'svelte';
  import './ui/styles/app.css';
  import DraftScreen from './ui/draft/DraftScreen.svelte';
  import Shell from './ui/shell/Shell.svelte';
  import Toast from './ui/shell/Toast.svelte';
  import { studio } from './ui/state/studio.svelte';

  onMount(() => {
    void studio.init();
  });
</script>

<svelte:head><title>{studio.ready ? `${studio.project.name} · 메일 템플릿 스튜디오` : '메일 템플릿 스튜디오'}</title></svelte:head>

{#if studio.ready}
  <Shell />
  {#if studio.draftOpen}<DraftScreen />{/if}
{:else}
  <p style="padding:24px" role="status">불러오는 중…</p>
{/if}
<Toast />
