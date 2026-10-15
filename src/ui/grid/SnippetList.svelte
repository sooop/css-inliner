<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import { SNIPPETS } from '../state/snippets';
</script>

<h3 class="rh">스니펫 라이브러리</h3>
<p class="note" style="margin-bottom:8px">삽입하면 사본이 만들어집니다. 원본을 고쳐도 이미 넣은 곳은 바뀌지 않습니다. 선택한 블록 바로 아래에 들어갑니다.</p>
<ul class="list">
  {#each SNIPPETS as s}
    <li class="item" style="cursor:default">
      <span class="grow" style="white-space:normal"><b>{s.name}</b><br /><span class="note">{s.desc}</span></span>
      <button type="button" class="btn sm" onclick={() => studio.insertSnippet(s)}>삽입</button>
    </li>
  {/each}
</ul>
