<script>
  // The full-screen map, opened by tapping an event's map: Google's street map around the place
  // (OpenStreetMap's when Google's tiles aren't there, lib/maptiles.js), dragged with a finger, and
  // closer or further with + and – (the frame has no pinch). The tiles sit in one layer moved with a
  // transform, so a drag repaints nothing; tiles coming into view load as it moves. Each tile is
  // counted against the Worker's daily allowance unless Google lets Cloudflare keep it.
  import Icon from './Icon.svelte';
  import { TILE, pixel, googleFirst, tileSrc, tileFailed, mapCredit } from '../lib/maptiles.js';

  let { place, title = '', onclose } = $props();
  const MIN_Z = 3, MAX_Z = 18, START_Z = 16;

  let w = $state(window.innerWidth), h = $state(window.innerHeight);
  let z = $state(START_Z);
  let centre = $state(pixel(place.lat, place.lon, START_Z)); // the view's middle, in pixels at z
  // The layer's own origin, reset with each zoom, so tiles' positions stay small numbers.
  let origin = $state({ x: Math.floor(centre.x), y: Math.floor(centre.y) });
  const google = googleFirst();
  let osm = $state({}); // tiles shown from OSM after Google's failed
  let credit = $state(google ? 'Google Maps' : '© OpenStreetMap');

  let tiles = $derived.by(() => {
    const n = 2 ** z, left = centre.x - w / 2, top = centre.y - h / 2, out = [];
    for (let tx = Math.floor(left / TILE); tx * TILE < left + w; tx++) {
      for (let ty = Math.floor(top / TILE); ty * TILE < top + h; ty++) {
        if (ty < 0 || ty >= n) continue;
        const key = z + '/' + tx + '/' + ty, x = ((tx % n) + n) % n;
        out.push({ key, src: tileSrc(z, x, ty, google && !osm[key]), x: tx * TILE - origin.x, y: ty * TILE - origin.y });
      }
    }
    return out;
  });
  let pin = $derived.by(() => { const p = pixel(place.lat, place.lon, z); return { x: p.x - origin.x, y: p.y - origin.y }; });
  let shift = $derived({ x: Math.round(w / 2 - (centre.x - origin.x)), y: Math.round(h / 2 - (centre.y - origin.y)) });

  function failed(key) {
    if (!google || osm[key]) return;
    tileFailed();
    osm[key] = true;
  }

  // Google's data credit for what's on screen, once the view settles.
  function settle() {
    if (!google) return;
    const at = z;
    mapCredit(z, centre.x - w / 2, centre.y - h / 2, w, h).then((c) => { if (at === z) credit = 'Google Maps · ' + c; });
  }
  settle();

  function zoomTo(nz) {
    nz = Math.max(MIN_Z, Math.min(MAX_Z, nz));
    if (nz === z) return;
    const f = 2 ** (nz - z);
    centre = { x: centre.x * f, y: centre.y * f };
    origin = { x: Math.floor(centre.x), y: Math.floor(centre.y) };
    z = nz;
    settle();
  }
  function home() {
    const p = pixel(place.lat, place.lon, z);
    centre = p;
    settle();
  }

  let drag = null;
  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, centre };
  }
  function move(e) {
    if (!drag) return;
    const max = 2 ** z * TILE;
    centre = { x: drag.centre.x - (e.clientX - drag.x), y: Math.max(0, Math.min(max, drag.centre.y - (e.clientY - drag.y))) };
  }
  function up() {
    if (drag) settle();
    drag = null;
  }
</script>

<svelte:window onresize={() => { w = window.innerWidth; h = window.innerHeight; }} />

<div class="full" role="dialog" aria-label={'Map of ' + title} tabindex="-1"
  onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onclose(); } }}>
  <div class="area" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <div class="layer" style="transform: translate({shift.x}px, {shift.y}px)">
      {#each tiles as t (t.key)}
        <img src={t.src} alt="" decoding="async" draggable="false" style="transform: translate({t.x}px, {t.y}px)" onerror={() => failed(t.key)} />
      {/each}
      <span class="pin" style="transform: translate({Math.round(pin.x)}px, {Math.round(pin.y)}px)"></span>
    </div>
  </div>
  <div class="top">
    {#if title}<span class="title">{title}</span>{/if}
    <button class="round" onclick={onclose} aria-label="Close map"><Icon name="close" size={28} /></button>
  </div>
  <div class="zoom">
    <button class="round" onclick={() => zoomTo(z + 1)} disabled={z >= MAX_Z} aria-label="Closer"><Icon name="plus" size={28} /></button>
    <button class="round" onclick={() => zoomTo(z - 1)} disabled={z <= MIN_Z} aria-label="Further"><Icon name="minus" size={28} /></button>
    <button class="round" onclick={home} aria-label="Back to the place"><Icon name="mapPin" size={26} /></button>
  </div>
  <span class="credit">{credit}</span>
</div>

<style>
  .full { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 48; background: #e8e4dc; overflow: hidden; }
  .area { position: absolute; top: 0; right: 0; bottom: 0; left: 0; touch-action: none; cursor: grab; }
  .layer { position: absolute; left: 0; top: 0; will-change: transform; }
  img { position: absolute; left: 0; top: 0; width: 256px; height: 256px; user-select: none; -webkit-user-drag: none; }
  .pin { position: absolute; left: -13px; top: -13px; width: 26px; height: 26px; border-radius: 50%; background: var(--red); border: 4px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .35); }
  .top { position: absolute; top: 16px; left: 16px; right: 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; pointer-events: none; }
  .title { max-width: 900px; padding: 10px 20px; border-radius: 24px; background: rgba(28, 28, 30, .82); color: #fff; font-size: 21px; font-weight: 600; overflow-wrap: anywhere; }
  .round { pointer-events: auto; flex: none; width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; background: rgba(28, 28, 30, .82); color: #fff; }
  .round:disabled { opacity: .4; }
  .top .round { margin-left: auto; }
  .zoom { position: absolute; right: 16px; bottom: 40px; display: flex; flex-direction: column; gap: 12px; }
  .credit { position: absolute; right: 0; bottom: 0; padding: 2px 8px; border-top-left-radius: 8px; background: rgba(255, 255, 255, .8); color: #333; font-size: 12px; }
</style>
