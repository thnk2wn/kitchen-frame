<script>
  // A YouTube video nearly full screen (Media → Videos), in YouTube's own embedded player, with our
  // own control bar under it: big volume − and +, pause, next, Close. YouTube's own volume slider is
  // small and hides during playback, too fiddly on this screen. Its volume tops out at the frame's
  // Android media volume.
  // The player is laid out small (640x360) and scaled up: YouTube picks the quality from the player's
  // size, and this frame decodes YouTube's VP9 on its CPU, which stuttered at 720p (6 stalls a minute)
  // and plays smoothly this size (2026-10-17). Plays on through the group (next) when one ends.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { log } from '../lib/log.svelte.js';
  import { loadYouTube } from '../lib/youtube.js';
  import { notePlay } from '../lib/state.svelte.js';

  // startMuted: it arrived without a tap here (shared from a phone), and the frame's browser plays
  // sound only after one: muted, with a big "Tap for sound" until then.
  let { list, index = 0, onclose, startMuted = false } = $props();
  let muted = $state(startMuted);
  let at = $state(index);
  let paused = $state(false);
  let holder;
  let player = null;
  let title = $derived(list[at] ? list[at].title : '');
  const BAR = 104;
  const scale = Math.min(innerWidth / 640, (innerHeight - BAR) / 360);

  // Volume 0-100 in steps of 10, remembered on this frame.
  const saved = Number(localStorage.getItem('frame-video-volume'));
  let volume = $state(Number.isFinite(saved) && saved > 0 ? saved : 70);
  function setVolume(v) {
    volume = Math.max(0, Math.min(100, v));
    try { localStorage.setItem('frame-video-volume', String(volume)); } catch {}
    try { player && player.setVolume(volume); if (volume > 0) player.unMute(); } catch {}
  }

  onMount(() => {
    let gone = false, logged = -1; // which video's start has been logged
    const t0 = Date.now();
    loadYouTube().then((YT) => {
      if (gone) return;
      player = new YT.Player(holder, {
        width: 640, height: 360, videoId: list[at].id, host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => { e.target.setVolume(volume); if (muted) e.target.mute(); e.target.playVideo(); },
          onStateChange: (e) => {
            if (e.data === 1) {
              paused = false;
              if (logged !== at) { logged = at; notePlay(list[at].id); log('youtube.play', { video: list[at].id, ms: Date.now() - t0, quality: player.getPlaybackQuality() }); }
            }
            if (e.data === 2) paused = true;
            if (e.data === 0) next();
          },
          // 101/150: the channel doesn't allow playing outside YouTube; 100: gone. Skip to the next.
          onError: (e) => { log('youtube.error', { video: list[at].id, code: e.data }, 'warn'); next(); },
        },
      });
    }, () => log('youtube.error', { step: 'player script' }, 'warn'));
    return () => { gone = true; try { player && player.destroy(); } catch {} };
  });

  function next() {
    if (at >= list.length - 1) return onclose();
    at += 1;
    try { player.loadVideoById(list[at].id); } catch {}
  }
  const toggle = () => { try { paused ? player.playVideo() : player.pauseVideo(); } catch {} };
</script>

<div class="yt" role="dialog" aria-label={title}>
  <div class="stage" style="bottom:{BAR}px">
    <div class="box" style="transform: scale({scale})"><div bind:this={holder}></div></div>
  </div>
  <div class="bar" style="height:{BAR}px">
    <button class="round" onclick={toggle} aria-label={paused ? 'Play' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} size={30} /></button>
    {#if at < list.length - 1}<button class="round" onclick={next} aria-label="Next video"><Icon name="skipForward" size={30} /></button>{/if}
    <div class="title">{title}</div>
    {#if muted}
      <button class="sound" onclick={() => { muted = false; setVolume(volume); }}><Icon name="volume" size={28} />Tap for sound</button>
    {:else}
    <div class="vol" aria-label="Volume">
      <button class="round" onclick={() => setVolume(volume - 10)} disabled={volume <= 0} aria-label="Quieter"><Icon name="minus" size={30} /></button>
      <span class="level"><span style="transform:scaleX({volume / 100})"></span></span>
      <button class="round" onclick={() => setVolume(volume + 10)} disabled={volume >= 100} aria-label="Louder"><Icon name="plus" size={30} /></button>
    </div>
    {/if}
    <button class="close" onclick={onclose}>Close</button>
  </div>
</div>

<style>
  .yt { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 60; background: #000; color: #fff; }
  .stage { position: absolute; top: 0; left: 0; right: 0; overflow: hidden; }
  .box { position: absolute; width: 640px; height: 360px; left: 50%; top: 50%; margin: -180px 0 0 -320px; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 14px; padding: 0 24px; background: #1c1c1e; }
  .round { flex: none; width: 68px; height: 68px; border-radius: 50%; background: rgba(255, 255, 255, .16); color: #fff; display: grid; place-items: center; }
  .round:disabled { opacity: .35; }
  .title { flex: 1; min-width: 0; font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vol { flex: none; display: flex; align-items: center; gap: 12px; }
  .level { width: 150px; height: 12px; border-radius: 6px; background: rgba(255, 255, 255, .2); overflow: hidden; }
  .level span { display: block; height: 100%; background: #fff; transform-origin: left; }
  .sound { flex: none; height: 68px; padding: 0 28px; border-radius: 34px; background: var(--pal-blue, #0a84ff); color: #fff; font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
  .close { flex: none; height: 68px; padding: 0 34px; border-radius: 34px; background: #fff; color: #000; font-size: 24px; font-weight: 700; }
  button:active { opacity: .7; }
</style>
