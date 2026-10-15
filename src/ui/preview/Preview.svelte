<script lang="ts">
  import { untrack } from 'svelte';
  import { studio } from '../state/studio.svelte';
  import { previewKey, renderPreviewHtml } from '../state/preview';
  import { applySamples, buildPreviewDocument, decoratePreview, selectionCss } from '../state/preview-html';

  let { fit = true }: { fit?: boolean } = $props();

  let inlined = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let warnings = $state<string[]>([]);
  let seq = 0;

  let frame = $state<HTMLIFrameElement>();
  let frameDoc = $state<Document | null>(null);
  let contentHeight = $state(800);
  let stageWidth = $state(0);
  let handledReveal = 0;
  let observer: ResizeObserver | null = null;

  const renderWidth = $derived(studio.project.settings.renderWidth || 1000);
  const scale = $derived(fit && stageWidth > 0 ? Math.min(1, (stageWidth - 22) / renderWidth) : 1);
  const empty = $derived(studio.project.structure.trim() === '');

  // 입력이 바뀌면(같은 키는 건너뜀) 250ms 디바운스 후 실제 엔진으로 인라인
  const key = $derived(previewKey(studio.project, studio.lang, studio.showMarkers));
  $effect(() => {
    const k = key;
    const { p, lang, markers } = untrack(() => ({ p: studio.project, lang: studio.lang, markers: studio.showMarkers }));
    if (p.structure.trim() === '') {
      inlined = null;
      return;
    }
    const id = ++seq;
    busy = true;
    const t = setTimeout(async () => {
      try {
        const r = await renderPreviewHtml(p, lang, markers);
        if (id !== seq) return;
        inlined = r.html;
        warnings = r.warnings.map((w) => w.message);
        error = null;
      } catch (e) {
        if (id === seq) error = e instanceof Error ? e.message : String(e);
      } finally {
        if (id === seq) busy = false;
      }
    }, 250);
    return () => clearTimeout(t);
  });

  const srcdoc = $derived(
    inlined === null
      ? ''
      : buildPreviewDocument(
          studio.useSamples && !studio.isNotice ? applySamples(inlined, studio.project.variables) : inlined,
          studio.lang,
          studio.kind,
        ),
  );

  function measure() {
    const d = frameDoc;
    if (d) contentHeight = Math.max(200, d.documentElement.scrollHeight);
  }

  function onload() {
    const doc = frame?.contentDocument;
    if (!doc || !doc.body) return;
    decoratePreview(doc);
    doc.addEventListener('click', (e) => {
      e.preventDefault();
      const el = (e.target as Element | null)?.closest?.('[data-t]');
      const id = el?.getAttribute('data-t');
      if (id) studio.select(id);
    });
    frameDoc = doc;
    observer?.disconnect();
    const RO = (doc.defaultView as unknown as { ResizeObserver?: typeof ResizeObserver })?.ResizeObserver ?? ResizeObserver;
    observer = new RO(measure);
    observer.observe(doc.documentElement);
    measure();
    tryReveal();
  }

  // 선택 강조(문서 재로딩 없이 스타일만 교체)
  $effect(() => {
    const doc = frameDoc;
    const id = studio.selectedId;
    const s = doc?.getElementById('sel');
    if (s) s.textContent = selectionCss(id);
  });

  function tryReveal() {
    const r = studio.reveal;
    const doc = frameDoc;
    if (!r || !doc || r.tick === handledReveal) return;
    const el = Array.from(doc.querySelectorAll('[data-t]')).find((x) => x.getAttribute('data-t') === r.id);
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      handledReveal = r.tick;
    }
  }
  $effect(() => {
    void studio.reveal;
    untrack(tryReveal);
  });

  $effect(() => () => observer?.disconnect());
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (스크롤 영역은 키보드로도 스크롤되어야 함) -->
<div class="stage" role="region" aria-label="미리보기" title="미리보기의 문구를 클릭하면 편집합니다" tabindex="0" bind:clientWidth={stageWidth}>
  {#if empty}
    <div class="empty">
      <h2>비어 있는 프로젝트입니다</h2>
      <p>왼쪽 [블록]에서 블록을 추가하거나, 상단의 <b>+ 초안</b>으로 ko 초안(.txmd)에서 <b>새 프로젝트</b>를 만들 수 있습니다.</p>
      <button type="button" class="btn pri" onclick={() => studio.openDraft()}>+ 초안으로 새 프로젝트</button>
    </div>
  {:else}
    {#if error}
      <div class="banner ban-err" role="alert" style="margin-bottom:8px">미리보기 변환 실패: {error}</div>
    {/if}
    {#if warnings.length}
      <details class="banner ban-warn" style="margin-bottom:8px">
        <summary>인라인 변환 경고 {warnings.length}건</summary>
        <ul>{#each warnings as w}<li>{w}</li>{/each}</ul>
      </details>
    {/if}
    <div class="scalebox" style:width="{renderWidth * scale}px" style:height="{contentHeight * scale}px" aria-busy={busy}>
      {#if srcdoc}
        <iframe
          bind:this={frame}
          title="{studio.isNotice ? '공지' : '메일'} 미리보기 ({studio.lang})"
          {srcdoc}
          sandbox="allow-same-origin"
          {onload}
          lang={studio.lang}
          style:width="{renderWidth}px"
          style:height="{contentHeight}px"
          style:transform="scale({scale})"
        ></iframe>
      {/if}
    </div>
  {/if}
</div>
