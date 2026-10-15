<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import { placeholderUsage } from '../state/strings';
  import ConfirmButton from '../shell/ConfirmButton.svelte';

  const usage = $derived(placeholderUsage(studio.project));
</script>

<p class="note" style="margin-bottom:4px">본문·제목에서 쓴 <code>|!#-이름|</code> 은 자동으로 추가됩니다. 설명과 샘플값은 번들에 함께 들어가고, 샘플값은 미리보기의 [치환자 샘플값]에 쓰입니다.</p>
{#each studio.project.variables as v (v.name)}
  <div class="vrow">
    <div>
      <code>|!#-{v.name}|</code>
      <label class="sr-only" for="vd-{v.name}">{v.name} 설명</label>
      <input id="vd-{v.name}" type="text" placeholder="설명" value={v.description} oninput={(e) => studio.updateVariable(v.name, { description: e.currentTarget.value })} />
    </div>
    <div>
      <label class="sr-only" for="vs-{v.name}">{v.name} 샘플값</label>
      <input id="vs-{v.name}" type="text" placeholder="샘플값" value={v.sample} oninput={(e) => studio.updateVariable(v.name, { sample: e.currentTarget.value })} />
      <div class="d drow">
        {#if usage[v.name]}사용 {usage[v.name]}곳{:else}<span class="badge b-warn">미사용</span><ConfirmButton label="목록에서 제거" confirmLabel="정말 제거?" onconfirm={() => studio.removeVariable(v.name)} />{/if}
      </div>
    </div>
  </div>
{:else}
  <div class="hint">쓰인 치환자가 없습니다.</div>
{/each}
