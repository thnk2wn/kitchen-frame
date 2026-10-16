// Saving a recipe into Paprika (the household's library), the one place this project writes to it:
// a recipe saved from Explore on the frame, or sent by an agent, goes to Paprika when a Paprika
// account is configured, so it shows up in the Paprika apps and in the frame's Paprika view. It
// uses the same undocumented sync calls the Paprika apps make, in their order (the same ones
// scripts/paprika-photos.mjs uses to fix photos): the recipe with its thumbnail, the full photo,
// the recipe again, then a notify so other devices sync. A recipe is filed under the library's own
// category of the same name when there is one (Explore's Seafood into Seafood; ALIASES map the
// rest), else under CATEGORY when the library has it (make it once in the Paprika app), else
// uncategorized. Categories aren't created here: Paprika has no per-category write (404), and
// posting the whole list is not worth the risk to the library.
import { paprikaConfigured, api, loadSynced } from './paprika.js';
import { shrink } from './images.js';

export const CATEGORY = 'Kitchen Frame';
// Explore's (TheMealDB) category names that differ from the usual Paprika ones.
const ALIASES = { chicken: 'Poultry', starter: 'Appetizers', miscellaneous: '' };
const FULL_WIDTH = 1600;  // the photo stored in Paprika (its apps show it full screen)
const THUMB_WIDTH = 400;  // Paprika's own thumbnail
const MAX_IMAGE = 3 * 1024 * 1024;

const uuid = () => crypto.randomUUID().toUpperCase();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
export const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

// Paprika's recipe content hash (Recipe.hashValues in Paprika.framework, as ported by mcp-paprika and
// scripts/paprika-photos.mjs): SHA-256 of a compact JSON array of 27 fields, "/" escaped.
export async function recipeHash(r) {
  const s = (v) => v ?? '';
  const values = [
    [...(r.categories || [])].sort(), s(r.cook_time), r.created, false, s(r.description), s(r.difficulty),
    s(r.directions), null, r.image_url ?? null, false, s(r.ingredients), !!r.is_pinned, r.name, s(r.notes),
    s(r.nutritional_info), !!r.on_favorites, r.photo ?? null, r.photo_hash ?? null, r.photo_large ?? null,
    s(r.prep_time), r.rating ?? 0, r.scale ?? null, s(r.servings), s(r.source), s(r.source_url), s(r.total_time), r.uid,
  ];
  return sha256(new TextEncoder().encode(JSON.stringify(values).replaceAll('/', '\\/')));
}

// Paprika's "created": local-looking "YYYY-MM-DD HH:MM:SS".
export const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

// A saved recipe (worker/recipes.js shape) as Paprika's full recipe record, every field present.
export function toPaprika(recipe, { uid = uuid(), created = stamp(), categories = [] } = {}) {
  const ingredients = (recipe.ingredients || []).map((i) => [i.measure, i.name].filter(Boolean).join(' ').trim()).filter(Boolean).join('\n');
  const directions = (recipe.steps || []).map((s, i) => (i + 1) + '. ' + s).join('\n\n');
  let source = recipe.from || '';
  if (!source && recipe.source) { try { source = new URL(recipe.source).hostname.replace(/^www\./, ''); } catch {} }
  return {
    uid, name: recipe.title, ingredients, directions,
    description: '', notes: recipe.tags && recipe.tags.length ? 'Tags: ' + recipe.tags.join(', ') : '',
    nutritional_info: '', prep_time: '', cook_time: '', total_time: recipe.time || '',
    servings: recipe.servings ? String(recipe.servings) : '', difficulty: '', rating: 0, scale: null,
    source, source_url: recipe.source || '', image_url: null,
    photo: null, photo_hash: null, photo_large: null,
    categories, on_favorites: false, in_trash: false, is_pinned: false, deleted: false, created, hash: '',
  };
}

async function gzip(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()]);
}
async function form(payload, dataName, image, imageName) {
  const f = new FormData();
  f.append('data', await gzip(payload), dataName);
  if (image) f.append('photo_upload', new Blob([image], { type: 'image/jpeg' }), imageName);
  return f;
}

// Where to file it (see the top of the file); null when nothing fits.
async function categoryUid(env, state, recipe) {
  try {
    const cats = (await api(env, '/v2/sync/categories/', state)) || [];
    const byName = (n) => n && cats.find((c) => c && String(c.name).trim().toLowerCase() === String(n).trim().toLowerCase());
    const own = recipe.category || '';
    const wanted = own.toLowerCase() in ALIASES ? ALIASES[own.toLowerCase()] : own;
    const hit = byName(wanted) || byName(CATEGORY);
    return hit ? hit.uid : null;
  } catch (e) {
    console.warn({ source: 'worker', message: 'paprika category', error: String(e.message || e) });
    return null;
  }
}

// Already in the library? By source link, else by title. From the Worker's synced copy, so no extra
// requests; a recipe saved in the last few minutes may not be there yet, which is acceptable.
export async function findInPaprika(env, recipe) {
  const data = await loadSynced(env);
  const title = String(recipe.title || '').trim().toLowerCase();
  return (data.recipes || []).find((r) => !r.trashed && ((recipe.source && r.source === recipe.source) || (title && r.title.trim().toLowerCase() === title))) || null;
}

// Saves a recipe (cleanRecipe's shape) into Paprika, with its photo when imageBytes (or imageUrl) is
// given. Resolves { uid, existing? }. Throws when Paprika refuses.
export async function saveToPaprika(env, recipe, { imageUrl = '', imageBytes = null, imageType = '' } = {}) {
  if (!paprikaConfigured(env)) throw new Error('Paprika is not configured');
  const dup = await findInPaprika(env, recipe);
  if (dup) return { uid: dup.uid, existing: true };
  const state = {};
  const cat = await categoryUid(env, state, recipe);
  const rec = toPaprika(recipe, { categories: cat ? [cat] : [] });

  // The photo: fetched if needed, then a full-size copy and a thumbnail.
  let full = null, thumb = null;
  try {
    let bytes = imageBytes, type = imageType;
    if (!bytes && /^https:\/\//.test(imageUrl)) {
      const res = await fetch(imageUrl, { headers: { Accept: 'image/*' } });
      type = res.headers.get('Content-Type') || '';
      bytes = res.ok && /^image\/(jpeg|png|webp)/.test(type) ? await res.arrayBuffer() : null;
    }
    if (bytes && bytes.byteLength <= MAX_IMAGE) {
      full = (await shrink(env, bytes, type, FULL_WIDTH, 0)).bytes;
      thumb = (await shrink(env, bytes, type, THUMB_WIDTH, 0)).bytes;
    }
  } catch (e) { console.warn({ source: 'worker', message: 'paprika photo', error: String(e.message || e) }); }

  if (thumb && full) {
    const photoUid = uuid();
    rec.photo = uuid() + '.jpg';
    rec.photo_large = photoUid + '.jpg';
    rec.photo_hash = await sha256(thumb);
    rec.hash = await recipeHash(rec);
    const photo = { uid: photoUid, filename: photoUid + '.jpg', recipe_uid: rec.uid, name: '1', order_flag: 0, hash: await sha256(full), deleted: false };
    await api(env, '/v2/sync/recipe/' + rec.uid + '/', state, await form(rec, 'data.gz', thumb, rec.photo));
    await api(env, '/v2/sync/photo/' + photoUid + '/', state, await form(photo, 'file', full, photo.filename));
    await api(env, '/v2/sync/recipe/' + rec.uid + '/', state, await form(rec, 'data.gz'));
  } else {
    rec.hash = await recipeHash(rec);
    await api(env, '/v2/sync/recipe/' + rec.uid + '/', state, await form(rec, 'data.gz'));
  }
  await api(env, '/v2/sync/notify/', state, new FormData()).catch(() => {});
  console.log({ source: 'worker', message: 'recipe saved to Paprika', title: recipe.title, uid: rec.uid, photo: !!full });
  return { uid: rec.uid };
}
