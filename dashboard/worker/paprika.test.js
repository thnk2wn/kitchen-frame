import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPaprika, servingsOf, mealWindow } from './paprika.js';

test('Paprika free-text recipes become ingredients, steps and named categories', () => {
  const r = fromPaprika({
    uid: 'ABC-123', hash: 'h1', name: ' Blueberry Muffins ',
    ingredients: '2 cups flour\n\n1/2 cup sugar\r\n  1 egg  ',
    directions: '1. Preheat oven to 375F.\n2) Mix dry ingredients.\n\nStep 3: Bake 25 minutes.',
    categories: ['CAT-UID-1', 'Baking'], servings: '12 muffins', prep_time: '15 min', cook_time: '25 min',
    rating: 5, on_favorites: true, source: 'NYT Cooking', source_url: 'https://cooking.nytimes.com/x', photo_hash: 'p1',
    notes: '  We use half the sugar.  ', nutritional_info: 'Calories: 210', description: '',
  }, { 'CAT-UID-1': 'Breakfast' });
  assert.equal(r.id, 'pap:ABC-123');
  assert.equal(r.title, 'Blueberry Muffins');
  assert.deepEqual(r.ingredients.map((i) => i.name), ['2 cups flour', '1/2 cup sugar', '1 egg']);
  assert.deepEqual(r.steps, ['Preheat oven to 375F.', 'Mix dry ingredients.', 'Bake 25 minutes.']);
  assert.deepEqual(r.categories, ['Breakfast', 'Baking']);
  assert.equal(r.category, 'Breakfast');
  assert.equal(r.time, 'Prep 15 min, Cook 25 min');
  assert.equal(r.yield, "12 muffins");
  assert.equal(r.favorite, true);
  assert.equal(r.source, 'https://cooking.nytimes.com/x');
  assert.equal(r.notes, 'We use half the sugar.');
  assert.equal(r.nutrition, 'Calories: 210');
  assert.equal(r.description, undefined);
});

test('unknown category ids are dropped rather than shown', () => {
  const r = fromPaprika({ uid: 'X', name: 'Soup', categories: ['9E12FCF54A89FC52EA8E1C5DA1BDA62A6617ED8BDC2AEB6F291B93C7A399F6F6'] });
  assert.deepEqual(r.categories, []);
  assert.equal(r.category, undefined);
});

test('servings text becomes a number to show as "Serves N", or a yield', () => {
  assert.deepEqual(servingsOf('Yield: 4 servings'), { servings: '4' });
  assert.deepEqual(servingsOf('4-6'), { servings: '4-6' });
  assert.deepEqual(servingsOf('Serves 2'), { servings: '2' });
  assert.deepEqual(servingsOf('Yields: 4'), { servings: '4' });
  assert.deepEqual(servingsOf('12 muffins'), { yield: '12 muffins' });
  assert.deepEqual(servingsOf(''), {});
});

test('the meal plan is cut to a window around today and ordered by day and meal', () => {
  const types = [{ uid: 'D', name: 'Dinner' }, { uid: 'B', name: 'Breakfast' }];
  const meals = [
    { date: '2026-10-13 00:00:00', type_uid: 'D', name: 'Tacos', recipe_uid: 'R1', order_flag: 1 },
    { date: '2026-10-13 00:00:00', type_uid: 'B', name: 'Oatmeal', recipe_uid: null },
    { date: '2026-10-14 00:00:00', type: 2, type_uid: 'X', name: 'Leftovers', recipe_uid: null },
    { date: '2026-09-01 00:00:00', type_uid: 'D', name: 'Old', recipe_uid: null },
    { date: '2026-12-01 00:00:00', type_uid: 'D', name: 'Far', recipe_uid: null },
  ];
  assert.deepEqual(mealWindow(meals, types, '2026-10-13').map((m) => [m.date, m.type, m.title]), [
    ['2026-10-13', 'Breakfast', 'Oatmeal'], ['2026-10-13', 'Dinner', 'Tacos'], ['2026-10-14', 'Dinner', 'Leftovers'],
  ]);
});
