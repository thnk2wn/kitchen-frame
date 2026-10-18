import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staples, isStaple, onList, unitOf, nice, tidy, merge, parseLines, align, echoes, mealGroceries } from './meal-groceries.js';

const set = staples();

test('staples: oil, salt, pepper and dried spices, however written; fresh herbs and garlic are not', () => {
  for (const s of ['Kosher salt', 'Freshly ground black pepper', 'Extra virgin olive oil', 'Ground cumin', 'Dried oregano', 'Chili flake', 'Crushed red pepper flakes']) assert.ok(isStaple(s, set), s);
  for (const s of ['Cilantro', 'Garlic', 'Ginger', 'Basil leaves', 'Butter']) assert.ok(!isStaple(s, set), s);
  assert.ok(isStaple('Fish sauce', staples({ PANTRY_STAPLES: 'fish sauce, soy sauce' })));
});

test('already on the list: singular or plural, amounts ignored', () => {
  assert.ok(onList('Lime', ['Limes']));
  assert.ok(onList('Tomatoes', ['tomato (2)']));
  assert.ok(!onList('Lime juice', ['Limes']));
});

test('units: spellings, word fractions, and non-measures counted whole', () => {
  assert.deepEqual(unitOf('Tbsp.').slice(0, 2), ['vol', 3]);
  assert.deepEqual(unitOf('tablespoons').slice(0, 2), ['vol', 3]);
  assert.deepEqual(unitOf('lbs').slice(0, 2), ['oz', 16]);
  assert.deepEqual(unitOf('half cup').slice(0, 2), ['vol', 24]);
  assert.equal(unitOf('count')[0], 'count');
  assert.equal(unitOf('medium')[0], 'count');
  assert.equal(unitOf('chopped')[0], 'count');
  assert.equal(unitOf('cloves')[0], 'other:clove');
  assert.equal(unitOf('bunches')[0], 'other:bunch');
});

test('nice fractions', () => {
  assert.equal(nice(0.5), '1/2');
  assert.equal(nice(1.25), '1 1/4');
  assert.equal(nice(0.33), '1/3');
  assert.equal(nice(2.97), '3');
});

test('citrus juice and zest become whole fruit', () => {
  assert.deepEqual(tidy({ name: 'Lime juice', qty: 2, unit: 'tbsp' }), { name: 'Lime', qty: 1, unit: '' });
  assert.equal(tidy({ name: 'Lemon', qty: 0.25, unit: 'cup' }).qty, 12 / 9);
  assert.deepEqual(tidy({ name: 'Lemon zest', qty: 1, unit: 'tsp' }), { name: 'Lemon', qty: 1, unit: '' });
  assert.deepEqual(tidy({ name: 'Lemon', qty: 2, unit: '' }), { name: 'Lemon', qty: 2, unit: '' });
  assert.equal(tidy({ name: 'Prawns', qty: 200, unit: 'g' }).name, 'Shrimp');
});

test('merge: sums like units, joins unlike ones, rounds counts up, drops staples, list and headings', () => {
  const items = merge([
    { name: 'Avocado', qty: 1, unit: '', recipe: 'A' },
    { name: 'Avocados', qty: 1, unit: 'count', recipe: 'B' },
    { name: 'Coconut milk', qty: 0.5, unit: 'cup', recipe: 'A' },
    { name: 'Coconut milk', qty: 4, unit: 'tbsp', recipe: 'B' },
    { name: 'Shrimp', qty: 1, unit: 'lb', recipe: 'A' },
    { name: 'Prawn', qty: 200, unit: 'g', recipe: 'B' },
    { name: 'Lemon', qty: 0.5, unit: '', recipe: 'A' },
    { name: 'Garlic', qty: 3, unit: 'cloves', recipe: 'A' },
    { name: 'Garlic', qty: 2, unit: 'clove', recipe: 'B', times: 2 },
    { name: 'Kosher salt', qty: 1, unit: 'tsp', recipe: 'A' },
    { name: 'Lime', qty: 1, unit: '', recipe: 'A' },
    { name: 'For serving', qty: 0, unit: '', recipe: 'A' },
    { name: 'Feta', qty: 0, unit: '', recipe: 'B' },
  ], set, ['Limes']);
  const by = Object.fromEntries(items.map((x) => [x.name, x]));
  assert.equal(by.Avocado.amount, '2');
  assert.deepEqual(by.Avocado.for, ['A', 'B']);
  assert.equal(by['Coconut milk'].amount, '3/4 cup');
  assert.equal(by.Shrimp.amount, '1 lb + 200 g');
  assert.equal(by.Lemon.amount, '1');
  assert.equal(by.Garlic.amount, '7 cloves');
  assert.equal(by.Feta.amount, '');
  assert.equal(items.length, 6); // no salt, lime (on the list) or heading
});

test('parseLines: bare fractions, thinking, and a cut-off answer', () => {
  const got = parseLines('<think>hmm</think>{"lines":[{"n":1,"src":"a","name":"X","qty":1/2,"unit":"cup"},{"n":2,"src":"b","name":"Y","qty":1 1/4,"unit":"lb"},{"n":3,"src":"c","na');
  assert.deepEqual(got.map((x) => [x.n, x.qty]), [[1, 0.5], [2, 1.25]]);
});

test('echoes: tidied copies match, other lines do not', () => {
  assert.ok(echoes('2 teaspoon garlic', '2 teaspoons garlic powder'));
  assert.ok(echoes('2 large chicken', '3 large chicken breasts'));
  assert.ok(!echoes('4 medium bell', '1 medium onion, chopped'));
});

test('align: readings whose numbers drifted go back to their own lines', () => {
  const lines = ['½ cup panko bread crumbs', '1 tablespoon minced ginger', '1 tablespoon minced garlic', '½ teaspoon kosher salt'].map((text, i) => ({ text, n: i + 1 }));
  const got = [
    { n: 2, src: '½ cup panko', name: 'Panko', qty: 0.5, unit: 'cup' },
    { n: 2, src: '1 tablespoon minced', name: 'Garlic', qty: 1, unit: 'tbsp' },
    { n: 3, src: '1 tablespoon minced', name: 'Ginger', qty: 1, unit: 'tbsp' },
    { n: 9, src: 'nothing like it', name: 'Ghost', qty: 1, unit: '' },
  ];
  const out = align(lines, got);
  assert.equal(out.get(1).name, 'Panko');
  assert.equal(out.get(2).name, 'Ginger');
  assert.equal(out.get(3).name, 'Garlic');
  assert.equal(out.size, 3);
});

test('mealGroceries: the week\'s recipes, unplanned meals named, one model call per chunk, kept a day', async () => {
  const kv = new Map();
  const recipes = [
    { uid: 'R1', id: 'pap:R1', title: 'Tacos', hash: 'h1', ingredients: [{ name: '1 lb ground beef' }, { name: '1 tsp cumin' }, { name: '1 avocado' }] },
    { uid: 'R2', id: 'pap:R2', title: 'Salad', hash: 'h2', ingredients: [{ name: '2 avocados, sliced' }] },
  ];
  const plan = { meals: [{ date: '2026-10-18', title: 'Tacos', recipe: 'R1' }, { date: '2026-10-19', title: 'Salad', recipe: 'R2' }, { date: '2026-10-20', title: 'Leftovers' }, { date: '2026-11-01', title: 'Salad', recipe: 'R2' }] };
  let calls = 0;
  const env = {
    PAPRIKA_EMAIL: 'x', PAPRIKA_PASSWORD: 'y',
    CALENDAR: {
      get: async (k, t) => { const v = k === 'paprika-meals' ? JSON.stringify(plan) : k === 'paprika' ? JSON.stringify({ recipes }) : kv.get(k); return v == null ? null : t === 'json' || t?.type === 'json' ? JSON.parse(v) : v; },
      put: async (k, v) => { kv.set(k, v); },
    },
    AI: { run: async (model, { messages }) => {
      calls++;
      const lines = messages[1].content.split('\n').filter((l) => /^\d+\. /.test(l));
      const read = { 'ground beef': ['Ground beef', 1, 'lb'], cumin: ['Cumin', 1, 'tsp'], avocado: ['Avocado', 1, ''], avocados: ['Avocado', 2, ''] };
      return { response: { lines: lines.map((l) => { const n = +l.split('.')[0], text = l.slice(l.indexOf(' ') + 1); const k = Object.keys(read).filter((w) => text.includes(w)).pop(); return { n, src: text.split(' ').slice(0, 3).join(' '), name: read[k][0], qty: read[k][1], unit: read[k][2] }; }) } };
    } },
  };
  const r = await mealGroceries(env, ['Milk'], { today: '2026-10-18' });
  assert.deepEqual(r.meals, ['Tacos', 'Salad']);
  assert.deepEqual(r.unplanned, ['Leftovers']);
  assert.deepEqual(r.items.map((x) => [x.name, x.amount]), [['Ground beef', '1 lb'], ['Avocado', '3']]);
  await mealGroceries(env, ['Milk'], { today: '2026-10-18' });
  assert.equal(calls, 1);
});
