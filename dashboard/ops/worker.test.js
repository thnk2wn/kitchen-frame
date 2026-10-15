// The status page's gate: nothing but /login and /callback without a session, one GitHub account.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ops from './worker.js';

const MAIN = { calls: [], fetch: async (url, init) => { MAIN.calls.push([url, init]); return new Response(JSON.stringify({ frame: { version: 'x' } })); } };
const env = { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csecret', ALLOWED_GITHUB_ID: '42', SESSION_SECRET: 's'.repeat(40), DASHBOARD_KEY: 'k', MAIN };
const get = (path, headers = {}, e = env) => ops.fetch(new Request('https://ops.test' + path, { headers }), e);
let githubUser;
beforeEach(() => {
  MAIN.calls = [];
  githubUser = { id: 42, login: 'me' };
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://github.com/login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'gho_x' }));
    if (String(url) === 'https://api.github.com/user') return new Response(JSON.stringify(githubUser));
    throw new Error('unexpected fetch ' + url);
  };
});
const cookiesOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie')]).filter(Boolean);

async function signIn() {
  const login = await get('/login');
  const stateCookie = cookiesOf(login)[0].split(';')[0];
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  return get('/callback?code=abc&state=' + state, { Cookie: stateCookie });
}

test('without every secret set, everything is refused', async () => {
  const { SESSION_SECRET, ...partial } = env;
  assert.equal((await get('/', {}, partial)).status, 503);
  assert.equal((await get('/data', {}, partial)).status, 503);
});

test('without a session: the page redirects to sign-in, data and everything else are refused', async () => {
  assert.equal((await get('/')).headers.get('Location'), '/login');
  assert.equal((await get('/data')).status, 401);
  assert.equal((await get('/anything')).status, 302);
  assert.equal((await ops.fetch(new Request('https://ops.test/data', { method: 'POST' }), env)).status, 405);
  assert.equal(MAIN.calls.length, 0);
});

test('forged, tampered and other-account sessions are refused', async () => {
  for (const bad of ['ops_session=nope', 'ops_session=eyJpZCI6NDJ9.forged', 'ops_session=']) assert.equal((await get('/data', { Cookie: bad })).status, 401);
  const res = await signIn();
  const session = cookiesOf(res).find((c) => c.startsWith('ops_session=')).split(';')[0];
  const [body, sig] = session.slice('ops_session='.length).split('.');
  const other = Buffer.from(JSON.stringify({ id: 7, login: 'x', exp: Date.now() / 1000 + 999 })).toString('base64url');
  assert.equal((await get('/data', { Cookie: 'ops_session=' + other + '.' + sig })).status, 401); // a valid signature on other content
  assert.equal((await get('/data', { Cookie: 'ops_session=' + body + '.' + sig })).status, 200);
});

test('sign-in: the state must come back unchanged, and only the allowed account gets a session', async () => {
  const login = await get('/login');
  const to = new URL(login.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://ops.test/callback');
  const stateCookie = cookiesOf(login)[0].split(';')[0];
  assert.equal((await get('/callback?code=abc&state=wrong', { Cookie: stateCookie })).status, 400);
  assert.equal((await get('/callback?code=abc&state=' + to.searchParams.get('state'))).status, 400); // no state cookie
  githubUser = { id: 99, login: 'someone' };
  assert.equal((await signIn()).status, 403);
  githubUser = { id: 42, login: 'me' };
  const ok = await signIn();
  assert.equal(ok.status, 302);
  const set = cookiesOf(ok).find((c) => c.startsWith('ops_session='));
  assert.match(set, /HttpOnly; Secure; SameSite=Lax/);
});

test('signed in: the page and the summary (read with the dashboard key over the binding)', async () => {
  const session = cookiesOf(await signIn()).find((c) => c.startsWith('ops_session=')).split(';')[0];
  const page = await get('/', { Cookie: session });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /Frame status/);
  const data = await (await get('/data', { Cookie: session })).json();
  assert.equal(data.you, 'me');
  assert.equal(MAIN.calls[0][0], 'https://main/api/ops/summary');
  assert.equal(MAIN.calls[0][1].headers.Authorization, 'Bearer k');
});

test('a sign-in state token is never accepted as a session', async () => {
  const login = await get('/login');
  const stateToken = cookiesOf(login)[0].split(';')[0].split('=').slice(1).join('=');
  assert.equal((await get('/data', { Cookie: 'ops_session=' + stateToken })).status, 401);
});
