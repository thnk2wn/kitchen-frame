// A private Alexa skill ("Alexa, ask Kitchen Frame to …"): add to the lists, switch the frame's screen, play a
// group of videos, hear today's calendar. The skill stays in development on your Amazon account
// (docs/alexa.md); its interaction model is alexa/interaction-model.json at the repo's top. Amazon posts each request
// here, POST /api/alexa.
//
// Who may call: only requests Amazon signed (checked as Amazon requires: the signing certificate
// fetched from Amazon's own address, valid now and issued for echo-api.amazon.com, the body's
// signature checked with it, sent within 150 s), for this skill (ALEXA_SKILL_ID), and, when
// ALEXA_USER_IDS is set, from those Amazon accounts only.
import { addItem } from './todoist.js';
import { fromReminders, bridge } from './bridge.js';
import { rotationLines, DEMO_ROTATIONS } from '../src/lib/rotations.js';
import { demoCalendar, demoMeals } from '../src/lib/demo.js';
import { parseNames } from './demo-media.js';

// ---- Amazon's signature
function tlv(b, i) {
  const tag = b[i];
  let len = b[i + 1], p = i + 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = len * 256 + b[p++]; }
  return { tag, start: p, end: p + len, next: p + len };
}
const children = (b, t) => { const out = []; for (let i = t.start; i < t.end; i = tlv(b, i).next) out.push(tlv(b, i)); return out; };
const ascii = (b, t) => String.fromCharCode(...b.subarray(t.start, t.end));
function time(b, t) {
  const s = ascii(b, t); // UTCTime YYMMDDHHMMSSZ or GeneralizedTime YYYYMMDDHHMMSSZ
  const y = t.tag === 0x17 ? 2000 + Number(s.slice(0, 2)) - (Number(s.slice(0, 2)) >= 50 ? 100 : 0) : Number(s.slice(0, 4));
  const r = s.slice(t.tag === 0x17 ? 2 : 4);
  return Date.UTC(y, Number(r.slice(0, 2)) - 1, Number(r.slice(2, 4)), Number(r.slice(4, 6)), Number(r.slice(6, 8)), Number(r.slice(8, 10)));
}
// The first certificate in a PEM chain: its validity, DNS names and public key (DER SPKI).
export function readCert(pem) {
  const b64 = (/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem) || [])[1];
  if (!b64) throw new Error('no certificate');
  const der = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const cert = tlv(der, 0);
  const tbs = children(der, cert)[0];
  const f = children(der, tbs);
  const k = f[0].tag === 0xa0 ? 1 : 0; // explicit version present
  const [notBefore, notAfter] = children(der, f[k + 3]).map((t) => time(der, t));
  const spki = f[k + 5];
  const names = [];
  const ext = f.find((t) => t.tag === 0xa3);
  if (ext) {
    for (const e of children(der, children(der, ext)[0])) {
      const parts = children(der, e);
      const oid = der.subarray(parts[0].start, parts[0].end).join('.');
      if (oid !== '85.29.17') continue; // 2.5.29.17, subjectAltName
      const value = parts[parts.length - 1];
      for (const n of children(der, tlv(der, value.start))) if (n.tag === 0x82) names.push(ascii(der, n));
    }
  }
  return { notBefore, notAfter, names, spki: der.slice(tlvStart(der, spki), spki.end) };
}
function tlvStart(der, t) { // where a TLV's header began, given its parsed content start
  for (let h = 2; h <= 6; h++) { const s = t.start - h; if (s >= 0 && tlv(der, s).start === t.start && tlv(der, s).end === t.end) return s; }
  throw new Error('bad certificate');
}

export function certUrlOk(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 's3.amazonaws.com' && (url.port === '' || url.port === '443')
      && new URL(url.pathname, 'https://x').pathname.startsWith('/echo.api/');
  } catch { return false; }
}

async function verified(req, body) {
  const chainUrl = req.headers.get('SignatureCertChainUrl') || '';
  const sig = req.headers.get('Signature-256') || '';
  if (!certUrlOk(chainUrl) || !sig) return 'missing or foreign signature';
  const cacheKey = new Request('https://alexa-cert.local/' + encodeURIComponent(chainUrl));
  let pem = await caches.default.match(cacheKey).then((r) => r && r.text());
  if (!pem) {
    const r = await fetch(chainUrl);
    if (!r.ok) return 'certificate fetch ' + r.status;
    pem = await r.text();
    await caches.default.put(cacheKey, new Response(pem, { headers: { 'Cache-Control': 'public, max-age=86400' } }));
  }
  const cert = readCert(pem);
  const now = Date.now();
  if (now < cert.notBefore || now > cert.notAfter) return 'certificate out of date';
  if (!cert.names.includes('echo-api.amazon.com')) return 'certificate not for echo-api.amazon.com';
  const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)), new TextEncoder().encode(body));
  return ok ? null : 'bad signature';
}

// ---- What Alexa asked for
const say = (text, end = true) => ({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text }, shouldEndSession: end } });
const slot = (intent, name) => {
  const s = intent.slots && intent.slots[name];
  if (!s) return '';
  const r = s.resolutions && s.resolutions.resolutionsPerAuthority && s.resolutions.resolutionsPerAuthority.find((a) => a.status && a.status.code === 'ER_SUCCESS_MATCH');
  return (r && r.values[0].value.name) || s.value || '';
};
const TABS = { home: 'home', calendar: 'calendar', lists: 'groceries', groceries: 'groceries', tasks: 'todo', 'to do': 'todo', recipes: 'recipes', media: 'music', music: 'music', tv: 'tv', videos: 'videos', house: 'house', notices: 'notices' };
// (Media's views go as music, tv and videos; the frame opens Media on that view. notices opens the
// notices sheet over whatever is showing.)
export const tabOf = (word) => TABS[String(word || '').toLowerCase().trim()] || null;

async function add(env, list, item) {
  if (fromReminders(env, list)) {
    await bridge(env).fetch('https://bridge/add/' + list, { method: 'POST', body: JSON.stringify({ items: [{ content: item }] }) });
  } else {
    if (!env.TODOIST_TOKEN) throw new Error('no list connected');
    await addItem(env, list, item, '', 0);
  }
}

// Home's Today card, read out in its order: rotations with a switch time (up early), today's meals,
// today's events, then the rest (bedtime), and tomorrow's early one once today's has switched over:
// "Up early with kids: Alex. Dinner: Chicken Tacos. One event: at 3:30 PM, Swim lesson. Bedtime: …".
export function todaySpeech({ cal, meals = [], rules = [], tz, now = new Date() }) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  // rotations.js works in local time: a Date whose local fields are the wall clock in tz.
  const wall = wallClock(tz, now);
  const lines = rotationLines(rules, wall);
  const rot = (l) => l.name + ': ' + l.text.replace(/: /g, ' with ').replace(/ · /g, ', ') + '.';
  const parts = lines.filter((l) => l.place === 'top').map(rot);
  for (const m of meals.filter((x) => x.date === day && x.title)) parts.push(m.type + ': ' + m.title + '.');
  const events = ((cal && cal.events) || []).filter((e) => (e.allDay ? e.start <= day && e.end > day : new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(e.start)) === day));
  const t = (e) => (e.allDay ? 'all day' : 'at ' + new Date(e.start).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', ''));
  if (events.length) {
    const list = events.slice(0, 6).map((e) => t(e) + ', ' + e.title).join('; ');
    parts.push((events.length === 1 ? 'One event: ' : events.length + ' events: ') + list + (events.length > 6 ? '; and more on the frame.' : '.'));
  } else parts.push('Nothing on the calendar.');
  parts.push(...lines.filter((l) => l.place === 'last').map(rot));
  parts.push(...lines.filter((l) => l.place === 'tomorrow').map((l) => 'Tomorrow, ' + rot(l)));
  return parts.join(' ');
}

// A Date whose UTC fields are the wall clock in tz (the Worker runs in UTC): demo.js and rotations.js
// build days and times in local time, so with this and tz 'UTC' they come out as the frame shows them.
const wallClock = (tz, now = new Date()) => new Date(now.toLocaleString('en-US', { timeZone: tz }));
// Demo mode's invented day, the one the frame shows (src/lib/demo.js).
// The frame's invented calendar and rotations, and meals picked from the real recipe library the same
// way the frame picks them (src/lib/demo.js), so both say the same dinner.
async function demoDay(tz, recipes) {
  const now = wallClock(tz);
  const library = await recipes().catch(() => ({}));
  return { cal: demoCalendar(now), meals: demoMeals(now, library.recipes), rules: DEMO_ROTATIONS, tz: 'UTC', now };
}

// The Echo's own time zone (Alexa's settings API; needs no permission), or UTC.
async function zoneOf(sys) {
  try {
    const r = await fetch(sys.apiEndpoint + '/v2/devices/' + sys.device.deviceId + '/settings/System.timeZone', { headers: { Authorization: 'Bearer ' + sys.apiAccessToken } });
    if (r.ok) return await r.json();
  } catch {}
  return 'UTC';
}

// handle(req, env, { command, calendar, videoGroups, meals, rotations }): command(name, data) reaches the frame (the
// message room's live connection) and resolves to how many frames got it.
export async function handleAlexa(req, env, { command, calendar, videoGroups, meals, rotations, recipes = async () => ({}), demo = async () => false }) {
  const body = await req.text();
  const problem = await verified(req, body).catch((e) => 'signature check failed: ' + e.message);
  if (problem) { console.warn('alexa refused: ' + problem); return new Response('forbidden', { status: 403 }); }
  let r;
  try { r = JSON.parse(body); } catch { return new Response('bad request', { status: 400 }); }
  if (Math.abs(Date.now() - Date.parse(r.request && r.request.timestamp)) > 150000) return new Response('stale', { status: 400 });
  const sys = (r.context && r.context.System) || {};
  const app = (sys.application && sys.application.applicationId) || (r.session && r.session.application && r.session.application.applicationId);
  if (!env.ALEXA_SKILL_ID || app !== env.ALEXA_SKILL_ID) { console.warn('alexa refused: skill ' + app); return new Response('forbidden', { status: 403 }); }
  const user = (sys.user && sys.user.userId) || '';
  const allowed = String(env.ALEXA_USER_IDS || '').split(/[\s,]+/).filter(Boolean);
  if (allowed.length && !allowed.includes(user)) { console.warn('alexa refused: user ' + user + ' (an id changes when the skill is turned off and on: put the new one in ALEXA_USER_IDS)'); return Response.json(say('Sorry, this frame only listens to its own household.')); }

  const type = r.request.type;
  if (type === 'LaunchRequest') return Response.json(say('Kitchen Frame here. Say add eggs to groceries, show the calendar, what\'s for dinner, or the rundown.', false));
  if (type === 'SessionEndedRequest') return Response.json({ version: '1.0', response: {} });
  if (type !== 'IntentRequest') return Response.json(say('Sorry, I didn\'t get that.'));
  const intent = r.request.intent || {};
  const sent = async (name, data) => (await command(name, data)) > 0;
  const offline = 'The frame isn\'t connected right now.';
  try {
    switch (intent.name) {
      // One intent per list: Alexa won't take a free-text item and a list name in the same phrase.
      case 'AddGroceryIntent': case 'AddTaskIntent': {
        const item = slot(intent, 'item').trim();
        const list = intent.name === 'AddTaskIntent' ? 'todo' : 'groceries';
        if (!item) return Response.json(say('What should I add?', false));
        await add(env, list, item.slice(0, 200));
        await sent('show', { tab: list }).catch(() => false); // the frame shows the list it went on
        return Response.json(say('Added ' + item + ' to ' + (list === 'todo' ? 'Tasks' : 'Groceries') + '.'));
      }
      case 'ShowTabIntent': {
        const tab = tabOf(slot(intent, 'tab'));
        if (!tab) return Response.json(say('I can show home, calendar, groceries, tasks, recipes, music, videos, the house or notices.'));
        return Response.json(say((await sent('show', { tab })) ? 'Okay.' : offline));
      }
      case 'CloseIntent': return Response.json(say((await sent('close')) ? 'Okay.' : offline));
      case 'SlideshowIntent': return Response.json(say((await sent('slideshow')) ? 'Okay.' : offline));
      case 'WakeIntent': return Response.json(say((await sent('wake')) ? 'Okay.' : offline));
      case 'PlayVideosIntent': {
        // In demo mode a group goes by its shown name (DEMO_NAMES: "Sam" -> "Kiddo"), heard and said.
        const names = (await demo()) ? parseNames(env.DEMO_NAMES) : {};
        const shown = (g) => names[g] || g;
        const asked = slot(intent, 'group').toLowerCase().replace(/'s$|s'$/, '').trim();
        const groups = videoGroups();
        const is = (g, test) => test(g.toLowerCase()) || test(shown(g).toLowerCase());
        const g = groups.find((x) => is(x, (n) => n === asked)) || groups.find((x) => asked && is(x, (n) => n.includes(asked) || asked.includes(n)))
          || (!asked && groups.length === 1 ? groups[0] : null);
        if (!g) return Response.json(say(groups.length ? 'I have ' + groups.map(shown).join(', ') + '. Say, play ' + shown(groups[0]) + ' videos.' : 'No videos are set up.'));
        return Response.json(say((await sent('playgroup', { group: g })) ? 'Playing ' + shown(g) + ' on the frame. Tap it for sound.' : offline));
      }
      case 'DinnerIntent': {
        const tz = await zoneOf(sys);
        const isDemo = await demo();
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: isDemo ? 'UTC' : tz }).format(isDemo ? wallClock(tz) : new Date());
        const { configured, meals: planned = [] } = isDemo ? { configured: true, meals: (await demoDay(tz, recipes)).meals } : await meals();
        if (!configured) return Response.json(say('No meal plan is connected.'));
        const today = planned.filter((m) => m.date === day && /dinner|supper/i.test(m.type) && m.title);
        if (!today.length) return Response.json(say('Nothing is planned for dinner today.'));
        const names = today.map((m) => m.title);
        const spoken = 'Dinner is ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + '.';
        // One recipe: open it on the frame; several (or one not linked to a recipe): the week's meals.
        const shown = today.length === 1 && today[0].id ? await sent('recipe', { id: today[0].id, title: today[0].title }) : await sent('meals');
        return Response.json(say(spoken + (shown ? '' : ' ' + offline)));
      }
      case 'TodayIntent': {
        // Read out Home's Today card, and put Home on the frame so it's there to look at.
        const [plan, tz, isDemo] = await Promise.all([meals().catch(() => ({})), zoneOf(sys), demo(), sent('show', { tab: 'home' }).catch(() => false)]);
        if (isDemo) return Response.json(say(todaySpeech(await demoDay(tz, recipes))));
        return Response.json(say(todaySpeech({ cal: await calendar(), meals: plan.meals || [], rules: rotations(), tz })));
      }
      case 'AMAZON.HelpIntent': return Response.json(say('You can say: add milk to groceries, add call the dentist to tasks, show the calendar, start the slideshow, wake up, play videos, what\'s for dinner, or the rundown.', false));
      case 'AMAZON.StopIntent': case 'AMAZON.CancelIntent': case 'AMAZON.NavigateHomeIntent': return Response.json(say('Okay.'));
      default: return Response.json(say('Sorry, I can\'t do that yet. Say help for what I can do.'));
    }
  } catch (e) {
    console.error('alexa ' + intent.name + ': ' + e.message);
    return Response.json(say('Sorry, that didn\'t work: ' + String(e.message).slice(0, 80) + '.'));
  }
}
