<script>
  import { onMount, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import CameraView from '../components/CameraView.svelte';
  import { ha, haUrl } from '../lib/ha.svelte.js';
  import { haImage } from '../lib/ha-image.js';
  import { ui, cameraRefresh } from '../lib/state.svelte.js';
  import { pin, allowUnlock } from '../lib/pin.svelte.js';
  import { emojiHtml } from '../lib/emoji.js';
  import { haConfigured } from '../lib/ha.svelte.js';
  import { liveDemo, nm } from '../lib/demo-media.svelte.js';
  import { mediaUrl } from '../lib/api.js';
  import { house, houseDemo, setHouseDemo, startHouse, companionsOf, toggle, run, coverToggle, lock, unlock, nudge, setpoint, miniMarkdown } from '../lib/house.svelte.js';

  // Camera snapshots load once when the tab opens and again with the refresh button by the cameras'
  // heading: asking Ring for a snapshot can wake the camera (battery), and each one is a JPEG decode
  // on a slow CPU, so they don't refresh on a timer. Snapshots are requested at 480 px wide. Tapping a
  // camera opens it full screen (CameraView: live video, closed again after two minutes).
  let shots = $state({}); // entity_id -> time of the snapshot shown
  let now = $state(Date.now());
  // Demo mode (Settings): without Home Assistant, an invented house (screenshots); with it, the real
  // house, working, with private names swapped (lib/demo-media.svelte.js) and stock pictures in place
  // of the cameras, which don't open.
  $effect(() => setHouseDemo(ui.demo && !haConfigured()));
  let still = $derived(houseDemo.on || liveDemo()); // camera tiles that never fetch or open
  const CAM_PLACES = [['door', /door|porch|front|bell/i], ['driveway', /drive|street|car|front ?yard/i], ['garage', /garage|shop/i], ['yard', /back|yard|patio|deck|garden|side/i]];
  // The ?v= changes when a picture does: browsers keep each one for a month.
  const stockCam = (name, i) => mediaUrl('/api/photos/demo-cam-' + ((CAM_PLACES.find(([, re]) => re.test(name)) || CAM_PLACES[i % CAM_PLACES.length])[0]) + '?v=2');
  onMount(() => {
    startHouse();
    const t = setInterval(() => (now = Date.now()), 30000);
    return () => clearInterval(t);
  });
  const refresh = (id) => (shots = { ...shots, [id]: Date.now() });
  const ago = (t) => { const m = Math.round((now - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + ' min' : Math.round(m / 60) + ' h'; };

  const st = (id) => house.states[id] || null;
  const attr = (id) => (st(id) || {}).attributes || {};
  const label = (item) => nm(item.name || attr(item.entity).friendly_name || item.entity.split('.')[1].replace(/_/g, ' '));
  const on = (id) => ['on', 'open', 'opening', 'unlocked', 'heat', 'cool', 'heat_cool', 'playing'].includes((st(id) || {}).state);
  const unavailable = (id) => !st(id) || ['unavailable', 'unknown'].includes(st(id).state);
  const nice = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function valueText(id) {
    const s = st(id);
    if (!s) return '—';
    if (unavailable(id)) return 'Unavailable';
    const unit = s.attributes.unit_of_measurement;
    const n = Number(s.state);
    if (unit && Number.isFinite(n)) return (Math.round(n * 10) / 10) + (unit === '%' ? '%' : ' ' + unit);
    return nice(s.state);
  }
  function toggleText(id) {
    const s = st(id);
    if (unavailable(id)) return 'Unavailable';
    const a = s.attributes;
    if (s.state === 'on' && a.percentage != null) return 'On · ' + a.percentage + '%';
    if (s.state === 'on' && a.brightness != null) return 'On · ' + Math.round((a.brightness / 255) * 100) + '%';
    return nice(s.state);
  }
  function coverText(id) {
    const s = st(id);
    if (unavailable(id)) return 'Unavailable';
    const pos = s.attributes.current_position;
    return nice(s.state) + (pos != null && s.state === 'open' ? ' · ' + pos + '%' : '');
  }
  const iconFor = (item) => ({ toggle: item.entity.startsWith('fan.') ? 'fan' : item.entity.startsWith('light.') ? 'lightbulb' : 'toggle', lock: on(item.entity) ? 'unlock' : 'lock', cover: 'blinds', value: /temperature/.test(attr(item.entity).device_class || item.entity) ? 'thermometer' : 'gauge', run: 'play' })[item.kind] || 'house';

  // While a tap waits for the device: what it's doing, from the state it started in.
  function actingText(item) {
    const a = house.acting[item.entity];
    if (!a) return null;
    if (a.failed) return 'Didn’t change';
    if (item.kind === 'lock') return a.from === 'unlocked' ? 'Locking…' : 'Unlocking…';
    if (item.kind === 'cover') return a.from === 'open' ? 'Closing…' : 'Opening…';
    return a.from === 'on' ? 'Turning off…' : 'Turning on…';
  }

  // Unlocking asks for the unlock PIN when one is set (Settings → Home), and otherwise takes two
  // taps: the first arms it for 4 seconds. Locking is always one tap.
  let armed = $state(null);
  let armTimer;
  async function tapLock(id, name) {
    if (unavailable(id)) return;
    if (st(id).state === 'unlocked') return lock(id);
    if (pin.set && !houseDemo.on) return (await allowUnlock(name)) ? unlock(id, 'pin') : undefined;
    if (armed === id) { armed = null; clearTimeout(armTimer); return unlock(id, 'two taps'); }
    armed = id;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => (armed = null), 4000);
  }

  let errorMsg = $state(null);
  async function act(p) {
    errorMsg = null;
    try { await p; } catch (e) { errorMsg = e.message; setTimeout(() => (errorMsg = null), 5000); }
  }

  // Cameras: when a snapshot camera exists beside the dashboard's camera (ring-mqtt beside the Ring
  // integration), show it: it refreshes on its own (wired cameras every so often) and says when it
  // was taken. A tap presses its "Take Snapshot" button. Otherwise a tap re-fetches the picture.
  const snapOf = (id) => { const [cam, button] = companionsOf(id); const s = st(cam); return s && s.state !== 'unavailable' && s.attributes.entity_picture ? { cam, button, ts: Number(s.attributes.timestamp) || 0 } : null; };
  let asked = $state({}); // entity_id -> time a snapshot was requested (cleared when a newer one arrives)
  // Thumbnails change only when the tab opens, on Refresh and on a tap, not each time the camera's
  // add-on takes a picture of its own accord: pinned holds the snapshot time each one shows, moved on
  // when a snapshot asked for arrives. The address is kept while its picture is the same, as Home
  // Assistant renews the access token in entity_picture every few minutes, which reloaded them all.
  let pinned = $state({}); // entity_id -> snapshot time (s) shown
  $effect(() => {
    const next = {};
    for (const g of house.groups) for (const i of g.items) {
      if (i.kind !== 'camera') continue;
      const snap = snapOf(i.entity);
      if (!snap || !snap.ts) continue;
      const have = pinned[i.entity];
      if (have == null || (asked[i.entity] && snap.ts * 1000 > asked[i.entity] && snap.ts !== have)) next[i.entity] = snap.ts;
    }
    if (Object.keys(next).length) untrack(() => { pinned = { ...pinned, ...next }; });
  });
  const srcs = new Map(); // entity_id -> { bust, url }
  const camSrc = (id, t) => {
    const snap = snapOf(id);
    const pic = attr(snap ? snap.cam : id).entity_picture;
    const bust = snap ? pinned[id] : t;
    if (!pic || !bust) return null;
    const had = srcs.get(id);
    if (had && had.bust === bust) return had.url;
    const url = haUrl(pic) + (pic.includes('?') ? '&' : '?') + 'width=480&_=' + bust;
    srcs.set(id, { bust, url });
    return url;
  };
  // Keeping them fresh while the tab is open and the screen awake (Settings → Home → Camera pictures):
  // every minute (or 5) the newest picture the camera's add-on already took is shown, which costs
  // nothing; at most every 5 minutes a camera whose picture is older than that is asked for a new
  // one, which wakes a battery camera, so not more often.
  $effect(() => {
    const every = cameraRefresh();
    if (!every || still) return;
    const t = setInterval(() => untrack(() => {
      if (ui.idle || document.hidden) return;
      const next = {};
      for (const g of house.groups) for (const i of g.items) {
        if (i.kind !== 'camera') continue;
        const snap = snapOf(i.entity);
        if (snap && snap.ts && snap.ts !== pinned[i.entity]) next[i.entity] = snap.ts;
        const age = Date.now() - (snap && snap.ts ? snap.ts * 1000 : shots[i.entity] || 0);
        if (age > 5 * 60000) tapCamera(i.entity);
      }
      if (Object.keys(next).length) pinned = { ...pinned, ...next };
    }), every * 60000);
    return () => clearInterval(t);
  });
  // A new thumbnail loads in the background and replaces the old one once it's ready: no flash.
  let shown = $state({}); // entity_id -> the address on screen
  const loadingSrc = new Set();
  function swapIn(id, url) {
    if (!url || shown[id] === url || loadingSrc.has(url)) return;
    if (!shown[id]) { shown = { ...shown, [id]: url }; return; } // the first one: show it as it loads
    loadingSrc.add(url);
    const img = new Image();
    img.onload = img.onerror = () => { loadingSrc.delete(url); shown = { ...shown, [id]: url }; };
    img.src = url;
  }
  $effect(() => {
    for (const g of house.groups) for (const i of g.items) if (i.kind === 'camera') {
      const url = camSrc(i.entity, shots[i.entity]);
      untrack(() => swapIn(i.entity, url));
    }
  });
  let viewing = $state(null); // the camera open full screen: { entity, stream, name }
  // The sharper <name>_stream companion when there is one and it's available, chosen once when the
  // view opens, so a state update while video is starting can't swap the camera underneath it.
  const streamOf = (id) => { const s = companionsOf(id)[2]; return st(s) && st(s).state !== 'unavailable' ? s : null; };
  // ring-mqtt's live-stream switch for the camera, when there is one: turned on while the view is
  // open, it starts the Ring session at once and keeps it up through a retry, which otherwise costs
  // a cold start each time.
  // Only for cameras with a _stream companion (ring-mqtt's), and not checked against house.states:
  // the switch isn't on the dashboard, so the House tab doesn't track it.
  const warmOf = (id) => (streamOf(id) ? 'switch.' + id.replace(/^camera\./, '').replace(/_(live_view|snapshot|stream)$/, '') + '_live_stream' : null);
  const refreshAll = (items) => { for (const i of items) if (i.kind === 'camera') tapCamera(i.entity); };
  // A camera is asked for a new snapshot at most every SNAP_GAP_MS, whatever asks (a tap, Refresh, the
  // full-screen view): a runaway caller once pressed the button thousands of times in seconds.
  const SNAP_GAP_MS = 10000;
  const lastPress = new Map();
  function tapCamera(id) {
    const snap = snapOf(id);
    if (snap && st(snap.button)) {
      if (Date.now() - (lastPress.get(id) || 0) < SNAP_GAP_MS) return;
      lastPress.set(id, Date.now());
      asked = { ...asked, [id]: Date.now() };
      act(run(snap.button));
    } else refresh(id);
  }
  // When the picture shown was taken (ms), for the full-screen view's "Picture taken 10:31:42 PM".
  // A snapshot camera's time is the camera's own (ring-mqtt's timestamp): when it was taken. Without
  // one, all there is is when the frame loaded the picture, and it says "loaded".
  const camTakenAt = (id) => { const snap = snapOf(id); return snap ? { t: snap.ts ? snap.ts * 1000 : 0, real: true } : { t: shots[id] || 0, real: false }; };
  const camAge = (id) => {
    const snap = snapOf(id);
    if (snap) {
      if (asked[id] && asked[id] > snap.ts * 1000) return 'updating…';
      const ts = pinned[id] || snap.ts;
      return ts ? ago(ts * 1000) : '';
    }
    return shots[id] ? ago(shots[id]) : '';
  };
  // First load: one snapshot per camera once its entity (with its signed picture URL) arrives.
  $effect(() => {
    if (still) return;
    for (const g of house.groups) for (const i of g.items) if (i.kind === 'camera' && !shots[i.entity] && attr(i.entity).entity_picture) refresh(i.entity);
  });
  const temp = (v) => (v == null || v === '' ? '–' : Math.round(Number(v)));
</script>

{#snippet sp(entity, which)}
  {@const v = setpoint(entity, which)}
  <b class="num" class:pending={v.pending} class:failed={v.failed} title={v.failed ? 'The thermostat didn’t take that change' : ''}>{temp(v.value)}°</b>
{/snippet}

<div class="house">
  {#if !houseDemo.on && ha.status !== 'connected'}
    <p class="note">{ha.status === 'error' ? ha.error : 'Connecting to Home Assistant…'}</p>
  {:else if house.status === 'error'}
    <p class="note">{house.error}</p>
  {:else if house.status !== 'ready'}
    <p class="note">Loading…</p>
  {:else}
    {#if house.header}<div class="header">{@html emojiHtml(miniMarkdown(nm(house.header)))}</div>{/if}
    {#if errorMsg}<p class="toast">{errorMsg}</p>{/if}

    <div class="groups" class:single={house.groups.length === 1}>
      {#each house.groups as g, gi (gi)}
        <section class="group" class:main={gi === 0}>
          {#if g.title || g.items.some((i) => i.kind === 'camera')}
            <div class="ghead">
              {#if g.title}<h2>{nm(g.title)}</h2>{/if}
              {#if g.items.some((i) => i.kind === 'camera') && !still}
                <button class="refresh" onclick={() => refreshAll(g.items)} aria-label="Refresh camera pictures"><Icon name="reload" size={18} />Refresh</button>
              {/if}
            </div>
          {/if}
          <div class="tiles">
            {#each g.items as item, ii (ii)}
              {#if item.kind === 'climate'}
                {@const a = attr(item.entity)}
                {@const range = a.target_temp_low != null && a.target_temp_high != null && a.temperature == null}
                <div class="tile sheet climate" class:off={unavailable(item.entity)} class:cooling={a.hvac_action === 'cooling'} class:heating={a.hvac_action === 'heating' || a.hvac_action === 'preheating'}>
                  <div class="row">
                    <span class="name">{label(item)}</span>
                    {#if Object.entries(house.pending).some(([k, p]) => k.startsWith(item.entity + ':') && p.failed)}
                      <span class="sub bad">Not changed</span>
                    {:else if Object.keys(house.pending).some((k) => k.startsWith(item.entity + ':'))}
                      <span class="sub">Updating…</span>
                    {:else}
                      <span class="sub action">{nice(a.hvac_action || st(item.entity)?.state)}</span>
                    {/if}
                  </div>
                  <div class="row">
                    <span class="big num">{temp(a.current_temperature)}°</span>
                    <span class="sets">
                      {#if range}
                        <span class="set"><span class="lbl heat">Heat</span><button aria-label="Heat down" onclick={() => act(nudge(item.entity, 'low', -1))}><Icon name="minus" size={18} /></button>{@render sp(item.entity, 'low')}<button aria-label="Heat up" onclick={() => act(nudge(item.entity, 'low', 1))}><Icon name="plus" size={18} /></button></span>
                        <span class="set"><span class="lbl cool">Cool</span><button aria-label="Cool down" onclick={() => act(nudge(item.entity, 'high', -1))}><Icon name="minus" size={18} /></button>{@render sp(item.entity, 'high')}<button aria-label="Cool up" onclick={() => act(nudge(item.entity, 'high', 1))}><Icon name="plus" size={18} /></button></span>
                      {:else if a.temperature != null}
                        <span class="set"><span class="lbl">Set</span><button aria-label="Down" onclick={() => act(nudge(item.entity, null, -1))}><Icon name="minus" size={18} /></button>{@render sp(item.entity, null)}<button aria-label="Up" onclick={() => act(nudge(item.entity, null, 1))}><Icon name="plus" size={18} /></button></span>
                      {:else}
                        <span class="sub">{nice(st(item.entity)?.state)}</span>
                      {/if}
                    </span>
                  </div>
                </div>
              {:else if item.kind === 'camera'}
                {@const src = liveDemo() ? stockCam(label(item), ii) : shown[item.entity] || camSrc(item.entity, shots[item.entity])}
                <button class="tile sheet camera" onclick={() => !still && (viewing = { entity: item.entity, stream: streamOf(item.entity), warm: warmOf(item.entity), name: label(item).replace(/\s*live view$/i, '') })} aria-label={'Open ' + label(item)}>
                  {#if src && !houseDemo.on}<img {@attach haImage(src)} alt="" decoding="async" />{:else}<span class="noimg" class:demo={houseDemo.on}><Icon name="camera" size={30} /></span>{/if}
                  <span class="cap"><span class="cname">{label(item).replace(/\s*live view$/i, '')}</span>{#if !still && camAge(item.entity)}<span class="age"><Icon name="reload" size={13} /> {camAge(item.entity)}</span>{/if}</span>
                </button>
              {:else if item.kind === 'text'}
                <div class="tile sheet text">{@html emojiHtml(miniMarkdown(nm(house.text[item.key] || '')))}</div>
              {:else}
                {@const tappable = ['toggle', 'lock', 'cover', 'run'].includes(item.kind) && !unavailable(item.entity)}
                <button class="tile sheet dev" class:on={item.kind !== 'value' && on(item.entity)} class:warn={item.kind === 'lock' && st(item.entity)?.state === 'unlocked'}
                  class:armed={armed === item.entity} disabled={!tappable}
                  onclick={() => item.kind === 'toggle' ? act(toggle(item.entity)) : item.kind === 'lock' ? act(tapLock(item.entity, label(item))) : item.kind === 'cover' ? act(coverToggle(item.entity)) : item.kind === 'run' ? act(run(item.entity)) : null}>
                  <span class="ic"><Icon name={iconFor(item)} size={22} /></span>
                  <span class="txt">
                    <span class="name">{label(item)}</span>
                    <span class="sub" class:bad={house.acting[item.entity]?.failed}>{armed === item.entity ? 'Tap again to unlock' : actingText(item) || (item.kind === 'toggle' ? toggleText(item.entity) : item.kind === 'cover' ? coverText(item.entity) : valueText(item.entity))}</span>
                  </span>
                </button>
              {/if}
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

{#if viewing}
  <CameraView entity={viewing.stream || viewing.entity} soundEntity={viewing.entity} warm={viewing.warm} name={viewing.name} picture={attr(snapOf(viewing.entity) ? snapOf(viewing.entity).cam : viewing.entity).entity_picture || ''}
    age={camAge(viewing.entity)} takenAt={camTakenAt(viewing.entity)} onsnap={() => tapCamera(viewing.entity)} onclose={() => (viewing = null)} />
{/if}

<style>
  .house { height: 100%; overflow-y: auto; padding: 0 28px 24px; }
  .note { margin: 40px 6px; font-size: 20px; color: var(--secondary); }
  .toast { margin: 0 0 8px; font-size: 17px; color: var(--red-text); }
  .header { margin: 0 4px 14px; display: flex; flex-wrap: wrap; gap: 4px 28px; }
  .header :global(p) { margin: 0; font-size: 19px; color: var(--secondary); }
  .header :global(p.h) { font-size: 21px; font-weight: 600; color: var(--label); }

  /* The first group (usually the main devices) on the left, the rest stacked on the right. */
  .groups { display: grid; grid-template-columns: 1.65fr 1fr; gap: 0 22px; align-items: start; }
  .groups.single { grid-template-columns: 1fr; }
  .group { grid-column: 2; margin-bottom: 16px; }
  .group.main { grid-column: 1; grid-row: 1 / span 20; }
  h2 { margin: 0 4px 8px; font-size: 19px; font-weight: 700; color: var(--secondary); }
  .ghead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ghead h2 { flex: 1; }
  .refresh { display: inline-flex; align-items: center; gap: 6px; height: 36px; margin: 0 4px 8px auto; padding: 0 14px; border-radius: 18px; background: var(--track); font-size: 16px; font-weight: 600; color: var(--blue-text); }
  .refresh:active { opacity: .6; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  /* Six tracks: thermostats take half a row each, other devices a third. */
  .main .tiles { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .main .tile { grid-column: span 2; }
  .main .tile.climate { grid-column: span 3; }
  .main .tile.text { grid-column: 1 / -1; }
  .tile { border-radius: 18px; min-width: 0; }

  .dev { display: flex; align-items: center; gap: 10px; padding: 12px; text-align: left; min-height: 70px; }
  .dev:disabled { opacity: 1; }
  .dev:not(:disabled):active { opacity: .7; }
  .ic { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--secondary); }
  .dev.on .ic { background: var(--yellow); color: #fff; }
  .dev.warn .ic, .dev.armed .ic { background: var(--red); color: #fff; }
  .txt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 15px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .armed .sub, .warn .sub { color: var(--red-text); }

  .climate { grid-column: span 2; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
  .climate.off { opacity: .6; }
  /* Running: the card takes the colour of what it's doing (tint layered over the sheet colour). */
  .climate.cooling { background-image: linear-gradient(var(--pal-blue-tint), var(--pal-blue-tint)); }
  .climate.heating { background-image: linear-gradient(var(--pal-red-tint), var(--pal-red-tint)); }
  .cooling .action, .cooling .big { color: var(--blue-text); }
  .heating .action, .heating .big { color: var(--red-text); }
  .cooling .action, .heating .action { font-weight: 700; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .big { font-size: 46px; font-weight: 300; line-height: 1; }
  .sets { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
  .set { display: flex; align-items: center; gap: 6px; font-size: 18px; }
  .set b { min-width: 42px; text-align: center; transition: opacity .2s; }
  .set b.pending { opacity: .45; }
  .set b.failed { color: var(--red-text); }
  .sub.bad { color: var(--red-text); }
  .set button { width: 36px; height: 36px; border-radius: 50%; background: var(--track); display: grid; place-items: center; }
  .set button:active { opacity: .6; }
  .lbl { font-size: 14px; font-weight: 600; color: var(--secondary); margin-right: 2px; }
  .lbl.heat { color: var(--orange-text); }
  .lbl.cool { color: var(--blue-text); }

  .camera { position: relative; display: block; width: 100%; padding: 0; overflow: hidden; aspect-ratio: 16 / 9; background: var(--track); }
  .camera:active { opacity: .8; }
  .camera img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .noimg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--tertiary); }
  .noimg.demo { background: linear-gradient(160deg, #8fb3c9, #4a6b7d); color: rgba(255, 255, 255, .7); }
  .cap { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; gap: 8px; padding: 18px 10px 6px; font-size: 14px; font-weight: 600; color: #fff; text-align: left; background: linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, .6)); }
  .cname { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .age { flex: none; display: flex; align-items: center; gap: 4px; font-weight: 500; opacity: .85; white-space: nowrap; }

  .text { grid-column: 1 / -1; padding: 12px 14px; }
  .text :global(p) { margin: 0 0 4px; font-size: 16px; color: var(--secondary); }
  .text :global(p.h) { font-size: 18px; font-weight: 600; color: var(--label); }
  /* Emoji the frame's 2017 font lacks, drawn as pictures (lib/emoji.js), sized like the text. */
  .header :global(.emoji), .text :global(.emoji) { display: inline-block; width: 1.1em; height: 1.1em; margin: 0 .05em; vertical-align: -0.18em; }
</style>
