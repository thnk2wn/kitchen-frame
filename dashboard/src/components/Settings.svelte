<script>
  // "42 MB of 1 GB (4%)": Cloudflare's free storage, which photos and videos from the Mac bridge use.
  const storageText = (st) => {
    const mb = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : Math.round(b / 1024 ** 2) + ' MB');
    return mb(st.bytes) + ' of ' + mb(st.limit) + ' (' + Math.round((st.bytes / st.limit) * 100) + '%) · ' + st.videos + (st.videos === 1 ? ' video' : ' videos');
  };
  import Icon from './Icon.svelte';
  import { ui, calendar, photos, paprika, loadPaprika, setSetting, calendarNames } from '../lib/state.svelte.js';
  import { calColorVars, formatDate } from '../lib/format.js';
  import { say as realSay, setSay as realSetSay, speakers, speaker, speak } from '../lib/announce.svelte.js';
  // Demo mode shows Announcements set up, on invented speakers, without touching the real settings
  // (and nothing is said in demo mode).
  const DEMO_SPEAKERS = [{ entity_id: 'demo.kitchen', label: 'Kitchen' }, { entity_id: 'demo.living', label: 'Living Room' }, { entity_id: 'demo.office', label: 'Office' }];
  const demoSay = $state({ on: true, speaker: 'demo.kitchen', volume: 0.4, alertVolume: 0.7, messages: true,
    reminders: { cals: { Family: true, 'Tennessee Football': true }, lead: 30, own: true },
    alerts: { red: true, night: true, repeat: false, orange: false } });
  let say = $derived(ui.demo ? demoSay : realSay);
  const setSay = (c) => (ui.demo ? Object.assign(demoSay, c) : realSetSay(c));
  let speakerList = $derived(ui.demo ? DEMO_SPEAKERS : speakers());
  let current = $derived(ui.demo ? DEMO_SPEAKERS.find((p) => p.entity_id === demoSay.speaker) : speaker());
  // Sections, as tabs at the top; the last one chosen is remembered.
  const TABS = [['display', 'Display'], ['announce', 'Announcements'], ['home', 'Home'], ['about', 'About']];
  const asked = new URLSearchParams(location.search).get('settings');
  let tab = $state(TABS.some(([v]) => v === asked) ? asked : (() => { try { return localStorage.getItem('frame-settings-tab') || 'display'; } catch { return 'display'; } })());
  $effect(() => { try { localStorage.setItem('frame-settings-tab', tab); } catch {} });
  // About shows when recipes last synced: Paprika's data otherwise loads only with the Recipes tab.
  $effect(() => { if (tab === 'about' && !ui.demo) loadPaprika(); });
  let testing = $state(false);
  async function test(alert) {
    testing = true;
    try { await speak(alert ? 'This is a test alert from the kitchen frame.' : 'This is a test announcement from the kitchen frame.', { alert, kind: 'test' }); } catch {}
    setTimeout(() => (testing = false), 4000);
  }
  import { ha, haConfigured, nowPrefs, setNowTv } from '../lib/ha.svelte.js';
  import { night, setNight, dayBrightness, setDayBrightness } from '../lib/night.svelte.js';
  import { api } from '../lib/api.js';
  import { checkIn } from '../lib/checkin.js';
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
  // A time today ("10:15 PM"), or with its day ("Wed 3:12 PM").
  const when = (t) => { const d = new Date(t); return d.toDateString() === new Date().toDateString() ? time(d) : formatDate(d, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  const version = ((/assets\/index-([\w-]+)\.js/.exec(document.documentElement.innerHTML) || [])[1] || 'dev').slice(0, 6);
  // And when it was built (vite.config.js), e.g. "Oct 15, 10:24 PM".
  /* global __BUILT_AT__, __RELEASE__ */
  const release = typeof __RELEASE__ === 'string' ? __RELEASE__ : '';
  const built = typeof __BUILT_AT__ === 'string' ? formatDate(new Date(__BUILT_AT__), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

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
    try { sessionStorage.setItem('frame-reload-reason', 'manual'); } catch {}
    try { await checkIn(); } catch {} // send what the frame logged first
    location.reload();
  }
  // Timer alerts: "Announce" notify entities (Echos through Alexa Devices), kitchen ones first, up to 3.
  import { timerSpeakerId, setTimerSpeaker, timerSpeakers } from '../lib/timers.svelte.js';
  import { bell, ring } from '../lib/doorbell.svelte.js';
  import { presence, presenceArea, ignored, setIgnored } from '../lib/presence.svelte.js';
  import { roomLight, darkLux } from '../lib/roomlight.svelte.js';
  // What "Photos after sunset" is doing right now, under its buttons.
  const nightPhotosHint = () => ui.nightPhotosMode === 'off' ? 'No photos on the clock screen after sunset'
    : ui.nightPhotosMode === 'on' ? 'Dimmed from sunset'
    : roomLight.lit == null ? 'No light sensor found in the room: dims from sunset'
    : 'Room ' + (roomLight.lit ? 'lit' : 'dark') + ' (' + Math.round(roomLight.lux) + ' lux, dark at ' + darkLux() + ' or less): ' + (roomLight.lit ? 'photos at full strength' : 'photos dimmed');
  import { recent } from '../lib/log.svelte.js';
  import { pin, anyPin, pinAvailable, confirmPin, enterPin, savePin, removePin } from '../lib/pin.svelte.js';
  import { fitness, setGuest } from '../lib/fitness.svelte.js';
  // Guest mode off asks for the unlock PIN when there is one, so a guest can't just turn it off.
  async function guestOff() {
    if (!fitness.guest.on) return;
    if (anyPin() && !(await confirmPin('Enter PIN to turn off guest mode'))) return;
    await setGuest(false).catch(() => {});
  }
  // The unlock PIN: set it twice; changing or removing it needs the current one first.
  async function newPin() {
    let first = await enterPin('New unlock PIN', 'Four digits');
    while (first) {
      const again = await enterPin('Enter it again');
      if (!again) return;
      if (again === first) return savePin(first);
      first = await enterPin('New unlock PIN', 'They didn’t match. Start again');
    }
  }
  async function changePin() { if (await confirmPin('Current PIN')) newPin(); }
  async function dropPin() { if (await confirmPin('Current PIN to remove it')) removePin(); }
  // Pairing the iPhone app (ios/): a QR code the iPhone camera opens the app with, carrying this
  // dashboard's address and a one-time code (worker/devices.js), good for 10 minutes and once; the
  // phone trades it for a key of its own. Behind the PIN when one is set; hidden again after the code
  // runs out.
  let pairQr = $state('');
  let pairCode = $state('');
  let pairProblem = $state('');
  let pairTimer;
  async function pair() {
    if (pairQr) { pairQr = ''; pairCode = ''; return; }
    if (anyPin() && !(await confirmPin('PIN to show the pairing code'))) return;
    pairProblem = '';
    let code = '';
    try { code = (await api('/api/devices/pair', { method: 'POST' })).code || ''; } catch (e) { pairProblem = 'Couldn’t get a pairing code: ' + e.message; return; }
    const { default: qrcode } = await import('qrcode-generator');
    const q = qrcode(0, 'M');
    q.addData('kitchenframe://pair?url=' + encodeURIComponent(location.origin) + '&code=' + encodeURIComponent(code));
    q.make();
    pairQr = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
    pairCode = code;
    clearTimeout(pairTimer);
    pairTimer = setTimeout(() => { pairQr = ''; pairCode = ''; loadDevices(); }, 10 * 60 * 1000);
  }
  // Devices with a key of their own (worker/devices.js): the frame, each phone, the status page. A
  // lost phone is revoked here, alone. Behind the PIN when one is set.
  let devices = $state(null);
  let devicesProblem = $state('');
  let revoking = $state('');
  async function loadDevices() {
    try { devices = (await api('/api/devices')).devices || []; devicesProblem = ''; } catch (e) { devices = null; devicesProblem = e.message; }
  }
  async function revoke(d) {
    if (revoking !== d.id) { revoking = d.id; return; } // a second tap confirms
    if (anyPin() && !(await confirmPin('PIN to revoke ' + d.name))) { revoking = ''; return; }
    try { await api('/api/devices/' + d.id, { method: 'DELETE' }); } catch (e) { devicesProblem = e.message; }
    revoking = '';
    loadDevices();
  }
  const ROLE_NAMES = { frame: 'This frame', phone: 'Phone', ops: 'Status page' };
  const lastUsed = (d) => d.lastUsed ? 'used ' + formatDate(new Date(d.lastUsed), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not used yet';
  let showLog = $state(false);
  const logLine = (e) => Object.entries(e).filter(([k]) => !['t', 'event', 'level'].includes(k)).map(([k, v]) => k + ': ' + v).join(' · ');
  let announcers = $derived(timerSpeakers());
</script>

<!-- Tap outside the sheet to close; the sheet itself swallows the tap. -->
<div class="scrim" onclick={close} role="presentation">
  <section class="panel sheet" role="dialog" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>Settings</h2>
      <button class="done" onclick={close}>Done</button>
      <nav class="tabs seg" role="tablist" aria-label="Settings sections">
        {#each TABS as [v, label] (v)}
          <button role="tab" aria-selected={tab === v} class:on={tab === v} onclick={() => (tab = v)}>{label}</button>
        {/each}
      </nav>
    </header>

    {#if tab === 'display'}
    <div class="row">
      <span>Appearance</span>
      <div class="seg">
        {#each THEMES as [v, label] (v)}
          <button class:on={ui.themePref === v} onclick={() => setSetting('themePref', v)}>{label}</button>
        {/each}
      </div>
    </div>
    <p class="hint">Auto follows sunrise and sunset.</p>

    {#if !ui.demo}
    <div class="row">
      <span>Guest mode<small>{fitness.guest.on ? 'Personal things, like Fitness, are hidden until it’s turned off' : 'Hides personal things, like Fitness, while guests are here'}</small></span>
      <div class="seg">
        <button class:on={!fitness.guest.on} onclick={guestOff}>Off</button>
        <button class:on={fitness.guest.on} onclick={() => setGuest(true).catch(() => {})}>On</button>
      </div>
    </div>
    {/if}

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
      <div class="seg five">
        {#each IDLE as [v, label] (v)}
          <button class:on={ui.idleMinutes === v} onclick={() => setSetting('idleMinutes', v)}>{label}</button>
        {/each}
      </div>
    </div>


    <div class="row">
      <span>Photos after sunset<small>{nightPhotosHint()}</small></span>
      <div class="seg">
        <button class:on={ui.nightPhotosMode === 'auto'} onclick={() => setSetting('nightPhotos', 'auto')}>Dim when dark</button>
        <button class:on={ui.nightPhotosMode === 'on'} onclick={() => setSetting('nightPhotos', 'on')}>Dimmed</button>
        <button class:on={ui.nightPhotosMode === 'off'} onclick={() => setSetting('nightPhotos', 'off')}>Off</button>
      </div>
    </div>

    <div class="row">
      <span>Videos in the slideshow<small>Muted, up to 30 seconds each; off shows their stills{#if photos.storage}<br /><b class:warn={photos.storage.bytes / photos.storage.limit > 0.7} class:bad={photos.storage.bytes / photos.storage.limit > 0.9}>Storage: {storageText(photos.storage)}</b>{/if}</small></span>
      <div class="seg">
        <button class:on={ui.slideVideos} onclick={() => setSetting('slideVideos', true)}>On</button>
        <button class:on={!ui.slideVideos} onclick={() => setSetting('slideVideos', false)}>Off</button>
      </div>
    </div>

    <div class="row">
      <span>Photo details<small>When and where each photo was taken, small, in its corner</small></span>
      <div class="seg">
        <button class:on={ui.photoDetails} onclick={() => setSetting('photoDetails', true)}>On</button>
        <button class:on={!ui.photoDetails} onclick={() => setSetting('photoDetails', false)}>Off</button>
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





    {:else if tab === 'announce'}
    {#if !haConfigured() && !ui.demo}
      <p class="hint pad">Announcements need Home Assistant (see the README).</p>
    {:else}
      <div class="row">
        <span>Announcements<small>Things said out loud on a speaker</small></span>
        <div class="seg">
          <button class:on={say.on} onclick={() => setSay({ on: true })}>On</button>
          <button class:on={!say.on} onclick={() => setSay({ on: false })}>Off</button>
        </div>
      </div>
      {#if say.on}
      <div class="row">
        <span>Speaker<small>Messages, event reminders and alerts</small></span>
        <select class="pick" value={current?.entity_id || ''} onchange={(e) => setSay({ speaker: e.currentTarget.value })} aria-label="Speaker for announcements">
          {#each speakerList as p (p.entity_id)}<option value={p.entity_id}>{p.label || p.friendly_name}</option>{/each}
        </select>
      </div>
      <div class="row">
        <span>Volume<small>Set for each announcement, then put back</small></span>
        <div class="bright vol">
          <Icon name="volume" size={20} />
          <input type="range" min="10" max="100" step="5" value={Math.round(say.volume * 100)} oninput={(e) => setSay({ volume: e.currentTarget.value / 100 })} aria-label="Announcement volume" style="--pct:{((say.volume * 100 - 10) / 90) * 100}%" />
          <span class="pct num">{Math.round(say.volume * 100)}%</span>
        </div>
      </div>
      <div class="row">
        <span>Alert volume<small>Red alerts, such as a leak</small></span>
        <div class="bright vol">
          <Icon name="alert" size={20} />
          <input type="range" min="10" max="100" step="5" value={Math.round(say.alertVolume * 100)} oninput={(e) => setSay({ alertVolume: e.currentTarget.value / 100 })} aria-label="Alert volume" style="--pct:{((say.alertVolume * 100 - 10) / 90) * 100}%" />
          <span class="pct num">{Math.round(say.alertVolume * 100)}%</span>
        </div>
      </div>
      <div class="row">
        <span>Test<small>Says a short sentence on {current?.label || 'the speaker'}</small></span>
        <div class="tests">
          <button class="reload" disabled={testing} onclick={() => test(false)}><Icon name="volume" size={20} />Normal</button>
          <button class="reload" disabled={testing} onclick={() => test(true)}><Icon name="alert" size={20} />Alert</button>
        </div>
      </div>
      <h3 class="sub">Event reminders</h3>
      <div class="row">
        <span>Calendars<small>Tap to have them announced</small></span>
        <div class="chips">
          {#each calendarNames() as name, i (i)}
            {@const on = !!say.reminders.cals[name]}
            <button class="chip" class:on style={calColorVars(i)} onclick={() => setSay({ reminders: { ...say.reminders, cals: { ...say.reminders.cals, [name]: !on } } })} aria-pressed={on}>
              <span class="dot"></span>{name}
            </button>
          {/each}
        </div>
      </div>
      <div class="row">
        <span>Announce<small>Before each event</small></span>
        <select class="pick" value={String(say.reminders.lead)} onchange={(e) => setSay({ reminders: { ...say.reminders, lead: Number(e.currentTarget.value) } })} aria-label="How long before an event">
          {#each [10, 15, 30, 45, 60, 90] as m (m)}<option value={String(m)}>{m < 60 ? m + ' min' : m === 60 ? '1 hour' : '1½ hours'} before</option>{/each}
        </select>
      </div>
      <div class="row">
        <span>Own reminders<small>Use an event's own when it has one</small></span>
        <div class="seg">
          <button class:on={say.reminders.own} onclick={() => setSay({ reminders: { ...say.reminders, own: true } })}>On</button>
          <button class:on={!say.reminders.own} onclick={() => setSay({ reminders: { ...say.reminders, own: false } })}>Off</button>
        </div>
      </div>
      <h3 class="sub">Home alerts</h3>
      <div class="row">
        <span>Red alerts<small>A leak, the freezer: at the alert volume</small></span>
        <div class="seg">
          <button class:on={say.alerts.red} onclick={() => setSay({ alerts: { ...say.alerts, red: true } })}>On</button>
          <button class:on={!say.alerts.red} onclick={() => setSay({ alerts: { ...say.alerts, red: false } })}>Off</button>
        </div>
      </div>
      {#if say.alerts.red}
        <div class="row">
          <span>At night<small>Red alerts only</small></span>
          <div class="seg">
            <button class:on={say.alerts.night} onclick={() => setSay({ alerts: { ...say.alerts, night: true } })}>Said</button>
            <button class:on={!say.alerts.night} onclick={() => setSay({ alerts: { ...say.alerts, night: false } })}>Quiet</button>
          </div>
        </div>
        <div class="row">
          <span>Repeat<small>Every 10 min until cleared or dismissed</small></span>
          <div class="seg">
            <button class:on={say.alerts.repeat} onclick={() => setSay({ alerts: { ...say.alerts, repeat: true } })}>On</button>
            <button class:on={!say.alerts.repeat} onclick={() => setSay({ alerts: { ...say.alerts, repeat: false } })}>Once</button>
          </div>
        </div>
      {/if}
      <div class="row">
        <span>Orange notices<small>Washer done, a door left open: not at night</small></span>
        <div class="seg">
          <button class:on={say.alerts.orange} onclick={() => setSay({ alerts: { ...say.alerts, orange: true } })}>On</button>
          <button class:on={!say.alerts.orange} onclick={() => setSay({ alerts: { ...say.alerts, orange: false } })}>Off</button>
        </div>
      </div>
      <h3 class="sub">Also</h3>
      <div class="row">
        <span>Agent messages<small>{night.on ? 'Read aloud, not at night' : 'Read aloud, not 10 PM–7 AM'}</small></span>
        <div class="seg">
          <button class:on={say.messages} onclick={() => setSay({ messages: true })}>On</button>
          <button class:on={!say.messages} onclick={() => setSay({ messages: false })}>Off</button>
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
    {/if}
    {:else if tab === 'home'}
    {#if ha.players.some((p) => p.tv)}
      <div class="row">
        <span>Now Playing<small>On Home and the top bar</small></span>
        <div class="seg">
          <button class:on={nowPrefs.tv} onclick={() => setNowTv(true)}>Music and TV</button>
          <button class:on={!nowPrefs.tv} onclick={() => setNowTv(false)}>Music only</button>
        </div>
      </div>
    {/if}
    {#if haConfigured() && !ui.demo}
      <div class="row">
        <span>Camera pictures<small>How often the House tab updates them while it’s open</small></span>
        <div class="seg">
          {#each [[1, 'Every minute'], [5, 'Every 5 min'], [0, 'Off']] as [v, label] (v)}
            <button class:on={ui.cameraRefresh === v} onclick={() => setSetting('cameraRefresh', v)}>{label}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if bell.doorbells.length}
      <div class="row">
        <span>Doorbell<small>{bell.doorbells.map((d) => d.name).join(', ')} shows here when it rings</small></span>
        <button class="reload" onclick={() => { close(); ring({ ...bell.doorbells[0], test: true }); }}><Icon name="bell" size={20} />Test</button>
      </div>
    {/if}
    {#if haConfigured() && !ui.demo && pinAvailable()}
      <div class="row">
        <!-- Each person's own PIN, set in the phone app, works here; the frame's own PIN is the older way. -->
        <span>PINs<small>{pin.people.length ? pin.people.map((p) => p.person).join(', ') + ' (from the phone app)' + (pin.set ? ', and the frame’s own' : '') : pin.set ? 'The frame’s own PIN. Each person can set theirs in the phone app instead' : 'Off: unlocking takes two taps. Set yours in the phone app'}; asked before unlocking a door, and more</small></span>
        <div class="tests">
          {#if pin.set}
            <button class="reload" onclick={changePin}>Change</button>
            <button class="reload" onclick={dropPin}>{pin.people.length ? 'Remove frame PIN' : 'Remove'}</button>
          {:else if !pin.people.length}
            <button class="reload" onclick={newPin}><Icon name="lock" size={20} />Set PIN</button>
          {/if}
        </div>
      </div>
    {/if}
    {#if presence.sensors.length}
      <div class="row">
        <span>Presence sensors<small>Motion here keeps the dashboard up; tap to leave one out</small></span>
        <div class="chips">
          {#each presence.sensors as id (id)}
            {@const on = !ignored(id)}
            <button class="chip plain" class:on onclick={() => setIgnored(id, on)} aria-pressed={on}>{presence.names[id] || id}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if !ha.players.some((p) => p.tv) && !bell.doorbells.length && !presence.sensors.length && !(haConfigured() && !ui.demo)}<p class="hint pad">Nothing here yet: TVs and doorbells from Home Assistant show their settings here.</p>{/if}
    {:else}
    <div class="row">
      <span>Demo mode<small>Sample data, for showing people</small></span>
      <div class="seg">
        <button class:on={ui.demo} onclick={() => setSetting('demo', true)}>On</button>
        <button class:on={!ui.demo} onclick={() => setSetting('demo', false)}>Off</button>
      </div>
    </div>
    {#if !ui.demo}
      <div class="row">
        <span>Phone app<small>Scan with the iPhone camera to pair the Kitchen Frame app</small></span>
        <button class="reload" onclick={pair}>{pairQr ? 'Hide' : 'Pair a phone'}</button>
      </div>
      <!-- An SVG made here from our own address and a code from our own Worker, not outside input. -->
      {#if pairQr}<div class="qr">{@html pairQr}</div><p class="hint">Code {pairCode} · good for 10 minutes, once</p>{/if}
      {#if pairProblem}<p class="hint warn">{pairProblem}</p>{/if}
      <div class="row">
        <span>Devices<small>Each has a key of its own; revoke a lost phone here</small></span>
        <button class="reload" onclick={() => (devices ? (devices = null) : loadDevices())}>{devices ? 'Hide' : 'Show'}</button>
      </div>
      {#if devicesProblem}<p class="hint warn">{devicesProblem}</p>{/if}
      {#if devices}
        <ul class="devices">
          {#each devices as d (d.id)}
            <li>
              <span><b>{d.name}</b><small>{ROLE_NAMES[d.role] || d.role}{d.you ? ' · this one' : ''} · {lastUsed(d)}</small></span>
              {#if !d.you}<button class="reload" class:warn={revoking === d.id} onclick={() => revoke(d)}>{revoking === d.id ? 'Tap to revoke' : 'Revoke'}</button>{/if}
            </li>
          {:else}
            <li><span><small>No device keys yet: the frame and phones still use the shared key.</small></span></li>
          {/each}
        </ul>
      {/if}
    {/if}
    <div class="row">
      <span>Recent events<small>What the frame noticed, newest first</small></span>
      <button class="reload" onclick={() => (showLog = !showLog)}>{showLog ? 'Hide' : 'Show ' + recent.length}</button>
    </div>
    {#if showLog}
      <ol class="events">
        {#each recent as e, i (i)}
          <li class={e.level}><span class="num">{time(new Date(e.t))}</span><b>{e.event}</b><small>{logLine(e)}</small></li>
        {:else}<li>Nothing yet.</li>{/each}
      </ol>
    {/if}
    <div class="row last">
      <span>{ui.demo ? 'Showing demo data' : [calendar.data ? 'Calendar updated ' + when(calendar.data.updated) : 'Calendar not loaded',
        paprika.configured && paprika.updated ? 'Recipes synced ' + when(paprika.updated) : '', photos.items.length + ' photos'].filter(Boolean).join(' · ')}</span>
    </div>
    <div class="row last">
      <span>{release ? release + ' · build ' + version : 'Version ' + version}{built ? ' · built ' + built : ''}</span>
      <button class="reload" disabled={reloading} onclick={reload}><Icon name="reload" size={20} />{reloading ? 'Reloading…' : 'Reload'}</button>
    </div>
    {/if}
  </section>
</div>

<style>
  .scrim { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 20; background: rgba(0, 0, 0, .45); display: grid; place-items: center; }
  /* Taller than the screen now: it scrolls, with its heading and Done kept at the top. */
  /* One size for every tab, so switching tabs doesn't make the sheet jump; a longer tab scrolls. */
  .panel { width: 640px; height: min(600px, calc(100% - 32px)); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 22px 28px 10px; }
  header { position: sticky; top: -22px; z-index: 1; display: flex; align-items: center; justify-content: space-between; margin: -22px 0 6px; padding: 22px 0 8px; background: var(--sheet); }
  h2 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
  .done { font-size: 20px; font-weight: 600; color: var(--blue-text); padding: 8px 0 8px 16px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 64px; padding: 8px 0; border-top: 1px solid var(--sep); font-size: 20px; }
  .row.last { color: var(--secondary); font-size: 17px; }
  header { flex-wrap: wrap; }
  .tabs { flex: 1 0 100%; margin-top: 12px; }
  .tabs button { flex: 1; min-width: 0; }
  .hint.pad { margin: 18px 0; }
  /* Indented under the Devices row, with a rule down the left, so they read as its contents. */
  .devices { list-style: none; margin: 0 0 12px 8px; padding: 0 0 0 16px; border-left: 2px solid var(--sep); }
  .devices li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; font-size: 18px; }
  .devices li + li { border-top: 1px solid var(--sep); }
  .devices li span { display: flex; flex-direction: column; }
  .devices small { font-size: 15px; color: var(--secondary); }
  .hint.warn, .reload.warn { color: var(--orange-text); }
  .qr { width: 260px; margin: 4px auto 14px; padding: 10px; border-radius: 16px; background: #fff; }
  .qr :global(svg) { display: block; width: 100%; height: auto; }
  .tests { display: flex; gap: 10px; }
  .events { list-style: none; margin: 0 0 8px; padding: 0; max-height: 260px; overflow-y: auto; font-size: 15px; }
  .events li { display: flex; gap: 10px; align-items: baseline; padding: 5px 0; border-top: 1px solid var(--sep); }
  .events li > span { flex: none; width: 68px; color: var(--secondary); }
  .events li b { flex: none; font-weight: 600; }
  .events li small { min-width: 0; color: var(--secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .events li.warn b { color: var(--orange-text, #b25000); }
  .events li.error b { color: var(--red-text); }
  h3.sub { margin: 18px 0 2px; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  /* A calendar in its colour: outlined while off, filled while it's announced. */
  .chip { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 20px; border: 2px solid var(--c); font-size: 17px; font-weight: 600; color: var(--label); }
  .chip .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .chip.on { background: var(--c-tint); }
  .chip.plain { --c: var(--blue); --c-tint: var(--fill); }
  .chip:not(.on) { color: var(--secondary); border-color: var(--track); }
  .pct { width: 48px; text-align: right; font-size: 17px; color: var(--secondary); }
  /* Announcement volumes: a shorter slider, so the percentage fits beside it. */
  .bright.vol input[type='range'] { width: 200px; }
  /* Five choices (Clock screen after): narrower buttons so Never fits. */
  .seg.five button { min-width: 60px; padding: 0 10px; }
  .hint { margin: -6px 0 8px; font-size: 15px; color: var(--secondary); }
  .seg { display: flex; padding: 3px; border-radius: 11px; background: var(--track); }
  .nightset { display: flex; align-items: center; gap: 6px; }
  .nightset select { height: 44px; padding: 0 4px; border: 0; border-radius: 9px; background: var(--fill); font: inherit; font-size: 17px; color: var(--label); }
  .nightset .to { font-size: 16px; color: var(--secondary); }
  .nightset .seg button { min-width: 56px; padding: 0 10px; }
  .seg button { min-width: 84px; height: 40px; padding: 0 14px; border-radius: 9px; font-size: 17px; font-weight: 500; text-align: center; }
  .seg button.on { background: var(--thumb); font-weight: 600; }
  .seg button:not(.on):active { opacity: .5; }
  .row small { display: block; font-size: 15px; color: var(--secondary); margin-top: 2px; }
  /* Storage under the videos setting: amber past 70% of Cloudflare's free 1 GB, red past 90%. */
  .row small b { font-weight: 600; }
  .row small b.warn { color: var(--orange-text, #b25000); }
  .row small b.bad { color: var(--red-text, #d70015); }
  /* A setting's name never wraps; its controls take the rest of the row. */
  .row > span:first-child { flex: none; white-space: nowrap; }
  /* Its description may wrap, so a row with wide controls (Night) still fits. */
  .row > span:first-child small { max-width: 180px; white-space: normal; }
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
