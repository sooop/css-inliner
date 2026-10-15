<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import { cellState, rowHasProblem, stripTags, textOf } from '../state/strings';

  let { wide = $bindable(false) }: { wide?: boolean } = $props();

  const p = $derived(studio.project);
  const rows = $derived(
    studio.gridProblemsOnly ? studio.stringRows.filter((r) => rowHasProblem(p, r.id, studio.stale)) : studio.stringRows,
  );

  function short(t: string): string {
    const s = stripTags(t).trim();
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }
  const stateText = { ok: '정상', miss: '미번역', stale: '번역 오래됨' } as const;
</script>

<div class="drow" style="margin-bottom:8px">
  <h3 class="rh" style="margin:0">문자열 그리드 ({rows.length})</h3>
  <span class="sp"></span>
  <label class="chk"><input type="checkbox" bind:checked={wide} /> 넓게</label>
  <div class="seg" role="group" aria-label="필터">
    <button type="button" aria-pressed={!studio.gridProblemsOnly} onclick={() => (studio.gridProblemsOnly = false)}>전체</button>
    <button type="button" aria-pressed={studio.gridProblemsOnly} onclick={() => (studio.gridProblemsOnly = true)}>문제만</button>
  </div>
</div>

{#if wide}
  <div class="tw">
    <table class="g fixed">
      <colgroup>
        <col style="width:96px" />
        {#each p.langs as l (l)}<col />{/each}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">ID</th>
          {#each p.langs as l}<th scope="col">{l}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr class="clickable" class:rowsel={studio.selectedId === r.id}>
            <td class="c1">
              <button type="button" class="cellbtn" onclick={() => studio.select(r.id, { reveal: true })} aria-label="{r.kind} {r.id} 선택">
                <span class="idc">{r.id === '__subject' ? '제목' : r.id}</span><br /><span class="note">{r.kind}</span>
              </button>
            </td>
            {#each p.langs as l}
              {@const s = cellState(p, r.id, l, studio.stale)}
              <td>
                {#if s === 'miss'}<span class="badge b-err">미번역</span>{:else if s === 'stale'}<span class="badge b-warn">오래됨</span>
                  <button type="button" class="btn sm" onclick={() => studio.ack(r.id, l)}>최신 확인</button>{/if}
                <textarea
                  rows="2"
                  lang={l}
                  aria-label="{r.id} {l}"
                  value={textOf(p, r.id, l)}
                  onfocus={() => studio.select(r.id, { openEdit: false })}
                  oninput={(e) => studio.setText(r.id, l, e.currentTarget.value)}
                ></textarea>
              </td>
            {/each}
          </tr>
        {:else}
          <tr><td colspan={p.langs.length + 1}>{studio.gridProblemsOnly ? '문제 있는 문자열이 없습니다.' : '문자열이 없습니다.'}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <ul class="list cards">
    {#each rows as r (r.id)}
      <li class="card" class:rowsel={studio.selectedId === r.id}>
        <button type="button" class="cardbtn" onclick={() => studio.select(r.id, { reveal: true })} aria-label="{r.kind} {r.id} 선택">
          <span class="chead">
            <span class="idc">{r.id === '__subject' ? '제목' : r.id}</span>
            <span class="note">{r.kind}</span>
            <span class="dots">
              {#each p.langs as l}
                {@const s = cellState(p, r.id, l, studio.stale)}
                <span class="dot d-{s}" title="{l}: {stateText[s]}"><span class="sr-only">{l} {stateText[s]}</span><span aria-hidden="true">{l[0]}</span></span>
              {/each}
            </span>
          </span>
          <span class="ctext" lang={studio.lang}>{short(textOf(p, r.id, studio.lang)) || '—'}</span>
        </button>
      </li>
    {:else}
      <li class="hint">{studio.gridProblemsOnly ? '문제 있는 문자열이 없습니다.' : '문자열이 없습니다.'}</li>
    {/each}
  </ul>
{/if}
{#if !wide}<p class="note" style="margin-top:8px">행을 누르면 오른쪽 [속성]에서 ko/en/ja 를 한 번에 편집합니다. 여러 줄을 한꺼번에 번역하려면 위의 [넓게] 를 켜세요.</p>{/if}
