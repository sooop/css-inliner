<script lang="ts">
  import type { Snippet } from 'svelte';
  import { studio, type AccKey } from '../state/studio.svelte';

  interface Props {
    key: AccKey;
    title: string;
    badge?: Snippet;
    children: Snippet;
  }
  let { key, title, badge, children }: Props = $props();
  const open = $derived(studio.acc[key]);
</script>

<section class="acc" data-k={key}>
  <h3 class="acch">
    <button type="button" class="acchb" aria-expanded={open} aria-controls="acc-{key}" id="acch-{key}" onclick={() => studio.toggleAcc(key)}>
      <span class="chev" aria-hidden="true">▸</span>
      <span class="acct">{title}</span>
      <span class="accbd">{#if badge}{@render badge()}{/if}</span>
    </button>
  </h3>
  <div class="accb" id="acc-{key}" role="region" aria-labelledby="acch-{key}" hidden={!open}>
    {#if open}{@render children()}{/if}
  </div>
</section>
