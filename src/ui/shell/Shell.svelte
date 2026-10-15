<script lang="ts">
  import { untrack } from 'svelte';
  import CenterPane from '../preview/CenterPane.svelte';
  import RightPane from '../panels/RightPane.svelte';
  import { studio } from '../state/studio.svelte';
  import AppBar from './AppBar.svelte';
  import LeftPane from './LeftPane.svelte';

  let wide = $state(false);

  // 편집이 멈춘 뒤 2.5초에 변환 검사(크기·인라인 경고)를 갱신한다. 6회 안팎의 인라인 실행이라 편집 중에는 돌리지 않는다.
  $effect(() => {
    const v = studio.version;
    if (!studio.ready || studio.project.structure.trim() === '') return;
    const t = setTimeout(() => {
      if (untrack(() => studio.version) === v) void studio.runAnalysis();
    }, 2500);
    return () => clearTimeout(t);
  });
</script>

<div class="app-root" inert={studio.draftOpen}>
  <AppBar />
  <div class="ws" class:wide={wide && studio.leftTab === 'strings'}>
    <LeftPane bind:wide />
    <CenterPane />
    <RightPane />
  </div>
</div>
