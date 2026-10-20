<script>
  // Full screen when a doorbell rings (lib/doorbell.svelte.js): live video once it starts, the
  // latest snapshot until then. Closes itself after a while, or on Dismiss.
  import Icon from './Icon.svelte';
  import { bell, dismiss, startLive } from '../lib/doorbell.svelte.js';
  import { haUrl } from '../lib/ha.svelte.js';
  import { haImage } from '../lib/ha-image.js';
  import { time } from '../lib/format.js';
  import { log } from '../lib/log.svelte.js';

  let d = $derived(bell.ringing);
  let video = $state();
  let live = $state(false);
  let muted = $state(true);

  // The still: its entity_picture carries a rotating token, and a new snapshot bumps the timestamp.
  let still = $derived.by(() => {
    if (!d || !d.still) return null;
    const s = bell.states[d.still];
    const pic = s && s.attributes && s.attributes.entity_picture;
    return pic ? haUrl(pic) + '&t=' + (s.attributes.timestamp || s.attributes.access_token || '') : null;
  });

  // d.video is the sharper <name>_stream camera when there is one, which has no sound; Sound switches
  // to the doorbell's own live view (smaller picture, with sound), Sharper back. Each ring starts sharp.
  let withSound = $state(false);
  let sharpFailed = $state(false); // the sharp stream didn't play: stay on the doorbell's own view
  let canSwitch = $derived(!!d && !!d.video && d.video !== d.live && !sharpFailed);
  $effect(() => { if (d) { d.at; withSound = false; sharpFailed = false; muted = true; } });

  // Ring to live video, once per ring (worker/frame.js keeps it as a metric).
  let loggedRing = 0;
  $effect(() => {
    if (!live || !d || loggedRing === d.at) return;
    loggedRing = d.at;
    log('doorbell.live', { doorbell: d.name || d.entity, ms: Date.now() - d.at, test: d.test || undefined });
  });

  // Start the live view when a ring opens the pop-up (or the source switches); stop it when it closes.
  $effect(() => {
    if (!d || !d.live || !video) return;
    const cam = withSound || !d.video ? d.live : d.video;
    let stop = null, gone = false;
    live = false;
    startLive(cam, video, () => (live = true))
      .then((s) => { if (gone) s && s(); else stop = s; })
      .catch((e) => console.error('doorbell live view', e));
    // The sharp stream not playing within 10 s (a doorbell's large picture can be too much for the
    // frame's video decoder): fall back to the doorbell's own live view.
    const fallback = cam !== d.live ? setTimeout(() => { if (!live && !gone) { sharpFailed = true; withSound = true; } }, 10000) : null;
    return () => { gone = true; live = false; clearTimeout(fallback); if (stop) stop(); };
  });
</script>

{#if d}
  <div class="door" role="alertdialog" aria-label="{d.name} doorbell">
    <div class="media">
      {#if still}<img {@attach haImage(still)} alt="" class:hide={live} />{/if}
      {#if !still && !live}<div class="wait"><Icon name="camera" size={56} /></div>{/if}
      <!-- svelte-ignore a11y_media_has_caption -->
      <!-- A transparent poster: WebView otherwise draws a big play icon before the first frame. -->
    <video bind:this={video} {muted} autoplay playsinline poster="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class:hide={!live}></video>
    </div>
    <div class="bar">
      <span class="ic"><Icon name="bell" size={28} /></span>
      <div class="txt">
        <div class="title">{d.name}</div>
        <div class="sub">{d.test ? 'Test ring' : 'Someone’s at the door'} · {time(new Date(d.at))}{#if d.live && !live} · connecting…{:else if withSound && !sharpFailed} · with sound, lower quality{/if}</div>
      </div>
      {#if canSwitch && (live || withSound)}
        <button class="snd" onclick={() => { withSound = !withSound; muted = !withSound; }} aria-label={withSound ? 'Sharper video, no sound' : 'Sound, lower quality video'}>
          <Icon name={withSound ? 'camera' : 'volume'} size={24} />{withSound ? 'Sharper' : 'Sound'}
        </button>
      {:else if live}
        <button class="snd" onclick={() => (muted = !muted)} aria-label={muted ? 'Sound on' : 'Sound off'}>
          <Icon name={muted ? 'volumeOff' : 'volume'} size={24} />{muted ? 'Sound' : 'Mute'}
        </button>
      {/if}
      <button class="done" onclick={dismiss}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .door { position: fixed; inset: 0; z-index: 60; background: #000; display: flex; flex-direction: column; }
  .media { position: relative; flex: 1; min-height: 0; }
  img, video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .hide { opacity: 0; }
  .wait { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, .4); }
  .bar { flex: none; display: flex; align-items: center; gap: 16px; padding: 14px 24px; background: #1c1c1e; color: #fff; }
  .ic { flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--orange); }
  .txt { flex: 1; min-width: 0; }
  .title { font-size: 26px; font-weight: 800; letter-spacing: -.01em; }
  .sub { font-size: 17px; color: rgba(255, 255, 255, .7); }
  .bar button { height: 56px; padding: 0 26px; border-radius: 28px; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .snd { background: rgba(255, 255, 255, .16); color: #fff; }
  .done { background: var(--orange); color: #fff; }
  .bar button:active { opacity: .7; }
</style>
