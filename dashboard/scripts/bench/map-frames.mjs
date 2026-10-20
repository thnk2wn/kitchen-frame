#!/usr/bin/env node
// Maps minified "file:line:col" frames (from trace.mjs's JS list) to source, using a local build with
// source maps of the same code: node scripts/bench/map-frames.mjs <deployed.js> <built.js> <line:col>...
// Each frame's code is looked up by its text in the source-mapped build, since build stamps shift
// positions between the two builds.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SourceMapConsumer } = require('source-map-js');
const [deployedFile, builtFile, ...frames] = process.argv.slice(2);
const deployed = readFileSync(deployedFile, 'utf8').split('\n');
const built = readFileSync(builtFile, 'utf8');
const builtLines = built.split('\n');
const map = new SourceMapConsumer(JSON.parse(readFileSync(builtFile + '.map', 'utf8')));

for (const f of frames) {
  const [line, col] = f.split(':').map(Number);
  const snippet = deployed[line - 1].slice(col - 1, col - 1 + 80);
  // Find the snippet in the mapped build.
  let found = null;
  builtLines.forEach((l, i) => { const at = l.indexOf(snippet); if (at >= 0 && !found) found = { line: i + 1, column: at }; });
  if (!found) { console.log(`${f}  (not found)  ${snippet.slice(0, 60)}`); continue; }
  const o = map.originalPositionFor(found);
  console.log(`${f}  ->  ${o.source}:${o.line}:${o.column}${o.name ? ' ' + o.name : ''}   | ${snippet.slice(0, 50)}`);
}
