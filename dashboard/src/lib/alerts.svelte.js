// Home Assistant alerts, said out loud (Settings → Announcements → Home alerts): a red notice
// (frame_alert_…: a leak, the freezer) is said when it appears, at the louder alert volume, at
// night too unless that's turned off, and optionally again every 10 minutes until it clears or is
// dismissed. Orange ones can be said too, at the normal volume, never at night. Blue never.
//
// Each notice is said once per appearance (its id and when it was created), remembered across
// reloads, so a reload doesn't repeat it; one Home Assistant re-posts after a restart counts as new.
import { untrack } from 'svelte';
import { notices } from './notices.svelte.js';
import { say, speak } from './announce.svelte.js';
import { quietNow } from './night.svelte.js';
import { weather } from './state.svelte.js';
import { toSay, spoken, isWarning, alertKey, activeAlerts } from './wxalerts.js';

const MIN = 60000;
const REPEAT_MS = 10 * MIN;
const KEY = 'frame-alerts-said';
// "id|created" -> when it was last said. Exported so the notices sheet can mark them "Announced".
export const said = $state((() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })());
// By time, not text: Home Assistant and the Worker write the same moment differently.
export const keyOf = (n) => n.id + '|' + Date.parse(n.created);

const speaks = (n) => (n.tone === 'alert' ? say.alerts.red : n.tone === 'warn' && say.alerts.orange);
const allowedNow = (n) => !quietNow() || (n.tone === 'alert' && say.alerts.night);

function check() {
  if (!say.on) return;
  const now = Date.now();
  const current = notices();
  for (const n of current) {
    if (!speaks(n) || !allowedNow(n)) continue;
    const k = keyOf(n), last = said[k];
    const repeat = n.tone === 'alert' && say.alerts.repeat && last && now - last >= REPEAT_MS;
    if (last && !repeat) continue;
    said[k] = now; // claimed before speaking, so the next check can't repeat it
    const text = (n.tone === 'alert' ? 'Alert: ' : '') + (n.title || n.message);
    speak(text, { alert: n.tone === 'alert', kind: n.tone === 'alert' ? 'alert' : 'notice' }).then((ok) => { if (!ok && !last) delete said[k]; save(); }, () => { if (!last) delete said[k]; });
  }
  // Weather Service alerts (Settings → Announcements → Weather alerts): a warning at the alert volume,
  // day or night; anything else waits out quiet hours and is said then if it's still in effect.
  const wx = weather.data && weather.data.alerts;
  for (const a of toSay(wx, { mode: say.weather, quiet: quietNow(), said, now })) {
    const k = alertKey(a);
    said[k] = now;
    speak(spoken(a, now), { alert: isWarning(a), kind: 'weather' }).then((ok) => { if (!ok) delete said[k]; save(); }, () => { delete said[k]; });
  }
  // Forget notices that have gone (after a day, so the sheet's "Announced" outlives them a while).
  const live = new Set([...current.map(keyOf), ...activeAlerts(wx, now).map(alertKey)]);
  for (const k of Object.keys(said)) if (!live.has(k) && now - said[k] > 24 * 60 * MIN) delete said[k];
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(said)); } catch {} }

export function startAlerts() {
  $effect.root(() => {
    // As soon as a notice appears. Untracked: check() records what it said, which mustn't re-run it.
    $effect(() => { notices(); weather.data; say.on; say.alerts.red; say.alerts.orange; say.weather; untrack(check); });
  });
  setInterval(check, 60000); // repeats, and the night window ending
}
