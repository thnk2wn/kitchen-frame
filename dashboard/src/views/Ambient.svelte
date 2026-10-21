<script>
  import Txt from '../components/Txt.svelte';
  import Icon from '../components/Icon.svelte';
  import { ui, clock, calendar, weather, photos, messages, exitIdle, photosVisible } from '../lib/state.svelte.js';
  import { clockTime, longDate, weatherInfo, time, eventsOn, formatDate } from '../lib/format.js';
  import { src, takeSlide, lightOf, asVideo, takeVideo, videoSrc } from '../lib/slides.js';
  import { nowPlaying } from '../lib/ha.svelte.js';
  import { notices, iconOf, startedAt } from '../lib/notices.svelte.js';
  import { night as nightMode } from '../lib/night.svelte.js';
  import { roomLight } from '../lib/roomlight.svelte.js';

  // StandBy-style idle screen: the iCloud album as a slideshow behind the clock, in the text colour
  // chosen in Settings. At night photos and text are dimmed (or photos are off, per Settings).
  // How long each slide shows. A video is cut off here too, so the Mac sends only this much of one
  // (photos.clip in the Worker's bridge config, worker/index.js): change both together.
  const SLIDE_MS = 30000;
  const FADE_MS = 1200;

  let next = $derived((calendar.data ? eventsOn(calendar.data.events, clock.now) : [])
    .find((e) => !e.allDay && Date.parse(e.start) > clock.now.getTime()));
  let wx = $derived(weather.data);
  let playing = $derived(nowPlaying());
  // After sunset the photos and text dim, unless "Dim when dark" finds the room still lit.
  let night = $derived(ui.theme === 'dark' && !(ui.nightPhotosMode === 'auto' && roomLight.lit === true));
  // Night hours (Settings → Night) have their own text colour.
  let color = $derived(nightMode.active && nightMode.color !== 'day' ? nightMode.color : ui.clockColor);
  // Paused while an agent message covers the screen.
  let covered = $derived(messages.items.length > 0 && !ui.demo);
  let showPhotos = $derived(photos.items.length > 0 && photosVisible() && !covered);

  // Settings → Photo details: "October 3, 2026 · Asheville, NC" (the place comes only from the Mac
  // bridge, which looks it up there; a public album link gives the date alone).
  // A bright photo gets more shade where text sits over it, so a white photo and a white clock don't
  // clash (lib/slides.js measures it): a deeper fade behind the clock, and a soft shade behind the
  // details. Dark photos keep the light fade. No boxes behind text.
  const BRIGHT = 0.55;
  let brightBottom = $derived((layers.at(-1)?.items || []).some((p) => (lightOf(p.id)?.bottom ?? 0) > BRIGHT));
  const brightCorner = (p) => (lightOf(p.id)?.corner ?? 0) > BRIGHT;

  const details = (p) => [p.date ? formatDate(new Date(p.date), { month: 'long', day: 'numeric', year: 'numeric' }) : '', p.place || '']
    .filter(Boolean).join(' · ');

  // A video slide: the prepared player (lib/slides.js) goes in over the still, muted, and plays until the
  // slide changes; one revisited by a swipe back gets a new player. Stopped and let go when it leaves.
  function video(node, p) {
    const v = takeVideo(p) || Object.assign(document.createElement('video'), { muted: true, playsInline: true, loop: true, src: videoSrc(p) });
    v.className = 'vid';
    node.append(v);
    v.play().catch(() => {});
    return { destroy() { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } };
  }

  // Up to two slides exist at once: the one showing and the one fading in over it.
  let layers = $state([]);
  let serial = 0;

  // What's been shown, for a swipe back (the last HISTORY slides); at is the one showing.
  const HISTORY = 20;
  let shown = [];
  let at = -1;

  // dir 1: the next slide (forward through history first, after swiping back); -1: the one before.
  async function advance(dir = 1) {
    let items;
    if (dir < 0) {
      if (at <= 0) return;
      items = shown[--at];
    } else if (at < shown.length - 1) {
      items = shown[++at];
    } else {
      items = await takeSlide(); // already downloaded and decoded (see lib/slides.js)
      if (!items) return;
      shown = [...shown, items].slice(-HISTORY);
      at = shown.length - 1;
    }
    const layer = { key: ++serial, items, shown: false };
    layers = [...layers.slice(-1), layer];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layers = layers.map((l) => (l.key === layer.key ? { ...l, shown: true } : l));
      setTimeout(() => (layers = layers.filter((l) => l.key >= layer.key)), FADE_MS + 100);
    }));
  }

  let timer = null;
  const restartTimer = () => { clearInterval(timer); timer = setInterval(() => advance(1), SLIDE_MS); };
  $effect(() => {
    if (!showPhotos) { layers = []; return; }
    advance(1);
    restartTimer();
    return () => clearInterval(timer);
  });

  // A swipe changes the photo without waking the dashboard: right to left for the next, left to
  // right for the one before. A tap (the browser's click, which a swipe doesn't fire) still wakes it.
  // Mostly sideways, at least SWIPE_PX, within a second; anything else is a tap.
  const SWIPE_PX = 60;
  let start = null;
  let swiped = 0;
  function down(e) { start = { x: e.clientX, y: e.clientY, t: Date.now() }; }
  function up(e) {
    if (!start || !showPhotos) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, quick = Date.now() - start.t < 1000;
    start = null;
    if (!quick || Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
    swiped = Date.now();
    advance(dx < 0 ? 1 : -1);
    restartTimer();
  }
  // Some WebViews still send a click after a short swipe: ignore one that close behind it.
  const tap = () => { if (Date.now() - swiped > 400) exitIdle(); };
</script>

<button class="standby" class:night class:photos={showPhotos} style="--clock:{color}" onclick={tap} onpointerdown={down} onpointerup={up} onpointercancel={() => (start = null)} aria-label="Show dashboard">
  {#if showPhotos}
    <div class="slides" aria-hidden="true">
      {#each layers as layer (layer.key)}
        <div class="slide" class:in={layer.shown} class:pair={layer.items.length === 2}>
          {#each layer.items as p (p.id)}
            <div class="ph"><img src={src(p)} alt="" />{#if asVideo(p)}<div class="vidbox" use:video={p}></div>{/if}{#if ui.photoDetails && details(p)}{#if brightCorner(p)}<div class="shade"></div>{/if}<span class="cap">{details(p)}</span>{/if}</div>
          {/each}
        </div>
      {/each}
    </div>
    <div class="scrim"></div>
    <div class="scrim deep" class:on={brightBottom}></div>
  {/if}

  <div class="info">
    <div class="clock num">{clockTime(clock.now)}</div>
    <div class="side">
      <div class="date">{longDate(clock.now)}</div>
      {#if wx}
        <div class="wx"><Icon name={weatherInfo(wx.code, wx.day).icon} size={40} /><span class="num">{wx.temp}°</span></div>
      {/if}
      {#if playing}
        <div class="music"><Icon name="music" size={24} /><span>{playing.media_title}{playing.media_artist ? ' · ' + playing.media_artist : ''}</span></div>
      {/if}
      {#if notices().length}
        {@const n = notices()[0]}
        <div class="notice tone-{n.tone}"><Icon name={iconOf(n.tone)} size={24} /><span>{n.title || n.message}{notices().length > 1 ? ' +' + (notices().length - 1) : ''}</span>{#if startedAt(n, clock.now)}<small class="at">{startedAt(n, clock.now)}</small>{/if}</div>
      {/if}
      {#if next}
        <div class="next"><span><Txt text={next.title} /></span><span class="num">{time(new Date(next.start))}</span></div>
      {/if}
    </div>
  </div>
</button>

<style>
  /* touch-action: the browser leaves swipes to us (otherwise it may claim them to scroll). */
  .standby { touch-action: none;  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 10; background: #000; color: #fff; overflow: hidden; }
  /* All clock-screen text takes the colour chosen in Settings (white by default). */
  .info { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; gap: 56px; padding: 0 72px; color: var(--clock); }
  .clock { font-size: 300px; font-weight: 600; line-height: 1; letter-spacing: -.04em; }
  .side { display: flex; flex-direction: column; gap: 22px; min-width: 0; padding-top: 40px; }
  .date { font-size: 30px; font-weight: 600; opacity: .75; }
  .wx { display: flex; align-items: center; gap: 12px; font-size: 44px; font-weight: 300; }
  .next { display: flex; flex-direction: column; gap: 4px; font-size: 26px; font-weight: 600; }
  .next .num { font-weight: 400; opacity: .75; }
  .music { display: flex; align-items: center; gap: 10px; max-width: 560px; font-size: 24px; font-weight: 600; }
  .music span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .photos .music { font-size: 20px; max-width: 520px; }
  /* A Home Assistant notice keeps its own colour over the clock colour, so it stands out. Its tone
     classes are prefixed: a bare "info" would pick up the .info layout above. */
  .notice { align-self: flex-start; display: flex; align-items: center; gap: 10px; max-width: 560px; padding: 8px 16px; border-radius: 16px; background: #ff9500; color: #fff; font-size: 22px; font-weight: 700; }
  .notice.tone-alert { background: #ff3b30; }
  .notice .at { flex: none; font-size: 17px; font-weight: 600; opacity: .85; }
  .notice.tone-info { background: #007aff; }
  .notice span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* After sunset: same colour, dimmer, and photos dimmed, so the kitchen isn't lit up. */
  .night .info { opacity: .7; }
  .night .slides { opacity: .45; }

  /* Photo mode: photos fill the screen, the clock moves to the bottom over a dark fade. */
  .slides { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }
  .slide { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; gap: 4px; opacity: 0; transition: opacity 1.2s ease-out; }
  .slide.in { opacity: 1; }
  .ph { position: relative; flex: 1; min-width: 0; height: 100%; }
  .ph img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 35%; }
  /* A video over its still, filling the same space (the still shows until its first frame). */
  .vidbox { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }
  .vidbox :global(.vid) { width: 100%; height: 100%; object-fit: cover; object-position: 50% 35%; }
  /* Top right of each photo: the clock and date have the bottom. A small shadow keeps it readable. */
  .cap { position: absolute; top: 20px; right: 24px; font-size: 19px; font-weight: 600; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, .7); }
  .scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 55%; background: linear-gradient(0deg, rgba(0, 0, 0, .72), rgba(0, 0, 0, 0)); }
  /* Over a bright photo: a second, taller fade, faded in (opacity only, cheap on the frame's GPU). */
  .scrim.deep { height: 70%; background: linear-gradient(0deg, rgba(0, 0, 0, .6) 0%, rgba(0, 0, 0, .35) 45%, rgba(0, 0, 0, 0)); opacity: 0; transition: opacity 1.2s ease-out; }
  .scrim.deep.on { opacity: 1; }
  /* Behind the details on a bright corner: a soft shade that fades out every way, no edge. */
  .shade { position: absolute; top: 0; right: 0; width: 460px; height: 150px; background: radial-gradient(ellipse at 100% 0%, rgba(0, 0, 0, .5), rgba(0, 0, 0, 0) 70%); }
  .photos .info { align-items: flex-end; padding: 0 56px 40px; gap: 40px; }
  .photos .clock { font-size: 168px; }
  .photos .side { padding: 0 0 12px; gap: 12px; }
  .photos .date { font-size: 26px; opacity: .9; }
  .photos .wx { font-size: 34px; }
  .photos .next { font-size: 22px; }
  .photos .next .num { opacity: .85; }
</style>
