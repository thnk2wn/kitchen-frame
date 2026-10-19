<script>
  // A photo or video shared from a phone (the iPhone app's share extension; worker/shared-media.js),
  // full screen over whatever the frame shows. A photo stays PHOTO_MIN minutes, a video until it ends
  // (then a few seconds more); Close, the phone's remote Close or Alexa's "close" end either sooner.
  // The phone sends both ready for the frame (a screen-size JPEG; H.264 sized for this Wi-Fi). A video
  // tries to start with sound; when the browser wants a tap first, it plays muted with Tap for sound.
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { sharedMedia } from '../lib/state.svelte.js';
  import { mediaUrl } from '../lib/api.js';
  import { log } from '../lib/log.svelte.js';

  const PHOTO_MIN = 15;
  const BLACK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  let item = $derived(sharedMedia.item);
  let src = $derived(item ? mediaUrl('/api/share/media/' + item.id) : '');
  let muted = $state(false);
  let loading = $state(true);
  let failed = $state(false);
  let video = $state(null);
  let timer;

  const close = () => { sharedMedia.item = null; };
  const after = (ms) => { clearTimeout(timer); timer = setTimeout(close, ms); };

  // Each new share starts fresh.
  $effect(() => {
    if (!item) return;
    muted = false; loading = true; failed = false;
    if (item.kind === 'photo') after(PHOTO_MIN * 60 * 1000);
    else clearTimeout(timer);
  });
  onDestroy(() => clearTimeout(timer));

  async function start() {
    if (!video) return;
    try { await video.play(); }
    catch {
      muted = true; // no sound until a tap here
      try { await video.play(); } catch (e) { log('share.media', { error: 'play', message: e && e.message }, 'warn'); }
    }
  }
  function unmute() { muted = false; if (video) { video.muted = false; video.play().catch(() => {}); } }

  // Volume 0-10, remembered on this frame; the loudest is the frame's own Android media volume.
  const saved = () => { try { const v = Number(localStorage.getItem('frame-shared-volume')); return v >= 0 && v <= 10 && localStorage.getItem('frame-shared-volume') !== null ? v : 8; } catch { return 8; } };
  let volume = $state(saved());
  $effect(() => { if (video) video.volume = volume / 10; });
  function step(d) {
    volume = Math.max(0, Math.min(10, volume + d));
    if (volume > 0 && muted) unmute();
    try { localStorage.setItem('frame-shared-volume', String(volume)); } catch {}
  }
</script>

{#if item}
  <div class="shared" role="dialog" aria-label={item.kind === 'video' ? 'Shared video' : 'Shared photo'}>
    {#if item.kind === 'photo'}
      <img {src} alt={item.title} onload={() => (loading = false)} onerror={() => { loading = false; failed = true; log('share.media', { error: 'photo' }, 'warn'); }} />
    {:else if !failed}
      <!-- A black poster: without one, Android's WebView shows its own big play icon while loading. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} {src} {muted} playsinline preload="auto" poster={BLACK}
        oncanplay={() => { if (loading) { loading = false; start(); } }}
        onended={() => after(4000)}
        onerror={() => { loading = false; failed = true; log('share.media', { error: 'video' }, 'warn'); }}></video>
    {/if}
    {#if loading}<p class="note">{item.kind === 'video' ? 'Loading the video…' : 'Loading…'}</p>{/if}
    {#if failed}<p class="note">Couldn’t load it. It may have expired (shared items last a day).</p>{/if}
    <div class="bar">
      {#if item.title}<span class="title">{item.title}</span>{:else}<span class="title"></span>{/if}
      {#if muted}<button class="sound" onclick={unmute}><Icon name="volume" size={26} />Tap for sound</button>
      {:else if item.kind === 'video' && !failed}
        <span class="vol">
          <button class="round" onclick={() => step(-1)} disabled={volume === 0} aria-label="Quieter"><Icon name="minus" size={28} /></button>
          <span class="level"><span style="transform: scaleX({volume / 10})"></span></span>
          <button class="round" onclick={() => step(1)} disabled={volume === 10} aria-label="Louder"><Icon name="plus" size={28} /></button>
        </span>
      {/if}
      <button class="close" onclick={close}>Close</button>
    </div>
  </div>
{/if}

<style>
  .shared { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 62; background: #000; color: #fff; }
  img, video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; }
  .note { position: absolute; left: 0; right: 0; top: 45%; margin: 0; text-align: center; font-size: 24px; font-weight: 600; color: rgba(255, 255, 255, .8); }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 14px; padding: 16px 24px; background: linear-gradient(to top, rgba(0, 0, 0, .6), rgba(0, 0, 0, 0)); }
  .title { flex: 1; min-width: 0; font-size: 22px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sound { flex: none; height: 64px; padding: 0 28px; border-radius: 32px; background: var(--pal-blue, #0a84ff); color: #fff; font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
  .vol { flex: none; display: flex; align-items: center; gap: 12px; }
  .round { flex: none; width: 64px; height: 64px; border-radius: 50%; background: rgba(255, 255, 255, .18); color: #fff; display: grid; place-items: center; }
  .round:disabled { opacity: .35; }
  .level { width: 140px; height: 12px; border-radius: 6px; background: rgba(255, 255, 255, .25); overflow: hidden; }
  .level span { display: block; height: 100%; background: #fff; transform-origin: left; }
  .close { flex: none; height: 64px; padding: 0 34px; border-radius: 32px; background: #fff; color: #000; font-size: 24px; font-weight: 700; }
</style>
