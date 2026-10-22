<script>
  import Icon from './Icon.svelte';
  import { haUrl, callService } from '../lib/ha.svelte.js';
  import { haImage } from '../lib/ha-image.js';
  import { nm } from '../lib/demo-media.svelte.js';
  import { ui } from '../lib/state.svelte.js';
  import { busy, expectFor } from '../lib/pending.svelte.js';
  import { playlistOf } from '../lib/playlist.svelte.js';
  import { toggle as podToggle, echoCommand } from '../lib/podcasts.svelte.js';
  // Two sizes: a card in Home's left column (cover, song, artist), and a mini pill in the top bar of
  // the other tabs (cover and play/pause; with the clock and notice chip there, that's all that fits).
  // cover: a big cover above the song (px), when the card has the height for it.
  // slim: two lines (song; artist · playlist) and a smaller cover, where height is tight.
  let { player, card = false, cover = 0, slim = false } = $props();
  let from = $derived(card ? playlistOf(player) : null);
  // Opens the Media tab on what's playing: the TV view for a TV, Music otherwise.
  // A podcast (App.svelte's podcastNow) opens Podcasts.
  const openIt = () => { ui.media = player.podcast ? 'podcasts' : player.tv ? 'tv' : 'music'; ui.tab = 'music'; };

  // The pill opens the Music tab; the button pauses without leaving the tab.
  function toggle(e) {
    e.stopPropagation();
    // A podcast pauses where it plays: the frame's own audio, or the Echo through the skill.
    if (player.podcast === 'frame') { podToggle(); return; }
    if (player.podcast === 'echo') { echoCommand(player.state === 'playing' ? 'pause' : 'resume'); return; }
    expectFor(player, 'media_play_pause');
    callService('media_player', 'media_play_pause', {}, { entity_id: player.entity_id }).catch(() => {});
  }
  let failedArt = $state(null); // the picture that didn't load, so the next song's is tried
</script>

<div class="np" class:card class:slim class:tall={cover > 0} class:sheet={card} style={cover ? '--cover:' + cover + 'px' : ''} role="button" tabindex="0" title={player.media_title} onclick={openIt} onkeydown={(e) => e.key === 'Enter' && openIt()}>
  <!-- A cover that fails to load (Home Assistant's art proxy can) shows the note, not a broken image. -->
  {#if player.podcast}{#if player.art && failedArt !== player.art}<img src={player.art} alt="" decoding="async" onerror={() => (failedArt = player.art)} />{:else}<span class="noart"><Icon name="podcast" size={20} /></span>{/if}
  {:else if player.entity_picture && failedArt !== player.entity_picture}<img {@attach haImage(haUrl(player.entity_picture))} alt="" onerror={() => (failedArt = player.entity_picture)} />{:else}<span class="noart"><Icon name="music" size={20} /></span>{/if}
  {#if card}
    <div class="txt">
      <div class="title">{player.media_title}</div>
      {#if slim}
        <div class="sub">{player.media_artist || nm(player.label)}{#if from}{' · From ' + from}{/if}</div>
      {:else}
        <div class="sub">{player.media_artist || nm(player.label)}</div>
        {#if from}<div class="from">From {from}</div>{/if}
      {/if}
    </div>
  {/if}
  <button class="pp" class:busy={busy(player, 'state')} onclick={toggle} aria-label={player.state === 'playing' ? 'Pause' : 'Play'}>
    <Icon name={player.state === 'playing' ? 'pause' : 'play'} size={card ? 22 : 20} />
  </button>
</div>

<style>
  .np { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 5px 0 6px; border-radius: 26px; background: var(--track); min-width: 0; }
  .np:active { opacity: .8; }
  img, .noart { flex: none; width: 40px; height: 40px; border-radius: 20px; object-fit: cover; background: var(--sheet); }
  .noart { display: grid; place-items: center; color: var(--secondary); }
  .txt { min-width: 0; max-width: 220px; }
  .title { font-size: 16px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 14px; line-height: 1.2; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pp { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--sheet); color: var(--label); }
  .pp:active { opacity: .6; }
  .pp.busy :global(svg) { animation: waiting 1s ease-in-out infinite; }
  @keyframes waiting { 50% { opacity: .35; } }
  .card { height: auto; gap: 14px; padding: 12px 14px; border-radius: 20px; background: var(--sheet); }
  .card img, .card .noart { width: 56px; height: 56px; border-radius: 10px; background: var(--track); }
  .card .txt { flex: 1; max-width: none; }
  .card .title { font-size: 19px; }
  .card .sub { margin-top: 2px; font-size: 16px; }
  .from { margin-top: 2px; font-size: 14px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .pp { width: 44px; height: 44px; background: var(--track); }
  .slim { padding: 8px 10px; gap: 12px; }
  .slim img, .slim .noart { width: 44px; height: 44px; border-radius: 8px; }
  .slim .title { font-size: 17px; }
  .slim .sub { font-size: 14px; }
  .slim .pp { width: 40px; height: 40px; }
  /* Tall: the cover on top, song and button below (grid keeps the button beside the words). */
  .tall { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; align-items: center; padding: 14px; }
  .tall img, .tall .noart { grid-column: 1 / -1; justify-self: center; width: var(--cover); height: var(--cover); border-radius: 14px; }
  .tall .title { font-size: 21px; }
</style>
