// Announcements: what the frame says out loud on a speaker, through Home Assistant. One speaker and
// two volumes (Settings → Announcements), used by everything the frame says: agent messages today,
// event reminders and red Home Assistant alerts next. Timer alerts keep their own speaker setting.
//
// Speaking goes through the Home Assistant script script.frame_announce (homeassistant/scripts/):
// it uses an Echo's Announce when the speaker has one, otherwise text-to-speech, sets the
// announcement volume first and puts the speaker's own volume back afterwards. Without that script
// the frame falls back to plain text-to-speech at the speaker's current volume.
import { ha, announce as ttsSpeak, callService } from './ha.svelte.js';
import { ui } from './state.svelte.js';

const KEY = 'frame-announcements';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

// The first time: carry over the old "Read messages aloud" choice (frame-announce: a speaker or 'off').
function initial() {
  let old = null;
  try { old = localStorage.getItem('frame-announce'); } catch {}
  return { speaker: old && old !== 'off' ? old : null, volume: 0.4, alertVolume: 0.7, messages: old !== 'off' };
}
export const say = $state({ ...initial(), ...(read() || {}) });

export function setSay(changes) {
  Object.assign(say, changes);
  try { localStorage.setItem(KEY, JSON.stringify({ speaker: say.speaker, volume: say.volume, alertVolume: say.alertVolume, messages: say.messages })); } catch {}
}

// Speakers that can talk: Home Assistant's media players, not TVs or a Spotify account.
export const speakers = () => ha.players.filter((p) => !p.tv && !p.entity_id.startsWith('media_player.spotify_'));

// The chosen speaker if Home Assistant has it, else the first with "kitchen" in its name, else the first.
export function speaker() {
  const all = speakers();
  return all.find((p) => p.entity_id === say.speaker) || all.find((p) => /kitchen/i.test(p.entity_id)) || all[0] || null;
}

const hasScript = () => ha.scripts && ha.scripts.includes('script.frame_announce');

// Say something. alert: a red alert, at the louder alert volume.
export function speak(text, { alert = false } = {}) {
  const s = speaker();
  if (ui.demo || !s || ha.status !== 'connected') return Promise.resolve(false);
  const message = String(text).slice(0, 400);
  if (!hasScript()) return ttsSpeak(message, s.entity_id).then(() => true);
  return callService('script', 'frame_announce', { message, speaker: s.entity_id, volume: alert ? say.alertVolume : say.volume }).then(() => true);
}
