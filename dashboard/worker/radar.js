// Rain radar for the weather sheet: the last hour, now, and the next two hours, around home.
//   GET /api/radar -> { lat, lon, zoom, source, frames: [{ time, url, kind }] }
// time: ms; url: a tile template with {z}/{x}/{y}; kind: 'past' | 'now' | 'forecast'; oldest first.
// The frame loads the tiles itself (small PNGs), and the street map under them through /api/tiles.
//
// In the US: the Iowa Environmental Mesonet's tiles (free, no key). Past and now are the NWS
// NEXRAD composite (every 5 minutes); the forecast is NOAA's HRRR model's simulated radar, in
// 15-minute steps from its latest run, which is an hour or two old, so the steps are counted from
// when it started. Elsewhere: RainViewer, the past two hours only (it has no forecast).
const IEM = 'https://mesonet.agron.iastate.edu';
const TILES = IEM + '/cache/tile.py/1.0.0/';
const MIN = 60000;
// Radar tiles' zoom, shown doubled over a street map one zoom closer. In the US 9 (over a zoom 10
// map, about 130 km across: home and the towns around it); RainViewer's free tiles stop at 7.
export const RADAR_ZOOM = 9;
const RAINVIEWER_ZOOM = 7;

const inUS = (lat, lon) => lat > 18 && lat < 50 && lon > -128 && lon < -64;
const getJson = async (u) => {
  const r = await fetch(u, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!r.ok) throw new Error(u.split('/').pop() + ' ' + r.status);
  return r.json();
};

// Past and now from NEXRAD, the next two hours from HRRR, as frames.
export function iemFrames(nowValid, hrrrInit, now = Date.now()) {
  const frames = [];
  for (const m of [50, 40, 30, 20, 10]) frames.push({ time: nowValid - m * MIN, url: `${TILES}nexrad-n0q-900913-m${String(m).padStart(2, '0')}m/{z}/{x}/{y}.png`, kind: 'past' });
  frames.push({ time: nowValid, url: `${TILES}nexrad-n0q-900913/{z}/{x}/{y}.png`, kind: 'now' });
  if (Number.isFinite(hrrrInit)) {
    for (const ahead of [30, 60, 90, 120]) {
      const f = Math.ceil((now + ahead * MIN - hrrrInit) / (15 * MIN)) * 15; // minutes into the run
      if (f <= 0 || f > 1080) continue;
      frames.push({ time: hrrrInit + f * MIN, url: `${TILES}hrrr::REFD-F${String(f).padStart(4, '0')}-0/{z}/{x}/{y}.png`, kind: 'forecast' });
    }
  }
  // The same tile address shows a newer picture every few minutes: tie each to its time.
  return frames.map((x) => ({ ...x, url: x.url + '?v=' + Math.round(x.time / MIN) }));
}

export async function getRadar(env) {
  const lat = Number(env.WEATHER_LAT), lon = Number(env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: 'WEATHER_LAT / WEATHER_LON not set' };
  if (inUS(lat, lon)) {
    const [n0q, hrrr] = await Promise.all([
      getJson(IEM + '/data/gis/images/4326/USCOMP/n0q_0.json'),
      getJson(IEM + '/data/gis/images/4326/hrrr/refd_0000.json').catch(() => null),
    ]);
    const valid = Date.parse(n0q.meta && n0q.meta.valid);
    if (!Number.isFinite(valid)) throw new Error('no radar time');
    return { lat, lon, zoom: RADAR_ZOOM, source: 'NWS radar and NOAA HRRR, via Iowa Environmental Mesonet', frames: iemFrames(valid, hrrr ? Date.parse(hrrr.model_init_utc) : NaN) };
  }
  const d = await getJson('https://api.rainviewer.com/public/weather-maps.json');
  const host = /^https:\/\/[\w.-]+$/.test(d.host || '') ? d.host : 'https://tilecache.rainviewer.com';
  const past = ((d.radar && d.radar.past) || []).filter((f) => f && /^\/v2\/radar\/[\w-]+$/.test(f.path || '') && Number.isFinite(f.time));
  return { lat, lon, zoom: RAINVIEWER_ZOOM, source: 'RainViewer',
    frames: past.map((f, i) => ({ time: f.time * 1000, url: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, kind: i === past.length - 1 ? 'now' : 'past' })) };
}
