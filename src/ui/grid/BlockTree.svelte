<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import { ADD_KIND_LABEL, BLOCK_KIND_LABEL, type AddKind } from '../state/ops';
  import { stripTags, SUBJECT_ID } from '../state/strings';
  import ConfirmButton from '../shell/ConfirmButton.svelte';

  let addKind = $state<AddKind>('paragraph');

  const p = $derived(studio.project);
  const sel = $derived(studio.selectedBlock);
  const selKind = $derived(sel === null ? null : (studio.blocks[sel]?.kind ?? null));
  const isTable = $derived(selKind === 'table-h' || selKind === 'table-v' || selKind === 'table');

  function label(ids: string[]): string {
    const t = stripTags(p.strings[ids[0]]?.[p.baseLang] ?? '').trim();
    return t.length > 22 ? t.slice(0, 22) + '…' : t;
  }
</script>

<div class="col">
  <div>
    <h3 class="rh">블록 구조 ({studio.blocks.length})</h3>
    <ul class="list">
      <li>
        <button type="button" class="item" aria-current={studio.selectedId === SUBJECT_ID} onclick={() => studio.select(SUBJECT_ID)}>
          <span class="idc">제목</span><span class="grow"><b>{studio.isNotice ? '공지 제목' : '메일 제목'}</b> {p.subject[p.baseLang] ?? ''}</span>
        </button>
      </li>
      {#each studio.blocks as b (b.index)}
        <li>
          <button type="button" class="item" aria-current={sel === b.index} onclick={() => studio.selectBlock(b.index)}>
            <span class="idc">{b.ids[0] ?? '—'}</span>
            <span class="grow"><b>{BLOCK_KIND_LABEL[b.kind]}</b>
              {#if b.kind === 'dynamic'}({b.tableIds.join(', ')}){:else}{label(b.ids)}{/if}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if studio.blocks.length === 0}<p class="hint">블록이 없습니다. [+ 초안]으로 새 프로젝트를 만들거나 아래에서 추가하세요.</p>{/if}
  </div>

  <div>
    <div class="drow" role="group" aria-label="선택한 블록 조작">
      <button type="button" class="btn sm" disabled={sel === null || sel === 0} onclick={() => studio.moveSelectedBlock(-1)}>위로</button>
      <button type="button" class="btn sm" disabled={sel === null || sel === studio.blocks.length - 1} onclick={() => studio.moveSelectedBlock(1)}>아래로</button>
      <ConfirmButton label="블록 삭제" disabled={sel === null} onconfirm={() => studio.deleteSelectedBlock()} />
    </div>
    <div class="drow" style="margin-top:8px">
      <label class="sr-only" for="add-kind">추가할 블록 종류</label>
      <select id="add-kind" bind:value={addKind} style="width:auto">
        {#each Object.entries(ADD_KIND_LABEL) as [k, v]}<option value={k}>{v}</option>{/each}
      </select>
      <button type="button" class="btn sm" onclick={() => studio.addBlock(addKind)}>+ 블록 추가</button>
    </div>
    <div class="drow" style="margin-top:8px">
      <button type="button" class="btn sm" disabled={!isTable} onclick={() => studio.addRow()}>+ 표 행</button>
      <ConfirmButton label="표 행 삭제" confirmLabel="정말 삭제?" disabled={!studio.canRemoveRow()} onconfirm={() => studio.removeRow()} />
    </div>
    <p class="note" style="margin-top:10px">구조 조작은 ko/en/ja 모두에 동시에 반영됩니다. 새 블록의 en·ja 는 미번역으로 시작합니다. 블록은 선택한 블록 바로 아래에 추가됩니다.</p>
  </div>
</div>
