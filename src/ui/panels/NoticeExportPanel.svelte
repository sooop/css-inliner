<script lang="ts">
  import { byteLength } from '../../project';
  import { studio } from '../state/studio.svelte';

  const r = $derived(studio.analysis.rendered);
  const p = $derived(studio.project);
  const running = $derived(studio.analysis.status === 'running');
</script>

{#if studio.errorCount > 0}
  <div class="banner ban-err" style="margin-bottom:8px">오류 {studio.errorCount}건이 있습니다. 해결하거나 강제로 내보낼 수 있습니다.</div>
  <label class="chk" style="margin-bottom:8px"><input type="checkbox" bind:checked={studio.force} /> 오류를 확인했고 강제로 내보냅니다</label>
{:else}
  <div class="banner ban-ok" style="margin-bottom:8px">오류가 없습니다. 경고 {studio.warningCount}건은 내보내기를 막지 않습니다.</div>
{/if}

<div class="ops" style="margin:0 0 10px">
  <button type="button" class="btn pri" data-notice-save disabled={studio.exportBlocked || running} onclick={() => studio.saveNoticeFile()}>공지 HTML 저장</button>
  <button type="button" class="btn" data-notice-copy-all disabled={studio.exportBlocked || running} onclick={() => studio.copyNoticeAll()}>공지 HTML 복사</button>
</div>
<p class="note" style="margin-bottom:10px">
  공지 HTML 은 파일 하나이며 언어별로 <code>&lt;!-- tx:lang ko --&gt;</code> … <code>&lt;!-- /tx:lang ko --&gt;</code> 구역으로 나뉩니다.
  공지는 언어마다 별개 게시물이라, 아래 버튼으로 <b>언어별 본문 HTML(주석 제외)</b>과 제목을 복사해 공지 시스템 폼에 붙여 등록하세요.
  저장 전에 최신 상태가 아니면 모든 언어를 실제 엔진으로 다시 변환합니다.
</p>

<h3 class="rh">언어별 복사</h3>
<div class="col" style="gap:6px;margin-bottom:10px">
  {#each p.langs as l}
    <div class="drow">
      <b lang={l}>{l}</b>
      {#if r?.locales[l]}<span class="idc">{(byteLength(r.locales[l].html) / 1024).toFixed(1)} KB</span>{/if}
      <span class="sp"></span>
      <button type="button" class="btn sm" data-notice-zone={l} disabled={studio.exportBlocked || running} onclick={() => studio.copyNoticeZone(l)}>{l} 구역 복사</button>
      <button type="button" class="btn sm" data-notice-title={l} disabled={studio.exportBlocked || running} onclick={() => studio.copyNoticeTitle(l)}>{l} 제목 복사</button>
    </div>
  {/each}
</div>
{#if r && !studio.analysisFresh}<p class="note">이전 검사 결과입니다(그 뒤 내용이 바뀜). 복사·저장 시에는 최신으로 다시 변환합니다.</p>{/if}
<button type="button" class="btn sm" disabled={running || studio.analysisFresh} onclick={() => studio.runAnalysis()}>{running ? '변환 중…' : '변환 검사 실행'}</button>
