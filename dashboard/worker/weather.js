// Weather from Open-Meteo (free, no API key): current conditions, a 7-day daily forecast and hourly
// temperature/rain for the day detail sheet. In the US the National Weather Service (also free, no
// key) adds its written forecast for each day and night and any active alerts; elsewhere those are
// simply absent.
// Vars: WEATHER_LAT, WEATHER_LON, WEATHER_UNIT ("fahrenheit" default, or "celsius").
const NWS = 'https://api.weather.gov';
// NWS asks every client to identify itself.
const NWS_HEADERS = { 'User-Agent': 'kitchen-frame (github.com/thnk2wn/kitchen-frame)', Accept: 'application/geo+json' };

export async function getWeather(env) {
  if (!env.WEATHER_LAT || !env.WEATHER_LON) return { error: 'Set WEATHER_LAT and WEATHER_LON' };
  const unit = env.WEATHER_UNIT === 'celsius' ? 'celsius' : 'fahrenheit';
  const us = unit === 'fahrenheit';
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: env.WEATHER_LAT,
    longitude: env.WEATHER_LON,
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,uv_index',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,'
      + 'precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    temperature_unit: unit,
    wind_speed_unit: us ? 'mph' : 'kmh',
    precipitation_unit: us ? 'inch' : 'mm',
    timezone: 'auto',
    forecast_days: '7',
  });
  // Cache upstream for 10 minutes so every frame poll doesn't hit Open-Meteo. NWS is fetched
  // alongside; if it fails or doesn't cover the location, the forecast is shown without its text.
  const [res, nws] = await Promise.all([
    fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } }),
    getNws(env.WEATHER_LAT, env.WEATHER_LON).catch(() => null),
  ]);
  if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
  return shape(await res.json(), unit, nws);
}

// The NWS forecast is two steps: the point lookup (which never changes, so it's cached for a day)
// names the forecast office's grid, then the grid forecast. Alerts are by point.
async function getNws(lat, lon) {
  const at = Number(lat).toFixed(4) + ',' + Number(lon).toFixed(4);
  const get = async (u, ttl) => {
    const r = await fetch(u, { headers: NWS_HEADERS, cf: { cacheTtl: ttl, cacheEverything: true } });
    if (!r.ok) throw new Error('NWS HTTP ' + r.status);
    return r.json();
  };
  const point = await get(NWS + '/points/' + at, 86400);
  const [forecast, alerts] = await Promise.all([
    get(point.properties.forecast, 1800),
    get(NWS + '/alerts/active?point=' + at, 300).catch(() => null),
  ]);
  return { periods: forecast.properties.periods, alerts: alerts ? alerts.features : [] };
}

export function shape(w, unit, nws = null) {
  const c = w.current, d = w.daily, h = w.hourly;
  const pick = (a, i) => (a ? a[i] ?? null : null);
  const periods = nws ? nws.periods || [] : [];
  return {
    unit: unit === 'celsius' ? 'C' : 'F',
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    code: c.weather_code,
    day: c.is_day === 1,
    uvNow: c.uv_index == null ? null : Math.round(c.uv_index), // the UV right now (Home's badge)
    days: d.time.map((date, i) => ({
      date,
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i]),
      rain: d.precipitation_probability_max[i] ?? 0,
      code: d.weather_code[i],
      // Local wall-clock times ("2026-10-12T07:03"); the frame switches light/dark on these.
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
      precip: pick(d.precipitation_sum, i),
      wind: pick(d.wind_speed_10m_max, i) == null ? null : Math.round(d.wind_speed_10m_max[i]),
      gusts: pick(d.wind_gusts_10m_max, i) == null ? null : Math.round(d.wind_gusts_10m_max[i]),
      windDir: compass(pick(d.wind_direction_10m_dominant, i)),
      uv: pick(d.uv_index_max, i) == null ? null : Math.round(d.uv_index_max[i]),
      // NWS periods for this date: "Wednesday" and "Wednesday Night" (or "This Afternoon"/"Tonight"),
      // and the daytime one's short forecast as the day's label (the night's once the day is over).
      ...nwsDay(periods.filter((p) => String(p.startTime).slice(0, 10) === date)),
      hours: h ? h.time.flatMap((t, j) => (t.slice(0, 10) === date ? [{
        hour: Number(t.slice(11, 13)),
        temp: Math.round(h.temperature_2m[j]),
        rain: h.precipitation_probability[j] ?? 0,
        code: h.weather_code[j],
        day: h.is_day[j] === 1,
      }] : [])) : [],
    })),
    alerts: (nws ? nws.alerts || [] : []).map((a) => a.properties).filter(Boolean).map((a) => ({
      id: a.id,
      event: a.event,
      headline: a.headline,
      severity: a.severity,
      ends: a.ends || a.expires || null,
      text: [a.description, a.instruction].filter(Boolean).join('\n\n'),
    })),
    updated: new Date().toISOString(),
  };
}

function nwsDay(ps) {
  const main = ps.find((p) => p.isDaytime) || ps[0];
  return {
    short: main ? main.shortForecast : null,
    shortNight: main ? !main.isDaytime : false,
    text: ps.map((p) => ({ name: p.name, night: !p.isDaytime, text: p.detailedForecast })),
  };
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass(deg) {
  return deg == null ? null : POINTS[Math.round(deg / 45) % 8];
}
