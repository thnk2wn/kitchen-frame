// The frame's status page: a separate, optional Worker behind GitHub sign-in, showing what the
// frame and the dashboard's backend are doing (check-ins, a day's timeline, the event log, calendar,
// Paprika, Reminders and notices). It reads one summary from the main Worker over a service binding
// (GET /api/ops/summary) and can't change anything.
//
// Sign-in: GitHub OAuth, allowing exactly one GitHub account (by its numeric ID, which can't be
// reused the way a username can). Every route needs a valid session except /login and /callback;
// the session is an HMAC-signed cookie (HttpOnly, Secure, SameSite=Lax for the OAuth redirect),
// valid 30 days, all ended at once by changing SESSION_SECRET.
//
// Secrets (npx wrangler secret put NAME --config ops/wrangler.jsonc):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  from a GitHub OAuth app (README → Status page)
//   ALLOWED_GITHUB_ID   the one GitHub account allowed (gh api user --jq .id)
//   SESSION_SECRET      any long random string (openssl rand -hex 32)
//   OPS_KEY             its own key on the main Worker (worker/devices.js, role ops): the summary and
//                       nothing else; scripts/device-token.sh ops makes it. DASHBOARD_KEY, the admin key,
//                       still works in its place until then, and should then be removed from here.
// Missing any of them, every request is refused.
import PAGE from './page.html';

const SESSION = 'ops_session';
const STATE = 'ops_state';
const DAY = 24 * 60 * 60;

const mainKey = (env) => env.OPS_KEY || env.DASHBOARD_KEY;
const configured = (env) => ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ALLOWED_GITHUB_ID', 'SESSION_SECRET'].every((k) => env[k]) && !!mainKey(env);
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}
// Constant-time string comparison, so a signature can't be guessed a character at a time.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const cookie = (req, name) => (new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.get('Cookie') || '') || [])[1] || null;
const setCookie = (name, value, maxAge, path = '/') => `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

async function sign(env, payload) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  return body + '.' + (await hmac(env, body));
}
async function verify(env, token, typ) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!same(sig, await hmac(env, body))) return null;
  try {
    const p = JSON.parse(fromB64u(body));
    return p.typ === typ && p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

const headers = (extra = {}) => ({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  ...extra,
});
const text = (body, status, extra) => new Response(body, { status, headers: headers({ 'Content-Type': 'text/plain; charset=utf-8', ...extra }) });
const redirect = (to, extra = {}) => new Response(null, { status: 302, headers: headers({ Location: to, ...extra }) });

async function login(req, env) {
  const state = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const url = new URL(req.url);
  const go = new URL('https://github.com/login/oauth/authorize');
  go.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  go.searchParams.set('redirect_uri', url.origin + '/callback');
  go.searchParams.set('state', state);
  go.searchParams.set('allow_signup', 'false');
  // The state is kept signed in a short-lived cookie and must come back unchanged (no forged logins).
  return redirect(go.toString(), { 'Set-Cookie': setCookie(STATE, await sign(env, { typ: 'state', state, exp: Date.now() / 1000 + 600 }), 600, '/callback') });
}

async function callback(req, env) {
  const url = new URL(req.url);
  const saved = await verify(env, cookie(req, STATE), 'state');
  const clear = setCookie(STATE, '', 0, '/callback');
  if (!saved || !same(saved.state, url.searchParams.get('state') || '') || !url.searchParams.get('code')) return text('Sign-in expired or was tampered with. Start again at /login.', 400, { 'Set-Cookie': clear });
  const tok = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: url.origin + '/callback' }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return text('GitHub did not complete the sign-in.', 502, { 'Set-Cookie': clear });
  const user = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'kitchen-frame-ops' },
  }).then((r) => r.json()).catch(() => ({}));
  if (String(user.id) !== String(env.ALLOWED_GITHUB_ID)) {
    console.warn({ source: 'ops', message: 'sign-in refused', github: user.login || null });
    return text('This GitHub account is not allowed here.', 403, { 'Set-Cookie': clear });
  }
  console.log({ source: 'ops', message: 'signed in', github: user.login });
  const session = await sign(env, { typ: 'session', id: user.id, login: user.login, exp: Date.now() / 1000 + 30 * DAY });
  const res = redirect('/', { 'Set-Cookie': setCookie(SESSION, session, 30 * DAY) });
  res.headers.append('Set-Cookie', clear);
  return res;
}

export default {
  async fetch(req, env) {
    if (!configured(env)) return text('Not set up (see README → Status page).', 503);
    const url = new URL(req.url);
    if (req.method !== 'GET') return text('Not allowed.', 405);
    if (url.pathname === '/login') return login(req, env);
    if (url.pathname === '/callback') return callback(req, env);
    if (url.pathname === '/logout') return redirect('/login', { 'Set-Cookie': setCookie(SESSION, '', 0) });

    // Everything below needs a session; there is no other way in.
    const session = await verify(env, cookie(req, SESSION), 'session');
    if (!session || String(session.id) !== String(env.ALLOWED_GITHUB_ID)) {
      return url.pathname === '/data' ? text('Sign in first.', 401) : redirect('/login');
    }
    if (url.pathname === '/') return new Response(PAGE, { headers: headers({ 'Content-Type': 'text/html; charset=utf-8' }) });
    if (url.pathname === '/data') {
      const res = await env.MAIN.fetch('https://main/api/ops/summary', { headers: { Authorization: 'Bearer ' + mainKey(env) } });
      const data = await res.json().catch(() => ({ error: 'bad summary' }));
      return new Response(JSON.stringify({ ...data, you: session.login }), { status: res.ok ? 200 : 502, headers: headers({ 'Content-Type': 'application/json' }) });
    }
    return text('Not found.', 404);
  },
};
