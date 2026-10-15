// History of the frame's Home Assistant notices, for the notices sheet's "Earlier": the frame
// reports each one as it ends (dismissed on the frame, cleared by Home Assistant, or expired), and
// reads the list back when it starts and when the sheet opens. Home Assistant keeps no history of
// its notifications, and the Worker can't reach Home Assistant, so the frame is the one watching.
//   GET  /api/notices   -> { items: [...newest first], keepHours, keepMax, infoHours }
//   POST /api/notices   { id, title, message, tone, created, ended, how } adds one
// Kept as one KV entry (in the CALENDAR namespace, key "notices"), trimmed on every write to the
// last keepHours and at most keepMax. A handful of writes a day, far inside KV's free allowance.
// Optional vars (wrangler.jsonc or .dev.vars):
//   NOTICES_KEEP_HOURS  how long ended notices are kept (default 24, up to 168)
//   NOTICES_KEEP_MAX    how many at most (default 50, up to 200)
//   NOTICES_INFO_HOURS  blue info notices still on after this many hours are dismissed by the
//                       frame (default 24; 0 = never). Red and orange ones stay until dismissed.
const KV_KEY = 'notices';
const TONES = ['alert', 'warn', 'info'];
const HOWS = ['dismissed', 'cleared', 'expired'];

const num = (v, def, max) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; };
export const noticeSettings = (env) => ({
  keepHours: num(env.NOTICES_KEEP_HOURS, 24, 168) || 24,
  keepMax: num(env.NOTICES_KEEP_MAX, 50, 200) || 50,
  infoHours: num(env.NOTICES_INFO_HOURS, 24, 24 * 30),
});

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// Newest ended first, inside the window and the count.
function trim(items, { keepHours, keepMax }, now = Date.now()) {
  const since = now - keepHours * 3600000;
  return items.filter((n) => Date.parse(n.ended) >= since)
    .sort((a, b) => b.ended.localeCompare(a.ended))
    .slice(0, keepMax);
}

export async function listNotices(env) {
  const settings = noticeSettings(env);
  const items = trim((await env.CALENDAR.get(KV_KEY, 'json')) || [], settings);
  return { items, ...settings };
}

export async function addNotice(env, body) {
  const b = body || {};
  const n = {
    id: clip(b.id, 200), title: clip(b.title, 200), message: clip(b.message, 2000),
    tone: TONES.includes(b.tone) ? b.tone : 'warn', created: iso(b.created), ended: iso(b.ended) || new Date().toISOString(),
    how: HOWS.includes(b.how) ? b.how : 'cleared',
  };
  if (!n.id || !n.created) return { status: 400, body: { error: 'id and created are required' } };
  const settings = noticeSettings(env);
  const items = (await env.CALENDAR.get(KV_KEY, 'json')) || [];
  // The same notice (id and start) reported twice, say after a reconnect, is kept once.
  const rest = items.filter((x) => !(x.id === n.id && x.created === n.created));
  await env.CALENDAR.put(KV_KEY, JSON.stringify(trim([n, ...rest], settings)));
  return { status: 200, body: { ok: true } };
}
