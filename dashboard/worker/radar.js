// Rain radar for the weather sheet: RainViewer's list of radar frames (the past two hours, every 10
// minutes; free, no key) and where home is, so the frame can draw the map around it. The frame
// loads the radar tiles from RainViewer's CDN itself (small PNGs, zoom 7 at most on the free API),
// and the street map under them through /api/tiles.
//   GET /api/radar -> { lat, lon, zoom, host, frames: [{ time, path }] }  (frames oldest first)
const LIST = 'https://api.rainviewer.com/public/weather-maps.json';
export const RADAR_ZOOM = 7; // the most the free tiles go to

export async function getRadar(env) {
  const lat = Number(env.WEATHER_LAT), lon = Number(env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: 'WEATHER_LAT / WEATHER_LON not set' };
  const res = await fetch(LIST, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error('RainViewer ' + res.status);
  const d = await res.json();
  const frames = ((d.radar && d.radar.past) || [])
    .filter((f) => f && typeof f.path === 'string' && /^\/v2\/radar\/[\w-]+$/.test(f.path) && Number.isFinite(f.time))
    .map((f) => ({ time: f.time, path: f.path }));
  return { lat, lon, zoom: RADAR_ZOOM, host: /^https:\/\/[\w.-]+$/.test(d.host || '') ? d.host : 'https://tilecache.rainviewer.com', frames };
}
