#!/usr/bin/env node
// Replaces small recipe photos in Paprika itself with full-size ones, so every device (and the frame)
// gets them. Many recipes were imported from web pages that offered Paprika only a thumbnail; the
// recipe's own page usually has the full photo (its og:image or recipe data). Run on a Mac (it uses
// `sips` to resize). Reads PAPRIKA_EMAIL and PAPRIKA_PASSWORD from dashboard/.dev.vars.
//
//   node scripts/paprika-photos.mjs check              hashes match Paprika's for every recipe (read-only)
//   node scripts/paprika-photos.mjs scan               find a bigger photo for each small one (read-only);
//                                                      writes review.html to compare before and after
//   node scripts/paprika-photos.mjs use <uid> <url>... use this photo for a recipe (one found in a browser,
//                                                      for sites that block scripts; several uid/url pairs,
//                                                      or --file with one pair per line); then apply <uid>
//   node scripts/paprika-photos.mjs apply <uid>...     upload the found photos for these recipes
//   node scripts/paprika-photos.mjs apply --all        ... for every recipe the scan found one for
//   node scripts/paprika-photos.mjs undo <uid>...      put a recipe back as it was before apply
//
// Working files (the scan, found photos and a backup of every recipe before it's changed) go in
// --dir (default ~/temp/paprika-photos). Keep the backups until you're happy with the result.
//
// Paprika has no public API. Writing a photo copies what the Paprika app itself sends, as captured
// and documented by mcp-paprika (MIT): https://github.com/bojanrajkovic/mcp-paprika
// (docs/wire-format.md, src/paprika/client.ts, src/paprika/recipe-hash.ts).
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'https://www.paprikaapp.com/api';
const SMALL = 500;        // a photo narrower than this (in its longer side) is worth replacing
const BETTER = 1.5;       // ... by one at least this much bigger
const FULL_MAX = 1600;    // longest side of the full photo we upload
const THUMB = 280;        // Paprika's own thumbnails: a 280x280 centre crop
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const args = process.argv.slice(2);
const dirAt = args.indexOf('--dir');
const DIR = dirAt >= 0 ? args.splice(dirAt, 2)[1] : join(homedir(), 'temp', 'paprika-photos');
const [cmd, ...rest] = args;

// ---- Paprika

const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const setting = (k) => (new RegExp('^' + k + '="?([^"\\n]*)"?', 'm').exec(vars) || [])[1] || '';
let token = null;

async function json(res) {
  const b = Buffer.from(await res.arrayBuffer());
  const text = b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b).toString() : b.toString();
  try { return JSON.parse(text); } catch { throw new Error('Paprika HTTP ' + res.status + ': ' + text.slice(0, 120)); }
}

// The login token is kept in --dir (readable only by you) and reused: Paprika refuses logins for a few
// minutes after several in a row.
const tokenFile = () => join(DIR, '.token');

async function login(fresh = false) {
  if (!fresh && existsSync(tokenFile())) { token = readFileSync(tokenFile(), 'utf8').trim(); if (token) return; }
  const email = setting('PAPRIKA_EMAIL'), password = setting('PAPRIKA_PASSWORD');
  if (!email || !password) throw new Error('Set PAPRIKA_EMAIL and PAPRIKA_PASSWORD in dashboard/.dev.vars');
  const res = await fetch(API + '/v1/account/login/', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(email + ':' + password).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
  });
  const body = await json(res);
  token = body?.result?.token;
  if (!token) throw new Error('Paprika login failed: ' + (body?.error?.message || 'HTTP ' + res.status));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(tokenFile(), token, { mode: 0o600 });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Paced (Paprika answers 429 to quick bursts), and retried after a wait when it does.
async function paprika(path, form) {
  if (!token) await login();
  for (let wait = 5000; ; wait *= 2) {
    await pause(400);
    const res = await fetch(API + '/v2/sync' + path, { method: form ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (res.status === 401 || res.status === 403) { await login(true); continue; }
    if (res.status === 429 && wait <= 80000) { process.stdout.write(` (Paprika asked to slow down; waiting ${wait / 1000}s)`); await pause(wait); continue; }
    const body = await json(res);
    if (!res.ok || body.error) throw new Error('Paprika ' + path + ': HTTP ' + res.status + ' ' + JSON.stringify(body.error || body).slice(0, 160));
    return body.result;
  }
}

// Recipes are cached in --dir by their hash, so a second run only fetches what changed.
let cache = null;
async function recipe(uid, hash) {
  const file = join(DIR, 'recipes.json');
  if (!cache) { mkdirSync(DIR, { recursive: true }); cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; }
  if (hash && cache[uid] && cache[uid].hash === hash) return cache[uid];
  const r = await paprika('/recipe/' + uid + '/');
  cache[uid] = r;
  writeFileSync(file, JSON.stringify(cache));
  return r;
}

// Paprika's recipe content hash (Recipe.hashValues in Paprika.framework, as ported by mcp-paprika):
// SHA-256, upper-case hex, of a compact JSON array of 27 fields in key order, with "/" escaped.
export function recipeHash(r) {
  const s = (v) => v ?? '';
  const values = [
    [...(r.categories || [])].sort(), s(r.cook_time), r.created, false, s(r.description), s(r.difficulty),
    s(r.directions), null, r.image_url ?? null, false, s(r.ingredients), !!r.is_pinned, r.name, s(r.notes),
    s(r.nutritional_info), !!r.on_favorites, r.photo ?? null, r.photo_hash ?? null, r.photo_large ?? null,
    s(r.prep_time), r.rating ?? 0, r.scale ?? null, s(r.servings), s(r.source), s(r.source_url), s(r.total_time), r.uid,
  ];
  return createHash('sha256').update(JSON.stringify(values).replaceAll('/', '\\/'), 'utf8').digest('hex').toUpperCase();
}

const RECIPE_FIELDS = ['uid', 'hash', 'name', 'categories', 'ingredients', 'directions', 'description', 'notes', 'prep_time',
  'cook_time', 'total_time', 'servings', 'difficulty', 'rating', 'created', 'image_url', 'photo', 'photo_hash', 'photo_large',
  'source', 'source_url', 'on_favorites', 'in_trash', 'is_pinned', 'scale', 'nutritional_info', 'deleted'];
const recipePayload = (r) => Object.fromEntries(RECIPE_FIELDS.map((k) => [k, r[k] ?? (k === 'categories' ? [] : k === 'deleted' || k === 'in_trash' ? false : null)]));

function form(payload, dataName, image, imageName) {
  const f = new FormData();
  f.append('data', new Blob([gzipSync(JSON.stringify(payload))]), dataName);
  if (image) f.append('photo_upload', new Blob([image], { type: 'image/jpeg' }), imageName);
  return f;
}

// ---- Images

const sha256 = (b) => createHash('sha256').update(b).digest('hex').toUpperCase();

function size(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
    const t = b.subarray(12, 16).toString();
    if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (t === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (t === 'VP8L') { const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

async function download(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/jpeg,image/png,image/webp;q=0.8,image/*;q=0.5' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const b = Buffer.from(await res.arrayBuffer());
    const d = size(b);
    return d ? { url, bytes: b, w: d[0], h: d[1] } : null;
  } catch { return null; }
}

// Image addresses a recipe page offers: og:image / twitter:image, and the image in its schema.org
// Recipe data (a string, a list, or an ImageObject).
async function pageImages(pageUrl) {
  let html;
  try {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    html = await res.text();
  } catch { return []; }
  const out = [];
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi)) {
    const c = /content=["']([^"']+)["']/i.exec(m[0]);
    if (c) out.push(c[1]);
  }
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    const types = [].concat(x['@type'] || []);
    if (types.includes('Recipe') && x.image) for (const i of [].concat(x.image)) out.push(typeof i === 'string' ? i : i && (i.url || i.contentUrl));
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch {}
  }
  const base = new URL(pageUrl);
  return [...new Set(out.filter(Boolean).map((u) => { try { return new URL(u.replace(/&amp;/g, '&'), base).href; } catch { return null; } }).filter(Boolean))];
}

// Resizes with macOS sips: the full photo (longest side FULL_MAX) and Paprika's square thumbnail.
function prepare(bytes) {
  const tmp = join(tmpdir(), 'paprika-photo-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  const src = join(tmp, 'src'), full = join(tmp, 'full.jpg'), thumb = join(tmp, 'thumb.jpg');
  writeFileSync(src, bytes);
  const sips = (...a) => execFileSync('sips', a, { stdio: 'ignore' });
  const [sw, sh] = size(bytes);
  // Only ever smaller: sips -Z would also enlarge a photo below FULL_MAX.
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', ...(Math.max(sw, sh) > FULL_MAX ? ['-Z', String(FULL_MAX)] : []), src, '--out', full);
  const [w, h] = size(readFileSync(full));
  const side = Math.min(w, h);
  sips('-c', String(side), String(side), full, '--out', thumb);
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-z', String(THUMB), String(THUMB), thumb, '--out', thumb);
  return { full: readFileSync(full), thumb: readFileSync(thumb) };
}

// ---- Commands

const scanFile = () => join(DIR, 'scan.json');
const longest = (d) => (d ? Math.max(d.w, d.h) : 0);

async function check() {
  const list = await paprika('/recipes/');
  let ok = 0;
  const bad = [];
  for (const { uid, hash } of list) {
    const r = await recipe(uid, hash);
    if (r.in_trash) continue;
    if (recipeHash(r) === r.hash) ok++; else bad.push(r.name);
  }
  console.log(`hash matches Paprika's for ${ok} of ${ok + bad.length} recipes`);
  if (bad.length) console.log('different (written by an older Paprika, or edited elsewhere):\n  ' + bad.join('\n  '));
}

async function scan() {
  mkdirSync(join(DIR, 'found'), { recursive: true });
  const list = await paprika('/recipes/');
  const results = [];
  let n = 0;
  for (const { uid, hash } of list) {
    const r = await recipe(uid, hash);
    if (r.in_trash) continue;
    process.stdout.write(`\r${++n}/${list.length} ${r.name.slice(0, 50).padEnd(50)}`);
    const current = r.photo_large ? null : r.photo_url ? await download(r.photo_url) : null;
    const now = longest(current);
    const row = { uid, name: r.name, source: r.source_url || '', now: current ? `${current.w}x${current.h}` : r.photo_large ? 'full' : 'none' };
    if (r.photo_large || (now && now >= SMALL)) { results.push({ ...row, skip: 'already full size' }); continue; }
    const urls = [...(r.image_url ? [r.image_url] : []), ...(r.source_url ? await pageImages(r.source_url) : [])];
    let best = null;
    for (const u of [...new Set(urls)].slice(0, 6)) {
      const d = await download(u);
      if (d && longest(d) > longest(best)) best = d;
    }
    if (!best || longest(best) < Math.max(SMALL, now * BETTER)) { results.push({ ...row, skip: best ? `best found ${best.w}x${best.h}` : r.source_url ? 'nothing on the page' : 'no source page' }); continue; }
    writeFileSync(join(DIR, 'found', uid + '.img'), best.bytes);
    if (current) writeFileSync(join(DIR, 'found', uid + '.now.jpg'), current.bytes);
    results.push({ ...row, found: `${best.w}x${best.h}`, from: best.url });
  }
  writeFileSync(scanFile(), JSON.stringify(results, null, 1));
  const found = results.filter((x) => x.found);
  // A page to look over before applying: today's photo beside the one found.
  const cell = (x) => `<figure><div><img src="found/${x.uid}.now.jpg" title="${x.now}"><img src="found/${x.uid}.img" title="${x.found}"></div><figcaption>${x.name.replace(/</g, '&lt;')}<br><small>${x.now} → ${x.found} · <code>${x.uid}</code></small></figcaption></figure>`;
  writeFileSync(join(DIR, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Paprika photos</title><style>body{font:14px system-ui;margin:20px}figure{display:inline-block;margin:0 16px 20px 0;vertical-align:top;width:520px}div{display:flex;gap:8px;align-items:flex-start}img{width:256px;height:256px;object-fit:cover;background:#eee}small{color:#666}</style><h1>${found.length} photos to replace</h1>${found.map(cell).join('')}`);
  console.log(`\n${found.length} of ${results.length} recipes have a bigger photo. Look them over: open "${join(DIR, 'review.html')}"`);
  const why = {};
  for (const x of results.filter((x) => !x.found)) { const k = x.skip.replace(/\d+x\d+/, 'small'); why[k] = (why[k] || 0) + 1; }
  console.log('Not replaced:', why);
}

async function use(pairs) {
  if (pairs[0] === '--file') pairs = readFileSync(pairs[1], 'utf8').split(/\s+/).filter(Boolean);
  for (let i = 0; i + 1 < pairs.length; i += 2) await useOne(pairs[i], pairs[i + 1]);
}

async function useOne(uid, url) {
  const scanned = existsSync(scanFile()) ? JSON.parse(readFileSync(scanFile(), 'utf8')) : [];
  const row = scanned.find((x) => x.uid === uid);
  if (!row || !url) { console.log(`${uid}: not in the scan; run scan first`); return; }
  const d = await download(url);
  if (!d) { console.log(`${row.name}: couldn't download that image`); return; }
  const r = await recipe(uid);
  const current = r.photo_url ? await download(r.photo_url) : null;
  if (longest(d) < Math.max(SMALL, longest(current) * BETTER)) { console.log(`${row.name}: ${d.w}x${d.h} isn't much bigger than today's; not used`); return; }
  mkdirSync(join(DIR, 'found'), { recursive: true });
  writeFileSync(join(DIR, 'found', uid + '.img'), d.bytes);
  if (current) writeFileSync(join(DIR, 'found', uid + '.now.jpg'), current.bytes);
  Object.assign(row, { found: `${d.w}x${d.h}`, from: url, skip: undefined });
  writeFileSync(scanFile(), JSON.stringify(scanned, null, 1));
  console.log(`${row.name}: ${row.now} → ${row.found}`);
}

async function apply(uids) {
  const scanned = existsSync(scanFile()) ? JSON.parse(readFileSync(scanFile(), 'utf8')) : [];
  if (uids[0] === '--all') uids = scanned.filter((x) => x.found).map((x) => x.uid);
  mkdirSync(join(DIR, 'backup'), { recursive: true });
  for (const uid of uids) {
    const row = scanned.find((x) => x.uid === uid);
    const file = join(DIR, 'found', uid + '.img');
    if (!row || !row.found || !existsSync(file)) { console.log(`${uid}: not in the scan's results; run scan first`); continue; }
    const r = await recipe(uid);
    if (r.photo_large) { console.log(`${r.name}: already has a full-size photo; skipped`); continue; }
    // Backup: the recipe as it is now, and its thumbnail's bytes, for undo.
    const backup = join(DIR, 'backup', uid + '.json');
    if (!existsSync(backup)) {
      const thumb = r.photo_url ? await download(r.photo_url) : null;
      writeFileSync(backup, JSON.stringify({ recipe: recipePayload(r), thumb: thumb ? thumb.bytes.toString('base64') : null, at: new Date().toISOString() }));
    }
    const { full, thumb } = prepare(readFileSync(file));
    const photoUid = randomUUID().toUpperCase();
    const thumbName = randomUUID().toUpperCase() + '.jpg';
    const next = { ...recipePayload(r), photo: thumbName, photo_large: photoUid + '.jpg', photo_hash: sha256(thumb) };
    next.hash = recipeHash(next);
    const photo = { uid: photoUid, filename: photoUid + '.jpg', recipe_uid: uid, name: '1', order_flag: 0, hash: sha256(full), deleted: false };
    // The Paprika app's own sequence: recipe with the thumbnail, the full photo, the recipe again.
    await paprika('/recipe/' + uid + '/', form(next, 'data.gz', thumb, thumbName));
    await paprika('/photo/' + photoUid + '/', form(photo, 'file', full, photo.filename));
    await paprika('/recipe/' + uid + '/', form(next, 'data.gz'));
    writeFileSync(backup.replace('.json', '.photo.json'), JSON.stringify(photo));
    console.log(`${r.name}: ${row.now} → ${row.found}`);
  }
  await paprika('/notify/', new FormData()).catch(() => {});
}

async function undo(uids) {
  for (const uid of uids) {
    const file = join(DIR, 'backup', uid + '.json');
    if (!existsSync(file)) { console.log(`${uid}: no backup`); continue; }
    const { recipe: before, thumb } = JSON.parse(readFileSync(file, 'utf8'));
    const photoFile = file.replace('.json', '.photo.json');
    if (existsSync(photoFile)) {
      const photo = JSON.parse(readFileSync(photoFile, 'utf8'));
      await paprika('/photo/' + photo.uid + '/', form({ ...photo, deleted: true }, 'file'));
    }
    const back = { ...before, hash: recipeHash(before) };
    await paprika('/recipe/' + uid + '/', thumb && before.photo ? form(back, 'data.gz', Buffer.from(thumb, 'base64'), before.photo) : form(back, 'data.gz'));
    console.log(`${before.name}: back as it was`);
  }
  await paprika('/notify/', new FormData()).catch(() => {});
}

const commands = { check, scan, use: () => use(rest), apply: () => apply(rest), undo: () => undo(rest) };
if (!commands[cmd]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n'));
  process.exit(1);
}
await commands[cmd]();
