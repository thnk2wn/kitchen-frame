// Notices: Home Assistant persistent notifications meant for the frame, shown as banners on Home,
// a line on the clock screen and a chip in the top bar elsewhere. Nothing device-specific lives
// here: an HA automation creates one with persistent_notification.create and a notification_id
// starting "frame_", and dismisses it (persistent_notification.dismiss) when the problem clears.
// HA's own notifications (repairs, new devices, …) don't start with "frame_" and are left alone.
//
// Tone comes from the id: frame_alert_… is red, frame_info_… blue, anything else orange. Alerts
// sort first, so the top bar chip and the clock screen line take the most urgent one.
// Tapping a banner shows its message; Dismiss removes it in HA for every screen.
import { ui } from './state.svelte.js';
import { subscribeTo, callService, onHAConnect } from './ha.svelte.js';

const PREFIX = 'frame_';
const real = $state({ list: [] }); // [{ id, title, message, created, tone }], alerts first, then newest
const RANK = { alert: 0, warn: 1, info: 2 };
const map = new Map();

onHAConnect(() => {
  map.clear();
  subscribeTo({ type: 'persistent_notification/subscribe' }, (ev) => {
    if (ev.type === 'current') map.clear();
    for (const [id, n] of Object.entries(ev.notifications || {})) {
      if (!id.startsWith(PREFIX)) continue;
      if (ev.type === 'removed') map.delete(id);
      else map.set(id, n);
    }
    real.list = [...map.values()]
      .map((n) => ({ id: n.notification_id, title: n.title || '', message: n.message || '', created: n.created_at, tone: toneOf(n.notification_id) }))
      .sort((a, b) => (RANK[a.tone] - RANK[b.tone]) || String(b.created).localeCompare(String(a.created)));
  }).catch((e) => console.error('notices', e));
});

// The icon for a tone: a bell for info, a warning triangle for warnings and alerts.
export const iconOf = (tone) => (tone === 'info' ? 'bell' : 'alert');

function toneOf(id) {
  return id.startsWith(PREFIX + 'alert') ? 'alert' : id.startsWith(PREFIX + 'info') ? 'info' : 'warn';
}

// What the screen shows: the real notices, or invented ones in demo mode.
const DEMO = [
  { id: 'frame_alert_demo_freezer', title: 'Garage freezer is 18°F', message: 'Above 15°F for 45 minutes.', created: '', tone: 'alert' },
  { id: 'frame_info_demo_thermostat', title: 'Upstairs set to Auto, 70–75°', message: 'Changed outside Home Assistant (the thermostat, its app or voice).', created: '', tone: 'info' },
];
// ?notices=<n> shows only the first n demo notices (screenshots of Home with music playing).
let demoDismissed = $state((() => {
  const n = new URLSearchParams(location.search).get('notices');
  return /^\d$/.test(n || '') ? DEMO.slice(Number(n)).map((d) => d.id) : [];
})());
export const notices = () => (ui.demo ? DEMO.filter((n) => !demoDismissed.includes(n.id)) : real.list);

export function dismissNotice(id) {
  if (ui.demo) { demoDismissed = [...demoDismissed, id]; return Promise.resolve(); }
  real.list = real.list.filter((n) => n.id !== id); // at once; HA confirms with a "removed" event
  return callService('persistent_notification', 'dismiss', { notification_id: id }).catch(() => {});
}
