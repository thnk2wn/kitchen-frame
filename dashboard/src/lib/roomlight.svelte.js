// Room light: is the room lit? "Photos after sunset: Dim when dark" (Settings → Display) keeps the
// clock screen's photos at full strength through a lit evening and dims them once the room goes dark,
// instead of from sunset: in autumn sunset is hours before anyone goes to bed.
//
// The light level comes from Home Assistant: every illuminance sensor in the presence area
// (?presence_area=kitchen, PRESENCE_AREA in .frame.vars), or one named with ?light_sensor=sensor.x
// (LIGHT_SENSOR; "off" turns it off). The brightest reading counts, so one lit sensor is enough.
// Lit means above DARK_LUX (?dark_lux=, default 20 lux: lights off reads at a sensor's floor, about
// 10, and a lamp-lit evening 25 and up). A change counts only after it has held for SETTLE_MS, so a
// light flicked on and off doesn't flash the photos. Without a sensor, lit stays null and the photos
// dim from sunset as before.
//
// One render_template subscription, like presence: HA pushes the result whenever a sensor changes.
import { subscribeTo, onHAConnect, haConfigured } from './ha.svelte.js';
import { presenceArea } from './presence.svelte.js';

const KEYS = { light_sensor: 'frame-light-sensor', dark_lux: 'frame-dark-lux' };
{
  const q = new URLSearchParams(location.search);
  let changed = false;
  for (const [param, key] of Object.entries(KEYS)) {
    if (!q.has(param)) continue;
    const v = q.get(param);
    try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch {}
    q.delete(param);
    changed = true;
  }
  if (changed) history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
}
const setting = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const DEFAULT_DARK_LUX = 20;
const SETTLE_MS = 60 * 1000;

export const roomLight = $state({
  sensors: [], // entity ids found (or the one named)
  lux: null,   // the brightest reading right now
  lit: null,   // settled: true lit, false dark, null unknown (no sensor, or no reading yet)
});

export const darkLux = () => {
  const n = Number(setting(KEYS.dark_lux));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DARK_LUX;
};

const template = (area, sensor) => (sensor
  ? `{% set s = [states[${JSON.stringify(sensor)}]] | reject('none') | list %}`
  : `{% set s = expand(area_entities(${JSON.stringify(area)}) | select('match', 'sensor\\\\.') | list) | selectattr('attributes.device_class', 'eq', 'illuminance') | list %}`) +
  `{% set v = s | map(attribute='state') | select('is_number') | map('float') | list %}` +
  `{{ {'sensors': s | map(attribute='entity_id') | list, 'lux': (v | max) if v else none} | tojson }}`;

let pending = null; // { lit, timer } while a change waits out SETTLE_MS
function update(lux) {
  roomLight.lux = lux;
  const lit = lux == null ? null : lux > darkLux();
  if (lit === roomLight.lit) { if (pending) { clearTimeout(pending.timer); pending = null; } return; }
  // The first reading, or losing the sensor, applies at once; a change of state waits.
  if (roomLight.lit == null || lit == null) {
    if (pending) { clearTimeout(pending.timer); pending = null; } // a change waiting on a lost sensor is dropped
    roomLight.lit = lit;
    return;
  }
  if (pending && pending.lit === lit) return;
  if (pending) clearTimeout(pending.timer);
  pending = { lit, timer: setTimeout(() => { roomLight.lit = lit; pending = null; }, SETTLE_MS) };
}

onHAConnect(() => {
  const sensor = setting(KEYS.light_sensor);
  const area = presenceArea();
  if (sensor === 'off' || (!sensor && !area) || !haConfigured()) return;
  subscribeTo({ type: 'render_template', template: template(area, sensor), report_errors: false }, (ev) => {
    let r = ev.result;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return; } }
    if (!r || !Array.isArray(r.sensors)) return;
    roomLight.sensors = r.sensors;
    update(typeof r.lux === 'number' ? r.lux : null);
  }).catch((e) => console.error('room light', e));
});
