#!/usr/bin/env node
// Smoke test of a build before it goes to the frame: the built page (dist/client) is served here, its
// /api calls go to the live Worker, so it runs on the household's real data (calendar, lists, Home
// Assistant) the way the frame would, and on demo mode. Each screen is opened in headless Chrome; any
// uncaught error, any failed API call (so a calendar that didn't load fails too), any part that had to be caught (components/Safe.svelte), or a page that didn't draw
// fails the test. On 2026-10-19 one card's error on that day's real calendar turned the frame white;
// this would have stopped that deploy.
//
//   npm run build && node scripts/smoke.mjs          (run it before wrangler deploy; not yet automatic)
//
// Reads DASHBOARD_KEY from .dev.vars, and DASHBOARD_URL and the optional HA_URL / HA_TOKEN /
// HA_DASHBOARD from .frame.vars (both gitignored). Chrome: /Applications/Google Chrome.app, or CHROME.
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('..', import.meta.url).pathname;
const vars = (file) => (existsSync(join(here, file)) ? readFileSync(join(here, file), 'utf8') : '');
const setting = (text, k) => (new RegExp('^' + k + '="?([^"\\n]*)"?', 'm').exec(text) || [])[1] || '';
const dev = vars('.dev.vars'), frame = vars('.frame.vars');
const key = setting(dev, 'DASHBOARD_KEY');
const url = setting(frame, 'DASHBOARD_URL');
const live = /^https?:\/\//.test(url) ? new URL(url).origin : '';
if (!key || !live) { console.error('smoke: needs DASHBOARD_KEY in .dev.vars and DASHBOARD_URL in .frame.vars'); process.exit(2); }
const ha = ['HA_URL:ha_url', 'HA_TOKEN:ha_token', 'HA_DASHBOARD:ha_dashboard']
  .map((p) => p.split(':')).filter(([v]) => setting(frame, v)).map(([v, q]) => '&' + q + '=' + encodeURIComponent(setting(frame, v))).join('');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Every screen worth opening: real data (demo=off) and demo mode, each tab and Media view, the sheets.
const screens = [
  ['home', 'tab=home'], ['calendar', 'tab=calendar'], ['lists', 'tab=todo'], ['groceries', 'tab=groceries'],
  ['recipes', 'tab=recipes'], ['music', 'tab=music'], ['tv', 'tab=music&media=tv'], ['videos', 'tab=music&media=videos'],
  ['podcasts', 'tab=music&media=podcasts'], ['house', 'tab=house'], ['weather', 'tab=home&weather=0'],
  ['radar', 'tab=home&weather=0&radar'], ['settings', 'tab=home&settings=about'], ['timer', 'tab=home&timer=Pasta:7'], ['fitness', 'tab=fitness'], ['workout', 'tab=fitness&workout=1'], ['fitness day', 'tab=fitness&fitnessday=3'],
].flatMap(([name, q]) => [[name, q + '&demo=off'], ['demo ' + name, q + '&demo=on']])
  .filter(([name]) => !process.env.SMOKE_ONLY || name === process.env.SMOKE_ONLY); // SMOKE_ONLY=home: just that one

const server = await preview({
  root: here, logLevel: 'silent',
  preview: { port: 4174, strictPort: true, proxy: { '/api': { target: live, changeOrigin: true, ws: true } } },
});
const base = 'http://localhost:4174/';

// One Chrome for the whole run, driven over its DevTools protocol, with each screen in a fresh private
// context (nothing saved carries from one screen to the next). One process, not one per screen: each
// launch of a Mac app shows up in the Dock. A screen is read once its tab bar has drawn and it has had
// SETTLE_MS more to load its data (and show any error), or counts as hung after HUNG_MS.
const profile = mkdtempSync(join(tmpdir(), 'kf-smoke-'));
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--user-data-dir=' + profile, '--remote-debugging-port=0',
  // Home Assistant is on the home network over http; the frame's browser allows that, Chrome needs telling.
  '--allow-running-insecure-content', '--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks', 'about:blank'],
  { stdio: 'ignore' });
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); } catch { await new Promise((r) => setTimeout(r, 100)); }
}
if (!port) { console.error('smoke: Chrome did not start'); browser.kill(); process.exit(2); }
const ws = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
const SETTLE_MS = 2500, HUNG_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 0;
const pending = new Map(), listeners = new Set();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { ok, no } = pending.get(m.id); pending.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result); }
  else for (const f of listeners) f(m);
};
const cdp = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++nextId;
  pending.set(id, { ok, no });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

async function open(query) {
  const { browserContextId } = await cdp('Target.createBrowserContext');
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const consoleLines = [];
  const listen = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleLines.push('Uncaught ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
  };
  listeners.add(listen);
  try {
    await cdp('Runtime.enable', {}, sessionId);
    await cdp('Page.enable', {}, sessionId);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp('Page.navigate', { url: base + '?key=' + encodeURIComponent(key) + '&' + query + ha }, sessionId);
    const drawn = () => cdp('Runtime.evaluate', { expression: "!!document.querySelector('[role=tablist]')", returnByValue: true }, sessionId).then((r) => r.result.value === true, () => false);
    const until = Date.now() + HUNG_MS;
    let how = 'hung';
    while (Date.now() < until) { if (await drawn()) { how = 'ok'; break; } await sleep(250); }
    await sleep(SETTLE_MS);
    const { result } = await cdp('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, sessionId);
    return { hung: how === 'hung', dom: result.value || '', console: consoleLines };
  } finally {
    listeners.delete(listen);
    await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

let failures = 0;
for (const [name, query] of screens) {
  const r = await open(query);
  const problems = [];
  for (const msg of r.console) {
    if (/Uncaught|\[frame\] (error|ui\.error|api\.failed)/.test(msg)) problems.push(msg.slice(0, 200));
  }
  if (r.hung) problems.push('hung: no tab bar after 30 s');
  if (!/role="tablist"/.test(r.dom)) problems.push("the page didn't draw (no tab bar)");
  if (/couldn’t show just now/.test(r.dom)) problems.push('a part failed and showed its placeholder');
  console.log((problems.length ? 'FAIL ' : 'ok   ') + name + (problems.length ? '\n       ' + [...new Set(problems)].join('\n       ') : ''));
  failures += problems.length ? 1 : 0;
}
ws.close();
await new Promise((r) => { browser.once('exit', r); browser.kill(); });
rmSync(profile, { recursive: true, force: true });
await new Promise((r) => server.httpServer.close(r));
console.log(failures ? `smoke: ${failures} of ${screens.length} screens failed` : `smoke: all ${screens.length} screens fine`);
process.exit(failures ? 1 : 0);
