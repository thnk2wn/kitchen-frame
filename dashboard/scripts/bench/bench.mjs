#!/usr/bin/env node
// Screen profile on the real frame over ADB + Chrome DevTools: loads each screen, lets it settle, then
// records frame rate, long frames, load timings, DOM size, decoded image megapixels and the app's memory
// as Android counts it (PSS, every process of the package). See README.md beside this file.
// Usage: node scripts/bench/bench.mjs <label> [package] [settleSeconds]
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, pss, sleep } from './cdp.mjs';

const label = process.argv[2] || 'run';
const pkg = process.argv[3] || 'com.huntsyea.frame';
const SETTLE_S = Number(process.argv[4] || 15);
const SAMPLE_S = 10;
const OUT = process.env.BENCH_OUT || 'diagnostics/bench';
const SCENARIOS = ['home', 'calendar', 'fitness', 'recipes', 'groceries', 'music', 'house', 'ambient'];

const SAMPLE = `new Promise((resolve) => {
  const gaps = []; let last = 0, frames = 0; const t0 = performance.now();
  const tick = (now) => { if (last) gaps.push(now - last); last = now; frames++;
    if (now - t0 < ${SAMPLE_S * 1000}) requestAnimationFrame(tick); else done(now); };
  const done = (now) => {
    gaps.sort((a, b) => a - b);
    const imgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0);
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    resolve({
      engine: (/Chrome\\/([\\d.]+)/.exec(navigator.userAgent) || [])[1],
      fps: +(frames / ((now - t0) / 1000)).toFixed(1),
      longFrames: gaps.filter((g) => g > 50).length,
      p95FrameMs: +(gaps[Math.floor(gaps.length * 0.95)] || 0).toFixed(1),
      maxFrameMs: +(gaps[gaps.length - 1] || 0).toFixed(1),
      nodes: document.getElementsByTagName('*').length,
      imageMP: +(imgs.reduce((s, i) => s + i.naturalWidth * i.naturalHeight, 0) / 1e6).toFixed(1),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0),
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
    });
  };
  requestAnimationFrame(tick);
})`;

async function main() {
  const c = await connect(pkg);
  console.error(`${label}: ${pkg} -> ${c.origin} (settle ${SETTLE_S}s, sample ${SAMPLE_S}s)`);
  const results = [];
  for (const s of SCENARIOS) {
    // The clock screen: the page reopens it after a reload when this flag is set (lib/state.svelte.js).
    if (s === 'ambient') await c.evaluate(`sessionStorage.setItem('frame-resume-idle', '1')`);
    const loadWallMs = await c.navigate(s === 'ambient' ? `${c.origin}/` : `${c.origin}/?tab=${s}`);
    await sleep(SETTLE_S * 1000);
    const page = await c.evaluate(SAMPLE);
    const m = await c.metrics();
    const mem = pss(pkg);
    const r = { scenario: s, loadWallMs, ...page, jsHeapMB: +(m.JSHeapUsedSize / 2 ** 20).toFixed(1), layoutCount: m.LayoutCount, scriptSec: +m.ScriptDuration.toFixed(2), pssMB: mem.totalMB, pssParts: mem.parts };
    results.push(r);
    console.error(`${s.padEnd(10)} fps ${r.fps}  long ${r.longFrames}  p95 ${r.p95FrameMs}ms  max ${r.maxFrameMs}ms  load ${r.loadMs}ms  fcp ${r.fcpMs}ms  js ${r.jsHeapMB}MB  pss ${r.pssMB}MB  nodes ${r.nodes}  img ${r.imageMP}MP`);
  }
  await c.navigate(`${c.origin}/`); // leave the frame on Home
  c.close();
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/${label}.json`;
  writeFileSync(file, JSON.stringify({ label, pkg, at: new Date().toISOString(), settleS: SETTLE_S, sampleS: SAMPLE_S, results }, null, 2));
  console.error(file);
}

main().catch((e) => { console.error('bench failed:', e.message); process.exit(1); });
