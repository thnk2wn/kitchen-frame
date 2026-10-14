import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListBridge, viewOf } from './bridge.js';
import worker from './index.js';

// A ListBridge with in-memory storage, reached through a stub like env.BRIDGE.
function fakeBridge() {
  const data = new Map();
  const ctx = {
    storage: { get: async (k) => data.get(k), put: async (k, v) => { data.set(k, structuredClone(v)); } },
    getWebSockets: () => [],
    setWebSocketAutoResponse() {},
  };
  const obj = new ListBridge(ctx);
  return { data, ns: { idFromName: () => 'home', get: () => ({ fetch: (url, init) => obj.fetch(url instanceof Request ? url : new Request(url, init)) }) } };
}
const env = (b, extra = {}) => ({ DASHBOARD_KEY: 'k', BRIDGE_TOKEN: 'mac', GROCERIES_SOURCE: 'reminders', REMINDERS_GROCERIES_LIST: 'Groceries', BRIDGE: b.ns, ASSETS: { fetch: () => new Response('') }, ...extra });
const call = (e, path, init = {}, auth = 'k') => worker.fetch(new Request('https://frame.test' + path, { ...init, headers: { Authorization: 'Bearer ' + auth, ...(init.headers || {}) } }), e, { waitUntil() {} });

test('the Mac needs its own token and gets only the lists set to Reminders', async () => {
  const b = fakeBridge();
  assert.equal((await call(env(b), '/api/bridge/config', {}, 'k')).status, 401); // the frame's key won't do
  const r = await (await call(env(b), '/api/bridge/config', {}, 'mac')).json();
  assert.deepEqual(r, { lists: { groceries: 'Groceries' } }); // todo stays on Todoist
  assert.equal((await call(env(b, { BRIDGE_TOKEN: '' }), '/api/bridge/config', {}, '')).status, 401);
});

test('frame changes queue for the Mac; its next snapshot clears them', async () => {
  const b = fakeBridge(), e = env(b);
  const snap = (body) => call(e, '/api/bridge/snapshot', { method: 'POST', body: JSON.stringify(body) }, 'mac').then((r) => r.json());
  assert.deepEqual(await snap({ lists: { groceries: { name: 'Groceries', items: [{ id: 'r1', title: 'Milk' }, { id: 'r2', title: 'Eggs', due: '2026-10-15', note: 'dozen' }] } } }), { ops: [] });

  let view = await (await call(e, '/api/lists/groceries')).json();
  assert.deepEqual(view.items.map((i) => i.content), ['Milk', 'Eggs']);
  assert.equal(view.items[1].due, '2026-10-15');
  assert.equal(view.source, 'reminders');

  // Tick Milk, add bread (one) and two recipe ingredients (several).
  await call(e, '/api/lists/groceries/r1/done', { method: 'POST' });
  await call(e, '/api/lists/groceries', { method: 'POST', body: JSON.stringify({ content: 'Bread' }) });
  await call(e, '/api/lists/groceries', { method: 'POST', body: JSON.stringify({ items: [{ content: 'Shrimp', description: 'For: Bowls' }, { content: 'Limes' }] }) });
  view = await (await call(e, '/api/lists/groceries')).json();
  assert.deepEqual(view.items.map((i) => i.content), ['Eggs', 'Bread', 'Shrimp', 'Limes']); // shown at once
  assert.ok(view.items.slice(1).every((i) => i.pending));

  // Ticking a still-pending add just cancels it.
  const limes = view.items.find((i) => i.content === 'Limes');
  await call(e, '/api/lists/groceries/' + limes.id + '/done', { method: 'POST' });

  const { ops } = await snap({ lists: {} });
  assert.deepEqual(ops.map((o) => [o.type, o.itemId || o.content]), [['complete', 'r1'], ['add', 'Bread'], ['add', 'Shrimp']]);
  assert.equal(ops[2].description, 'For: Bowls');

  // The Mac applies them and reports back with the new list.
  const after = await snap({ applied: ops.map((o) => o.id), lists: { groceries: { name: 'Groceries', items: [{ id: 'r2', title: 'Eggs' }, { id: 'r3', title: 'Bread' }, { id: 'r4', title: 'Shrimp' }] } } });
  assert.deepEqual(after, { ops: [] });
  view = await (await call(e, '/api/lists/groceries')).json();
  assert.deepEqual(view.items.map((i) => [i.id, i.content]), [['r2', 'Eggs'], ['r3', 'Bread'], ['r4', 'Shrimp']]);
});

test('the frame is told when the Mac has not sent the list, or has gone quiet', () => {
  assert.equal(viewOf(undefined, [], 'groceries').waiting, true);
  const now = Date.parse('2026-10-14T12:00:00Z');
  const fresh = { name: 'G', items: [], at: '', seen: now - 5 * 60e3 };
  assert.equal(viewOf(fresh, [], 'groceries', now).stale, undefined);
  assert.equal(viewOf({ ...fresh, seen: now - 2 * 3600e3 }, [], 'groceries', now).stale, '2026-10-14T10:00:00.000Z');
});

test('lists not set to Reminders still go to Todoist', async () => {
  const b = fakeBridge();
  const r = await call(env(b, { TODOIST_TOKEN: '' }), '/api/lists/todo');
  assert.equal(r.status, 503); // Todoist path: "Add TODOIST_TOKEN"
});

test('priority and due time come through from the Mac, and adds carry a priority', async () => {
  const b = fakeBridge(), e = env(b, { TODO_SOURCE: 'reminders' });
  const snap = (body) => call(e, '/api/bridge/snapshot', { method: 'POST', body: JSON.stringify(body) }, 'mac').then((r) => r.json());
  await snap({ lists: { todo: { name: 'To Do', items: [
    { id: 'r1', title: 'Dentist', due: '2026-10-15', time: '16:30', priority: 3 },
    { id: 'r2', title: 'Gutters', time: '09:00', priority: 7 }, // a time without a day, and an out-of-range priority: dropped
  ] } } });
  await call(e, '/api/lists/todo', { method: 'POST', body: JSON.stringify({ content: 'Call plumber', priority: 2 }) });
  const view = await (await call(e, '/api/lists/todo')).json();
  assert.deepEqual(view.items.map(({ id, ...i }) => i), [
    { content: 'Dentist', due: '2026-10-15', time: '16:30', priority: 3 },
    { content: 'Gutters' },
    { content: 'Call plumber', priority: 2, pending: true },
  ]);
  const { ops } = await snap({ lists: {} });
  assert.equal(ops[0].priority, 2);
});

test('edits queue for the Mac, show at once, and merge until applied', async () => {
  const b = fakeBridge(), e = env(b, { TODO_SOURCE: 'reminders' });
  const snap = (body) => call(e, '/api/bridge/snapshot', { method: 'POST', body: JSON.stringify(body) }, 'mac').then((r) => r.json());
  await snap({ lists: { todo: { name: 'To Do', items: [{ id: 'r1', title: 'Dentist', priority: 3 }] } } });
  const edit = (id, body) => call(e, '/api/lists/todo/' + id, { method: 'POST', body: JSON.stringify(body) });
  await edit('r1', { content: 'Dentist at 4' });
  await edit('r1', { priority: 0 }); // merged with the title change; 0 clears the priority
  let view = await (await call(e, '/api/lists/todo')).json();
  assert.deepEqual(view.items.map(({ id, ...i }) => i), [{ content: 'Dentist at 4', pending: true }]);

  // An edit to an add the Mac hasn't made yet changes the queued add.
  await call(e, '/api/lists/todo', { method: 'POST', body: JSON.stringify({ content: 'Gutters', priority: 1 }) });
  view = await (await call(e, '/api/lists/todo')).json();
  await edit(view.items[1].id, { content: 'Clean gutters', priority: 3 });

  const { ops } = await snap({ lists: {} });
  assert.deepEqual(ops.map(({ type, itemId, content, priority }) => [type, itemId, content, priority]), [
    ['update', 'r1', 'Dentist at 4', 0],
    ['add', undefined, 'Clean gutters', 3],
  ]);
});

test('with REMINDERS_EXTRAS the Mac is asked for sections, flags and assignees, and they reach the frame', async () => {
  const b = fakeBridge(), e = env(b, { REMINDERS_EXTRAS: 'on' });
  assert.equal((await (await call(e, '/api/bridge/config', {}, 'mac')).json()).extras, true);
  assert.equal((await (await call(env(b), '/api/bridge/config', {}, 'mac')).json()).extras, undefined);
  await call(e, '/api/bridge/snapshot', { method: 'POST', body: JSON.stringify({ lists: { groceries: { name: 'Groceries',
    sections: ['Produce', 'Dairy', 'Bakery', 'Produce'],
    items: [{ id: 'r1', title: 'Milk', section: 'Dairy', flagged: true, assignee: 'Sam' }, { id: 'r2', title: 'Limes', section: 'Produce' }, { id: 'r3', title: 'Foil' }] } } }) }, 'mac');
  const view = await (await call(e, '/api/lists/groceries')).json();
  assert.deepEqual(view.sections, [{ id: 'Produce', name: 'Produce' }, { id: 'Dairy', name: 'Dairy' }]); // Bakery is empty
  assert.deepEqual(view.people, { Sam: 'Sam' });
  assert.deepEqual(view.items[0], { id: 'r1', content: 'Milk', section: 'Dairy', flagged: true, assignee: 'Sam' });
});
