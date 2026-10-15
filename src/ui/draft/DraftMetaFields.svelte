<script lang="ts">
  import { DRAFT_LANGS } from '../state/draft';
  import { studio } from '../state/studio.svelte';

  /** 새 프로젝트 정보 중 이름 외 항목: 템플릿 코드(선택)·언어 목록(표시만) */
  let { stacked = false }: { stacked?: boolean } = $props();
</script>

<div class="dm" class:stacked>
  <div class="dm-f" role="radiogroup" aria-label="프로젝트 유형">
    <span class="dm-l">유형 <small>(만든 뒤에는 바꿀 수 없습니다)</small></span>
    <div class="seg">
      <button type="button" role="radio" data-kind="mail" aria-checked={studio.draftKind === 'mail'} onclick={() => (studio.draftKind = 'mail')}>메일</button>
      <button type="button" role="radio" data-kind="notice" aria-checked={studio.draftKind === 'notice'} onclick={() => (studio.draftKind = 'notice')}>공지</button>
    </div>
    <small class="dm-d" data-kind-desc>
      {#if studio.draftKind === 'notice'}
        공지: 로고·푸터 없이 본문만, 호스트 페이지 폰트를 상속하는 단일 HTML(언어별 구역 주석). 치환자·동적 표는 쓸 수 없습니다.
      {:else}
        메일: 로고 헤더·푸터가 있는 600px 메일 본문(언어별 번들 JSON)과 치환자·동적 표.
      {/if}
    </small>
  </div>
  <label class="dm-f">
    <span class="dm-l">템플릿 코드 <small>(선택)</small></span>
    <input id="draft-code" type="text" placeholder="예: SHIP_START" maxlength="60" autocomplete="off" spellcheck="false" bind:value={studio.draftCode} />
  </label>
  <div class="dm-f" role="group" aria-label="언어 목록">
    <span class="dm-l">언어</span>
    <span class="drow" style="gap:4px">
      {#each DRAFT_LANGS as l, i}
        <span class="badge b-n">{l}{i === 0 ? ' (기준)' : ''}</span>
      {/each}
    </span>
  </div>
</div>

<style>
  .dm {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: flex-end;
  }
  .dm.stacked {
    flex-direction: column;
    align-items: stretch;
  }
  .dm-f {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .dm-l {
    font-size: 12px;
    color: var(--muted);
  }
  .dm-d {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.5;
  }
  .dm-l small {
    font-size: 11px;
  }
</style>
