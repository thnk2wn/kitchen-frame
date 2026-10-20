#!/usr/bin/env node
// Interaction profile: tab switches through the tab bar, then scroll gestures on scrolling screens.
// Usage: node scripts/bench/interact.mjs <label> [package] [rounds]
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, pss, sleep, RECORDER } from './cdp.mjs';

const label = process.argv[2] || 'interact';
const pkg = process.argv[3] || 'com.huntsyea.frame';
const ROUNDS = Number(process.argv[4] || 3);
const OUT = process.env.BENCH_OUT || 'diagnostics/bench';
const SCROLLERS = ['recipes', 'calendar', 'house', 'groceries'];
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Taps a tab button (real input through the compositor) and times tap -> the frame after the DOM changes.
const TAB_SWITCH = (i) => `new Promise((resolve) => {
  const btn = document.querySelectorAll('nav.seg button')[${i}];
  const label = btn.textContent.trim();
  const root = document.querySelector('main') || document.body;
  let t0 = 0;
  const obs = new MutationObserver(() => { if (!t0) return; obs.disconnect(); requestAnimationFrame(() => requestAnimationFrame((t) => resolve({ label, ms: Math.round(performance.now() - t0) }))); });
  btn.addEventListener('click', () => { t0 = performance.now(); }, { once: true, capture: true });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true });
  const r = btn.getBoundingClientRect();
  window.__tapAt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  setTimeout(() => resolve({ label, ms: null }), 5000);
})`;

async function tap(c, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

async function main() {
  const c = await connect(pkg);
  console.error(`${label}: ${pkg} -> ${c.origin}`);
  await c.navigate(`${c.origin}/?tab=home`);
  await sleep(10000);
  await c.evaluate(RECORDER);
  const count = await c.evaluate(`document.querySelectorAll('nav.seg button').length`);

  // Tab switches: each round goes through every tab, recording frames throughout.
  const switches = {};
  await c.evaluate('__rec.start()');
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < count; i++) {
      const pending = c.evaluate(TAB_SWITCH(i));
      await sleep(50);
      const at = await c.evaluate('window.__tapAt');
      await tap(c, at.x, at.y);
      const res = await pending;
      (switches[res.label] ||= []).push(res.ms);
      await sleep(2500);
    }
  }
  const switchFrames = await c.evaluate('__rec.stop()');
  const perTab = Object.fromEntries(Object.entries(switches).map(([k, v]) => [k, median(v.filter((x) => x != null))]));
  const all = Object.values(switches).flat().filter((x) => x != null);
  console.error(`tab switch ms (median per tab): ${JSON.stringify(perTab)}`);
  console.error(`tab switch overall median ${median(all)}ms  max ${Math.max(...all)}ms  frames: ${JSON.stringify(switchFrames)}`);

  // Scrolls: a fling-like synthesized gesture down then up on each scrolling screen.
  const scrolls = {};
  for (const s of SCROLLERS) {
    await c.navigate(`${c.origin}/?tab=${s}`);
    await sleep(8000);
    await c.evaluate(RECORDER);
    await c.evaluate('__rec.start()');
    for (let r = 0; r < 2; r++) {
      await c.send('Input.synthesizeScrollGesture', { x: 640, y: 450, yDistance: -1200, speed: 1200, gestureSourceType: 'touch' });
      await c.send('Input.synthesizeScrollGesture', { x: 640, y: 450, yDistance: 1200, speed: 1200, gestureSourceType: 'touch' });
    }
    scrolls[s] = await c.evaluate('__rec.stop()');
    console.error(`scroll ${s.padEnd(10)} ${JSON.stringify(scrolls[s])}`);
  }

  const mem = pss(pkg);
  const m = await c.metrics();
  console.error(`after: pss ${mem.totalMB}MB ${JSON.stringify(mem.parts)}  jsHeap ${(m.JSHeapUsedSize / 2 ** 20).toFixed(1)}MB of ${(m.JSHeapTotalSize / 2 ** 20).toFixed(1)}MB`);
  await c.navigate(`${c.origin}/`);
  c.close();
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/${label}.json`;
  writeFileSync(file, JSON.stringify({ label, pkg, at: new Date().toISOString(), rounds: ROUNDS, switches, perTab, switchFrames, scrolls, pss: mem, jsHeapMB: m.JSHeapUsedSize / 2 ** 20 }, null, 2));
  console.error(file);
}

main().catch((e) => { console.error('interact failed:', e.stack || e.message); process.exit(1); });
