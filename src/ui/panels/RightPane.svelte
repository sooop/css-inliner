<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import { SUBJECT_ID } from '../state/strings';
  import Accordion from './Accordion.svelte';
  import ChecksPanel from './ChecksPanel.svelte';
  import DynTablePanel from './DynTablePanel.svelte';
  import ExportPanel from './ExportPanel.svelte';
  import NoticeExportPanel from './NoticeExportPanel.svelte';
  import HandoffPanel from './HandoffPanel.svelte';
  import PropertiesPanel from './PropertiesPanel.svelte';
  import VariablesPanel from './VariablesPanel.svelte';
</script>

<section class="pane" aria-label="우측 패널">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (스크롤 영역은 키보드로도 스크롤되어야 함) -->
  <div class="scr col" role="region" aria-label="속성 · 검사 · 치환자 · 동적 표 · 내보내기 · handoff" tabindex="0">
    <Accordion key="edit" title="속성">
      {#snippet badge()}{#if studio.selectedId}<span class="idc">{studio.selectedId === SUBJECT_ID ? '제목' : studio.selectedId}</span>{/if}{/snippet}
      <PropertiesPanel />
    </Accordion>
    <Accordion key="check" title="검사">
      {#snippet badge()}<span class="badge b-err">오류 {studio.errorCount}</span><span class="badge b-warn">경고 {studio.warningCount}</span>{/snippet}
      <ChecksPanel />
    </Accordion>
    {#if !studio.isNotice}
    <Accordion key="vars" title="치환자">
      {#snippet badge()}<span class="badge b-n">{studio.project.variables.length}</span>{/snippet}
      <VariablesPanel />
    </Accordion>
    <Accordion key="dyn" title="동적 표">
      {#snippet badge()}<span class="badge b-n">표 {studio.project.dynamicTables.length}</span>{/snippet}
      <DynTablePanel />
    </Accordion>
    {/if}
    <Accordion key="export" title="내보내기">
      {#snippet badge()}
        {#if studio.exportBlocked}<span class="badge b-err">차단됨</span>{:else}<span class="badge b-ok">가능</span>{/if}
      {/snippet}
      {#if studio.isNotice}<NoticeExportPanel />{:else}<ExportPanel />{/if}
    </Accordion>
    {#if !studio.isNotice}
    <Accordion key="handoff" title="handoff">
      {#snippet badge()}<span class="badge b-n">표 {studio.project.dynamicTables.length}</span>{/snippet}
      <HandoffPanel />
    </Accordion>
    {/if}
  </div>
</section>
