<script lang="ts">
  import { GMAIL_CLIP_BYTES, byteLength } from '../../project';
  import { studio } from '../state/studio.svelte';
  import Preview from './Preview.svelte';

  let fit = $state(true);

  const sizeInfo = $derived.by(() => {
    const r = studio.analysis.rendered;
    const h = r?.locales[studio.lang]?.html;
    if (h === undefined) return null;
    const bytes = byteLength(h);
    return { kb: bytes / 1024, cls: bytes > GMAIL_CLIP_BYTES ? 'b-err' : bytes > GMAIL_CLIP_BYTES * 0.85 ? 'b-warn' : 'b-ok', fresh: studio.analysisFresh };
  });
</script>

<section class="pane center" aria-label="미리보기 영역">
  <div class="pane-head compact">
    <div class="seg" role="group" aria-label="미리보기 언어">
      {#each studio.project.langs as l}
        <button type="button" aria-pressed={studio.lang === l} onclick={() => studio.setLang(l)} lang={l}>{l}</button>
      {/each}
    </div>
    {#if !studio.isNotice}
      <label class="chk"><input type="checkbox" bind:checked={studio.useSamples} /> 치환자 샘플값</label>
      <label class="chk" title="동적 표를 끄면 예시 행, 켜면 서버가 받게 될 표식(|!#-rows_…|)으로 보여 줍니다"><input type="checkbox" bind:checked={studio.showMarkers} /> 발송용 표식</label>
    {/if}
    <div class="seg" role="group" aria-label="미리보기 배율">
      <button type="button" aria-pressed={fit} onclick={() => (fit = true)}>맞춤</button>
      <button type="button" aria-pressed={!fit} onclick={() => (fit = false)}>100%</button>
    </div>
    <span class="sp"></span>
    {#if sizeInfo && !studio.isNotice}
      <span class="badge {sizeInfo.cls}" title="{studio.lang} 발송 HTML 크기(동적 표 행 제외). Gmail 은 102KB 초과 시 본문을 자릅니다.{sizeInfo.fresh ? '' : ' (이전 검사 결과)'}">
        {studio.lang} {sizeInfo.kb.toFixed(0)}/102KB{sizeInfo.fresh ? '' : '*'}
      </span>
    {/if}
  </div>
  <Preview {fit} />
</section>
