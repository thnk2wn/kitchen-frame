<script>
  // Music | TV, at the start of the Media tab's bottom bar, shown only when Home Assistant has a TV
  // (or in demo mode). The dot marks a view with something playing.
  import { ha } from '../lib/ha.svelte.js';
  import { ui } from '../lib/state.svelte.js';
  let hasTv = $derived(ui.demo || ha.players.some((p) => p.tv));
  let tvPlaying = $derived(ha.players.some((p) => p.tv && p.state === 'playing'));
  let musicPlaying = $derived(ha.players.some((p) => !p.tv && p.state === 'playing'));
</script>

{#if hasTv}
  <div class="seg" role="tablist" aria-label="Media">
    <button role="tab" aria-selected={ui.media !== 'tv'} class:on={ui.media !== 'tv'} onclick={() => (ui.media = 'music')}>Music{#if musicPlaying && ui.media === 'tv'}<i></i>{/if}</button>
    <button role="tab" aria-selected={ui.media === 'tv'} class:on={ui.media === 'tv'} onclick={() => (ui.media = 'tv')}>TV{#if tvPlaying && ui.media !== 'tv'}<i></i>{/if}</button>
  </div>
{/if}

<style>
  .seg { flex: none; display: flex; padding: 3px; border-radius: 14px; background: var(--fill); }
  .seg button { position: relative; display: flex; align-items: center; gap: 6px; min-width: 88px; height: 44px; padding: 0 18px; justify-content: center; border-radius: 11px; font-size: 18px; font-weight: 500; }
  .seg button.on { background: var(--thumb); font-weight: 700; }
  i { width: 8px; height: 8px; border-radius: 50%; background: var(--pal-green); }
</style>
