import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaprika, recipeHash, saveToPaprika, findInPaprika, CATEGORY } from './paprika-write.js';

const recipe = {
  title: 'Bang bang prawn salad', source: 'https://www.bbcgoodfood.com/recipes/bang-bang-prawn-salad', time: '20 min', servings: '2',
  ingredients: [{ name: 'Prawns', measure: '200g' }, { name: 'Lime', measure: '' }], steps: ['Mix the dressing.', 'Toss and serve.'],
};

test('toPaprika: Paprika\'s record, every field present, lines joined the way its apps store them', () => {
  const r = toPaprika(recipe, { uid: 'ABC', created: '2026-10-16 01:00:00', categories: ['CAT1'] });
  assert.equal(r.uid, 'ABC');
  assert.equal(r.ingredients, '200g Prawns\nLime');
  assert.equal(r.directions, '1. Mix the dressing.\n\n2. Toss and serve.');
  assert.equal(r.source, 'bbcgoodfood.com');
  assert.equal(r.source_url, recipe.source);
  assert.deepEqual([r.servings, r.total_time, r.categories, r.in_trash, r.rating], ['2', '20 min', ['CAT1'], false, 0]);
  for (const k of ['name', 'description', 'notes', 'nutritional_info', 'prep_time', 'cook_time', 'difficulty', 'photo', 'photo_hash', 'photo_large', 'on_favorites', 'is_pinned', 'deleted', 'created', 'hash']) assert.ok(k in r, k);
  assert.match(toPaprika(recipe).uid, /^[0-9A-F-]{36}$/);
  assert.match(toPaprika(recipe).created, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('recipeHash: 64 upper-case hex, stable, and changed by content (as Paprika expects)', async () => {
  const r = toPaprika(recipe, { uid: 'ABC', created: '2026-10-16 01:00:00' });
  const h = await recipeHash(r);
  assert.match(h, /^[0-9A-F]{64}$/);
  assert.equal(await recipeHash({ ...r }), h);
  assert.notEqual(await recipeHash({ ...r, name: 'Other' }), h);
  assert.notEqual(await recipeHash({ ...r, categories: ['X'] }), h);
});

// A stand-in Paprika: records each call; the library has one category and no matching recipe.
function fakePaprika({ categories = [{ uid: 'CAT-BREAKFAST', name: 'Breakfast' }] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const entry = { method: init.method || 'GET', path: u.pathname };
    if (init.body instanceof FormData) {
      const data = init.body.get('data');
      if (data) entry.data = JSON.parse(await new Response(new Blob([await data.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
      const photo = init.body.get('photo_upload');
      if (photo) entry.photoBytes = (await photo.arrayBuffer()).byteLength;
    }
    calls.push(entry);
    if (u.pathname === '/api/v1/account/login/') return Response.json({ result: { token: 'tok' } });
    if (u.pathname === '/api/v2/sync/categories/') return Response.json({ result: categories });
    if (u.hostname === 'img.test') return new Response(new Uint8Array(2000), { headers: { 'Content-Type': 'image/jpeg' } });
    return Response.json({ result: true });
  };
  return calls;
}
const kv = (data = {}) => {
  const store = new Map(Object.entries(data));
  return { get: async (k, o) => { const v = store.get(k); return v == null ? null : (o === 'json' || (o && o.type === 'json')) ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k) };
};
const env = () => ({ PAPRIKA_EMAIL: 'e', PAPRIKA_PASSWORD: 'p', CALENDAR: kv({ paprika: JSON.stringify({ recipes: [{ uid: 'HAVE', title: 'Pancakes', source: 'https://x.test/p' }] }) }) });

test('saveToPaprika: the apps\' sequence: recipe with thumbnail, photo, recipe, notify; Kitchen Frame when the library has it', async () => {
  const calls = fakePaprika({ categories: [{ uid: 'KF', name: 'Kitchen Frame' }] });
  const r = await saveToPaprika(env(), recipe, { imageUrl: 'https://img.test/a.jpg' });
  assert.match(r.uid, /^[0-9A-F-]{36}$/);
  const paths = calls.filter((c) => c.path.startsWith('/api/v2')).map((c) => c.method + ' ' + c.path.replace(/[0-9A-F-]{36}/g, 'UID'));
  assert.deepEqual(paths, ['GET /api/v2/sync/categories/', 'POST /api/v2/sync/recipe/UID/', 'POST /api/v2/sync/photo/UID/', 'POST /api/v2/sync/recipe/UID/', 'POST /api/v2/sync/notify/']);
  const first = calls.filter((c) => c.path.includes('/recipe/'))[0];
  assert.equal(first.data.name, recipe.title);
  assert.deepEqual(first.data.categories, ['KF']);
  assert.match(first.data.hash, /^[0-9A-F]{64}$/);
  assert.match(first.data.photo, /\.jpg$/);
  assert.ok(first.photoBytes > 0); // the thumbnail rides with the first recipe post
  const photo = calls.find((c) => c.path.includes('/photo/'));
  assert.equal(photo.data.recipe_uid, first.data.uid);
  assert.ok(photo.photoBytes > 0);
});

test('saveToPaprika: no matching category means none; no photo means one recipe post; a duplicate is not re-saved', async () => {
  const calls = fakePaprika({ categories: [{ uid: 'B', name: 'Breakfast' }] });
  await saveToPaprika(env(), { ...recipe, source: '' });
  const paths = calls.filter((c) => c.path.startsWith('/api/v2')).map((c) => c.method + ' ' + c.path.replace(/[0-9A-F-]{36}/g, 'UID'));
  assert.deepEqual(paths, ['GET /api/v2/sync/categories/', 'POST /api/v2/sync/recipe/UID/', 'POST /api/v2/sync/notify/']);
  assert.deepEqual(calls.find((c) => c.path.includes('/recipe/')).data.categories, []);
  // A recipe whose own category the library has goes there instead.
  calls.length = 0;
  const calls2 = fakePaprika({ categories: [{ uid: 'KF', name: 'Kitchen Frame' }, { uid: 'SEA', name: 'Seafood' }, { uid: 'POU', name: 'Poultry' }] });
  await saveToPaprika(env(), { ...recipe, title: 'Prawn thing', source: '', category: 'Seafood' });
  assert.deepEqual(calls2.find((c) => c.path.includes('/recipe/')).data.categories, ['SEA']);
  calls2.length = 0;
  await saveToPaprika(env(), { ...recipe, title: 'Chicken thing', source: '', category: 'Chicken' }); // Explore's Chicken -> Poultry
  assert.deepEqual(calls2.find((c) => c.path.includes('/recipe/')).data.categories, ['POU']);
  calls.length = 0;
  const dup = await saveToPaprika(env(), { ...recipe, title: 'Pancakes', source: '' });
  assert.deepEqual(dup, { uid: 'HAVE', existing: true });
  assert.equal(calls.length, 0);
  assert.equal((await findInPaprika(env(), { title: 'x', source: 'https://x.test/p' })).uid, 'HAVE');
});
