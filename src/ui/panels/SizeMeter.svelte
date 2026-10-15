<script lang="ts">
  import { GMAIL_CLIP_BYTES } from '../../project';

  let { lang, bytes, rowBytes = 0 }: { lang: string; bytes: number; rowBytes?: number } = $props();
  const total = $derived(bytes + rowBytes);
  const ratio = $derived(total / GMAIL_CLIP_BYTES);
  const cls = $derived(ratio > 1 ? 'e' : ratio > 0.85 ? 'w' : '');
</script>

<div style="margin-bottom:8px">
  <div class="drow">
    <b {lang}>{lang}</b>
    <span class="idc">{(total / 1024).toFixed(1)} KB / 102 KB{rowBytes ? ` (본문 ${(bytes / 1024).toFixed(1)} + 행 ${(rowBytes / 1024).toFixed(1)})` : ''}</span>
  </div>
  <div class="meter" role="meter" aria-label="{lang} 발송 HTML 크기" aria-valuemin={0} aria-valuemax={GMAIL_CLIP_BYTES} aria-valuenow={Math.round(total)}>
    <i class={cls} style:width="{Math.min(100, ratio * 100)}%"></i>
  </div>
  {#if ratio > 1}
    <div class="banner ban-err" style="margin-top:4px">Gmail 은 102KB 를 넘는 본문을 잘라 "메시지 전체 보기"로 숨깁니다.</div>
  {:else if ratio > 0.85}
    <div class="banner ban-warn" style="margin-top:4px">102KB 한도의 {Math.round(ratio * 100)}% 입니다.</div>
  {/if}
</div>
