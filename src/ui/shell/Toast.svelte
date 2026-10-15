<script lang="ts">
  import { studio } from '../state/studio.svelte';
</script>

<div class="toast-region" role="status" aria-live="polite">
  {#if studio.toastMsg}
    <div class="toast">{studio.toastMsg.text}</div>
  {/if}
</div>
