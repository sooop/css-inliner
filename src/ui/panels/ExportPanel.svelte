<script lang="ts">
  import { byteLength, estimateRowBytes } from '../../project';
  import { studio } from '../state/studio.svelte';
  import SizeMeter from './SizeMeter.svelte';

  const r = $derived(studio.analysis.rendered);
  const p = $derived(studio.project);
  const running = $derived(studio.analysis.status === 'running');

  function sizes(lang: string) {
    if (!r) return { bytes: 0, rows: 0 };
    const bytes = byteLength(r.locales[lang]?.html ?? '');
    const rows = r.dynamicTables.reduce(
      (s, t) => s + estimateRowBytes(t.rowTemplates[lang] ?? '', t.vars, t.sampleRows) * (studio.expectedRows[t.id] ?? 0),
      0,
    );
    return { bytes, rows };
  }
</script>

{#if studio.errorCount > 0}
  <div class="banner ban-err" style="margin-bottom:8px">오류 {studio.errorCount}건이 있습니다. 해결하거나 강제로 내보낼 수 있습니다.</div>
  <label class="chk" style="margin-bottom:8px"><input type="checkbox" bind:checked={studio.force} /> 오류를 확인했고 강제로 내보냅니다</label>
{:else}
  <div class="banner ban-ok" style="margin-bottom:8px">오류가 없습니다. 경고 {studio.warningCount}건은 내보내기를 막지 않습니다.</div>
{/if}

<div class="ops" style="margin:0 0 10px">
  <button type="button" class="btn pri" disabled={studio.exportBlocked || running} onclick={() => studio.saveBundleFile()}>번들 저장(.json)</button>
  <button type="button" class="btn" disabled={studio.exportBlocked || running} onclick={() => studio.copyBundle()}>클립보드 복사</button>
</div>
<p class="note" style="margin-bottom:10px">번들에는 언어별 제목·본문 HTML(인라인 완료, 블록 ID 제거), 치환자, 동적 표 행 템플릿, 프로젝트 원본(source)이 들어갑니다. 저장 전에 최신 상태가 아니면 모든 언어를 실제 엔진으로 다시 변환합니다.</p>

<h3 class="rh">Gmail 102KB 크기 (언어별)</h3>
{#if p.dynamicTables.length}
  <div class="drow" style="margin-bottom:8px">
    {#each p.dynamicTables as t}
      <label class="drow" style="gap:4px">
        예상 행 수 <code>{t.id}</code>
        <input type="number" min="0" value={studio.expectedRows[t.id] ?? 0} oninput={(e) => (studio.expectedRows[t.id] = Math.max(0, Number(e.currentTarget.value) || 0))} />
      </label>
    {/each}
  </div>
{/if}
{#if r}
  {#each p.langs as l}
    {@const s = sizes(l)}
    <SizeMeter lang={l} bytes={s.bytes} rowBytes={s.rows} />
  {/each}
  {#if !studio.analysisFresh}<p class="note">이전 검사 결과입니다(그 뒤 내용이 바뀜). 아래 버튼으로 갱신하세요.</p>{/if}
{:else}
  <p class="note">아직 측정하지 않았습니다.</p>
{/if}
<button type="button" class="btn sm" disabled={running || studio.analysisFresh} onclick={() => studio.runAnalysis()}>{running ? '측정 중…' : '크기·변환 검사 실행'}</button>
