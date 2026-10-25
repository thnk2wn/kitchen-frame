<script module>
  // Last answers this session, so reopening an event doesn't ask again.
  const seen = new Map();
</script>

<script>
  // A small street map with a pin for an event's location: the Worker looks the place up once
  // (Google, or OpenStreetMap's Nominatim) and sends Google's map picture; OSM tiles when that fails
  // (no Google key, or its daily allowance used up). Nothing shows if the place
  // can't be found (a video call, a room name), so the sheet just has no map. Tapped, it opens the
  // full-screen map (MapView).
  import Icon from './Icon.svelte';
  import MapView from './MapView.svelte';
  import { api, mediaUrl } from '../lib/api.js';
  import { ui } from '../lib/state.svelte.js';

  let { location, width = 340, height = 280, zoom = 15, found = $bindable(false) } = $props();
  const TILE = 256;

  let place = $state(null);
  $effect(() => {
    const q = location;
    place = seen.get(q) || null;
    if (seen.has(q)) return;
    let live = true;
    // v=2: past "not found" answers the browser kept a day (before misses stopped being cached).
    api('/api/geo?v=2&q=' + encodeURIComponent(q)).then((r) => {
      if (!r.error) seen.set(q, r.place);
      if (live) place = r.place;
    }).catch(() => {});
    return () => { live = false; };
  });

  $effect(() => { found = !!place; });

  // Asked for every time rather than only when the Worker says it has a key: a geo answer the
  // browser kept from before the key would otherwise keep the tiles for a day.
  // Three heights only: the sheet settles its height (and a drive row arrives) after the map is asked
  // for, and each new size would be another counted call. The picture is cropped to fit. Demo mode
  // keeps to OSM.
  const tall = (h) => (h <= 260 ? 220 : h <= 360 ? 320 : 420);
  let picture = $derived(place && !ui.demo ? mediaUrl(`/api/staticmap?lat=${place.lat}&lon=${place.lon}&w=${width}&h=${tall(height)}&z=${zoom}`) : '');

  // Web Mercator: the pin's position in pixels at this zoom, and the tiles around it.
  let failed = $state(false);
  let big = $state(false);
  let tiles = $derived.by(() => {
    if (!place || !failed) return [];
    const n = 2 ** zoom, lat = (place.lat * Math.PI) / 180;
    const px = ((place.lon + 180) / 360) * n * TILE;
    const py = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * TILE;
    const left = px - width / 2, top = py - height / 2, out = [];
    for (let tx = Math.floor(left / TILE); tx * TILE < left + width; tx++) {
      for (let ty = Math.floor(top / TILE); ty * TILE < top + height; ty++) {
        if (ty < 0 || ty >= n) continue;
        out.push({ key: tx + '/' + ty, src: mediaUrl(`/api/tiles/${zoom}/${((tx % n) + n) % n}/${ty}`), x: tx * TILE - left, y: ty * TILE - top });
      }
    }
    return out;
  });
</script>

{#if place}
  <button class="map" style="width: {width}px; height: {height}px" onclick={() => (big = true)} aria-label="Open a bigger map">
    {#if picture && !failed}
      <!-- Google's picture has its own pin and credit. -->
      <img class="google" src={picture} alt="" decoding="async" onerror={() => (failed = true)} />
    {:else}
      {#each tiles as t (t.key)}
        <img src={t.src} alt="" decoding="async" style="transform: translate({t.x}px, {t.y}px)" />
      {/each}
      <span class="pin"></span>
      <span class="credit">© OpenStreetMap</span>
    {/if}
    <span class="more"><Icon name="maximize" size={22} /></span>
  </button>
  {#if big}<MapView {place} title={location} onclose={() => (big = false)} />{/if}
{/if}

<style>
  .map { position: relative; flex: none; display: block; padding: 0; overflow: hidden; border-radius: 18px; background: #e8e4dc; }
  img { position: absolute; left: 0; top: 0; width: 256px; height: 256px; }
  img.google { width: 100%; height: 100%; object-fit: cover; }
  .pin { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: var(--red); border: 4px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .35); }
  /* Says the map opens bigger; top right, clear of Google's logo and credit along the bottom. */
  .more { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: rgba(28, 28, 30, .7); color: #fff; }
  .credit { position: absolute; right: 0; bottom: 0; padding: 2px 8px; border-top-left-radius: 8px; background: rgba(255, 255, 255, .8); color: #333; font-size: 11px; }
</style>
