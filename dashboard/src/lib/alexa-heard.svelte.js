// What each Echo heard, for the status page's Alexa log (worker/alexa-log.js). Home Assistant's Alexa
// Devices integration gives every Echo a voice event (event.<echo>_voice_event) with Alexa's words
// ("alexa ask kitchen friend to go home"), how Alexa took them (AnnounceIntent) and its reply. The
// frame watches them and sends each new one to the Worker: requests that never reached the Kitchen
// Frame skill show up there too. Only the kiosk sends (not a browser viewing the dashboard), so
// each is logged once.
import { onHAConnect, send, subscribeTo, applyEntityDiff } from './ha.svelte.js';
import { api } from './api.js';

const kiosk = () => typeof window !== 'undefined' && !!window.FrameKiosk;

onHAConnect(async () => {
  if (!kiosk()) return;
  try {
    const reg = (await send({ type: 'config/entity_registry/list_for_display' })).entities || [];
    const ids = reg.filter((e) => e.pl === 'alexa_devices' && /^event\..+_voice_event$/.test(e.ei)).map((e) => e.ei);
    if (!ids.length) return;
    const map = new Map(), seen = new Map(); // entity -> the event time already sent (or found at start)
    await subscribeTo({ type: 'subscribe_entities', entity_ids: ids }, (ev) => {
      applyEntityDiff(map, ev);
      for (const [id, s] of map) {
        if (!s.state || seen.get(id) === s.state) continue;
        const first = !seen.has(id);
        seen.set(id, s.state);
        if (first) continue; // what was there when the frame connected was sent before
        const a = s.attributes || {};
        if (!a.voice_command) continue;
        api('/api/alexa/heard', { method: 'POST', body: JSON.stringify({
          device: (a.friendly_name || id).replace(/ Voice event$/i, ''), heard: a.voice_command, intent: a.intent, reply: a.voice_reply, at: s.state,
        }) }).catch(() => {});
      }
    });
  } catch (e) { console.warn('alexa voice events', e); }
});
