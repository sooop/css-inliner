<script lang="ts">
  import { tableLayout, unusedVars } from '../state/dyn';
  import { studio } from '../state/studio.svelte';
  import ConfirmButton from '../shell/ConfirmButton.svelte';

  let pickedId = $state<string | null>(null);
  const p = $derived(studio.project);
  const table = $derived(p.dynamicTables.find((t) => t.id === pickedId) ?? p.dynamicTables[0]);
  const layout = $derived(table ? tableLayout(p, table.id) : { headIds: [], cellIds: [] });
  const unused = $derived(table ? unusedVars(p, table) : []);
  const cols = $derived(Math.max(layout.headIds.length, layout.cellIds.length));
  const textRows = $derived(
    Array.from({ length: cols }, (_, i) => i).flatMap((i) => [
      { label: `열 ${i + 1} 이름`, id: layout.headIds[i] },
      { label: `열 ${i + 1} 셀`, id: layout.cellIds[i] },
    ]).filter((r) => !!r.id),
  );
</script>

{#if !table}
  <div class="hint">동적 표가 없습니다. 초안에서 <code>[표: 가로형, 동적: 표id]</code> 로 만들 수 있습니다.</div>
{:else}
  {#if p.dynamicTables.length > 1}
    <div class="seg" role="group" aria-label="동적 표 선택" style="margin-bottom:8px">
      {#each p.dynamicTables as t}<button type="button" aria-pressed={t.id === table.id} onclick={() => (pickedId = t.id)}>{t.id}</button>{/each}
    </div>
  {/if}
  <div class="drow" style="margin-bottom:6px"><h3 class="rh" style="margin:0">동적 표 · {table.id}</h3><span class="badge b-n">표식 |!#-rows_{table.id}|</span></div>
  <p class="note" style="margin-bottom:10px">발송 HTML 의 tbody 에는 표식 하나만 남고, 서버(워커)가 행 템플릿을 반복해 채웁니다. 행 템플릿은 표당 1종이며 줄무늬·합계 행·빈 목록 문구는 지원하지 않습니다.</p>

  <h3 class="rh">행 템플릿 · 언어별 문구</h3>
  <div class="tw">
    <table class="g">
      <thead><tr><th scope="col">항목</th>{#each p.langs as l}<th scope="col">{l}</th>{/each}</tr></thead>
      <tbody>
        {#each textRows as r (r.id)}
          <tr>
            <td class="c1">{r.label} <span class="idc">{r.id}</span></td>
            {#each p.langs as l}
              <td>
                <input type="text" lang={l} aria-label="{r.id} {l}" value={p.strings[r.id]?.[l] ?? ''} onfocus={() => studio.select(r.id, { openEdit: false })} oninput={(e) => studio.setText(r.id, l, e.currentTarget.value)} />
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="note" style="margin-top:6px">셀 문구에는 <code>{'{{변수}}'}</code> 를 쓸 수 있고, 모든 언어에 같은 변수가 있어야 합니다. 새 변수는 아래 목록에 자동 추가됩니다.</p>

  <h3 class="rh" style="margin-top:14px">행 변수 목록</h3>
  <div class="tw">
    <table class="g">
      <thead><tr><th scope="col">변수</th><th scope="col">설명</th><th scope="col">샘플(새 행 기본값)</th><th scope="col"><span class="sr-only">제거</span></th></tr></thead>
      <tbody>
        {#each table.vars as v (v.name)}
          <tr>
            <td class="c1"><code>{`{{${v.name}}}`}</code></td>
            <td><input type="text" aria-label="{v.name} 설명" value={v.description} oninput={(e) => studio.updateTableVar(table.id, v.name, { description: e.currentTarget.value })} /></td>
            <td><input type="text" aria-label="{v.name} 샘플" value={v.sample} oninput={(e) => studio.updateTableVar(table.id, v.name, { sample: e.currentTarget.value })} /></td>
            <td class="c1">{#if unused.includes(v.name)}<ConfirmButton label="제거" confirmLabel="정말?" onconfirm={() => studio.removeTableVar(table.id, v.name)} />{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if unused.length}<p class="note" style="margin-top:6px">행 템플릿에서 쓰이지 않는 변수({unused.join(', ')})는 내보내기 검사에서 오류가 되므로 제거하세요.</p>{/if}

  <div class="drow" style="margin:14px 0 6px">
    <h3 class="rh" style="margin:0">예시 행 데이터 ({table.sampleRows.length}행, 미리보기용)</h3><span class="sp"></span>
    <button type="button" class="btn sm" onclick={() => studio.addSampleRow(table.id)}>+ 행 추가</button>
  </div>
  <div class="tw">
    <table class="g">
      <thead><tr><th scope="col">#</th>{#each table.vars as v}<th scope="col">{v.name}</th>{/each}<th scope="col"><span class="sr-only">삭제</span></th></tr></thead>
      <tbody>
        {#each table.sampleRows as r, ri}
          <tr>
            <td class="c1">{ri + 1}</td>
            {#each table.vars as v}
              <td><input type="text" aria-label="{ri + 1}행 {v.name}" value={r[v.name] ?? ''} oninput={(e) => studio.setSampleCell(table.id, ri, v.name, e.currentTarget.value)} /></td>
            {/each}
            <td class="c1"><button type="button" class="btn sm dng" onclick={() => studio.removeSampleRow(table.id, ri)}>삭제</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="note" style="margin-top:6px">예시 행은 모델에만 보관되며 발송 HTML 에는 들어가지 않습니다. 값은 HTML 이스케이프되어 표시됩니다.</p>
{/if}
