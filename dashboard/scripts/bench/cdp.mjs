// Shared ADB + Chrome DevTools Protocol plumbing for the bench scripts. The kiosk opens DevTools when
// started with --ez debug true (connect() does that); a browser package exposes it by default.
import { execSync } from 'node:child_process';

export const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const adb = (cmd) => sh(`adb shell ${JSON.stringify(cmd)}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333;

export function pss(pkg) {
  const pids = adb(`ps -A -o PID,NAME | grep ${pkg} || true`).trim().split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)[0]);
  let total = 0;
  const parts = {};
  for (const pid of pids) {
    const out = adb(`dumpsys meminfo ${pid}`);
    const name = (/\*\* MEMINFO in pid \d+ \[([^\]]+)\]/.exec(out) || [])[1] || pid;
    const t = /^\s*TOTAL\s+(\d+)/m.exec(out);
    if (t) { total += Number(t[1]); parts[name] = Math.round(Number(t[1]) / 1024); }
  }
  return { totalMB: Math.round(total / 1024), parts };
}

export async function connect(pkg) {
  if (pkg === 'com.huntsyea.frame') adb('am start -n com.huntsyea.frame/.MainActivity --ez debug true');
  await sleep(1500);
  const names = adb('cat /proc/net/unix').match(/@\S*devtools_remote\S*/g) || [];
  const want = pkg === 'com.huntsyea.frame' ? names.find((n) => n.includes('webview_devtools_remote')) : names.find((n) => n.includes('chrome_devtools_remote'));
  if (!want) throw new Error(`no devtools socket for ${pkg} (have: ${names.join(', ') || 'none'})`);
  sh(`adb forward tcp:${PORT} localabstract:${want.slice(1)}`);
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && /^https?:\/\/[^/]*workers\.dev/.test(t.url)) || targets.find((t) => t.type === 'page' && /^https?:/.test(t.url));
  if (!page) throw new Error('no dashboard page target: ' + JSON.stringify(targets.map((t) => t.url)));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let nextId = 1;
  const waiters = new Map();
  const events = [];
  const listeners = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) { const w = waiters.get(d.id); waiters.delete(d.id); d.error ? w.reject(new Error(d.error.message)) : w.resolve(d.result); }
    else if (d.method) {
      for (const fn of listeners) fn(d);
      const i = events.findIndex((e) => e.method === d.method); if (i >= 0) events.splice(i, 1)[0].done(d.params);
    }
  };
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const waitEvent = (method, timeoutMs) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
    events.push({ method, done: (p) => { clearTimeout(t); resolve(p); } });
  });
  const navigate = async (url) => {
    const loaded = waitEvent('Page.loadEventFired', 60000);
    const t0 = Date.now();
    await send('Page.navigate', { url });
    await loaded;
    return Date.now() - t0;
  };
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await send('Page.enable');
  await send('Performance.enable');
  const close = () => {
    ws.close();
    try { sh(`adb forward --remove tcp:${PORT}`); } catch {}
    if (pkg === 'com.huntsyea.frame') adb('am start -n com.huntsyea.frame/.MainActivity --ez debug false'); // DevTools off again
  };
  // Every event as it arrives; returns a function that stops listening.
  const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  return { origin: new URL(page.url).origin, send, evaluate, navigate, metrics, onEvent, close };
}

// In-page frame recorder: start() then stop() returns frame-gap stats.
export const RECORDER = `window.__rec = { gaps: [], last: 0, on: false,
  start() { this.gaps = []; this.last = 0; this.on = true; const tick = (now) => { if (!this.on) return; if (this.last) this.gaps.push(now - this.last); this.last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); },
  stop() { this.on = false; const g = this.gaps.slice().sort((a, b) => a - b); const sum = g.reduce((s, x) => s + x, 0);
    return { frames: g.length, fps: +(g.length / (sum / 1000 || 1)).toFixed(1), longFrames: g.filter((x) => x > 50).length,
      jankMs: Math.round(g.reduce((s, x) => s + Math.max(0, x - 20), 0)), p95FrameMs: +(g[Math.floor(g.length * 0.95)] || 0).toFixed(1), maxFrameMs: +(g[g.length - 1] || 0).toFixed(1) }; } }; true`;
