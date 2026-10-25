// The Alexa log on the status page: what each Echo heard and how Alexa took it (from Home Assistant's
// Alexa Devices voice events, sent by the frame: POST /api/alexa/heard), and what the Kitchen Frame
// skill did with the requests that reached it (alexa.js). Together they show why a request went
// wrong: misheard ("ask kitchen friend…"), taken by Alexa itself (an announcement), or reaching the
// skill and doing something unexpected. The last 3 days, at most 200 entries.
const KEY = 'alexa-log';
const MAX = 200, DAYS = 3;
const s = (v, n = 300) => (v == null ? undefined : String(v).slice(0, n));

export async function readLog(env) { return (await env.CALENDAR.get(KEY, 'json')) || []; }

export async function addLog(env, entry) {
  try {
    const cutoff = Date.now() - DAYS * 86400000;
    const list = (await readLog(env)).filter((e) => Date.parse(e.t) > cutoff);
    list.push({ t: new Date().toISOString(), ...entry });
    await env.CALENDAR.put(KEY, JSON.stringify(list.slice(-MAX)));
  } catch (e) { console.warn('alexa log: ' + e.message); }
}

// From the frame: one Echo's voice event.
// A fitness question's reply is someone's health numbers: not kept, only that it was answered.
const FITNESS = /\b(fitness|rings?|activity)\b/i;
export function heardEntry(b = {}) {
  if (!b.heard) return null;
  const reply = (FITNESS.test(String(b.heard)) || /fitness/i.test(String(b.intent || ''))) && b.reply ? '(fitness summary, not kept)' : s(b.reply);
  return { source: 'alexa', device: s(b.device, 80), heard: s(b.heard), intent: s(b.intent, 80), reply, at: s(b.at, 40) };
}

// From the skill: a request and what came of it.
export function skillEntry(r, response, sent, refused) {
  const req = (r && r.request) || {};
  const intent = req.intent || {};
  const slots = Object.fromEntries(Object.entries(intent.slots || {}).filter(([, v]) => v && v.value).map(([k, v]) => [k, s(v.value, 120)]));
  const out = (response && response.response) || {};
  return {
    source: 'skill', type: s(req.type, 60), intent: s(intent.name, 60), slots: Object.keys(slots).length ? slots : undefined,
    said: s(out.outputSpeech && out.outputSpeech.text), directives: (out.directives || []).map((d) => d.type).join(', ') || undefined,
    sent: sent.length ? sent.map(([c, d]) => c + (d && (d.tab || d.group || d.what || d.action) ? ' ' + (d.tab || d.group || d.what || d.action) : '')).join(', ') : undefined,
    refused: s(refused, 120),
  };
}
