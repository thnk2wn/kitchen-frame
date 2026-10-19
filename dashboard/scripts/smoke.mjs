#!/usr/bin/env node
// Smoke test of a build before it goes to the frame: the built page (dist/client) is served here, its
// /api calls go to the live Worker, so it runs on the household's real data (calendar, lists, Home
// Assistant) the way the frame would, and on demo mode. Each screen is opened in headless Chrome; any
// uncaught error, any part that had to be caught (components/Safe.svelte), or a page that didn't draw
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
const live = new URL(setting(frame, 'DASHBOARD_URL') || 'http://invalid').origin;
if (!key || live === 'null') { console.error('smoke: needs DASHBOARD_KEY in .dev.vars and DASHBOARD_URL in .frame.vars'); process.exit(2); }
const ha = ['HA_URL:ha_url', 'HA_TOKEN:ha_token', 'HA_DASHBOARD:ha_dashboard']
  .map((p) => p.split(':')).filter(([v]) => setting(frame, v)).map(([v, q]) => '&' + q + '=' + encodeURIComponent(setting(frame, v))).join('');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Every screen worth opening: real data (demo=off) and demo mode, each tab and Media view, the sheets.
const screens = [
  ['home', 'tab=home'], ['calendar', 'tab=calendar'], ['lists', 'tab=todo'], ['groceries', 'tab=groceries'],
  ['recipes', 'tab=recipes'], ['music', 'tab=music'], ['tv', 'tab=music&media=tv'], ['videos', 'tab=music&media=videos'],
  ['podcasts', 'tab=music&media=podcasts'], ['house', 'tab=house'], ['weather', 'tab=home&weather=0'],
  ['radar', 'tab=home&weather=0&radar'], ['settings', 'tab=home&settings=about'], ['timer', 'tab=home&timer=Pasta:7'],
].flatMap(([name, q]) => [[name, q + '&demo=off'], ['demo ' + name, q + '&demo=on']])
  .filter(([name]) => !process.env.SMOKE_ONLY || name === process.env.SMOKE_ONLY); // SMOKE_ONLY=home: just that one

const server = await preview({
  root: here, logLevel: 'silent',
  preview: { port: 4174, strictPort: true, proxy: { '/api': { target: live, changeOrigin: true, ws: true } } },
});
const base = 'http://localhost:4174/';

function open(query) {
  return new Promise((resolve) => {
    const profile = mkdtempSync(join(tmpdir(), 'kf-smoke-'));
    const args = ['--headless=new', '--disable-gpu', '--user-data-dir=' + profile, '--window-size=1280,720',
      '--enable-logging=stderr', '--v=0', '--virtual-time-budget=15000', '--dump-dom',
      // Home Assistant is on the home network over http; the frame's browser allows that, Chrome needs telling.
      '--allow-running-insecure-content', '--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks',
      base + '?key=' + encodeURIComponent(key) + '&' + query + ha];
    const p = spawn(chrome, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => p.kill('SIGKILL'), 60000);
    p.on('close', (code) => { clearTimeout(killer); rmSync(profile, { recursive: true, force: true }); resolve({ code, dom: out, console: err }); });
  });
}

let failures = 0;
for (const [name, query] of screens) {
  const r = await open(query);
  const problems = [];
  for (const line of r.console.split('\n')) {
    const msg = (/CONSOLE[^"]*"(.*)", source/.exec(line) || [])[1] || (/Uncaught.*/.exec(line) || [])[0];
    if (!msg) continue;
    if (/Uncaught|\[frame\] (error|ui\.error)/.test(msg)) problems.push(msg.slice(0, 200));
  }
  if (r.code !== 0) problems.push('Chrome exited ' + r.code + (r.code === null ? ' (hung, killed after 60 s)' : ''));
  if (!/role="tablist"/.test(r.dom)) problems.push("the page didn't draw (no tab bar)");
  if (/couldn’t show just now/.test(r.dom)) problems.push('a part failed and showed its placeholder');
  console.log((problems.length ? 'FAIL ' : 'ok   ') + name + (problems.length ? '\n       ' + [...new Set(problems)].join('\n       ') : ''));
  failures += problems.length ? 1 : 0;
}
await new Promise((r) => server.httpServer.close(r));
console.log(failures ? `smoke: ${failures} of ${screens.length} screens failed` : `smoke: all ${screens.length} screens fine`);
process.exit(failures ? 1 : 0);
