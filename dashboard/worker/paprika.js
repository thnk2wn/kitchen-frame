// Our own recipes from Paprika (paprikaapp.com), read-only. Paprika has no official API; its apps
// sync through an undocumented one, described by the community at
// https://github.com/aarons22/paprika-tools/blob/main/API_REFERENCE.md. This file only reads; the
// one write, saving a recipe, is in paprika-write.js.
//
//   GET /api/recipes/paprika              { configured, updated, recipes: [card…] }
//   GET /api/recipes/paprika/:uid         { recipe }  (full: ingredients and steps)
//   GET /api/recipes/paprika/:uid/image   the photo, resized and stored at sync time
//   GET /api/meals                        the meal plan: last 2 days through the next 3 weeks
//
// A cron (see wrangler.jsonc) calls syncPaprika. Paprika lists every recipe as { uid, hash };
// only new or changed ones are fetched, a batch per run, because each is its own request and a
// Free-plan Worker run allows 50. Everything lives in one KV value plus one KV entry per photo.
// Secrets: PAPRIKA_EMAIL and PAPRIKA_PASSWORD (a Paprika Cloud Sync account). Unset = feature off.
import { shrink } from './images.js';

const API = 'https://www.paprikaapp.com/api';
const KEY = 'paprika';
const TOKEN_KEY = 'paprika-token';
const IMAGE_KEY = 'paprika-image:';
const THUMB_KEY = 'paprika-thumb:'; // a 320 px copy for the grid's cards, made on first request
const BATCH = 10;          // recipes fetched per run (each may also fetch its photo: up to 4 requests)
const PHOTO_WIDTH = 640;   // same as saved recipes
const MAX_IMAGE = 3 * 1024 * 1024;
// Bumped when fromPaprika keeps more fields, so already-synced recipes are fetched again (in batches).
const RECIPE_VERSION = 4; // 3: the full-size photo (photo_large); 4: renamed categories, trashed recipes

export const paprikaConfigured = (env) => !!(env.PAPRIKA_EMAIL && env.PAPRIKA_PASSWORD);

// ---- Paprika API

async function login(env) {
  const body = new URLSearchParams({ email: env.PAPRIKA_EMAIL, password: env.PAPRIKA_PASSWORD });
  const res = await fetch(API + '/v1/account/login/', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(env.PAPRIKA_EMAIL + ':' + env.PAPRIKA_PASSWORD), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await readJson(res);
  const token = data && data.result && data.result.token;
  if (!token) throw new Error('Paprika login failed (HTTP ' + res.status + ')');
  await env.CALENDAR.put(TOKEN_KEY, token);
  return token;
}

// Some responses arrive gzip-compressed without saying so.
async function readJson(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  try { return JSON.parse(text); } catch { return null; }
}

// One request: GET, or POST when a form is given (paprika-write.js). Logs in once and retries once
// with a fresh token when the stored one is refused.
export async function api(env, path, state, formBody = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!state.token) state.token = (await env.CALENDAR.get(TOKEN_KEY)) || (await login(env));
    const res = await fetch(API + path, { method: formBody ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + state.token }, ...(formBody ? { body: formBody } : {}) });
    if (res.status === 401 || res.status === 403) { state.token = null; await env.CALENDAR.delete(TOKEN_KEY); continue; }
    const data = await readJson(res);
    if (!res.ok || (data && data.error)) throw new Error('Paprika ' + path + ': HTTP ' + res.status + (data && data.error ? ' ' + JSON.stringify(data.error).slice(0, 160) : ''));
    if (!data || !('result' in data)) throw new Error('Paprika ' + path + ': unexpected response');
    return data.result;
  }
  throw new Error('Paprika rejected the login');
}
const get = (env, path, state) => api(env, path, state);

// ---- Shape

const lines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

// Paprika's servings is free text ("4", "Yield: 4 servings", "12 muffins"). The recipe page says
// "Serves N", so pass a plain number as servings and anything else as yield.
export function servingsOf(text) {
  const t = String(text || '').trim().replace(/^(yields|yield|servings|serves|makes)\s*:?\s*/i, '').trim();
  if (!t) return {};
  const n = /^(\d+(?:\s*[-–]\s*\d+)?)\s*(servings?|people|persons|portions)?\.?$/i.exec(t);
  return n ? { servings: n[1].replace(/\s+/g, '') } : { yield: t.slice(0, 40) };
}

// Paprika keeps ingredients and directions as free text, one per line.
export function fromPaprika(p, categoryNames = {}) {
  const steps = lines(p.directions)
    .map((s) => s.replace(/^\s*(step\s*)?\d+[.):]\s*/i, '').trim())
    .filter((s) => s.length > 1);
  const cats = (Array.isArray(p.categories) ? p.categories : [])
    .map((c) => categoryNames[c] || c)
    .filter((c) => typeof c === 'string' && c && !/^[0-9A-F-]{32,}$/i.test(c));
  const time = p.total_time || [p.prep_time && 'Prep ' + p.prep_time, p.cook_time && 'Cook ' + p.cook_time].filter(Boolean).join(', ');
  return {
    id: 'pap:' + p.uid,
    uid: p.uid,
    hash: p.hash || '',
    title: String(p.name || '').trim() || 'Untitled',
    ingredients: lines(p.ingredients).map((name) => ({ name, measure: '' })),
    steps,
    categories: cats,
    ...(cats[0] ? { category: cats[0] } : {}),
    ...servingsOf(p.servings),
    ...(time ? { time } : {}),
    ...(p.rating ? { rating: Number(p.rating) || 0 } : {}),
    ...(p.on_favorites ? { favorite: true } : {}),
    ...(p.source ? { sourceName: String(p.source).trim() } : {}),
    ...(/^https?:/.test(p.source_url || '') ? { source: p.source_url } : {}),
    ...(String(p.notes || '').trim() ? { notes: String(p.notes).trim().slice(0, 4000) } : {}),
    ...(String(p.description || '').trim() ? { description: String(p.description).trim().slice(0, 2000) } : {}),
    ...(String(p.nutritional_info || '').trim() ? { nutrition: String(p.nutritional_info).trim().slice(0, 2000) } : {}),
    photoHash: p.photo_hash || '',
    v: RECIPE_VERSION,
  };
}

// ---- Sync (cron)

// Meal plan: Paprika keeps every planned meal ever; we store a window around today. The dates are
// plain calendar days ("2026-10-13 00:00:00"); meal type names come from Paprika's own list.
const MEALS_KEY = 'paprika-meals';
const MEAL_ORDER = { Breakfast: 0, Lunch: 1, Dinner: 2, Snacks: 3, Snack: 3 };
export function mealWindow(meals, types, today, back = 2, ahead = 21) {
  const day = (offset) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  const from = day(-back), to = day(ahead);
  const typeName = new Map((types || []).map((t) => [t.uid, t.name]));
  const byNumber = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  return (meals || [])
    .map((m) => ({ date: String(m.date || '').slice(0, 10), type: typeName.get(m.type_uid) || byNumber[m.type] || 'Meal', order: m.order_flag || 0, title: String(m.name || '').trim(), recipe: m.recipe_uid || null }))
    .filter((m) => m.title && m.date >= from && m.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (MEAL_ORDER[a.type] ?? 9) - (MEAL_ORDER[b.type] ?? 9) || a.order - b.order);
}
async function syncMeals(env, state) {
  const [meals, types] = await Promise.all([get(env, '/v2/sync/meals/', state), get(env, '/v2/sync/mealtypes/', state).catch(() => [])]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: env.DISPLAY_TZ || 'UTC' });
  const list = mealWindow(meals, types, today);
  const prev = await env.CALENDAR.get(MEALS_KEY);
  const next = JSON.stringify(list);
  if (!prev || JSON.parse(prev).meals === undefined || JSON.stringify(JSON.parse(prev).meals) !== next) {
    await env.CALENDAR.put(MEALS_KEY, JSON.stringify({ updated: new Date().toISOString(), meals: list }));
  }
  return list.length;
}

export async function syncPaprika(env) {
  if (!paprikaConfigured(env)) return { skipped: true };
  const state = { token: null };
  let meals = null;
  try { meals = await syncMeals(env, state); } catch (e) { console.error('paprika meals:', e); }
  const stored = (await env.CALENDAR.get(KEY, 'json')) || { recipes: [], updated: null };
  const byUid = new Map(stored.recipes.map((r) => [r.uid, r]));

  const index = await get(env, '/v2/sync/recipes/', state); // [{ uid, hash }]
  const live = new Map(index.map((x) => [x.uid, x.hash]));
  let dirty = false;

  // Removed in Paprika (or emptied from the trash): drop them and their photos.
  for (const uid of [...byUid.keys()]) {
    if (!live.has(uid)) {
      byUid.delete(uid);
      await env.CALENDAR.delete(IMAGE_KEY + uid);
      await env.CALENDAR.delete(THUMB_KEY + uid);
      dirty = true;
    }
  }

  const todo = index.filter((x) => { const r = byUid.get(x.uid); return !r || r.hash !== x.hash || (!r.trashed && r.v !== RECIPE_VERSION); });
  if (todo.length) {
    let categoryNames = {};
    try {
      for (const c of await get(env, '/v2/sync/categories/', state)) categoryNames[c.uid] = c.name;
    } catch {}
    for (const { uid, hash } of todo.slice(0, BATCH)) {
      const p = await get(env, '/v2/sync/recipe/' + uid + '/', state);
      if (!p || p.in_trash) {
        // Trashed: remember its hash so it isn't fetched again, but don't show it.
        if (byUid.has(uid)) await env.CALENDAR.delete(IMAGE_KEY + uid);
        byUid.set(uid, { uid, hash, trashed: true });
        dirty = true;
        continue;
      }
      const prev = byUid.get(uid);
      const recipe = fromPaprika({ ...p, hash: p.hash || hash }, categoryNames);
      recipe.photoLarge = p.photo_large || '';
      recipe.hasImage = !!(prev && prev.hasImage && prev.photoHash === recipe.photoHash && (prev.photoLarge || '') === recipe.photoLarge);
      // The full-size photo when the recipe has one; photo_url is only Paprika's 280px thumbnail.
      if (!recipe.hasImage && p.photo_large) {
        try {
          const full = await get(env, '/v2/sync/photo/' + encodeURIComponent(p.photo_large.replace(/\.\w+$/, '')) + '/', state);
          if (full && full.photo_url) recipe.hasImage = await storePhoto(env, uid, full.photo_url);
        } catch {}
      }
      if (!recipe.hasImage && p.photo_url) recipe.hasImage = await storePhoto(env, uid, p.photo_url);
      if (!recipe.hasImage && /^https:/.test(p.image_url || '')) recipe.hasImage = await storePhoto(env, uid, p.image_url);
      byUid.set(uid, recipe);
      dirty = true;
    }
  }

  const remaining = Math.max(0, todo.length - BATCH);
  if (dirty || stored.remaining !== remaining) {
    const recipes = [...byUid.values()].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    await env.CALENDAR.put(KEY, JSON.stringify({ updated: new Date().toISOString(), remaining, recipes }));
  }
  return { total: index.length, fetched: Math.min(todo.length, BATCH), remaining, meals };
}

async function storePhoto(env, uid, url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'image/*' } });
    const type = res.headers.get('Content-Type') || '';
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) return false;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE) return false;
    const photo = await shrink(env, bytes, type, PHOTO_WIDTH);
    await env.CALENDAR.put(IMAGE_KEY + uid, photo.bytes, { metadata: { type: photo.type } });
    await env.CALENDAR.delete(THUMB_KEY + uid); // made again from the new photo
    return true;
  } catch {
    return false;
  }
}

// ---- Routes

async function load(env) {
  return (await env.CALENDAR.get(KEY, { type: 'json', cacheTtl: 60 })) || { recipes: [], updated: null };
}

export const loadSynced = (env) => load(env);

const card = (r) => ({
  id: r.id, title: r.title, categories: r.categories || [], hasImage: !!r.hasImage,
  // The source link, so the frame can tell an Explore recipe is already in the library.
  ...(r.source ? { source: r.source } : {}),
  // Photo version: part of the photo's address, so a replaced photo isn't served from a week-long cache.
  ...(r.hasImage ? { img: String(r.photoLarge || r.photoHash || '').replace(/\W/g, '').slice(0, 8) } : {}),
  ...(r.favorite ? { favorite: true } : {}), ...(r.rating ? { rating: r.rating } : {}),
});

export async function listPaprika(env) {
  if (!paprikaConfigured(env)) return { configured: false, recipes: [] };
  const data = await load(env);
  return { configured: true, updated: data.updated, remaining: data.remaining || 0, recipes: data.recipes.filter((r) => !r.trashed).map(card) };
}

export async function getPaprika(env, uid) {
  const data = await load(env);
  const r = data.recipes.find((x) => x.uid === uid && !x.trashed);
  if (!r) return null;
  const { hash, photoHash, photoLarge, servings, yield: y, ...recipe } = r;
  return { ...recipe, ...servingsOf(servings || y) }; // also tidies recipes stored before servingsOf
}

// w=320: the grid's smaller copy (a third of the bytes over the frame's slow Wi-Fi, and a quarter of
// the pixels to decode), made from the stored photo the first time it's asked for and kept.
export async function paprikaImage(env, uid, w) {
  const headers = (type) => ({ 'Content-Type': type || 'image/jpeg', 'Cache-Control': 'private, max-age=604800, immutable' });
  if (String(w) === '320') {
    const thumb = await env.CALENDAR.getWithMetadata(THUMB_KEY + uid, 'arrayBuffer');
    if (thumb.value) return new Response(thumb.value, { headers: headers(thumb.metadata && thumb.metadata.type) });
  }
  const { value, metadata } = await env.CALENDAR.getWithMetadata(IMAGE_KEY + uid, 'arrayBuffer');
  if (!value) return new Response('not found', { status: 404 });
  const type = (metadata && metadata.type) || 'image/jpeg';
  if (String(w) === '320') {
    const small = await shrink(env, value, type, 320, 0);
    await env.CALENDAR.put(THUMB_KEY + uid, small.bytes, { metadata: { type: small.type } });
    return new Response(small.bytes, { headers: headers(small.type) });
  }
  return new Response(value, { headers: headers(type) });
}

// The meal plan, each meal linked to its recipe in our synced library when there is one.
// "Chicken Tacos!" and "chicken tacos" are the same meal.
export const mealKey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function listMeals(env) {
  if (!paprikaConfigured(env)) return { configured: false, meals: [] };
  const [stored, data] = await Promise.all([env.CALENDAR.get(MEALS_KEY, { type: 'json', cacheTtl: 60 }), load(env)]);
  const live = data.recipes.filter((r) => !r.trashed);
  const byUid = new Map(live.map((r) => [r.uid, r]));
  // A meal typed by name rather than picked from the library still opens its recipe (and shows its
  // picture) when exactly one recipe has that name.
  const byName = new Map();
  for (const r of live) { const k = mealKey(r.title); byName.set(k, byName.has(k) ? null : r); }
  const meals = ((stored && stored.meals) || []).map(({ recipe, ...m }) => {
    const r = (recipe && byUid.get(recipe)) || byName.get(mealKey(m.title));
    return r ? { ...m, id: r.id, hasImage: !!r.hasImage } : m;
  });
  return { configured: true, updated: stored ? stored.updated : null, meals };
}
