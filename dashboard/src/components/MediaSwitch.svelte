<script>
  // Music | TV | Videos, at the start of the Media tab's bottom bar: TV when Home Assistant has a TV
  // (or in demo mode), Videos when YouTube videos are set up. The dot marks a view with something playing.
  import { ha, haConfigured } from '../lib/ha.svelte.js';
  import { ui, videos } from '../lib/state.svelte.js';
  let hasTv = $derived(ui.demo || ha.players.some((p) => p.tv));
  let hasVideos = $derived(videos.groups.length > 0);
  let hasMusic = $derived(haConfigured() || ui.demo);
  let tvPlaying = $derived(ha.players.some((p) => p.tv && p.state === 'playing'));
  let musicPlaying = $derived(ha.players.some((p) => !p.tv && p.state === 'playing'));
</script>

{#if [hasMusic, hasTv, hasVideos].filter(Boolean).length > 1}
  <div class="seg" role="tablist" aria-label="Media">
    {#if hasMusic}<button role="tab" aria-selected={ui.media === 'music'} class:on={ui.media === 'music'} onclick={() => (ui.media = 'music')}>Music{#if musicPlaying && ui.media !== 'music'}<i></i>{/if}</button>{/if}
    {#if hasTv}<button role="tab" aria-selected={ui.media === 'tv'} class:on={ui.media === 'tv'} onclick={() => (ui.media = 'tv')}>TV{#if tvPlaying && ui.media !== 'tv'}<i></i>{/if}</button>{/if}
    {#if hasVideos}<button role="tab" aria-selected={ui.media === 'videos'} class:on={ui.media === 'videos'} onclick={() => (ui.media = 'videos')}>Videos</button>{/if}
  </div>
{/if}

<style>
  .seg { flex: none; display: flex; padding: 3px; border-radius: 14px; background: var(--fill); }
  .seg button { position: relative; display: flex; align-items: center; gap: 6px; min-width: 88px; height: 44px; padding: 0 18px; justify-content: center; border-radius: 11px; font-size: 18px; font-weight: 500; }
  .seg button.on { background: var(--thumb); font-weight: 700; }
  i { width: 8px; height: 8px; border-radius: 50%; background: var(--pal-green); }
</style>
