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
    muted = false; loading = true; failed = false; zoom = 1; tx = 0; ty = 0;
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

  // Pinch to zoom a photo (up to MAX_ZOOM), drag to look around while zoomed, double-tap to zoom in at that
  // spot or back out. Only a transform changes (the frame's GPU handles that), centred on the screen:
  // a point p from the centre shows at t + zoom * p, so a pinch keeps the point under the fingers still.
  const MAX_ZOOM = 4;
  let zoom = $state(1), tx = $state(0), ty = $state(0);
  let box;
  const pointers = new Map(); // pointer id -> { x, y }
  let gesture = null;         // where the current pinch or drag started
  let lastTap = 0;
  const centre = (x, y) => { const r = box.getBoundingClientRect(); return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 }; };
  // Never past the photo's edge: at zoom z the picture is (z - 1) half-screens wider than the screen.
  function clamp() {
    const r = box.getBoundingClientRect();
    const mx = ((zoom - 1) * r.width) / 2, my = ((zoom - 1) * r.height) / 2;
    tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
  }
  function setZoom(z, at) { // at: the point (from the centre) to keep still
    const k = Math.max(1, Math.min(MAX_ZOOM, z)) / zoom;
    tx = at.x - (at.x - tx) * k; ty = at.y - (at.y - ty) * k;
    zoom *= k; clamp();
  }
  function begin() {
    const [a, b] = [...pointers.values()];
    gesture = b ? { d: Math.hypot(a.x - b.x, a.y - b.y), zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      : { x: a.x, y: a.y, tx, ty };
  }
  function down(e) {
    box.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, centre(e.clientX, e.clientY));
    after(PHOTO_MIN * 60 * 1000); // looking at it: the clock starts again
    begin();
  }
  function move(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, centre(e.clientX, e.clientY));
    const [a, b] = [...pointers.values()];
    if (b && gesture.d) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setZoom(gesture.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d), mid);
      tx += mid.x - gesture.mid.x; ty += mid.y - gesture.mid.y; gesture.mid = mid; clamp();
    } else if (!b && zoom > 1 && gesture.x !== undefined) {
      tx = gesture.tx + a.x - gesture.x; ty = gesture.ty + a.y - gesture.y; clamp();
    }
  }
  function up(e) {
    const was = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size) { begin(); return; }
    // A tap (not a drag): two within 300 ms zoom in there, or back out.
    if (gesture && gesture.x !== undefined && was && Math.hypot(was.x - gesture.x, was.y - gesture.y) < 12) {
      if (Date.now() - lastTap < 300) { if (zoom > 1) { zoom = 1; tx = 0; ty = 0; } else setZoom(2.5, was); lastTap = 0; }
      else lastTap = Date.now();
    }
    gesture = null;
  }

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
      <div class="zoom" bind:this={box} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} role="presentation">
        <img {src} alt={item.title} draggable="false" style="transform: translate({tx}px, {ty}px) scale({zoom})"
          onload={() => (loading = false)} onerror={() => { loading = false; failed = true; log('share.media', { error: 'photo' }, 'warn'); }} />
      </div>
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
  .zoom { position: absolute; top: 0; left: 0; right: 0; bottom: 0; overflow: hidden; touch-action: none; }
  .zoom img { transform-origin: 50% 50%; will-change: transform; }
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
