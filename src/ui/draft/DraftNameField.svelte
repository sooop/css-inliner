<script lang="ts">
  import { studio } from '../state/studio.svelte';

  /** 입력창 id 는 고정(초안 화면은 하나만 열린다) */
  let { compact = false }: { compact?: boolean } = $props();
  const placeholder = '프로젝트 이름';
</script>

<label class="dn" class:compact>
  <span class="dn-l">프로젝트 이름</span>
  <input
    id="draft-name"
    type="text"
    {placeholder}
    maxlength="80"
    autocomplete="off"
    value={studio.draftNameShown}
    oninput={(e) => (studio.draftName = e.currentTarget.value)}
    aria-describedby="draft-name-hint"
  />
  <span id="draft-name-hint" class="sr-only">비워 두면 초안의 첫 제목을 이름으로 씁니다</span>
</label>

<style>
  .dn {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .dn.compact {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    flex: 1 1 220px;
    max-width: 420px;
  }
  .dn-l {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
</style>
