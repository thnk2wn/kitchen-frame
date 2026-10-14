// Presence: is anyone in the room? With an HA area set (?presence_area=kitchen, or PRESENCE_AREA in
// .frame.vars), the frame watches every motion, occupancy and presence sensor HA has in that area,
// so the clock screen comes on only once the room has been empty a while, and goes away by itself
// when someone walks in. Adding or swapping sensors in HA needs no change here.
//
// One render_template subscription does it: HA re-renders the template (and pushes the result)
// whenever any of those sensors changes.
import { subscribeTo, onHAConnect, haConfigured } from './ha.svelte.js';

const KEY = 'frame-presence-area';
{
  const q = new URLSearchParams(location.search);
  if (q.has('presence_area')) {
    const v = q.get('presence_area');
    try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {}
    q.delete('presence_area');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
}
export const presenceArea = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };

export const presence = $state({
  sensors: [],      // entity ids found in the area
  occupied: false,  // any of them on right now
  lastSeen: 0,      // when one was last on (ms)
});
const arrivals = new Set();
// fn runs when the room goes from empty to occupied.
export function onArrive(fn) { arrivals.add(fn); return () => arrivals.delete(fn); }

const template = (area) => `{% set ids = area_entities(${JSON.stringify(area)}) | select('match', 'binary_sensor\\\\.') | list %}` +
  `{% set s = expand(ids) | selectattr('attributes.device_class', 'in', ['motion', 'occupancy', 'presence']) | list %}` +
  `{{ {'sensors': s | map(attribute='entity_id') | list, 'on': s | selectattr('state', 'eq', 'on') | map(attribute='entity_id') | list} | tojson }}`;

onHAConnect(() => {
  const area = presenceArea();
  if (!area || !haConfigured()) return;
  subscribeTo({ type: 'render_template', template: template(area), report_errors: false }, (ev) => {
    let r = ev.result;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return; } }
    if (!r || !Array.isArray(r.on)) return;
    const was = presence.occupied;
    presence.sensors = r.sensors || [];
    presence.occupied = r.on.length > 0;
    if (presence.occupied) presence.lastSeen = Date.now();
    else if (was) presence.lastSeen = Date.now(); // empty from now on
    if (presence.occupied && !was) for (const fn of arrivals) { try { fn(); } catch (e) { console.error(e); } }
  }).catch((e) => console.error('presence', e));
});
