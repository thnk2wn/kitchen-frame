// Notices: Home Assistant persistent notifications meant for the frame, shown as banners on Home,
// a line on the clock screen and a chip in the top bar elsewhere. Nothing device-specific lives
// here: an HA automation creates one with persistent_notification.create and a notification_id
// starting "frame_", and dismisses it (persistent_notification.dismiss) when the problem clears.
// HA's own notifications (repairs, new devices, …) don't start with "frame_" and are left alone.
//
// Tone comes from the id: frame_alert_… is red, frame_info_… blue, anything else orange. Alerts
// sort first, so the top bar chip and the clock screen line take the most urgent one.
// Tapping a banner shows its message; Dismiss removes it in HA for every screen.
//
// History: as each one ends (dismissed here, cleared by its automation, or expired) the frame
// reports it to the Worker (worker/notices.js), which keeps the last 24 hours for the sheet's
// "Earlier". Blue info notices still on after NOTICES_INFO_HOURS (24 by default) are dismissed here.
import { ui } from './state.svelte.js';
import { subscribeTo, callService, onHAConnect } from './ha.svelte.js';
import { api } from './api.js';

const PREFIX = 'frame_';
const real = $state({ list: [] }); // [{ id, title, message, created, tone }], alerts first, then newest
const RANK = { alert: 0, warn: 1, info: 2 };
const map = new Map();

// How notices we removed ourselves ended, by id: 'dismissed' or 'expired' (anything else: cleared).
const endedHere = new Map();

onHAConnect(() => {
  // Notices from before a reconnect that are gone afterwards ended while we weren't watching.
  const before = new Map(map);
  map.clear();
  subscribeTo({ type: 'persistent_notification/subscribe' }, (ev) => {
    if (ev.type === 'current') {
      map.clear();
      for (const [id, n] of before) if (!(ev.notifications || {})[id]) record(n);
      before.clear();
    }
    for (const [id, n] of Object.entries(ev.notifications || {})) {
      if (!id.startsWith(PREFIX)) continue;
      if (ev.type === 'removed') { record(map.get(id) || n); map.delete(id); }
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
const minsAgo = (min) => new Date(Date.now() - min * 60000).toISOString();
const DEMO = [
  { id: 'frame_alert_demo_freezer', title: 'Garage freezer is 18°F', message: 'Above 15°F for 45 minutes.', created: minsAgo(25), tone: 'alert' },
  { id: 'frame_info_demo_thermostat', title: 'Upstairs set to Auto, 70–75°', message: 'Changed outside Home Assistant (the thermostat, its app or voice).', created: minsAgo(180), tone: 'info' },
];
// ?notices=many adds more, to see the banners' "+N more" and a long sheet.
if (new URLSearchParams(location.search).get('notices') === 'many') DEMO.push(
  { id: 'frame_demo_garage', title: 'Garage door open for 20 minutes', message: 'Opened at 7:58 AM.', created: minsAgo(40), tone: 'warn' },
  { id: 'frame_alert_demo_leak', title: 'Water under the dishwasher', message: 'The leak sensor has been wet for 2 minutes.', created: minsAgo(8), tone: 'alert' },
  { id: 'frame_info_demo_filter', title: 'Furnace filter due', message: 'Replaced 90 days ago.', created: minsAgo(300), tone: 'info' },
);
DEMO.sort((a, b) => (RANK[a.tone] - RANK[b.tone]) || b.created.localeCompare(a.created)); // as the real list
// ?notices=<n> shows only the first n demo notices (screenshots of Home with music playing).
let demoDismissed = $state((() => {
  const n = new URLSearchParams(location.search).get('notices');
  return /^\d$/.test(n || '') ? DEMO.slice(Number(n)).map((d) => d.id) : [];
})());
export const notices = () => (ui.demo ? DEMO.filter((n) => !demoDismissed.includes(n.id)) : real.list);

// Earlier notices, the last 24 hours, newest first: [{ id, title, message, tone, created, ended, how }],
// how = 'dismissed' (on the frame) | 'cleared' (by Home Assistant, the problem went away).
const DEMO_EARLIER = [
  { id: 'e1', title: 'Front door unlocked for 10 minutes', message: 'Locked again from the House tab.', tone: 'warn', created: minsAgo(70), ended: minsAgo(56), how: 'cleared' },
  { id: 'e2', title: 'Garage freezer is 17°F', message: 'Above 15°F for 45 minutes.', tone: 'alert', created: minsAgo(610), ended: minsAgo(565), how: 'cleared' },
  { id: 'e3', title: 'Upstairs set to Heat, 68°', message: 'Changed outside Home Assistant (the thermostat, its app or voice).', tone: 'info', created: minsAgo(840), ended: minsAgo(700), how: 'dismissed' },
  { id: 'e4', title: 'Washer finished', message: '', tone: 'info', created: minsAgo(1300), ended: minsAgo(1290), how: 'dismissed' },
  { id: 'e5', title: 'Back door open for 10 minutes', message: '', tone: 'warn', created: minsAgo(95), ended: minsAgo(84), how: 'cleared' },
  { id: 'e6', title: 'Downstairs set to Cool, 74°', message: 'Changed outside Home Assistant (the thermostat, its app or voice).', tone: 'info', created: minsAgo(400), ended: minsAgo(340), how: 'cleared' },
  { id: 'e7', title: 'Dryer finished', message: '', tone: 'info', created: minsAgo(900), ended: minsAgo(880), how: 'expired' },
  { id: 'e8', title: 'Front door unlocked for 10 minutes', message: '', tone: 'warn', created: minsAgo(1000), ended: minsAgo(985), how: 'cleared' },
  { id: 'e9', title: 'Upstairs bedroom is 81°F', message: 'Above 80°F for 30 minutes.', tone: 'alert', created: minsAgo(1150), ended: minsAgo(1100), how: 'cleared' },
  { id: 'e10', title: 'Package at the front door', message: '', tone: 'info', created: minsAgo(1250), ended: minsAgo(1240), how: 'dismissed' },
];
export const earlier = () => {
  if (ui.demo) return DEMO_EARLIER;
  const since = Date.now() - past.keepHours * 3600000;
  return past.items.filter((n) => Date.parse(n.ended) >= since).sort((a, b) => String(b.created).localeCompare(String(a.created)));
};

// Unread: anything that started after the notices sheet was last opened (remembered per frame).
// The top bar's bell shows how many, in the most urgent one's colour; opening the sheet reads them.
const SEEN_KEY = 'frame-notices-seen';
const seen = $state({ at: (() => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } })(), demoAt: Date.now() - 2 * 3600000 });
const seenAt = () => (ui.demo ? seen.demoAt : seen.at);
export const isNew = (n) => !!n.created && Date.parse(n.created) > seenAt();
export const unread = () => [...notices(), ...earlier()].filter(isNew).sort((a, b) => RANK[a.tone] - RANK[b.tone]);
export function markSeen() {
  if (ui.demo) { seen.demoAt = Date.now(); return; }
  seen.at = Date.now();
  try { localStorage.setItem(SEEN_KEY, String(seen.at)); } catch {}
}

export function dismissNotice(id, how = 'dismissed') {
  if (ui.demo) { demoDismissed = [...demoDismissed, id]; return Promise.resolve(); }
  endedHere.set(id, how);
  real.list = real.list.filter((n) => n.id !== id); // at once; HA confirms with a "removed" event
  return callService('persistent_notification', 'dismiss', { notification_id: id }).catch(() => {});
}
export const dismissAll = () => Promise.all(notices().map((n) => dismissNotice(n.id)));

// ---- History (worker/notices.js)

const past = $state({ items: [], keepHours: 24, infoHours: 24 });

// One notice, however its start is written: HA sends microseconds and an offset (…03.123456+00:00),
// the Worker keeps an ISO time (…03.123Z), so comparing the strings showed it twice.
const same = (x) => x.id + '|' + Date.parse(x.created);

// A notice has ended: show it under Earlier at once, and keep it in the Worker.
function record(n) {
  if (!n || !n.notification_id || !n.notification_id.startsWith(PREFIX)) return;
  const id = n.notification_id;
  const item = { id, title: n.title || '', message: n.message || '', tone: toneOf(id), created: n.created_at,
    ended: new Date().toISOString(), how: endedHere.get(id) || 'cleared' };
  endedHere.delete(id);
  past.items = [item, ...past.items.filter((x) => same(x) !== same(item))];
  api('/api/notices', { method: 'POST', body: JSON.stringify(item) }).catch((e) => console.error('notices: not saved', e));
}

// The kept history and the Worker's settings: at start and whenever the sheet opens.
export async function loadEarlier() {
  if (ui.demo) return;
  try {
    const got = await api('/api/notices');
    // Keep anything recorded here that the Worker doesn't list yet (KV can lag a few seconds).
    const have = new Set(got.items.map(same));
    past.items = [...past.items.filter((x) => !have.has(same(x))), ...got.items];
    past.keepHours = got.keepHours;
    past.infoHours = got.infoHours;
  } catch {}
}
loadEarlier();

// Blue info notices still on after infoHours are dismissed (they move to Earlier as "Expired").
setInterval(() => {
  if (ui.demo || !past.infoHours) return;
  const cutoff = Date.now() - past.infoHours * 3600000;
  for (const n of real.list) if (n.tone === 'info' && Date.parse(n.created) < cutoff) dismissNotice(n.id, 'expired');
}, 60000);
