<script>
  // "Screenshot sent to a phone" for a few seconds after the phone app took one (lib/screenshot.svelte.js).
  import Icon from './Icon.svelte';
  import { shot } from '../lib/screenshot.svelte.js';
</script>

{#if shot.note}
  <div class="note" role="status"><Icon name="camera" size={20} />{shot.note}</div>
{/if}

<style>
  .note { position: fixed; left: 50%; top: 18px; z-index: 46; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-radius: 24px; background: rgba(28, 28, 30, .92); color: #fff; font-size: 18px; font-weight: 600; white-space: nowrap; animation: down .2s ease-out; }
  @keyframes down { from { opacity: 0; transform: translate(-50%, -12px); } }
</style>
