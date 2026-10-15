// Announcements: what the frame says out loud on a speaker, through Home Assistant. One speaker and
// two volumes (Settings → Announcements), used by everything the frame says: agent messages, event
// reminders (lib/reminders.svelte.js) and Home Assistant alerts (lib/alerts.svelte.js). Timer alerts keep their own speaker setting.
//
// Speaking goes through the Home Assistant script script.frame_announce (homeassistant/scripts/):
// it uses an Echo's Announce when the speaker has one, otherwise text-to-speech, sets the
// announcement volume first and puts the speaker's own volume back afterwards. Without that script
// the frame falls back to plain text-to-speech at the speaker's current volume.
import { ha, announce as ttsSpeak, callService } from './ha.svelte.js';
import { ui } from './state.svelte.js';
import { log } from './log.svelte.js';

const KEY = 'frame-announcements';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

// The first time: carry over the old "Read messages aloud" choice (frame-announce: a speaker or 'off').
function initial() {
  let old = null;
  try { old = localStorage.getItem('frame-announce'); } catch {}
  return { on: false, speaker: old && old !== 'off' ? old : null, volume: 0.4, alertVolume: 0.7, messages: old !== 'off',
    // Event reminders (lib/reminders.svelte.js): calendars by name (all off to start), minutes
    // before, and whether an event's own reminder (0-120 min) wins over that.
    reminders: { cals: {}, lead: 30, own: true },
    // Home Assistant alerts (lib/alerts.svelte.js): red ones said (at night too, by default), orange
    // optional, and red repeated every 10 minutes until cleared or dismissed if wanted.
    alerts: { red: true, night: true, repeat: false, orange: false } };
}
const saved = read() || {};
export const say = $state({ ...initial(), ...saved, reminders: { ...initial().reminders, ...(saved.reminders || {}) },
  alerts: { ...initial().alerts, ...(saved.alerts || {}) } });

export function setSay(changes) {
  Object.assign(say, changes);
  try { localStorage.setItem(KEY, JSON.stringify(say)); } catch {}
}

// Speakers that can talk: Home Assistant's media players, not TVs or a Spotify account.
export const speakers = () => ha.players.filter((p) => !p.tv && !p.entity_id.startsWith('media_player.spotify_'));

// The chosen speaker if Home Assistant has it, else the first with "kitchen" in its name, else the first.
export function speaker() {
  const all = speakers();
  return all.find((p) => p.entity_id === say.speaker) || all.find((p) => /kitchen/i.test(p.entity_id)) || all[0] || null;
}

const hasScript = () => ha.scripts && ha.scripts.includes('script.frame_announce');

// Say something. alert: a red alert, at the louder alert volume. Nothing is said while
// Announcements is off (it starts off: opt in from Settings). kind: for the event log
// (reminder, alert, notice, message, test).
export function speak(text, { alert = false, kind = 'other' } = {}) {
  const s = speaker();
  const message = String(text).slice(0, 400);
  if (ui.demo || !say.on || !s || ha.status !== 'connected') {
    if (!ui.demo) log('announce.skipped', { kind, text: message, why: !say.on ? 'off' : !s ? 'no speaker' : 'not connected' }, 'warn');
    return Promise.resolve(false);
  }
  const done = (ok) => { log('announce', { kind, text: message, speaker: s.entity_id, alert: alert || undefined }); return ok; };
  if (!hasScript()) return ttsSpeak(message, s.entity_id).then(() => done(true));
  return callService('script', 'frame_announce', { message, speaker: s.entity_id, volume: alert ? say.alertVolume : say.volume }).then(() => done(true));
}
