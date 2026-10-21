import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealRows } from './meals.js';

const meal = (type, title, id) => ({ type, title, ...(id ? { id } : {}) });

test('one row per meal type, in the plan’s order', () => {
  const rows = mealRows([meal('Dinner', 'Tacos', 'pap:1'), meal('Lunch', 'Soup'), meal('Dinner', 'Salad')]);
  assert.deepEqual(rows.map((r) => [r.type, r.title, r.more]), [['Dinner', 'Tacos + Salad', 0], ['Lunch', 'Soup', 0]]);
});

test('the recipe is the row’s dish even when a side is planned first', () => {
  const [r] = mealRows([meal('Dinner', 'Zucchini and squash side'), meal('Dinner', 'Grilled Chicken with Pumpkin-Seed Pesto', 'pap:2')]);
  assert.equal(r.main.id, 'pap:2');
  assert.equal(r.title, 'Grilled Chicken with Pumpkin-Seed Pesto');
  assert.equal(r.more, 1); // too long to join
});

test('a second recipe is counted, not joined, so it stays one tap away on Meals', () => {
  const [r] = mealRows([meal('Dinner', 'Tacos', 'pap:1'), meal('Dinner', 'Rice', 'pap:3')]);
  assert.deepEqual([r.title, r.more, r.main.id], ['Tacos', 1, 'pap:1']);
});

test('no recipe at all: the first is the dish', () => {
  const [r] = mealRows([meal('Dinner', 'Leftovers'), meal('Dinner', 'Bread')]);
  assert.deepEqual([r.title, r.more, r.main.id], ['Leftovers + Bread', 0, undefined]);
});

test('a joined side loses its leading "and"', () => {
  const [r] = mealRows([meal('Dinner', 'Easy Greek Red Lentil Soup', 'pap:4'), meal('Dinner', 'And a side salad')]);
  assert.equal(r.title, 'Easy Greek Red Lentil Soup + a side salad');
});

test('nothing planned: no rows', () => {
  assert.deepEqual(mealRows([]), []);
});
