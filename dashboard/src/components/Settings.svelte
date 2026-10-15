<script>
  import Icon from './Icon.svelte';
  import { ui, calendar, photos, setSetting, announceTarget } from '../lib/state.svelte.js';
  import { ha, haConfigured, nowPrefs, setNowTv } from '../lib/ha.svelte.js';
  import { night, setNight, dayBrightness, setDayBrightness } from '../lib/night.svelte.js';
  // Speaker offered for reading agent messages aloud: the chosen one, else the fallback (first speaker).
  let announceSpeaker = $derived(ha.players.find((p) => p.entity_id === ui.announceOn) || announceTarget() || ha.players[0]);
  import { api } from '../lib/api.js';
  import { time } from '../lib/format.js';

  const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
  const IDLE = [[15, '15 min'], [30, '30 min'], [60, '1 hr'], [120, '2 hr'], [0, 'Never']];
  // Slideshow clock colours: white plus the iOS system colours that read well over photos.
  // At night: red by default (easy on dark-adapted eyes, like StandBy), or the daytime colour.
  const NIGHT_CLOCK = [['#ff453a', 'Red'], ['#ff9f0a', 'Orange'], ['#ffd60a', 'Yellow'], ['day', 'Same as day']];
  const CLOCK = [['#ffffff', 'White'], ['#ffd60a', 'Yellow'], ['#ff9f0a', 'Orange'], ['#ff375f', 'Pink'], ['#bf5af2', 'Purple'], ['#64d2ff', 'Blue'], ['#30d158', 'Green']];
  const close = () => (ui.settingsOpen = false);
  let reloading = $state(false);
  // The running version: the hash in the page's script name (a new deploy changes it).
  const version = ((/assets\/index-([\w-]+)\.js/.exec(document.documentElement.innerHTML) || [])[1] || 'dev').slice(0, 6);

  // Brightness goes through the kiosk app (window.FrameKiosk); not available in a normal browser.
  const kiosk = typeof window !== 'undefined' ? window.FrameKiosk : null;
  // The daytime level: night mode (lib/night.svelte.js) dims below it and gives it back each morning.
  const saved = kiosk ? dayBrightness() : -1;
  let brightness = $state(saved < 0 ? 100 : Math.round(saved * 100));
  const setBrightness = () => kiosk && setDayBrightness(brightness / 100);
  // Night hours, every half hour: evenings from 8 PM, mornings to 9 AM.
  const half = (from, to) => { const out = []; for (let m = from; m <= to; m += 30) out.push(String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')); return out; };
  const EVENINGS = half(20 * 60, 25 * 60), MORNINGS = half(4 * 60, 9 * 60);
  const nice = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM'); };
  // Pull the calendar fresh from its feeds, then restart the page.
  async function reload() {
    reloading = true;
    try { await api('/api/calendar?refresh'); } catch {}
    location.reload();
  }
  // Timer alerts: "Announce" notify entities (Echos through Alexa Devices), kitchen ones first, up to 3.
  import { timerSpeakerId, setTimerSpeaker } from '../lib/timers.svelte.js';
  import { bell, ring } from '../lib/doorbell.svelte.js';
  import { presence, presenceArea } from '../lib/presence.svelte.js';
  let announcers = $derived(ha.notify.filter((n) => /_announce$/.test(n.entity_id))
    .sort((a, b) => (/kitchen/i.test(b.entity_id) - /kitchen/i.test(a.entity_id)) || a.name.localeCompare(b.name)).slice(0, 3));
</script>

<!-- Tap outside the sheet to close; the sheet itself swallows the tap. -->
<div class="scrim" onclick={close} role="presentation">
  <section class="panel sheet" role="dialog" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>Settings</h2>
      <button class="done" onclick={close}>Done</button>
    </header>

    <div class="row">
      <span>Appearance</span>
      <div class="seg">
        {#each THEMES as [v, label] (v)}
          <button class:on={ui.themePref === v} onclick={() => setSetting('themePref', v)}>{label}</button>
        {/each}
      </div>
    </div>
    <p class="hint">Auto follows sunrise and sunset.</p>

    <div class="row">
      <span>Clock screen color<small>The clock shown when the frame is idle</small></span>
      <div class="swatches">
        {#each CLOCK as [c, name] (c)}
          <button class="swatch" class:on={ui.clockColor === c} style="--c:{c}" aria-label={name} onclick={() => setSetting('clockColor', c)}></button>
        {/each}
      </div>
    </div>

    <div class="row">
      <span>Clock screen after<small>{presenceArea() && presence.sensors.length ? 'Once no one’s in the ' + presenceArea() : 'Without a touch'}</small></span>
      <div class="seg">
        {#each IDLE as [v, label] (v)}
          <button class:on={ui.idleMinutes === v} onclick={() => setSetting('idleMinutes', v)}>{label}</button>
        {/each}
      </div>
    </div>

    {#if ha.players.some((p) => p.tv)}
      <div class="row">
        <span>Now Playing<small>On Home and the top bar</small></span>
        <div class="seg">
          <button class:on={nowPrefs.tv} onclick={() => setNowTv(true)}>Music and TV</button>
          <button class:on={!nowPrefs.tv} onclick={() => setNowTv(false)}>Music only</button>
        </div>
      </div>
    {/if}

    <div class="row">
      <span>Photos after sunset</span>
      <div class="seg">
        <button class:on={ui.nightPhotos} onclick={() => setSetting('nightPhotos', true)}>Dimmed</button>
        <button class:on={!ui.nightPhotos} onclick={() => setSetting('nightPhotos', false)}>Off</button>
      </div>
    </div>

    <div class="row">
      <span>Night<small>{night.on ? 'A dim clock; motion doesn’t wake it' : 'Same as day'}</small></span>
      <div class="nightset">
        {#if night.on}
          <select value={night.from} onchange={(e) => setNight({ from: e.currentTarget.value })} aria-label="Night starts">
            {#each EVENINGS as t (t)}<option value={t}>{nice(t)}</option>{/each}
          </select>
          <span class="to">to</span>
          <select value={night.to} onchange={(e) => setNight({ to: e.currentTarget.value })} aria-label="Night ends">
            {#each MORNINGS as t (t)}<option value={t}>{nice(t)}</option>{/each}
          </select>
        {/if}
        <div class="seg">
          <button class:on={night.on} onclick={() => setNight({ on: true })}>On</button>
          <button class:on={!night.on} onclick={() => setNight({ on: false })}>Off</button>
        </div>
      </div>
    </div>

    {#if night.on}
      <div class="row">
        <span>Night clock color</span>
        <div class="swatches">
          {#each NIGHT_CLOCK as [c, name] (c)}
            <button class="swatch" class:on={night.color === c} class:day={c === 'day'} style="--c:{c === 'day' ? ui.clockColor : c}" aria-label={name} onclick={() => setNight({ color: c })}></button>
          {/each}
        </div>
      </div>
    {/if}

    {#if kiosk}
      <div class="row">
        <span>Brightness{#if night.on}<small>By day</small>{/if}</span>
        <div class="bright">
          <Icon name="sun" size={18} />
          <input type="range" min="5" max="100" step="5" bind:value={brightness} oninput={setBrightness} aria-label="Brightness" style="--pct:{((brightness - 5) / 95) * 100}%" />
          <Icon name="sun" size={26} />
        </div>
      </div>
    {/if}

    {#if haConfigured() && announceSpeaker}
      <div class="row">
        <span>Read messages aloud<small>{night.on ? 'Not at night' : 'Not 10 PM–7 AM'}</small></span>
        <div class="seg">
          <button class:on={ui.announceOn === announceSpeaker.entity_id} onclick={() => setSetting('announceOn', announceSpeaker.entity_id)}>{announceSpeaker.label}</button>
          <button class:on={ui.announceOn === 'off'} onclick={() => setSetting('announceOn', 'off')}>Off</button>
        </div>
      </div>
    {/if}

    {#if haConfigured() && announcers.length}
      <div class="row">
        <span>Timer alerts<small>Also said on a speaker</small></span>
        <select class="pick" value={timerSpeakerId() || 'off'} onchange={(e) => setTimerSpeaker(e.currentTarget.value)} aria-label="Speaker for timer alerts">
          {#each announcers as n (n.entity_id)}<option value={n.entity_id}>{n.name.replace(/\s*announce$/i, '')}</option>{/each}
          <option value="off">Off</option>
        </select>
      </div>
    {/if}

    {#if bell.doorbells.length}
      <div class="row">
        <span>Doorbell<small>{bell.doorbells.map((d) => d.name).join(', ')} shows here when it rings</small></span>
        <button class="reload" onclick={() => { close(); ring({ ...bell.doorbells[0], test: true }); }}><Icon name="bell" size={20} />Test</button>
      </div>
    {/if}

    <div class="row">
      <span>Demo mode<small>Sample data, for showing people</small></span>
      <div class="seg">
        <button class:on={ui.demo} onclick={() => setSetting('demo', true)}>On</button>
        <button class:on={!ui.demo} onclick={() => setSetting('demo', false)}>Off</button>
      </div>
    </div>

    <div class="row last">
      <span>{ui.demo ? 'Showing demo data' : (calendar.data ? 'Calendar updated ' + time(new Date(calendar.data.updated)) : 'Calendar not loaded') + ' · ' + photos.items.length + ' photos'} · version {version}</span>
      <button class="reload" disabled={reloading} onclick={reload}><Icon name="reload" size={20} />{reloading ? 'Reloading…' : 'Reload'}</button>
    </div>
  </section>
</div>

<style>
  .scrim { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 20; background: rgba(0, 0, 0, .45); display: grid; place-items: center; }
  /* Taller than the screen now: it scrolls, with its heading and Done kept at the top. */
  .panel { width: 640px; max-height: calc(100% - 32px); overflow-y: auto; overscroll-behavior: contain; padding: 22px 28px 10px; }
  header { position: sticky; top: -22px; z-index: 1; display: flex; align-items: center; justify-content: space-between; margin: -22px 0 6px; padding: 22px 0 8px; background: var(--sheet); }
  h2 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
  .done { font-size: 20px; font-weight: 600; color: var(--blue-text); padding: 8px 0 8px 16px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 64px; padding: 8px 0; border-top: 1px solid var(--sep); font-size: 20px; }
  .row.last { color: var(--secondary); font-size: 17px; }
  .hint { margin: -6px 0 8px; font-size: 15px; color: var(--secondary); }
  .seg { display: flex; padding: 3px; border-radius: 11px; background: var(--track); }
  .nightset { display: flex; align-items: center; gap: 8px; }
  .nightset select { height: 44px; padding: 0 10px; border: 0; border-radius: 9px; background: var(--fill); font: inherit; font-size: 17px; color: var(--label); }
  .nightset .to { font-size: 16px; color: var(--secondary); }
  .seg button { min-width: 84px; height: 40px; padding: 0 14px; border-radius: 9px; font-size: 17px; font-weight: 500; text-align: center; }
  .seg button.on { background: var(--thumb); font-weight: 600; }
  .seg button:not(.on):active { opacity: .5; }
  .row small { display: block; font-size: 15px; color: var(--secondary); margin-top: 2px; }
  /* A setting's name never wraps; its controls take the rest of the row. */
  .row > span:first-child { flex: none; white-space: nowrap; }
  .row.last > span:first-child { flex: 1 1 auto; white-space: normal; }
  .pick { height: 44px; max-width: 260px; padding: 0 12px; border: 0; border-radius: 11px; background: var(--fill); font: inherit; font-size: 18px; color: var(--label); }
  .swatches { display: flex; gap: 10px; }
  .swatch { width: 36px; height: 36px; border-radius: 50%; background: var(--c); border: 1px solid var(--sep); }
  /* Selected: a ring just outside the swatch. */
  .swatch.on { outline: 2px solid var(--label); outline-offset: 3px; }
  .swatch:active { opacity: .7; }
  /* "Same as day": the daytime colour as a smaller dot inside a dashed ring. */
  .swatch.day { border: 2px dashed var(--secondary); padding: 6px; background-clip: content-box; }
  .bright { display: flex; align-items: center; gap: 12px; color: var(--secondary); }
  /* Native range input, restyled flat: grey track, white round thumb. */
  input[type='range'] { -webkit-appearance: none; appearance: none; width: 300px; height: 6px; border-radius: 3px; outline: none;
    background: linear-gradient(90deg, var(--blue) var(--pct), var(--tertiary) var(--pct)); }
  input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 30px; height: 30px; border-radius: 50%; background: #fff; border: 1px solid var(--sep); }
  .reload { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 11px; background: var(--track); color: var(--label); font-size: 17px; font-weight: 600; }
  .reload:active, .reload:disabled { opacity: .6; }
</style>
