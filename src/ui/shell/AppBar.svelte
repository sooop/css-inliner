<script lang="ts">
  import { studio, type Theme } from '../state/studio.svelte';

  const themes: [Theme, string][] = [
    ['system', '자동'],
    ['light', '라이트'],
    ['dark', '다크'],
  ];

  const saveText = $derived.by(() => {
    switch (studio.saveState) {
      case 'dirty':
        return '저장 대기…';
      case 'saving':
        return '저장 중…';
      case 'saved':
        return '자동 저장됨';
      case 'error':
        return '저장 불가 — 메모리에서만 유지';
      default:
        return '';
    }
  });
  const saveCls = $derived(studio.saveState === 'error' ? 'b-err' : studio.saveState === 'saved' ? 'b-ok' : 'b-warn');

  function gotoExport() {
    studio.setAcc('export', true);
    queueMicrotask(() => document.getElementById('acc-export')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

<header class="appbar">
  <span class="brand">MAIL STUDIO</span>
  <span class="crumb">프로젝트 /</span>
  <button type="button" class="proj-btn" title="프로젝트 목록 열기" onclick={() => (studio.leftTab = 'projects')}>{studio.project.name}</button>
  <span class="badge {studio.isNotice ? 'b-warn' : 'b-n'}" data-kind-badge={studio.kind} title="프로젝트 유형(만든 뒤 변경 불가)">{studio.isNotice ? '공지' : '메일'}</span>
  {#if studio.project.templateCode}<span class="idc">{studio.project.templateCode}</span>{/if}
  <span class="sp"></span>
  <div class="seg" role="group" aria-label="테마">
    {#each themes as [k, label]}
      <button type="button" aria-pressed={studio.theme === k} onclick={() => studio.setTheme(k)}>{label}</button>
    {/each}
  </div>
  <button type="button" class="btn sm" data-draft-opener title="초안으로 새 프로젝트 만들기" onclick={() => studio.openDraft()}>+ 초안</button>
  <button type="button" class="btn sm pri" onclick={gotoExport}>
    내보내기{#if studio.errorCount > 0}&nbsp;<span class="badge b-err">오류 {studio.errorCount}</span>{/if}
  </button>
  {#if saveText}<span class="badge {saveCls}" title={studio.storeError ?? (studio.saveState === 'saved' ? '이 브라우저(IndexedDB)에 저장됨' : '')}>{saveText}</span>{/if}
</header>
