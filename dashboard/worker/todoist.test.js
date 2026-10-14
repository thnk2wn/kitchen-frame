import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTasks } from './todoist.js';

test('Todoist priority and due time map to the frame, timed tasks in time order', () => {
  const items = sortTasks([
    { id: 'a', content: 'Pinned to a zone', due: { date: '2026-10-15', datetime: '2026-10-15T20:00:00Z' }, priority: 1, child_order: 1 },
    { id: 'b', content: 'Floating', due: { date: '2026-10-15', datetime: '2026-10-15T09:30:00' }, priority: 4, child_order: 2 },
    { id: 'c', content: 'All day', due: { date: '2026-10-15' }, priority: 2, child_order: 3 },
  ], 'todo');
  assert.deepEqual(items.map(({ content, time, priority }) => [content, time, priority]), [
    ['All day', undefined, 1],
    ['Floating', '09:30', 3],
    ['Pinned to a zone', '2026-10-15T20:00:00Z', undefined],
  ]);
});
