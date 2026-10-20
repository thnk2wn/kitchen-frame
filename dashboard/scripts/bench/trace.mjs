#!/usr/bin/env node
// Traces one tab switch on the frame and breaks the time down: script, style, layout, paint, and the
// busiest JS functions. Usage: node scripts/bench/trace.mjs <label> <toTab> [fromTab] [runs]
// e.g. node scripts/bench/trace.mjs home-before home calendar 3
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, sleep } from './cdp.mjs';

const [label = 'trace', toTab = 'home', fromTab = 'calendar'] = process.argv.slice(2);
const RUNS = Number(process.argv[5] || 3);
const OUT = process.env.BENCH_OUT || 'diagnostics/bench';
const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing'].join(',');

// Top-level main-thread work by kind, inside [start, end] (microseconds).
const KIND = {
  FunctionCall: 'script', EvaluateScript: 'script', 'v8.callFunction': 'script', TimerFire: 'script', FireAnimationFrame: 'script', EventDispatch: 'script', RunMicrotasks: 'script', 'V8.GC_SCAVENGER': 'gc', MinorGC: 'gc', MajorGC: 'gc',
  UpdateLayoutTree: 'style', RecalculateStyles: 'style', ParseAuthorStyleSheet: 'style',
  Layout: 'layout', UpdateLayerTree: 'layerize', Layerize: 'layerize', PrePaint: 'paint', Paint: 'paint', PaintImage: 'paint', 'Decode Image': 'image', ImageDecodeTask: 'image', Commit: 'commit', CompositeLayers: 'composite',
};

async function main() {
  const c = await connect('com.huntsyea.frame');
  const tabIndex = async (id) => c.evaluate(`Array.from(document.querySelectorAll('nav.seg button')).findIndex((b) => b.textContent.trim().toLowerCase() === ${JSON.stringify(id === 'groceries' ? 'lists' : id === 'music' ? 'media' : id)})`);
  const tap = async (i) => {
    const at = await c.evaluate(`(() => { const r = document.querySelectorAll('nav.seg button')[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  };
  await c.navigate(`${c.origin}/?tab=${fromTab}`);
  await sleep(10000);
  const from = await tabIndex(fromTab), to = await tabIndex(toTab);

  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const events = [];
    let stop;
    const done = new Promise((resolve) => { stop = c.onEvent((m) => {
      if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
      if (m.method === 'Tracing.tracingComplete') resolve();
    }); });
    await c.send('Tracing.start', { categories: CATEGORIES, transferMode: 'ReportEvents' });
    await c.send('Profiler.enable');
    await c.send('Profiler.setSamplingInterval', { interval: 500 });
    await c.send('Profiler.start');
    await sleep(300);
    await tap(to);
    await sleep(2500);
    const { profile } = await c.send('Profiler.stop');
    await c.send('Tracing.end');
    await done;
    stop();

    // The switch: from the tap's input event to the last main-thread work before things go quiet.
    const main = events.filter((e) => e.ph === 'X' && e.dur && e.cat?.includes('devtools.timeline'));
    const input = events.filter((e) => e.name === 'EventDispatch' && /mouseup|click|pointerup/.test(e.args?.data?.type || '')).sort((a, b) => a.ts - b.ts)[0];
    const start = input ? input.ts : Math.min(...main.map((e) => e.ts));
    const tid = input?.tid;
    const mine = main.filter((e) => e.tid === tid && e.ts >= start && e.ts < start + 2000000);
    let end = start;
    for (const e of mine.sort((a, b) => a.ts - b.ts)) if (e.ts - end < 100000 || end === start) end = Math.max(end, e.ts + e.dur);
    // Count each kind once: take only events not nested inside another counted event.
    const byKind = {};
    const counted = [];
    for (const e of mine.filter((e) => e.ts < end).sort((a, b) => a.ts - b.ts || b.dur - a.dur)) {
      const kind = KIND[e.name];
      if (!kind) continue;
      if (counted.some((p) => e.ts >= p.ts && e.ts + e.dur <= p.ts + p.dur)) continue;
      counted.push(e);
      byKind[kind] = (byKind[kind] || 0) + e.dur / 1000;
    }
    // Busiest JS functions (self time) from the sampling profile.
    const self = new Map();
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const n = nodes.get(id); const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
      self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
    });
    const topSelf = [...self.entries()].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, Math.round(v)]);
    const run = { totalMs: Math.round((end - start) / 1000), byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, Math.round(v)])), topSelf };
    runs.push(run);
    console.error(`run ${r + 1}: ${run.totalMs} ms  ${JSON.stringify(run.byKind)}`);
    if (r === 0) writeFileSync(`${OUT}/${label}-trace.json`, JSON.stringify({ traceEvents: events }));
    // Back to where we started.
    await tap(from);
    await sleep(4000);
  }
  console.error('top JS self time (run 1, ms):');
  for (const [k, v] of runs[0].topSelf) console.error(`  ${String(v).padStart(5)}  ${k}`);
  await c.navigate(`${c.origin}/`);
  c.close();
  writeFileSync(`${OUT}/${label}.json`, JSON.stringify({ label, toTab, fromTab, runs }, null, 2));
  console.error(`${OUT}/${label}.json (and ${label}-trace.json, loadable in DevTools' Performance panel)`);
}

mkdirSync(OUT, { recursive: true });
main().catch((e) => { console.error('trace failed:', e.stack || e.message); process.exit(1); });
