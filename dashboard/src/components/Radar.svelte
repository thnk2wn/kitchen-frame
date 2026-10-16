<script>
  // Rain radar around home, in the weather sheet: the last hour, now and the next two hours, looping
  // (GET /api/radar; worker/radar.js: NWS radar and NOAA's HRRR forecast in the US, RainViewer's
  // past two hours elsewhere). The street map is drawn once at zoom 8 (OSM tiles through the
  // Worker's cache); each radar frame is drawn once at zoom 7 onto its own small canvas and shown at
  // twice the size: about 500 km across, and light on the frame's slow Wi-Fi. Canvases rather than
  // tile images, so the frame doesn't keep ~50 decoded PNGs.
  // Loads only while the sheet shows it; the loop stops when it closes.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api, mediaUrl } from '../lib/api.js';
  import { time } from '../lib/format.js';

  let { width = 1070, height = 430 } = $props();
  const TILE = 256, Z = 8, STEP_MS = 600, HOLD_MS = 1800;

  let canvas = $state();
  let frames = $state([]);   // [{ time, url, kind, img?: canvas }]
  let source = $state('');
  let at = $state(-1);       // the frame shown
  let playing = $state(true);
  let error = $state('');
  let base = null;           // the street map, drawn once
  let home = null;           // { x, y } in canvas pixels

  // Web Mercator: a point's pixel position at a zoom.
  const pixel = (lat, lon, z) => {
    const n = 2 ** z * TILE, r = (lat * Math.PI) / 180;
    return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
  };
  const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  const dark = () => document.documentElement.dataset.theme === 'dark'; // set by lib/state.svelte.js

  function draw() {
    const c = canvas && canvas.getContext('2d');
    if (!c || !base) return;
    c.drawImage(base, 0, 0);
    const f = frames[at];
    if (f && f.img) { c.globalAlpha = 0.8; c.imageSmoothingEnabled = true; c.drawImage(f.img, 0, 0, width, height); c.globalAlpha = 1; }
    if (home) {
      c.beginPath(); c.arc(home.x, home.y, 7, 0, Math.PI * 2);
      c.fillStyle = '#ff3b30'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    }
  }

  onMount(() => {
    let live = true, timer = null;
    (async () => {
      let r;
      try { r = await api('/api/radar'); } catch (e) { error = 'Radar isn’t available right now.'; return; }
      if (!live) return;
      if (r.error || !r.frames || !r.frames.length) { error = r.error ? 'Radar needs the home location (WEATHER_LAT / WEATHER_LON).' : 'No radar right now.'; return; }
      const c8 = pixel(r.lat, r.lon, Z);
      const left = c8.x - width / 2, top = c8.y - height / 2;
      home = { x: width / 2, y: height / 2 };

      // The street map, dimmed in dark mode so the rain stands out.
      base = document.createElement('canvas'); base.width = width; base.height = height;
      const b = base.getContext('2d');
      b.fillStyle = '#e8e4dc'; b.fillRect(0, 0, width, height);
      const n8 = 2 ** Z, jobs = [];
      for (let tx = Math.floor(left / TILE); tx * TILE < left + width; tx++) {
        for (let ty = Math.floor(top / TILE); ty * TILE < top + height; ty++) {
          if (ty < 0 || ty >= n8) continue;
          jobs.push(load(mediaUrl(`/api/tiles/${Z}/${((tx % n8) + n8) % n8}/${ty}`)).then((i) => i && b.drawImage(i, Math.round(tx * TILE - left), Math.round(ty * TILE - top))));
        }
      }
      await Promise.all(jobs);
      if (!live) return;
      if (dark()) { b.fillStyle = 'rgba(0, 0, 0, .45)'; b.fillRect(0, 0, width, height); }

      // Radar frames at zoom 7: half the size, drawn doubled.
      const z = r.zoom || 7, scale = 2 ** (Z - z), w = Math.ceil(width / scale), h = Math.ceil(height / scale);
      const l7 = left / scale, t7 = top / scale, n7 = 2 ** z;
      async function frame(f) {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d'), parts = [];
        for (let tx = Math.floor(l7 / TILE); tx * TILE < l7 + w; tx++) {
          for (let ty = Math.floor(t7 / TILE); ty * TILE < t7 + h; ty++) {
            if (ty < 0 || ty >= n7) continue;
            parts.push(load(f.url.replace('{z}', z).replace('{x}', ((tx % n7) + n7) % n7).replace('{y}', ty)).then((i) => i && g.drawImage(i, Math.round(tx * TILE - l7), Math.round(ty * TILE - t7))));
          }
        }
        await Promise.all(parts);
        return cv;
      }
      frames = r.frames.map((f) => ({ ...f }));
      source = r.source || '';
      // Now first, so the map shows the rain at once; then the rest, in order.
      const nowAt = Math.max(frames.findIndex((f) => f.kind === 'now'), 0);
      frames[nowAt].img = await frame(frames[nowAt]);
      if (!live) return;
      at = nowAt; draw();
      for (let k = 0; k < frames.length && live; k++) if (k !== nowAt) frames[k].img = await frame(frames[k]);
      if (!live) return;
      // Loops oldest to the furthest forecast, pausing on now and on the last frame.
      const tick = () => {
        if (!live) return;
        if (playing) { at = (at + 1) % frames.length; draw(); }
        timer = setTimeout(tick, at === frames.length - 1 || frames[at].kind === 'now' ? HOLD_MS : STEP_MS);
      };
      timer = setTimeout(tick, HOLD_MS);
    })();
    return () => { live = false; clearTimeout(timer); base = null; frames = []; };
  });

  const stamp = (f) => (!f ? '' : f.kind === 'now' ? 'Now · ' + time(new Date(f.time)) : f.kind === 'forecast' ? 'Forecast · ' + time(new Date(f.time)) : time(new Date(f.time)));
  const show = (k) => { playing = false; at = k; draw(); };
</script>

<div class="radar" style="width: {width}px; height: {height}px">
  <canvas bind:this={canvas} {width} {height}></canvas>
  {#if error}
    <p class="msg">{error}</p>
  {:else if at < 0}
    <p class="msg">Loading radar…</p>
  {:else}
    <div class="bar">
      <button class="play" onclick={() => (playing = !playing)} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
      <span class="when" class:ahead={frames[at] && frames[at].kind === 'forecast'}>{stamp(frames[at])}</span>
      <span class="ticks">
        {#each frames as f, k (f.time)}<button class="tick" class:on={k === at} class:ready={!!f.img} class:now={f.kind === 'now'} class:ahead={f.kind === 'forecast'} onclick={() => show(k)} aria-label={stamp(f)}></button>{/each}
      </span>
    </div>
  {/if}
  <span class="credit">{source ? source + ' · ' : ''}© OpenStreetMap</span>
</div>

<style>
  .radar { position: relative; overflow: hidden; border-radius: 18px; background: #e8e4dc; }
  canvas { display: block; }
  .msg { position: absolute; top: 50%; left: 0; right: 0; margin: 0; text-align: center; font-size: 19px; font-weight: 600; color: #333; transform: translateY(-50%); }
  .bar { position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 12px; padding: 6px 14px 6px 6px; border-radius: 26px; background: rgba(28, 28, 30, .82); color: #fff; }
  .play { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: rgba(255, 255, 255, .18); color: #fff; }
  .when { min-width: 190px; font-size: 17px; font-weight: 600; }
  .when.ahead { color: #64d2ff; }
  .ticks { display: flex; gap: 4px; }
  .tick { width: 14px; height: 24px; padding: 0; position: relative; }
  .tick::after { content: ''; position: absolute; left: 5px; top: 8px; width: 4px; height: 8px; border-radius: 2px; background: rgba(255, 255, 255, .25); }
  .tick.ready::after { background: rgba(255, 255, 255, .55); }
  .tick.ahead::after { background: rgba(100, 210, 255, .35); }
  .tick.ahead.ready::after { background: rgba(100, 210, 255, .7); }
  .tick.now::after { height: 12px; top: 6px; }
  .tick.on::after { top: 4px; height: 16px; background: #fff; }
  .tick.ahead.on::after { background: #64d2ff; }
  .credit { position: absolute; right: 0; bottom: 0; padding: 2px 8px; border-top-left-radius: 8px; background: rgba(255, 255, 255, .8); color: #333; font-size: 11px; }
</style>
