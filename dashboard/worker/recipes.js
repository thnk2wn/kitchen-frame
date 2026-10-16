// Recipes: Explore (TheMealDB, free, a curated few hundred recipes) and Saved (stored here, added by
// agents or from Explore on the frame).
//   GET    /api/recipes/explore?c=Chicken  recipes in a category (cards only)
//   GET    /api/recipes/explore?random=1   one random recipe (full)
//   GET    /api/recipes/explore?id=52772   one recipe (full)
//   GET    /api/recipes                    saved recipes (full)
//   POST   /api/recipes                    save one (AGENT_TOKEN or the frame's key): into Paprika when
//                                          a Paprika account is configured (paprika-write.js), else here
//   POST   /api/recipes/:id/paprika        move a recipe saved here into Paprika (frame)
//   DELETE /api/recipes/:id                remove a saved one (frame)
//   GET    /api/recipes/:id/image          a saved recipe's photo, stored at save time
// Saved recipes are one KV value; photos are copied into KV when saved so they keep working if the
// source site changes, and so the frame (old trust store) never fetches arbitrary sites.
const MDB = 'https://www.themealdb.com/api/json/v1/1/';
const KEY = 'recipes';
const MAX_SAVED = 300;
import { shrink } from './images.js';
import { paprikaConfigured, syncPaprika } from './paprika.js';
import { saveToPaprika } from './paprika-write.js';

const MAX_IMAGE = 3 * 1024 * 1024;
const SAVED_WIDTH = 640; // saved photos are resized to this once, at save time

// TheMealDB serves each photo at 700px, plus /large (500), /medium (350) and /small (150).
// On the frame (1.5x) a grid card is ~350 device px wide and the recipe page photo ~500.
const sized = (url, size) => (url ? url + '/' + size : null);
// Categories the household doesn't want in Explore (also skipped by Surprise me).
const HIDDEN = new Set(['Vegetarian', 'Vegan']);

async function mdb(path) {
  // TheMealDB changes rarely: cache upstream for a day.
  const res = await fetch(MDB + path, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) throw new Error('TheMealDB HTTP ' + res.status);
  return res.json();
}

// TheMealDB's flat strIngredient1..20 / strMeasure1..20 -> a normal recipe.
export function fromMealDB(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m['strIngredient' + i] || '').trim();
    if (name) ingredients.push({ name, measure: (m['strMeasure' + i] || '').trim() });
  }
  const steps = String(m.strInstructions || '')
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(step\s*)?\d+[.):]?\s*/i, '').trim())
    .filter((s) => s.length > 2);
  return {
    id: 'mdb:' + m.idMeal,
    title: m.strMeal,
    image: sized(m.strMealThumb, 'large'),
    thumb: sized(m.strMealThumb, 'medium'),
    category: m.strCategory || null,
    area: m.strArea || null,
    ingredients,
    steps,
    source: m.strSource || null,
    video: m.strYoutube || null,
  };
}

export async function explore(params) {
  if (params.get('id')) {
    const d = await mdb('lookup.php?i=' + encodeURIComponent(params.get('id').replace(/^mdb:/, '')));
    return { recipe: d.meals ? fromMealDB(d.meals[0]) : null };
  }
  if (params.has('random')) {
    // Never cached. Re-roll past hidden categories (~15% of recipes), a few times at most.
    let m;
    for (let i = 0; i < 6; i++) {
      m = (await fetch(MDB + 'random.php').then((r) => r.json())).meals[0];
      if (!HIDDEN.has(m.strCategory)) break;
    }
    return { recipe: fromMealDB(m) };
  }
  const c = params.get('c') || 'Chicken';
  if (HIDDEN.has(c)) return { recipes: [] };
  const d = await mdb('filter.php?c=' + encodeURIComponent(c));
  return {
    recipes: (d.meals || []).map((m) => ({ id: 'mdb:' + m.idMeal, title: m.strMeal, thumb: sized(m.strMealThumb, 'medium') })),
  };
}

// ---- Saved

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function cleanRecipe(input) {
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map((x) => (typeof x === 'string' ? { name: str(x, 200), measure: '' } : { name: str(x && x.name, 200), measure: str(x && x.measure, 80) }))
    .filter((x) => x.name)
    .slice(0, 60);
  const steps = (Array.isArray(input.steps) ? input.steps : []).map((s) => str(s, 1500)).filter(Boolean).slice(0, 60);
  return {
    title: str(input.title, 120),
    ingredients,
    steps,
    ...(str(input.servings, 40) || Number.isFinite(input.servings) ? { servings: String(input.servings).slice(0, 40) } : {}),
    ...(str(input.time, 60) ? { time: str(input.time, 60) } : {}),
    ...(str(input.source, 500).startsWith('http') ? { source: str(input.source, 500) } : {}),
    ...(str(input.from, 60) ? { from: str(input.from, 60) } : {}),
    ...(Array.isArray(input.tags) ? { tags: input.tags.map((t) => str(t, 30)).filter(Boolean).slice(0, 8) } : {}),
    ...(str(input.category, 40) ? { category: str(input.category, 40) } : {}),
    ...(str(input.ref, 40) ? { ref: str(input.ref, 40) } : {}), // e.g. "mdb:52772" when saved from Explore
  };
}

async function load(env) {
  return (await env.CALENDAR.get(KEY, { type: 'json', cacheTtl: 30 })) || [];
}

export async function listSaved(env) {
  return { recipes: await load(env) };
}

export async function saveRecipe(env, input, ctx) {
  const recipe = cleanRecipe(input || {});
  if (!recipe.title) return { status: 400, body: { error: 'A recipe needs a title' } };
  if (!recipe.ingredients.length && !recipe.steps.length) return { status: 400, body: { error: 'Send ingredients and/or steps' } };
  // With a Paprika account, Save means Paprika: the household's library, on every phone.
  if (paprikaConfigured(env) && !(input && input.local)) {
    try {
      const r = await saveToPaprika(env, recipe, { imageUrl: str(input.image, 1000) });
      if (!r.existing && ctx) ctx.waitUntil(syncPaprika(env).catch(() => {})); // so the frame's Paprika view has it soon
      return { status: r.existing ? 200 : 201, body: { paprika: true, uid: r.uid, ...(r.existing ? { existing: true } : {}) } };
    } catch (e) {
      console.error({ source: 'worker', message: 'save to Paprika failed', error: String(e.message || e) });
      return { status: 502, body: { error: 'Paprika didn’t take the recipe: ' + String(e.message || e).slice(0, 120) } };
    }
  }
  const list = await load(env);
  if (recipe.ref && list.some((r) => r.ref === recipe.ref)) return { status: 200, body: { id: list.find((r) => r.ref === recipe.ref).id, existing: true } };
  if (list.length >= MAX_SAVED) return { status: 429, body: { error: 'Saved recipes are full (' + MAX_SAVED + ')' } };
  const id = crypto.randomUUID();
  const entry = { id, ...recipe, savedAt: new Date().toISOString() };
  // Copy the photo now (best effort): JPEG/PNG/WebP up to 3 MB.
  const imageUrl = str(input.image, 1000);
  if (/^https:\/\//.test(imageUrl)) {
    try {
      const res = await fetch(imageUrl, { headers: { Accept: 'image/*' } });
      const type = res.headers.get('Content-Type') || '';
      const bytes = res.ok && /^image\/(jpeg|png|webp)/.test(type) ? await res.arrayBuffer() : null;
      if (bytes && bytes.byteLength <= MAX_IMAGE) {
        const photo = await shrink(env, bytes, type, SAVED_WIDTH);
        await env.CALENDAR.put('recipe-image:' + id, photo.bytes, { metadata: { type: photo.type } });
        entry.hasImage = true;
      }
    } catch {}
  }
  list.unshift(entry);
  await env.CALENDAR.put(KEY, JSON.stringify(list));
  return { status: 201, body: { id } };
}

// A recipe saved here, moved into Paprika (its stored photo goes with it), then removed from here.
export async function moveToPaprika(env, id, ctx) {
  if (!paprikaConfigured(env)) return { status: 400, body: { error: 'Paprika is not configured' } };
  const list = await load(env);
  const entry = list.find((r) => r.id === id);
  if (!entry) return { status: 404, body: { error: 'not found' } };
  const img = entry.hasImage ? await env.CALENDAR.getWithMetadata('recipe-image:' + id, { type: 'arrayBuffer' }) : null;
  try {
    const r = await saveToPaprika(env, entry, img && img.value ? { imageBytes: img.value, imageType: (img.metadata && img.metadata.type) || 'image/jpeg' } : {});
    await deleteRecipe(env, id);
    if (ctx) ctx.waitUntil(syncPaprika(env).catch(() => {}));
    return { status: 200, body: { paprika: true, uid: r.uid, ...(r.existing ? { existing: true } : {}) } };
  } catch (e) {
    return { status: 502, body: { error: 'Paprika didn’t take the recipe: ' + String(e.message || e).slice(0, 120) } };
  }
}

export async function deleteRecipe(env, id) {
  const list = await load(env);
  const rest = list.filter((r) => r.id !== id);
  if (rest.length !== list.length) {
    await env.CALENDAR.put(KEY, JSON.stringify(rest));
    await env.CALENDAR.delete('recipe-image:' + id);
  }
  return { ok: true };
}

export async function recipeImage(env, id) {
  const { value, metadata } = await env.CALENDAR.getWithMetadata('recipe-image:' + id, 'arrayBuffer');
  if (!value) return new Response('not found', { status: 404 });
  return new Response(value, { headers: { 'Content-Type': (metadata && metadata.type) || 'image/jpeg', 'Cache-Control': 'private, max-age=604800, immutable' } });
}
