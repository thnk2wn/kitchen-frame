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
// launch of a Mac app shows up in the Dock. A screen is read once its tab bar has drawn and its page and
// data requests have been quiet for QUIET_MS (its data loaded, or failed and said so), at most SETTLE_MAX_MS after the
// tab bar; it counts as hung with no tab bar after HUNG_MS. Every Chrome command times out after
// CDP_MS, and Chrome or its connection going away ends the run as a failure (never a hang). Chrome and
// its profile folder are removed however the run ends.
const QUIET_MS = 1500, SETTLE_MAX_MS = 12000, HUNG_MS = 30000, CDP_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'kf-smoke-'));
let browser = null, ws = null, dead = null;
const pending = new Map(), listeners = new Set();
function die(why) {
  if (dead) return;
  dead = why;
  for (const { no } of pending.values()) no(new Error(why));
  pending.clear();
}
let nextId = 0;
const cdp = (method, params = {}, sessionId) => new Promise((ok, no) => {
  if (dead) return no(new Error(dead));
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); no(new Error(method + ' took over ' + CDP_MS / 1000 + ' s')); }, CDP_MS);
  pending.set(id, { ok: (v) => { clearTimeout(timer); ok(v); }, no: (e) => { clearTimeout(timer); no(e); } });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

async function open(query) {
  const { browserContextId } = await cdp('Target.createBrowserContext');
  const consoleLines = [];
  const inFlight = new Set();
  let lastNet = Date.now(), sessionId = null;
  const listen = (m) => {
    if (!sessionId || m.sessionId !== sessionId) return;
    const p = m.params || {};
    if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleLines.push('Uncaught ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text));
    // Only what can end in an error on screen: the page, its code and its data. Pictures, video and
    // map tiles keep loading (cameras refresh) and would never let the page count as settled.
    // /api/messages is skipped too: with no live socket here (the local server), the frame checks it
    // every second or so as a fallback, which isn't loading anything.
    if (m.method === 'Network.requestWillBeSent' && /^(Document|Script|Stylesheet|Fetch|XHR)$/.test(p.type || '') && !/\/api\/messages(\?|$)/.test(p.request.url)) { inFlight.add(p.requestId); lastNet = Date.now(); }
    if ((m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') && inFlight.delete(p.requestId)) lastNet = Date.now();
  };
  listeners.add(listen);
  try {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    ({ sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
    await cdp('Runtime.enable', {}, sessionId);
    await cdp('Network.enable', {}, sessionId);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    // The screen's own options as a query, the key and Home Assistant settings after # as a setup link
    // sends them (scripts/frame-url.sh; index.html moves them into the query in the page).
    await cdp('Page.navigate', { url: base + '?' + query + '#key=' + encodeURIComponent(key) + ha }, sessionId);
    const drawn = () => cdp('Runtime.evaluate', { expression: "!!document.querySelector('[role=tablist]')", returnByValue: true }, sessionId).then((r) => r.result.value === true);
    let hung = true;
    for (const until = Date.now() + HUNG_MS; Date.now() < until;) { if (await drawn()) { hung = false; break; } await sleep(250); }
    // Then until nothing has been loading for QUIET_MS (the live socket isn't a request, so it doesn't count).
    for (const until = Date.now() + SETTLE_MAX_MS; Date.now() < until;) {
      if (!inFlight.size && Date.now() - lastNet >= QUIET_MS) break;
      await sleep(250);
    }
    const { result } = await cdp('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, sessionId);
    return { hung, dom: result.value || '', console: consoleLines };
  } finally {
    listeners.delete(listen);
    await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

let failures = 0, broken = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--user-data-dir=' + profile, '--remote-debugging-port=0',
    // Home Assistant is on the home network over http; the frame's browser allows that, Chrome needs telling.
    '--allow-running-insecure-content', '--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks', 'about:blank'],
    { stdio: 'ignore' });
  browser.on('exit', () => die('Chrome exited during the run'));
  let port = null;
  for (let i = 0; i < 100 && !port && !dead; i++) {
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); } catch { await sleep(100); }
  }
  if (!port) throw new Error('Chrome did not start');
  ws = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('could not connect to Chrome')); });
  ws.onclose = () => die('the connection to Chrome closed');
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { ok, no } = pending.get(m.id); pending.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result); }
    else for (const f of listeners) f(m);
  };
  for (const [name, query] of screens) {
    const problems = [];
    let r = null;
    try { r = await open(query); } catch (e) { problems.push('could not open it: ' + e.message); }
    if (r) {
      for (const msg of r.console) {
        if (/Uncaught|\[frame\] (error|ui\.error|api\.failed)/.test(msg)) problems.push(msg.slice(0, 200));
      }
      if (r.hung) problems.push('hung: no tab bar after ' + HUNG_MS / 1000 + ' s');
      else if (!/role="tablist"/.test(r.dom)) problems.push("the page didn't draw (no tab bar)");
      if (/couldn’t show just now/.test(r.dom)) problems.push('a part failed and showed its placeholder');
    }
    console.log((problems.length ? 'FAIL ' : 'ok   ') + name + (problems.length ? '\n       ' + [...new Set(problems)].join('\n       ') : ''));
    failures += problems.length ? 1 : 0;
    if (dead) { broken = dead; break; }
  }
} catch (e) {
  broken = e.message;
} finally {
  try { ws && ws.close(); } catch {}
  if (browser && browser.exitCode === null && browser.signalCode === null) await new Promise((r) => { browser.once('exit', r); browser.kill(); setTimeout(r, 5000); });
  rmSync(profile, { recursive: true, force: true });
  await new Promise((r) => server.httpServer.close(r));
}
if (broken) { console.error('smoke: stopped: ' + broken); process.exit(2); }
console.log(failures ? `smoke: ${failures} of ${screens.length} screens failed` : `smoke: all ${screens.length} screens fine`);
process.exit(failures ? 1 : 0);
