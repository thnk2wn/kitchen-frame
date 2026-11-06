// Weather Service alerts made short (worker/weather.js): for each alert, Workers AI writes one line
// for the alerts list and a couple of sentences to read aloud, leaving out the county lists, codes
// and radar times. Written once per alert and kept in KV until it ends, so a 15-minute weather poll
// costs nothing after the first. Without the model (slow, over its allowance, or a bad answer) the
// alert goes out as it came, and the frame reads it from the Weather Service's text
// (src/lib/wxalerts.js summary() / speech()).
import { MODEL, aiError } from './meal-groceries.js';

const CACHE = 'wxai4:';  // the number goes up when the prompt changes, so old answers aren't reused
const AI_WAIT_MS = 7000;   // the frame waits on /api/weather; past this it gets the summary next poll

function prompt(a, place) {
  const town = place ? place.split(',')[0] : '';
  const named = !!town && String(a.description || '').includes(town);
  return [
    { role: 'system', content: [
      'You rewrite US National Weather Service alerts for a family kitchen display' + (place ? ' in ' + place : '') + '.',
      'Reply with JSON only: {"summary": "...", "speech": "..."}.',
      'summary: 6 to 14 words, the most useful specifics (how much rain, wind speed, hail size, visibility, what is flooding), plain English.',
      'No times, no county or town lists, no period at the end, and do not just repeat the alert name.',
      'speech: 2 short sentences, under 40 words, to be read aloud: what is happening, then the single most important thing to do.',
      named ? 'The alert names ' + town + ' among the places affected: say so in the first sentence of speech (for example "Streets are flooding around the area, including ' + town + '.").' : '',
      'Never invent facts, numbers or places. No codes, no "Doppler radar", no time zones, no markdown, no emoji, no slogans like "Turn around, don\'t drown": say the practical step instead (for example "Don\'t drive through flooded roads.").',
      'The alert name and end time are shown and said already.',
    ].filter(Boolean).join(' ') },
    { role: 'user', content: JSON.stringify({ event: a.event, severity: a.severity, description: a.description, instruction: a.instruction }) + '\n/no_think' },
  ];
}

// The model's answer, or null when it isn't usable. Workers AI hands back JSON already parsed when
// the whole answer is JSON, else as text.
export function readAnswer(answer) {
  let j = answer && typeof answer === 'object' ? answer : null;
  if (!j) {
    const m = /\{[\s\S]*\}/.exec(String(answer || '').replace(/<think>[\s\S]*?<\/think>/g, ''));
    if (!m) return null;
    try { j = JSON.parse(m[0]); } catch { return null; }
  }
  const clean = (t) => String(t || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
  const summary = clean(j.summary).replace(/\.$/, ''), speech = clean(j.speech);
  if (summary.length < 8 || summary.length > 110 || speech.length < 15 || speech.length > 320) return null;
  return { summary, speech };
}

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function write(env, a, place, key) {
  const res = await env.AI.run(MODEL, { messages: prompt(a, place), max_tokens: 300, temperature: 0.2 });
  const raw = typeof res === 'string' ? res : res?.response ?? res?.choices?.[0]?.message?.content ?? null;
  const ai = readAnswer(raw);
  if (!ai) throw new Error('the model gave no usable answer: ' + (typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 160));
  // Kept until the alert ends (and an hour more), at least an hour; KV wants 60 s or more.
  const ttl = Math.max(3600, Math.round(((Date.parse(a.ends) || Date.now()) - Date.now()) / 1000) + 3600);
  await env.CALENDAR.put(key, JSON.stringify(ai), { expirationTtl: Math.min(ttl, 3 * 86400) }).catch(() => {});
  return ai;
}

// alerts with `ai: { summary, speech }` added where there is one. ctx: so a slow answer still lands in
// the cache for the next poll.
export async function withAi(env, ctx, alerts, place) {
  if (!alerts.length || !env.AI || !env.CALENDAR) return alerts;
  return Promise.all(alerts.map(async (a) => {
    const key = CACHE + await hash(a.id + '|' + a.description + '|' + a.instruction + '|' + place);
    const cached = await env.CALENDAR.get(key, 'json').catch(() => null);
    if (cached) return { ...a, ai: cached };
    const job = write(env, a, place, key);
    if (ctx) ctx.waitUntil(job.catch(() => {}));
    try {
      return { ...a, ai: await Promise.race([job, new Promise((_, no) => setTimeout(() => no(new Error('the model took too long')), AI_WAIT_MS))]) };
    } catch (e) {
      console.warn({ source: 'worker', message: 'weather alert summary: ' + aiError(e), event: a.event });
      return a;
    }
  }));
}
