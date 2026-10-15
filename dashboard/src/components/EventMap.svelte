<script module>
  // Last answers this session, so reopening an event doesn't ask again.
  const seen = new Map();
</script>

<script>
  // A small street map with a pin for an event's location: the Worker looks the place up once
  // (OpenStreetMap's Nominatim) and passes OSM tiles through its cache. Nothing shows if the place
  // can't be found (a video call, a room name), so the sheet just has no map.
  import { api, mediaUrl } from '../lib/api.js';

  let { location, width = 340, height = 280, zoom = 15, found = $bindable(false) } = $props();
  const TILE = 256;

  let place = $state(null);
  $effect(() => {
    const q = location;
    place = seen.get(q) || null;
    if (seen.has(q)) return;
    let live = true;
    api('/api/geo?q=' + encodeURIComponent(q)).then((r) => {
      if (!r.error) seen.set(q, r.place);
      if (live) place = r.place;
    }).catch(() => {});
    return () => { live = false; };
  });

  $effect(() => { found = !!place; });

  // Web Mercator: the pin's position in pixels at this zoom, and the tiles around it.
  let tiles = $derived.by(() => {
    if (!place) return [];
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
  <div class="map" style="width: {width}px; height: {height}px">
    {#each tiles as t (t.key)}
      <img src={t.src} alt="" decoding="async" style="transform: translate({t.x}px, {t.y}px)" />
    {/each}
    <span class="pin"></span>
    <span class="credit">© OpenStreetMap</span>
  </div>
{/if}

<style>
  .map { position: relative; flex: none; overflow: hidden; border-radius: 18px; background: #e8e4dc; }
  img { position: absolute; left: 0; top: 0; width: 256px; height: 256px; }
  .pin { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: var(--red); border: 4px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .35); }
  .credit { position: absolute; right: 0; bottom: 0; padding: 2px 8px; border-top-left-radius: 8px; background: rgba(255, 255, 255, .8); color: #333; font-size: 11px; }
</style>
