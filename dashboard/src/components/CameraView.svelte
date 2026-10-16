<script>
  // A camera full screen, opened by tapping it on the House tab: live video when the camera offers
  // it through Home Assistant (WebRTC, as the doorbell pop-up uses), otherwise its picture refreshed
  // every few seconds. Closes itself after OPEN_MS, so a battery camera isn't left streaming.
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { startLive } from '../lib/doorbell.svelte.js';
  import { ha, haUrl } from '../lib/ha.svelte.js';
  import { log } from '../lib/log.svelte.js';

  // onsnap: asks the camera for a new picture (a Ring camera's "Take Snapshot" through ring-mqtt), for
  // when there's no live video; age: how old the picture shown is, as text.
  // soundEntity: the same camera with sound but a smaller picture (Ring's own live view, when entity is
  // its sharper <name>_stream without audio): the Sound button switches to it, Sharper back.
  // takenAt: when the picture shown was taken (ms; 0 if unknown), shown as a clock time with seconds.
  // takenAt: { t, real }: when the picture was taken by the camera (real), or only loaded here.
  let { entity, soundEntity = null, name, picture = '', onclose, onsnap = null, age = '', takenAt = { t: 0, real: false } } = $props();
  // "Starting live video…", then with the seconds, then a word about why it can take a while: a
  // stream that goes through ring-mqtt and a transcoder starts in 10-25 s.
  const startingText = (now) => {
    const s = Math.round((now - openedAt) / 1000);
    return s < 6 ? 'Starting live video…' : s < 12 ? 'Starting live video… ' + s + ' s' : 'Still starting (the stream spins up on request, 10–25 s)… ' + s + ' s';
  };
  const taken = (p, now) => {
    if (!p || !p.t) return '';
    const s = Math.max(0, Math.round((now - p.t) / 1000));
    return (p.real ? 'taken ' : 'loaded ') + new Date(p.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' (' + (s < 90 ? s + ' s' : Math.round(s / 60) + ' min') + ' ago)';
  };
  let withSound = $state(false);
  let sharpFailed = $state(false); // the sharp stream didn't play here: stay on the camera's own view
  let source = $derived(withSound && soundEntity ? soundEntity : entity);
  let canSwitch = $derived(!!soundEntity && soundEntity !== entity && !sharpFailed);
  const OPEN_MS = 2 * 60 * 1000;
  const STILL_MS = 5000;
  const SNAP_MS = 15000;
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
  const KEYFRAME_WAIT_MS = 30000;
  const ANSWER_WAIT_MS = 30000; // for Home Assistant's answer when the stream has to start up first
  // The first big picture's wait, logged when slow (it has taken a minute on the frame's Wi-Fi).
  const openedAt = Date.now();
  let firstStill = true;
  function stillLoaded() {
    if (!firstStill) return;
    firstStill = false;
    const ms = Date.now() - openedAt;
    log(ms > 5000 ? 'camera.still_slow' : 'camera.still', { camera: entity, ms }, ms > 5000 ? 'warn' : 'info');
  }
  $effect(() => {
    if (!video) return;
    const cam = source; // switching between sharp and with-sound starts again
    live = false; noLive = false;
    let stop = null, gone = false, tries = 0, retry;
    const attempt = () => {
      const n = ++tries;
      startLive(cam, video, () => (live = true))
        // A slow first try that finishes after the retry began is closed, not kept.
        .then((s) => { if (gone || n !== tries) s && s(); else if (s) stop = s; else noLive = true; })
        .catch((e) => { console.error('camera live view', e); });
      // Video arriving but not yet shown is usually waiting for a keyframe (a whole picture to start
      // from), which a Ring camera sends only every so often, a battery one rarely: on 2026-10-15 the
      // frame had megabytes of video and 0 frames at 10 s. Starting over just waits for another, so
      // while bytes keep coming it waits on, up to KEYFRAME_WAIT_MS; with nothing coming it retries.
      const startedAt = Date.now();
      let lastBytes = 0, waited = false;
      let waitedAnswer = false;
      const check = async () => {
        if (live || gone || n !== tries) return;
        // Home Assistant failed the offer, usually because the stream was still starting: try the
        // same source again at once (the second start is warm and quick) before any fallback.
        if (stop && stop.failed && stop.failed()) return giveUp('offer failed');
        // No answer yet: the stream is still starting up (a transcoder spinning up, ring-mqtt starting
        // the Ring session). Give it ANSWER_WAIT_MS before falling back.
        if (stop && stop.answered && !stop.answered() && Date.now() - startedAt < ANSWER_WAIT_MS) {
          if (!waitedAnswer) { waitedAnswer = true; log('camera.waiting_answer', { camera: cam }); }
          retry = setTimeout(check, 3000);
          return;
        }
        const bytes = stop && stop.receivedBytes ? await stop.receivedBytes() : 0;
        if (live || gone || n !== tries) return;
        if (bytes > lastBytes && Date.now() - startedAt < KEYFRAME_WAIT_MS) {
          if (!waited) { waited = true; log('camera.waiting', { camera: cam, bytes }); }
          lastBytes = bytes;
          retry = setTimeout(check, 3000);
          return;
        }
        giveUp(bytes ? 'stalled' : 'silent');
      };
      // why: 'offer failed' (Home Assistant refused or timed out), 'silent' (nothing arrived),
      // 'stalled' (bytes arrived but no frame decoded within the wait).
      const giveUp = (why) => {
        if (live || gone) return;
        if (stop) { stop(); stop = null; }
        // A stream gets a second try (warm, quick) before anything else; one that still won't play
        // falls back to the camera's own live view (smaller, with sound), which gets two tries too.
        if (tries < 2) { log('camera.retry', { camera: cam, tries, why }, 'warn'); attempt(); return; }
        if (!withSound && soundEntity && soundEntity !== entity && !sharpFailed) { sharpFailed = true; withSound = true; log('camera.fallback', { camera: cam, to: soundEntity, why }, 'warn'); return; }
        log('camera.no_live', { camera: cam, tries, why }, 'warn'); noLive = true;
      };
      retry = setTimeout(check, RETRY_MS);
    };
    // Untracked: starting the video reads and writes state (the log, the connection), and none of it
    // may make this effect start again.
    untrack(attempt);
    // onclose and onsnap are read only when called: the House tab passes new functions whenever any
    // state changes, and reading them here would restart the video every few seconds.
    const close = setTimeout(() => onclose(), OPEN_MS);
    return () => { gone = true; clearTimeout(close); clearTimeout(retry); if (stop) stop(); };
  });
  // The "(25 s ago)" counts on while there's no live video (its own clock: tick reloads the picture).
  let clockNow = $state(Date.now());
  $effect(() => {
    if (live) return;
    const c = setInterval(() => (clockNow = Date.now()), 5000);
    return () => clearInterval(c);
  });
  // While video is starting, the picture keeps refreshing too (every STILL_MS), so what's shown is
  // current rather than the picture from when the view opened.
  $effect(() => {
    if (live || noLive) return;
    const t = setInterval(() => (tick = Date.now()), STILL_MS);
    return () => clearInterval(t);
  });
  // No live video: a new snapshot now and every SNAP_MS (a Ring camera keeps returning its last one
  // until asked for another), and the picture reloaded meanwhile to pick it up.
  $effect(() => {
    if (!noLive) return;
    // Called untracked as a whole: onsnap reads and writes the House tab's state, and run tracked here
    // it re-ran this effect at once, pressing "Take Snapshot" thousands of times (2026-10-15), which
    // flooded the connection until Home Assistant dropped it.
    const snap = () => untrack(() => { if (onsnap) onsnap(); });
    snap();
    const s = setInterval(snap, SNAP_MS);
    const t = setInterval(() => (tick = Date.now()), STILL_MS);
    return () => { clearInterval(t); if (s) clearInterval(s); };
  });
</script>

<div class="cam" role="dialog" aria-label={name}>
  <div class="media">
    {#if still}<img src={still} alt="" class:hide={live} onload={stillLoaded} onerror={() => log('camera.still_failed', { camera: entity }, 'warn')} />{/if}
    {#if !still && !live}<div class="wait"><Icon name="camera" size={56} /></div>{/if}
    <!-- svelte-ignore a11y_media_has_caption -->
    <!-- A transparent poster: WebView otherwise draws a big play icon before the first frame. -->
    <video bind:this={video} {muted} autoplay playsinline poster="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class:hide={!live}></video>
  </div>
  <div class="bar">
    <div class="txt">
      <div class="title">{name}</div>
      <div class="sub">
        {#if live}Live{withSound && !sharpFailed ? ' · with sound, lower quality' : ''}{:else if noLive}No live video right now · picture {takenAt.t ? taken(takenAt, clockNow) : age}{age === 'updating…' ? ', a new one on its way' : ''}
        {:else if ha.status === 'connected'}<span class="spin"></span>{startingText(clockNow)}{takenAt.t ? ' · picture ' + taken(takenAt, clockNow) : ''}{:else}Not connected to Home Assistant{/if}
      </div>
    </div>
    {#if canSwitch && (live || withSound)}
      <!-- The sharp stream has no sound: Sound switches to the camera's own live view, unmuted. -->
      <button class="snd" onclick={() => { withSound = !withSound; muted = !withSound; }} aria-label={withSound ? 'Sharper video, no sound' : 'Sound, lower quality video'}>
        <Icon name={withSound ? 'camera' : 'volume'} size={24} />{withSound ? 'Sharper' : 'Sound'}
      </button>
    {:else if live}
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
