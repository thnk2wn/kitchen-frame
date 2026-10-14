// House tab: mirrors one Home Assistant dashboard (frame-ha-dashboard, its URL path) over the same
// WebSocket as the Music tab. The dashboard's cards say which devices to show and in what order,
// so editing the dashboard in HA changes the frame; nothing household-specific lives in this repo.
//
// Supported cards: heading (starts a group), tile/entity/button and thermostat (a device),
// picture-entity/picture-glance with a camera (a snapshot), markdown (HA renders its template),
// and a view header card (markdown) shown above the groups. Other cards are skipped.
import { ha, send, subscribeTo, unsubscribeFrom, callService, onHAConnect, haDashboard, applyEntityDiff } from './ha.svelte.js';
import { parseDashboard } from './dashboard.js';
import { demoHouse } from './demo.js';
export { miniMarkdown } from './dashboard.js';

export const house = $state({
  status: 'off',   // off | loading | ready | error
  error: null,
  title: '',
  header: null,    // rendered header markdown
  groups: [],      // [{ title, items: [{ kind, entity?, key? }] }]
  states: {},      // entity_id -> { state, attributes }
  text: {},        // template key -> rendered markdown
  // Thermostat changes sent but not yet reported back (thermostats can take seconds to confirm):
  // "entity:which" -> { value, failed? }. The tile shows the pending value dimmed.
  pending: {},
});
const PENDING_MS = 30000;
const timers = new Map();

let started = false;
let stopHook = null;
let subs = [];          // this layout's subscriptions (entities, templates), dropped on reload
let watching = false;   // listening for the dashboard being saved in HA

// Starts once (first time the House tab or Home's status needs it) and re-subscribes after reconnects.
export function startHouse() {
  if (started || !haDashboard()) return;
  started = true;
  house.status = 'loading';
  stopHook = onHAConnect(() => { subs = []; watching = false; load(); });
}

async function load() {
  try {
    // Edits to the dashboard in HA show up here within a second or two.
    if (!watching) {
      watching = true;
      subscribeTo({ type: 'subscribe_events', event_type: 'lovelace_updated' }, (ev) => {
        if (ev.data && ev.data.url_path === haDashboard()) load();
      }).catch(() => { watching = false; });
    }
    const config = await send({ type: 'lovelace/config', url_path: haDashboard(), force: true });
    for (const id of subs) unsubscribeFrom(id);
    subs = [];
    const parsed = parseDashboard(config);
    // In demo mode the real layout waits behind the scenes until demo mode is switched off.
    const target = houseDemo.on ? (saved ||= {}) : house;
    target.title = parsed.title;
    target.groups = parsed.groups;
    target.header = null;
    // Cameras also bring their snapshot companions (ring-mqtt names them "<name>_snapshot" beside the
    // Ring integration's "<name>_live_view"), so the frame can show the fresher picture.
    const ids = [...new Set(parsed.groups.flatMap((g) => g.items.flatMap((i) => [i.entity, ...(i.kind === 'camera' ? companionsOf(i.entity) : [])])).filter(Boolean))];
    const map = new Map();
    if (ids.length) {
      subs.push(await subscribeTo({ type: 'subscribe_entities', entity_ids: ids }, (ev) => {
        applyEntityDiff(map, ev);
        if (houseDemo.on) return;
        house.states = Object.fromEntries(map);
        settle();
      }));
    }
    // HA renders each markdown template and re-sends it whenever its entities change.
    for (const [key, template] of Object.entries(parsed.templates)) {
      subscribeTo({ type: 'render_template', template, report_errors: false }, (ev) => {
        if (typeof ev.result !== 'string') return;
        const t = houseDemo.on ? (saved ||= {}) : house;
        if (key === 'header') t.header = ev.result;
        else t.text = { ...(t.text || {}), [key]: ev.result };
      }).then((id) => subs.push(id), () => {});
    }
    house.error = null;
    if (houseDemo.on) saved.status = 'ready'; else house.status = 'ready';
  } catch (err) {
    house.status = 'error';
    house.error = /not found|config_not_found/i.test(err.message) ? 'Home Assistant has no dashboard "' + haDashboard() + '"' : err.message;
  }
}

// ---- Demo mode: an invented house (lib/demo.js); taps change it locally and nothing reaches HA.

export const houseDemo = $state({ on: false });
let saved = null;
export function setHouseDemo(on) {
  if (on === houseDemo.on) return;
  houseDemo.on = on;
  if (on) {
    saved = { title: house.title, header: house.header, groups: house.groups, states: house.states, text: house.text, status: house.status };
    Object.assign(house, demoHouse(), { status: 'ready', pending: {} });
  } else if (saved) {
    Object.assign(house, saved);
    saved = null;
    if (started && ha.status === 'connected') load(); // fresh states after the demo
  }
}
function local(entity, state, attrs = {}) {
  const cur = house.states[entity] || { attributes: {} };
  house.states = { ...house.states, [entity]: { state, attributes: { ...cur.attributes, ...attrs } } };
  return Promise.resolve();
}
const flip = { on: 'off', off: 'on', open: 'closed', closed: 'open' };

// ---- Actions

export const toggle = (entity) => houseDemo.on ? local(entity, flip[house.states[entity]?.state] || 'on') : callService('homeassistant', 'toggle', {}, { entity_id: entity });
export const run = (entity) => {
  if (houseDemo.on) return Promise.resolve();
  const domain = entity.split('.')[0];
  return callService(domain, domain === 'button' ? 'press' : 'turn_on', {}, { entity_id: entity }); // buttons are pressed
};
export const coverToggle = (entity) => houseDemo.on ? local(entity, flip[house.states[entity]?.state] || 'open', { current_position: 100 }) : callService('cover', 'toggle', {}, { entity_id: entity });
export const lock = (entity) => houseDemo.on ? local(entity, 'locked') : callService('lock', 'lock', {}, { entity_id: entity });
export const unlock = (entity) => houseDemo.on ? local(entity, 'unlocked') : callService('lock', 'unlock', {}, { entity_id: entity });

// Thermostats: one setpoint (heat or cool) or a range (heat_cool / auto). which = 'low' | 'high' | null.
// Taps build on the value on screen (pending or reported), so three taps make three steps. In a range,
// the other setpoint moves along to keep a minimum gap between them, as a thermostat's own app does:
// an ecobee over HomeKit silently ignores a pair closer than its minimum instead of moving the other
// one itself. The gap is the thermostat's own setting (an ecobee's "heat/cool min delta", 5 °F unless
// changed): THERMOSTAT_GAP in .frame.vars, passed once as ?thermostat_gap=. A change the thermostat
// doesn't confirm shows as failed.
const GAP_KEY = 'frame-thermostat-gap';
{
  const q = new URLSearchParams(location.search);
  if (q.has('thermostat_gap')) {
    const v = Number(q.get('thermostat_gap'));
    try { v > 0 ? localStorage.setItem(GAP_KEY, String(v)) : localStorage.removeItem(GAP_KEY); } catch {}
    q.delete('thermostat_gap');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
}
const minGapF = () => { try { return Number(localStorage.getItem(GAP_KEY)) || 5; } catch { return 5; } };
const attrKey = (which) => (which === 'low' ? 'target_temp_low' : which === 'high' ? 'target_temp_high' : 'temperature');
export function setpoint(entity, which) {
  const p = house.pending[entity + ':' + (which || 'set')];
  if (p && !p.failed) return { value: p.value, pending: true };
  return { value: Number(((house.states[entity] || {}).attributes || {})[attrKey(which)]), pending: false, failed: !!(p && p.failed) };
}
export function nudge(entity, which, delta) {
  const a = (house.states[entity] || {}).attributes || {};
  const step = Number(a.target_temp_step) || 1;
  const clamp = (v) => Math.min(Number(a.max_temp) || 99, Math.max(Number(a.min_temp) || 40, v));
  const value = clamp(setpoint(entity, which).value + delta * step);
  if (!Number.isFinite(value)) return Promise.resolve();
  // The new value, and for a range the other end moved if it would be closer than the minimum gap.
  const set = {};
  if (!which) set[''] = value;
  else {
    const gap = (Number(a.max_temp) || 99) > 50 ? minGapF() : Math.round(minGapF() / 1.8 * 2) / 2; // °F, or the same in °C
    let low = which === 'low' ? value : setpoint(entity, 'low').value;
    let high = which === 'high' ? value : setpoint(entity, 'high').value;
    if (high - low < gap) { if (which === 'low') high = clamp(low + gap); else low = clamp(high - gap); }
    if (high - low < gap) return Promise.resolve(); // at the limit of the thermostat's range
    set.low = low; set.high = high;
  }
  if (houseDemo.on) return local(entity, house.states[entity].state, which ? { target_temp_low: set.low, target_temp_high: set.high } : { temperature: value });
  const keys = which ? ['low', 'high'].filter((w) => w === which || set[w] !== setpoint(entity, w).value) : [''];
  for (const w of keys) {
    const key = entity + ':' + (w || 'set');
    house.pending = { ...house.pending, [key]: { value: w ? set[w] : value } };
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => fail(key), PENDING_MS));
  }
  const data = which ? { target_temp_low: set.low, target_temp_high: set.high } : { temperature: value };
  return callService('climate', 'set_temperature', data, { entity_id: entity })
    .catch((e) => { for (const w of keys) fail(entity + ':' + (w || 'set')); throw e; });
}
function fail(key) {
  if (!house.pending[key]) return;
  house.pending = { ...house.pending, [key]: { ...house.pending[key], failed: true } };
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { const { [key]: _, ...rest } = house.pending; house.pending = rest; }, 6000));
}
// A pending value is done once the thermostat reports it.
function settle() {
  let next = null;
  for (const [key, p] of Object.entries(house.pending)) {
    if (p.failed) continue;
    const [entity, which] = key.split(':');
    const reported = Number(((house.states[entity] || {}).attributes || {})[attrKey(which === 'set' ? null : which)]);
    if (reported === p.value) { (next ||= { ...house.pending }); delete next[key]; clearTimeout(timers.get(key)); }
  }
  if (next) house.pending = next;
}

export function houseReady() { return ha.status === 'connected' && house.status === 'ready'; }

// A camera's companions, by name (whether or not they exist): [snapshot camera, take-snapshot button,
// stream camera]. The first two are ring-mqtt's; the stream is a camera you add in Home Assistant for
// a better live view, named <name>_stream (docs: README, House tab). Ring's own live view gives some
// browsers a small 480x272 picture; ring-mqtt's stream through HA gives them 720p.
export function companionsOf(entity) {
  const base = String(entity || '').replace(/^camera\./, '').replace(/_(live_view|snapshot|stream)$/, '');
  return ['camera.' + base + '_snapshot', 'button.' + base + '_take_snapshot', 'camera.' + base + '_stream'];
}
