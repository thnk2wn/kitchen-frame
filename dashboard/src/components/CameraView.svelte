<script>
  // A camera full screen, opened by tapping it on the House tab: live video when the camera offers
  // it through Home Assistant (WebRTC, as the doorbell pop-up uses), otherwise its picture refreshed
  // every few seconds. Closes itself after OPEN_MS, so a battery camera isn't left streaming.
  import Icon from './Icon.svelte';
  import { startLive } from '../lib/doorbell.svelte.js';
  import { ha, haUrl } from '../lib/ha.svelte.js';

  let { entity, name, picture = '', onclose } = $props();
  const OPEN_MS = 2 * 60 * 1000;
  const STILL_MS = 5000;
  let video = $state();
  let live = $state(false);
  let noLive = $state(false);
  let muted = $state(true);
  let tick = $state(Date.now());

  // The picture until (or instead of) live video: bigger than the tile's, and fresh each time.
  let still = $derived(picture ? haUrl(picture) + (picture.includes('?') ? '&' : '?') + 'width=1280&_=' + tick : null);

  // A first try sometimes stalls (a sleeping camera waking up), while a second connects in about a
  // second: so one retry after RETRY_MS, then pictures instead, rather than "connecting" for ever.
  const RETRY_MS = 10000;
  $effect(() => {
    if (!video) return;
    let stop = null, gone = false, tries = 0, retry;
    const attempt = () => {
      const n = ++tries;
      startLive(entity, video, () => (live = true))
        // A slow first try that finishes after the retry began is closed, not kept.
        .then((s) => { if (gone || n !== tries) s && s(); else if (s) stop = s; else noLive = true; })
        .catch((e) => { console.error('camera live view', e); });
      retry = setTimeout(() => {
        if (live || gone) return;
        if (stop) { stop(); stop = null; }
        if (tries < 2) attempt(); else noLive = true;
      }, RETRY_MS);
    };
    attempt();
    const close = setTimeout(onclose, OPEN_MS);
    return () => { gone = true; clearTimeout(close); clearTimeout(retry); if (stop) stop(); };
  });
  // No live video: refresh the picture instead.
  $effect(() => {
    if (!noLive) return;
    const t = setInterval(() => (tick = Date.now()), STILL_MS);
    return () => clearInterval(t);
  });
</script>

<div class="cam" role="dialog" aria-label={name}>
  <div class="media">
    {#if still}<img src={still} alt="" class:hide={live} />{/if}
    {#if !still && !live}<div class="wait"><Icon name="camera" size={56} /></div>{/if}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} {muted} autoplay playsinline class:hide={!live}></video>
  </div>
  <div class="bar">
    <div class="txt">
      <div class="title">{name}</div>
      <div class="sub">
        {#if live}Live{:else if noLive}Live video isn’t available right now · picture refreshed every few seconds
        {:else if ha.status === 'connected'}<span class="spin"></span>Starting live video…{:else}Not connected to Home Assistant{/if}
      </div>
    </div>
    {#if live}
      <button class="snd" onclick={() => (muted = !muted)} aria-label={muted ? 'Sound on' : 'Sound off'}>
        <Icon name={muted ? 'volumeOff' : 'volume'} size={24} />{muted ? 'Sound' : 'Mute'}
      </button>
    {/if}
    <button class="done" onclick={onclose}>Close</button>
  </div>
</div>

<style>
  .cam { position: fixed; inset: 0; z-index: 55; background: #000; display: flex; flex-direction: column; }
  .media { position: relative; flex: 1; min-height: 0; }
  img, video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .hide { opacity: 0; }
  .wait { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, .4); }
  .bar { flex: none; display: flex; align-items: center; gap: 16px; padding: 14px 24px; background: #1c1c1e; color: #fff; }
  .txt { flex: 1; min-width: 0; }
  .title { font-size: 26px; font-weight: 800; letter-spacing: -.01em; }
  .sub { display: flex; align-items: center; gap: 10px; font-size: 17px; color: rgba(255, 255, 255, .7); }
  .spin { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, .3); border-top-color: #fff; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .bar button { height: 56px; padding: 0 26px; border-radius: 28px; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .snd { background: rgba(255, 255, 255, .16); color: #fff; }
  .done { background: #fff; color: #000; }
  .bar button:active { opacity: .7; }
</style>
