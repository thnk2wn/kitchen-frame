<script>
  import Icon from '../components/Icon.svelte';
  import { ui, clock, calendar, weather, photos, messages, exitIdle, photosVisible } from '../lib/state.svelte.js';
  import { clockTime, longDate, weatherInfo, time, eventsOn } from '../lib/format.js';
  import { src, takeSlide } from '../lib/slides.js';
  import { nowPlaying } from '../lib/ha.svelte.js';
  import { notices, iconOf } from '../lib/notices.svelte.js';

  // StandBy-style idle screen: the iCloud album as a slideshow behind the clock, in the text colour
  // chosen in Settings. At night photos and text are dimmed (or photos are off, per Settings).
  const SLIDE_MS = 30000;
  const FADE_MS = 1200;

  let next = $derived((calendar.data ? eventsOn(calendar.data.events, clock.now) : [])
    .find((e) => !e.allDay && Date.parse(e.start) > clock.now.getTime()));
  let wx = $derived(weather.data);
  let playing = $derived(nowPlaying());
  let night = $derived(ui.theme === 'dark');
  // Paused while an agent message covers the screen.
  let covered = $derived(messages.items.length > 0 && !ui.demo);
  let showPhotos = $derived(photos.items.length > 0 && photosVisible() && !covered);

  // Up to two slides exist at once: the one showing and the one fading in over it.
  let layers = $state([]);
  let serial = 0;

  async function advance() {
    const items = await takeSlide(); // already downloaded and decoded (see lib/slides.js)
    if (!items) return;
    const layer = { key: ++serial, items, shown: false };
    layers = [...layers.slice(-1), layer];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layers = layers.map((l) => (l.key === layer.key ? { ...l, shown: true } : l));
      setTimeout(() => (layers = layers.filter((l) => l.key >= layer.key)), FADE_MS + 100);
    }));
  }

  $effect(() => {
    if (!showPhotos) { layers = []; return; }
    advance();
    const timer = setInterval(advance, SLIDE_MS);
    return () => clearInterval(timer);
  });
</script>

<button class="standby" class:night class:photos={showPhotos} style="--clock:{ui.clockColor}" onclick={exitIdle} aria-label="Show dashboard">
  {#if showPhotos}
    <div class="slides" aria-hidden="true">
      {#each layers as layer (layer.key)}
        <div class="slide" class:in={layer.shown} class:pair={layer.items.length === 2}>
          {#each layer.items as p (p.id)}<img src={src(p)} alt="" />{/each}
        </div>
      {/each}
    </div>
    <div class="scrim"></div>
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
        <div class="notice tone-{n.tone}"><Icon name={iconOf(n.tone)} size={24} /><span>{n.title || n.message}{notices().length > 1 ? ' +' + (notices().length - 1) : ''}</span></div>
      {/if}
      {#if next}
        <div class="next"><span>{next.title}</span><span class="num">{time(new Date(next.start))}</span></div>
      {/if}
    </div>
  </div>
</button>

<style>
  .standby { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 10; background: #000; color: #fff; overflow: hidden; }
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
  .notice.tone-info { background: #007aff; }
  .notice span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* After sunset: same colour, dimmer, and photos dimmed, so the kitchen isn't lit up. */
  .night .info { opacity: .7; }
  .night .slides { opacity: .45; }

  /* Photo mode: photos fill the screen, the clock moves to the bottom over a dark fade. */
  .slides { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }
  .slide { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; gap: 4px; opacity: 0; transition: opacity 1.2s ease-out; }
  .slide.in { opacity: 1; }
  .slide img { flex: 1; min-width: 0; height: 100%; object-fit: cover; object-position: 50% 35%; }
  .scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 55%; background: linear-gradient(0deg, rgba(0, 0, 0, .72), rgba(0, 0, 0, 0)); }
  .photos .info { align-items: flex-end; padding: 0 56px 40px; gap: 40px; }
  .photos .clock { font-size: 168px; }
  .photos .side { padding: 0 0 12px; gap: 12px; }
  .photos .date { font-size: 26px; opacity: .9; }
  .photos .wx { font-size: 34px; }
  .photos .next { font-size: 22px; }
  .photos .next .num { opacity: .85; }
</style>
