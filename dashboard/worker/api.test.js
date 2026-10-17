import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { shape } from './weather.js';
import { MessageRoom } from './messages.js';

// A MessageRoom behind a stand-in for the Durable Object namespace and its state.
function fakeRoom() {
  const data = new Map(), sockets = [], alarms = [];
  const ctx = {
    storage: { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => { data.set(k, structuredClone(v)); }, setAlarm: async (t) => alarms.push(t), deleteAlarm: async () => alarms.push(null) },
    getWebSockets: () => sockets,
    acceptWebSocket: (ws) => sockets.push(ws),
    setWebSocketAutoResponse() {},
  };
  const instance = new MessageRoom(ctx);
  return { ns: { idFromName: (n) => n, get: () => ({ fetch: (u, init) => instance.fetch(u instanceof Request ? u : new Request(u, init)) }) }, sockets, alarms, instance };
}

// Fake Todoist API: two pages of projects, tasks with subtasks and due dates.
let calls;
const projects = [
  { id: 'p1', name: 'Inbox' }, { id: 'p2', name: 'Groceries' }, { id: 'p3', name: 'To-do' },
];
const tasks = {
  p2: [
    { id: 't2', content: 'Eggs', child_order: 2 },
    { id: 't1', content: 'Milk', child_order: 1 },
    { id: 't3', content: 'Organic', parent_id: 't1', child_order: 1 },
  ],
  p3: [
    { id: 'a', content: 'No date', child_order: 1, section_id: 's2', responsible_uid: 7 },
    { id: 'b', content: 'Next week', due: { date: '2026-10-19' }, child_order: 2 },
    { id: 'c', content: 'Overdue', due: { date: '2026-10-01T09:00:00' }, child_order: 3 },
  ],
};
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method || 'GET', path: u.pathname, auth: init.headers?.Authorization, body: init.body });
    const page = (results, next = null) => Response.json({ results, next_cursor: next });
    if (u.pathname === '/api/v1/projects') {
      return u.searchParams.get('cursor') ? page(projects.slice(2)) : page(projects.slice(0, 2), 'c2');
    }
    if (u.pathname === '/api/v1/tasks' && init.method === 'POST') {
      return Response.json({ id: 'new', content: JSON.parse(init.body).content });
    }
    if (u.pathname === '/api/v1/tasks') return page(tasks[u.searchParams.get('project_id')]);
    if (u.pathname === '/api/v1/sections') return page(u.searchParams.get('project_id') === 'p3' ? [{ id: 's2', name: 'Later', section_order: 2 }, { id: 's1', name: 'Now', section_order: 1 }] : []);
    if (u.pathname === '/api/v1/projects/p3/collaborators') return page([{ id: 7, name: 'Alex Morgan' }, { id: 8, name: 'Sam Rivera' }]);
    if (/\/collaborators$/.test(u.pathname)) return new Response('not shared', { status: 400 });
    if (/\/close$/.test(u.pathname)) return new Response(null, { status: 204 });
    return new Response('nope', { status: 404 });
  };
});

const env = { DASHBOARD_KEY: 'k', TODOIST_TOKEN: 'tok', ASSETS: { fetch: () => new Response('asset') } };
const req = (path, init = {}) => worker.fetch(
  new Request('https://frame.test' + path, { ...init, headers: { Authorization: 'Bearer k', ...init.headers } }), env, { waitUntil() {} });

test('API calls need the dashboard key; assets do not', async () => {
  const res = await worker.fetch(new Request('https://frame.test/api/lists/todo'), env, {});
  assert.equal(res.status, 401);
  assert.equal(await (await worker.fetch(new Request('https://frame.test/'), env, {})).text(), 'asset');
});

test('groceries: project found across pages, Todoist order, subtasks hidden', async () => {
  const data = await (await req('/api/lists/groceries')).json();
  assert.deepEqual(data.items.map((i) => i.content), ['Milk', 'Eggs']);
  assert.deepEqual([data.sections, data.people], [[], {}]); // unshared, unsectioned project still works
  assert.equal(data.project, 'Groceries');
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
});

test('to-dos: dated first, overdue on top', async () => {
  const data = await (await req('/api/lists/todo')).json();
  assert.deepEqual(data.items.map((i) => [i.content, i.due]), [['Overdue', '2026-10-01'], ['Next week', '2026-10-19'], ['No date', undefined]]);
  assert.deepEqual(data.sections, [{ id: 's1', name: 'Now' }, { id: 's2', name: 'Later' }]); // Todoist order
  assert.deepEqual(data.people, { 7: 'Alex Morgan', 8: 'Sam Rivera' });
  assert.deepEqual([data.items[2].section, data.items[2].assignee], ['s2', '7']);
});

test('add and complete items', async () => {
  const added = await (await req('/api/lists/groceries', { method: 'POST', body: JSON.stringify({ content: '  Bread ' }) })).json();
  assert.deepEqual(added, { id: 'new', content: 'Bread' });
  assert.equal(JSON.parse(calls.find((c) => c.method === 'POST').body).project_id, 'p2');
  const done = await req('/api/lists/groceries/t1/done', { method: 'POST' });
  assert.equal(done.status, 200);
  assert.ok(calls.some((c) => c.path === '/api/v1/tasks/t1/close'));
});

test('unknown list and missing token', async () => {
  assert.equal((await req('/api/lists/chores')).status, 404);
  const res = await worker.fetch(new Request('https://frame.test/api/lists/todo', { headers: { Authorization: 'Bearer k' } }), { ...env, TODOIST_TOKEN: '' }, {});
  assert.equal(res.status, 503);
});

test('weather is reduced to what the screen shows', () => {
  const w = shape({
    current: { temperature_2m: 61.6, apparent_temperature: 59.2, weather_code: 3, is_day: 1, uv_index: 2.6 },
    daily: { time: ['2026-10-12'], temperature_2m_max: [68.4], temperature_2m_min: [50.5], precipitation_probability_max: [20], weather_code: [61], sunrise: ['2026-10-12T07:03'], sunset: ['2026-10-12T18:21'],
      precipitation_sum: [0.12], wind_speed_10m_max: [9.6], wind_gusts_10m_max: [21.2], wind_direction_10m_dominant: [225], uv_index_max: [5.4] },
    hourly: { time: ['2026-10-12T23:00', '2026-10-13T00:00'], temperature_2m: [55.4, 54], precipitation_probability: [10, 0], weather_code: [2, 0], is_day: [0, 0] },
  }, 'fahrenheit', {
    periods: [
      { name: 'This Afternoon', startTime: '2026-10-12T14:00:00-04:00', isDaytime: true, shortForecast: 'Cloudy', detailedForecast: 'Cloudy, with a high near 68.' },
      { name: 'Tonight', startTime: '2026-10-12T18:00:00-04:00', isDaytime: false, detailedForecast: 'Clear, with a low around 51.' },
      { name: 'Tuesday', startTime: '2026-10-13T06:00:00-04:00', isDaytime: true, detailedForecast: 'Sunny.' },
    ],
    alerts: [{ properties: { event: 'Heat Advisory', headline: 'Heat Advisory until 8 PM', severity: 'Moderate', ends: '2026-10-12T20:00:00-04:00', description: 'Hot.', instruction: 'Drink water.' } }],
  });
  assert.deepEqual({ ...w, updated: undefined }, {
    unit: 'F', temp: 62, feels: 59, code: 3, day: true, uvNow: 3, updated: undefined,
    days: [{
      date: '2026-10-12', hi: 68, lo: 51, rain: 20, code: 61, sunrise: '2026-10-12T07:03', sunset: '2026-10-12T18:21',
      precip: 0.12, wind: 10, gusts: 21, windDir: 'SW', uv: 5, short: 'Cloudy', shortNight: false,
      text: [{ name: 'This Afternoon', night: false, text: 'Cloudy, with a high near 68.' }, { name: 'Tonight', night: true, text: 'Clear, with a low around 51.' }],
      hours: [{ hour: 23, temp: 55, rain: 10, code: 2, day: false }],
    }],
    alerts: [{ event: 'Heat Advisory', headline: 'Heat Advisory until 8 PM', severity: 'Moderate', ends: '2026-10-12T20:00:00-04:00', text: 'Hot.\n\nDrink water.' }],
  });
});

test('weather without NWS (outside the US, or NWS down) has no text or alerts', () => {
  const w = shape({
    current: { temperature_2m: 20, apparent_temperature: 19, weather_code: 0, is_day: 1 },
    daily: { time: ['2026-10-12'], temperature_2m_max: [22], temperature_2m_min: [12], precipitation_probability_max: [null], weather_code: [0], sunrise: ['2026-10-12T07:03'], sunset: ['2026-10-12T18:21'] },
  }, 'celsius');
  assert.equal(w.unit, 'C');
  assert.deepEqual(w.alerts, []);
  assert.deepEqual([w.days[0].text, w.days[0].short, w.days[0].hours, w.days[0].rain, w.days[0].wind, w.days[0].windDir], [[], null, [], 0, null, null]);
});

test('stale calendar copy is served now and refreshed in the background', async () => {
  const stale = { updated: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), calendars: 1, errors: [], events: [] }; // cron fell behind
  const puts = [], waited = [];
  const kv = { get: async () => stale, put: async (k, v) => puts.push(JSON.parse(v)) };
  globalThis.fetch = async () => new Response('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:New\r\nDTSTART:' + new Date(Date.now() + 864e5).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z\r\nDTEND:' + new Date(Date.now() + 864e5 + 36e5).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z\r\nEND:VEVENT\r\nEND:VCALENDAR');
  const res = await worker.fetch(new Request('https://frame.test/api/calendar', { headers: { Authorization: 'Bearer k' } }),
    { ...env, CALENDAR: kv, CALENDAR_URLS: 'https://feed.test/a.ics' }, { waitUntil: (p) => waited.push(p) });
  assert.equal((await res.json()).events.length, 0); // served the stale copy immediately
  await Promise.all(waited);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].events.length, 1); // background refresh stored the new event
});

test('photos: album resolved anonymously, edited version preferred, videos skipped, images proxied', async () => {
  const calls = [];
  const store = new Map();
  const kv = {
    get: async (k, type) => (!store.has(k) ? null : type === 'json' ? JSON.parse(store.get(k)) : store.get(k)),
    put: async (k, v) => store.set(k, v),
  };
  const res = (url, w, h, type = 'public.jpeg') => ({ resJPEGMedRes: { value: { downloadURL: url } }, resJPEGMedWidth: { value: w }, resJPEGMedHeight: { value: h }, resJPEGMedFileType: { value: type }, resJPEGMedFingerprint: { value: 'fp' + w } });
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).includes('/records/resolve')) {
      assert.deepEqual(JSON.parse(init.body), { shortGUIDs: [{ value: 'TOKEN_1' }] });
      return Response.json({ results: [{ zoneID: { zoneName: 'SharedCollection-X' }, anonymousPublicAccess: { token: 'anon', databasePartition: 'https://p1-ckdatabasews.icloud.com:443' } }] });
    }
    if (String(url).includes('/shared/records/query')) {
      assert.match(String(url), /publicAccessAuthToken=anon/);
      return Response.json({ records: [
        { recordType: 'CPLMaster', recordName: 'M1', fields: res('https://cdn.test/m1/${f}', 2048, 1536) },
        { recordType: 'CPLAsset', recordName: 'A1', fields: { masterRef: { value: { recordName: 'M1' } }, assetDate: { value: 1 } } },
        { recordType: 'CPLMaster', recordName: 'M2', fields: res('https://cdn.test/m2/${f}', 2048, 1536) },
        { recordType: 'CPLAsset', recordName: 'A2', fields: { masterRef: { value: { recordName: 'M2' } }, ...res('https://cdn.test/edited/${f}', 1536, 2048) } },
        { recordType: 'CPLMaster', recordName: 'M3', fields: res('https://cdn.test/movie/${f}', 1920, 1080, 'com.apple.quicktime-movie') },
        { recordType: 'CPLAsset', recordName: 'A3', fields: { masterRef: { value: { recordName: 'M3' } } } },
      ] });
    }
    if (String(url).startsWith('https://cdn.test/')) return new Response('jpegbytes:' + url);
    return new Response('nope', { status: 404 });
  };
  const penv = { ...env, CALENDAR: kv, ALBUM_URL: 'https://photos.icloud.com/shared/album/TOKEN_1' };
  const list = await (await worker.fetch(new Request('https://frame.test/api/photos', { headers: { Authorization: 'Bearer k' } }), penv, {})).json();
  assert.equal(list.photos.length, 2);
  assert.ok(list.photos.every((p) => !('url' in p))); // Apple links never reach the frame
  assert.deepEqual(list.photos.map((p) => [p.w, p.h]), [[2048, 1536], [1536, 2048]]);
  // Image route: the edited version is served. A key in the URL is no longer accepted.
  assert.equal((await worker.fetch(new Request('https://frame.test/api/photos/' + list.photos[1].id + '?key=k'), penv, {})).status, 401);
  const img = await worker.fetch(new Request('https://frame.test/api/photos/' + list.photos[1].id, { headers: { Authorization: 'Bearer k' } }), penv, {});
  assert.equal(img.status, 200);
  assert.equal(await img.text(), 'jpegbytes:https://cdn.test/edited/photo.jpg');
  assert.match(img.headers.get('Cache-Control'), /immutable/);
  // Without the key: refused.
  assert.equal((await worker.fetch(new Request('https://frame.test/api/photos/' + list.photos[1].id), penv, {})).status, 401);
  // The image bytes are now kept in KV: a second request doesn't go back to iCloud.
  const beforeImg = calls.length;
  const again = await worker.fetch(new Request('https://frame.test/api/photos/' + list.photos[1].id, { headers: { Authorization: 'Bearer k' } }), penv, {});
  assert.equal(await again.text(), 'jpegbytes:https://cdn.test/edited/photo.jpg');
  assert.equal(calls.length, beforeImg);
  // A second list call within the cache window is served from KV.
  const before = calls.length;
  await worker.fetch(new Request('https://frame.test/api/photos', { headers: { Authorization: 'Bearer k' } }), penv, {});
  assert.equal(calls.length, before);
});

test('photos: small JPEG originals without a medium size are used as-is; large or HEIC originals are not', async () => {
  const { toPhotos } = await import('./photos.js');
  const orig = (w, h, type) => ({ resOriginalRes: { value: { downloadURL: 'https://cdn.test/o' + w + '/${f}' } }, resOriginalWidth: { value: w }, resOriginalHeight: { value: h }, resOriginalFileType: { value: type }, resOriginalFingerprint: { value: 'f' + w } });
  const recs = [
    { recordType: 'CPLMaster', recordName: 'M1', fields: orig(1024, 1535, 'public.jpeg') },
    { recordType: 'CPLAsset', recordName: 'A1', fields: { masterRef: { value: { recordName: 'M1' } } } },
    { recordType: 'CPLMaster', recordName: 'M2', fields: orig(4032, 3024, 'public.jpeg') },
    { recordType: 'CPLAsset', recordName: 'A2', fields: { masterRef: { value: { recordName: 'M2' } } } },
    { recordType: 'CPLMaster', recordName: 'M3', fields: orig(1024, 768, 'public.heic') },
    { recordType: 'CPLAsset', recordName: 'A3', fields: { masterRef: { value: { recordName: 'M3' } } } },
  ];
  assert.deepEqual(toPhotos(recs).map((p) => p.url), ['https://cdn.test/o1024/photo.jpg']);
});

test('messages: agents post with their own token only; frame lists and dismisses with its key', async () => {
  const menv = { ...env, MESSAGES: fakeRoom().ns, AGENT_TOKEN: 'agent' };
  const post = (body, auth = 'Bearer agent') => worker.fetch(new Request('https://frame.test/api/messages', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) }), menv, {});
  const frame = (path, method = 'GET') => worker.fetch(new Request('https://frame.test' + path, { method, headers: { Authorization: 'Bearer k' } }), menv, {});

  assert.equal((await post({ title: 'Hi' }, 'Bearer k')).status, 401);        // the frame key can't post
  assert.equal((await post({ title: 'Hi' }, 'Bearer wrong')).status, 401);
  assert.equal((await worker.fetch(new Request('https://frame.test/api/calendar', { headers: { Authorization: 'Bearer agent' } }), menv, {})).status, 401); // agent token reads nothing
  assert.equal((await post({})).status, 400);
  const created = await post({ title: '  Dinner is ready  ', body: 'Come down\r\nplease', from: 'Kitchen agent', ttl_minutes: 60 });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  await post({ body: 'x'.repeat(5000) });

  const { messages } = await (await frame('/api/messages')).json();
  assert.equal(messages.length, 2);
  assert.deepEqual([messages[0].title, messages[0].body, messages[0].from], ['Dinner is ready', 'Come down\nplease', 'Kitchen agent']);
  assert.ok(messages[0].expires > Date.now());
  assert.equal(messages[1].body.length, 2000);
  assert.equal(messages[0].speak, undefined); // speaks by default
  await post({ title: 'quiet', speak: false });
  assert.equal((await (await frame('/api/messages')).json()).messages.at(-1).speak, false);

  assert.equal((await frame('/api/messages/' + id + '/dismiss', 'POST')).status, 200);
  assert.equal((await (await frame('/api/messages')).json()).messages.length, 2); // the long one and 'quiet' remain

  for (let i = 0; i < 18; i++) await post({ title: 'spam ' + i });
  assert.equal((await post({ title: 'one too many' })).status, 429);
});

test('events from holiday feeds are marked; others are not', async () => {
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const ics = (name) => 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:' + name + '\r\nSUMMARY:' + name + '\r\nDTSTART;VALUE=DATE:' + day + '\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  globalThis.fetch = async (url) => new Response(ics(String(url).includes('holiday') ? 'Holiday' : 'Family'));
  const store = new Map();
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
  const cenv = { ...env, CALENDAR: kv, CALENDAR_URLS: 'https://family.test/a.ics https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics' };
  const { events } = await (await worker.fetch(new Request('https://frame.test/api/calendar?refresh', { headers: { Authorization: 'Bearer k' } }), cenv, { waitUntil() {} })).json();
  assert.deepEqual(events.map((e) => [e.title, !!e.holiday]).sort(), [['Family', false], ['Holiday', true]]);
});

test('recipes: explore normalizes TheMealDB; saved via agent or frame; image stored; groceries bulk add with description', async () => {
  const store = new Map(), meta = new Map(), calls = [];
  const kv = {
    get: async (k, opt) => { if (!store.has(k)) return null; const t = typeof opt === 'string' ? opt : opt && opt.type; return t === 'json' ? JSON.parse(store.get(k)) : store.get(k); },
    getWithMetadata: async (k) => ({ value: store.get(k) || null, metadata: meta.get(k) || null }),
    put: async (k, v, o) => { store.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); },
    delete: async (k) => { store.delete(k); },
  };
  const meal = { idMeal: '1', strMeal: 'Fried Rice', strMealThumb: 'https://img.test/r.jpg', strCategory: 'Chicken', strArea: 'Chinese',
    strInstructions: 'STEP 1. Cook rice.\r\n\r\n2) Fry it.', strIngredient1: 'Rice', strMeasure1: '2 cups', strIngredient2: ' ', strIngredient3: 'Egg', strMeasure3: '1' };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push([init.method || 'GET', u, init.body]);
    if (u.includes('lookup.php')) return Response.json({ meals: [meal] });
    if (u.includes('filter.php')) return Response.json({ meals: [{ idMeal: '1', strMeal: 'Fried Rice', strMealThumb: 'https://img.test/r.jpg' }] });
    if (u.startsWith('https://img.test/')) return new Response('jpg', { headers: { 'Content-Type': 'image/jpeg' } });
    if (u.endsWith('/api/v1/projects')) return Response.json({ results: [{ id: 'p2', name: 'Groceries' }], next_cursor: null });
    if (u.endsWith('/api/v1/tasks') && init.method === 'POST') { const b = JSON.parse(init.body); return Response.json({ id: 't-' + b.content, content: b.content }); }
    return new Response('nope', { status: 404 });
  };
  const renv = { ...env, CALENDAR: kv, AGENT_TOKEN: 'agent' };
  const call = (path, init = {}, auth = 'Bearer k') => worker.fetch(new Request('https://frame.test' + path, { ...init, headers: { Authorization: auth } }), renv, { waitUntil() {} });

  const { recipe } = await (await call('/api/recipes/explore?id=mdb:1')).json();
  assert.deepEqual([recipe.id, recipe.thumb, recipe.ingredients, recipe.steps], ['mdb:1', 'https://img.test/r.jpg/medium', [{ name: 'Rice', measure: '2 cups' }, { name: 'Egg', measure: '1' }], ['Cook rice.', 'Fry it.']]);
  assert.equal((await (await call('/api/recipes/explore?c=Chicken')).json()).recipes[0].title, 'Fried Rice');

  // Agent token can save recipes, but still can't read anything.
  const saved = await call('/api/recipes', { method: 'POST', body: JSON.stringify({ title: 'Tacos', ingredients: ['Tortillas', { name: 'Beef', measure: '1 lb' }], steps: ['Cook.'], image: 'https://img.test/t.jpg', from: 'Claude' }) }, 'Bearer agent');
  assert.equal(saved.status, 201);
  const { id } = await saved.json();
  assert.equal((await call('/api/recipes', {}, 'Bearer agent')).status, 401);
  assert.equal((await call('/api/recipes', { method: 'POST', body: '{}' }, 'Bearer agent')).status, 400);
  // Frame saves from Explore; saving the same one twice doesn't duplicate.
  assert.equal((await call('/api/recipes', { method: 'POST', body: JSON.stringify({ ...recipe, ref: recipe.id }) })).status, 201);
  assert.equal((await (await call('/api/recipes', { method: 'POST', body: JSON.stringify({ ...recipe, ref: recipe.id }) })).json()).existing, true);
  const { recipes } = await (await call('/api/recipes')).json();
  assert.deepEqual(recipes.map((r) => [r.title, !!r.hasImage]), [['Fried Rice', true], ['Tacos', true]]);
  assert.equal(await (await call('/api/recipes/' + id + '/image')).text(), 'jpg');
  assert.equal((await call('/api/recipes/' + id + '/image?key=k', {}, '')).status, 401);
  assert.equal((await call('/api/recipes/' + id + '/image', {}, '')).status, 401);
  await call('/api/recipes/' + id, { method: 'DELETE' });
  assert.equal((await (await call('/api/recipes')).json()).recipes.length, 1);
  assert.equal(store.has('recipe-image:' + id), false);

  // Ingredients to groceries in one request, each with the recipe in its description.
  const added = await (await call('/api/lists/groceries', { method: 'POST', body: JSON.stringify({ items: [{ content: 'Rice (2 cups)', description: 'For: Fried Rice' }, { content: 'Egg', description: 'For: Fried Rice' }] }) })).json();
  assert.equal(added.items.length, 2);
  const posts = calls.filter(([m, u]) => m === 'POST' && u.endsWith('/api/v1/tasks')).map(([, , b]) => JSON.parse(b));
  assert.deepEqual(posts.map((b) => [b.content, b.description]), [['Rice (2 cups)', 'For: Fried Rice'], ['Egg', 'For: Fried Rice']]);
});

test('recipes: vegetarian and vegan are left out of Explore and Surprise me', async () => {
  const picks = ['Vegetarian', 'Vegan', 'Beef'];
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url); seen.push(u);
    if (u.includes('random.php')) { const c = picks.shift(); return Response.json({ meals: [{ idMeal: c, strMeal: c + ' dish', strCategory: c }] }); }
    return Response.json({ meals: [{ idMeal: '9', strMeal: 'X', strMealThumb: 'https://img.test/x.jpg' }] });
  };
  const call = (path) => worker.fetch(new Request('https://frame.test' + path, { headers: { Authorization: 'Bearer k' } }), env, { waitUntil() {} });
  const { recipe } = await (await call('/api/recipes/explore?random=1')).json();
  assert.equal(recipe.category, 'Beef');
  assert.deepEqual(await (await call('/api/recipes/explore?c=Vegan')).json(), { recipes: [] });
  assert.ok(!seen.some((u) => u.includes('c=Vegan')));
});

test('list items carry the first line of their description as a short note', async () => {
  const { sortTasks } = await import('./todoist.js');
  const items = sortTasks([
    { id: '1', content: 'Rice', description: 'For: Beef Mandi', child_order: 1 },
    { id: '2', content: 'Milk', description: '\n  Whole, not 2%  \nSecond line', child_order: 2 },
    { id: '3', content: 'Eggs', description: '', child_order: 3 },
    { id: '4', content: 'Long', description: 'x'.repeat(200), child_order: 4 },
  ], 'groceries');
  assert.deepEqual(items.map((i) => i.note), ['For: Beef Mandi', 'Whole, not 2%', undefined, 'x'.repeat(119) + '…']);
});

test('calendar cron writes KV only when events change, or hourly', async () => {
  const feed = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  globalThis.fetch = async () => new Response(feed);
  const run = async (stored) => {
    const puts = [];
    const kv = { get: async () => stored, put: async (k, v) => puts.push(v) };
    await worker.scheduled({ cron: '*/10 * * * *' }, { ...env, CALENDAR: kv, CALENDAR_URLS: 'https://feed.test/a.ics' });
    return puts.length;
  };
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  assert.equal(await run({ updated: ago(20), calendars: 1, names: [null], errors: [], events: [] }), 0); // unchanged, recent
  assert.equal(await run({ updated: ago(90), calendars: 1, errors: [], events: [] }), 1); // unchanged, hourly heartbeat
  assert.equal(await run({ updated: ago(5), calendars: 1, errors: [], events: [{ uid: 'gone' }] }), 1); // changed
  assert.equal(await run(null), 1); // first run
});

test('messages: posts and dismissals are pushed to connected frames at once; expiry sets an alarm', async () => {
  const r = fakeRoom();
  const sent = [];
  r.sockets.push({ send: (t) => sent.push(JSON.parse(t)) }); // a connected frame
  const menv = { ...env, MESSAGES: r.ns, AGENT_TOKEN: 'agent' };
  const res = await worker.fetch(new Request('https://frame.test/api/messages', { method: 'POST', headers: { Authorization: 'Bearer agent' }, body: JSON.stringify({ title: 'Hi', ttl_minutes: 5 }) }), menv, {});
  const { id } = await res.json();
  assert.deepEqual(sent.at(-1).messages.map((m) => m.title), ['Hi']);
  assert.ok(r.alarms.at(-1) > Date.now()); // wakes to remove it when it expires
  await worker.fetch(new Request('https://frame.test/api/messages/' + id + '/dismiss', { method: 'POST', headers: { Authorization: 'Bearer k' } }), menv, {});
  assert.deepEqual(sent.at(-1).messages, []);
  assert.equal(r.alarms.at(-1), null);
  // The socket route needs the frame's key (or its cookie) and a WebSocket upgrade; not a key in the URL.
  assert.equal((await worker.fetch(new Request('https://frame.test/api/messages/live?key=k'), menv, {})).status, 401);
  assert.equal((await worker.fetch(new Request('https://frame.test/api/messages/live', { headers: { Authorization: 'Bearer k' } }), menv, {})).status, 426);
});

import { classicToken, pickDerivative } from './photos.js';
test('classic shared album links and the size picked for each photo', () => {
  assert.equal(classicToken('https://www.icloud.com/sharedalbum/#B0aGWZuqDGh2xyz'), 'B0aGWZuqDGh2xyz');
  assert.equal(classicToken('https://www.icloud.com/sharedalbum/#D0abcdefghij-K_lm'), 'D0abcdefghij-K_lm');
  assert.equal(classicToken('https://photos.icloud.com/shared/album/abc'), null);
  const photo = { derivatives: { 342: { checksum: 's', width: '342', height: '256' }, 2049: { checksum: 'l', width: '2049', height: '1536' }, 4032: { checksum: 'o', width: '4032', height: '3024' } } };
  assert.equal(pickDerivative(photo).checksum, 'l');
  const video = { mediaAssetType: 'video', derivatives: { PosterFrame: { checksum: 'p', width: '1280', height: '720' }, '720p': { checksum: 'v', width: '1280', height: '720' } } };
  assert.equal(pickDerivative(video).checksum, 'p');
});

test('calendar details: notes stored only for calendars allowed to open them', async () => {
  const at = (h) => new Date(Date.now() + h * 36e5).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const feed = (uid) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + uid, 'DTSTART:' + at(24), 'DTEND:' + at(25), 'DESCRIPTION:Notes for ' + uid, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  globalThis.fetch = async (url) => new Response(feed(String(url).includes('work') ? 'meeting' : 'game'));
  const run = async (extra) => {
    const puts = [];
    const kv = { get: async () => null, put: async (k, v) => puts.push(JSON.parse(v)) };
    await worker.scheduled({ cron: '*/10 * * * *' }, { ...env, CALENDAR: kv, CALENDAR_URLS: 'https://feed.test/work.ics https://feed.test/games.ics', ...extra });
    return puts[0];
  };
  const on = await run({ CALENDAR_DETAILS: 'no, yes' });
  assert.deepEqual(on.details, [false, true]);
  assert.deepEqual(on.notes, { game: 'Notes for game' }); // the work meeting's notes were never kept
  assert.ok(on.events.every((e) => !('notes' in e)));
  const off = await run({});
  assert.equal(off.details, undefined);
  assert.equal(off.notes, undefined);
});

test('notices: the frame reports ended notices and reads back the last 24 hours, newest first', async () => {
  const store = new Map();
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
  const nenv = { ...env, CALENDAR: kv, NOTICES_KEEP_MAX: '3' };
  const call = (method, body) => worker.fetch(new Request('https://frame.test/api/notices', { method, headers: { Authorization: 'Bearer k' }, ...(body ? { body: JSON.stringify(body) } : {}) }), nenv, {});
  const now = Date.now(), ago = (h) => new Date(now - h * 3600000).toISOString();
  const add = (id, endedHoursAgo, extra = {}) => call('POST', { id, title: id, tone: 'alert', created: ago(endedHoursAgo + 1), ended: ago(endedHoursAgo), how: 'dismissed', ...extra });

  assert.equal((await worker.fetch(new Request('https://frame.test/api/notices'), nenv, {})).status, 401);
  assert.equal((await call('POST', { title: 'no id' })).status, 400);
  await add('old', 30);            // outside 24 hours
  await add('a', 3);
  await add('b', 1);
  await add('b', 1, { tone: 'nonsense', how: 'whatever' }); // the same one again: kept once, the latest report
  await add('c', 2);
  await add('d', 4);               // the fourth inside the window: over NOTICES_KEEP_MAX
  const got = await (await call('GET')).json();
  assert.deepEqual(got.items.map((n) => n.id), ['b', 'c', 'a']);
  assert.deepEqual([got.keepHours, got.keepMax, got.infoHours], [24, 3, 24]);
  assert.equal(got.items[0].tone, 'warn');      // unknown values fall back
  assert.equal(got.items[0].how, 'cleared');
});

test('frame: the kiosk checks in and backs up its settings; secrets and odd keys are not kept', async () => {
  const store = new Map();
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
  const fenv = { ...env, CALENDAR: kv };
  const call = (path, method = 'GET', body) => worker.fetch(new Request('https://frame.test' + path, { method, headers: { Authorization: 'Bearer k' }, ...(body ? { body: JSON.stringify(body) } : {}) }), fenv, {});
  assert.equal((await worker.fetch(new Request('https://frame.test/api/frame/status'), fenv, {})).status, 401);
  assert.deepEqual(await (await call('/api/frame/settings')).json(), { settings: {}, savedAt: null });
  await call('/api/frame/status', 'POST', { version: 'abc123', screen: 'clock', settings: { 'frame-theme': 'dark', 'not-ours': 'x', 'frame-night': '{"on":true}', 'frame-n': 5 } });
  const st = await (await call('/api/frame/status')).json();
  assert.deepEqual([st.version, st.screen], ['abc123', 'clock']);
  assert.ok(st.receivedAt);
  assert.deepEqual((await (await call('/api/frame/settings')).json()).settings, { 'frame-theme': 'dark', 'frame-night': '{"on":true}' });
  await call('/api/frame/status', 'POST', { version: 'abc124' }); // a check-in without settings keeps the backup
  assert.equal((await (await call('/api/frame/settings')).json()).settings['frame-theme'], 'dark');
});

test('frame: events from the check-in are logged and the last ones kept with the status', async () => {
  const store = new Map();
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
  const fenv = { ...env, CALENDAR: kv };
  const post = (body) => worker.fetch(new Request('https://frame.test/api/frame/status', { method: 'POST', headers: { Authorization: 'Bearer k' }, body: JSON.stringify(body) }), fenv, {});
  const logged = [], orig = console.warn; console.warn = (x) => logged.push(x);
  await post({ version: 'a', events: [{ t: '2026-10-15T12:00:00Z', event: 'ha.disconnected', level: 'warn' }, { nope: 1 }] });
  console.warn = orig;
  await post({ version: 'b' }); // no events: the log is kept
  await post({ version: 'c', events: [{ t: '2026-10-15T12:05:00Z', event: 'ha.connected', downFor: '42 s', 'bad key': 'x', big: 'y'.repeat(500) }] });
  const st = await (await worker.fetch(new Request('https://frame.test/api/frame/status', { headers: { Authorization: 'Bearer k' } }), fenv, {})).json();
  assert.deepEqual(st.log.map((e) => e.event), ['ha.disconnected', 'ha.connected']);
  assert.equal(st.log[1].big.length, 300);
  assert.equal(st.log[1]['bad key'], undefined);
  assert.equal(st.log[1].level, 'info');
  assert.equal(logged[0].source, 'frame');
  assert.equal(logged[0].message, 'frame ha.disconnected');
});

test('auth cookie: a request with the key gets it; images then load with it, without the key in the URL', async () => {
  const call = (path, headers = {}) => worker.fetch(new Request('https://frame.test' + path, { headers }), { ...env, ALBUM_URL: '' }, {});
  const first = await call('/api/photos', { Authorization: 'Bearer k' });
  const set = first.headers.get('Set-Cookie');
  assert.match(set, /^frame_auth=[\w-]+; Path=\/api; .*HttpOnly; Secure; SameSite=Strict/);
  assert.ok(!set.includes('=k;'));                      // a fingerprint of the key, not the key
  const cookie = set.split(';')[0];
  assert.equal((await call('/api/photos', { Authorization: 'Bearer k', Cookie: cookie })).headers.get('Set-Cookie'), null); // already set
  assert.notEqual((await call('/api/tiles/1/1/1', { Cookie: cookie })).status, 401);   // a media path: allowed
  assert.equal((await call('/api/calendar', { Cookie: cookie })).status, 401);         // not a media path: the key is still needed
  assert.equal((await call('/api/tiles/1/1/1', { Cookie: 'frame_auth=forged' })).status, 401);
});

test('ops summary: needs the key; counts and health, not content; keeps a day of check-ins', async () => {
  const store = new Map([['calendar', JSON.stringify({ updated: '2026-10-15T12:00:00Z', names: ['Family'], errors: [], events: [{ cal: 0, title: 'Secret dinner' }, { cal: 0, title: 'x' }] })]]);
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
  const oenv = { ...env, CALENDAR: kv };
  const call = (path, method = 'GET', body) => worker.fetch(new Request('https://frame.test' + path, { method, headers: { Authorization: 'Bearer k' }, ...(body ? { body: JSON.stringify(body) } : {}) }), oenv, {});
  assert.equal((await worker.fetch(new Request('https://frame.test/api/ops/summary'), oenv, {})).status, 401);
  await call('/api/frame/status', 'POST', { version: 'a', screen: 'clock', ha: 'connected' });
  await call('/api/frame/status', 'POST', { version: 'a', screen: 'awake', ha: 'connected' });
  const s = await (await call('/api/ops/summary')).json();
  assert.deepEqual(s.frame.history.map((h) => h.screen), ['clock', 'awake']);
  assert.deepEqual(s.calendar.events, { 0: 2 });
  assert.ok(!JSON.stringify(s).includes('Secret dinner'));
});

test('no DASHBOARD_KEY set: the API is refused, unless local development allows it', async () => {
  const { DASHBOARD_KEY, ...nokey } = env;
  assert.equal((await worker.fetch(new Request('https://frame.test/api/weather'), nokey, {})).status, 401);
  assert.notEqual((await worker.fetch(new Request('https://frame.test/api/frame/settings'), { ...nokey, ALLOW_NO_KEY: '1', CALENDAR: { get: async () => null } }, {})).status, 401);
});

import { settingsChanges } from './frame.js';
test('settings changes: in words, nested JSON flattened, automatic ones and the PIN hash left out', () => {
  assert.deepEqual(settingsChanges(
    { 'frame-night': '{"on":true,"from":"22:00"}', 'frame-theme': 'auto', 'frame-notices-seen': '1', 'frame-unlock-pin': 'h1' },
    { 'frame-night': '{"on":false,"from":"22:00"}', 'frame-theme': 'auto', 'frame-notices-seen': '2', 'frame-unlock-pin': 'h2', 'frame-tv': 'media_player.tv' }),
  ['frame-night.on: true → false', 'frame-tv: set to "media_player.tv"', 'frame-unlock-pin: changed']);
  assert.deepEqual(settingsChanges({ 'frame-unlock-pin': 'h' }, {}), ['frame-unlock-pin: removed']);
});

test('settings: a change a person made is logged and the version before it kept; automatic ones are not', async () => {
  const store = new Map();
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
  const fenv = { ...env, CALENDAR: kv };
  const call = (path, body) => worker.fetch(new Request('https://frame.test' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer k' }, ...(body ? { body: JSON.stringify(body) } : {}) }), fenv, {});
  const orig = console.log; console.log = () => {};
  await call('/api/frame/status', { version: 'a', settings: { 'frame-theme': 'auto', 'frame-notices-seen': '1' } });
  await call('/api/frame/status', { version: 'a', settings: { 'frame-theme': 'auto', 'frame-notices-seen': '2' } });
  await call('/api/frame/status', { version: 'a', settings: { 'frame-theme': 'dark', 'frame-notices-seen': '2' } });
  console.log = orig;
  const st = await (await call('/api/frame/status')).json();
  assert.deepEqual(st.log.map((e) => [e.event, e.changes]), [['settings.changed', 'frame-theme: "auto" → "dark"']]);
  const versions = await (await call('/api/frame/settings?history')).json();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].settings['frame-theme'], 'auto');
  assert.deepEqual(versions[0].changes, ['frame-theme: "auto" → "dark"']);
  assert.equal((await (await call('/api/frame/settings')).json()).settings['frame-theme'], 'dark');
});

import { iemFrames } from './radar.js';
test('radar: the last hour of NEXRAD, now, then HRRR steps counted from its run', () => {
  const now = Date.parse('2026-10-16T01:30:00Z'), valid = Date.parse('2026-10-16T01:25:00Z'), init = Date.parse('2026-10-15T23:00:00Z');
  const f = iemFrames(valid, init, now);
  assert.deepEqual(f.map((x) => x.kind), ['past', 'past', 'past', 'past', 'past', 'now', 'forecast', 'forecast', 'forecast', 'forecast']);
  assert.match(f[0].url, /nexrad-n0q-900913-m50m\/\{z\}\/\{x\}\/\{y\}\.png\?v=/);
  assert.equal(new Date(f[0].time).toISOString(), '2026-10-16T00:35:00.000Z');
  assert.match(f[6].url, /hrrr::REFD-F0180-0\//); // 02:00Z: 3 hours into the 23Z run
  assert.equal(new Date(f[6].time).toISOString(), '2026-10-16T02:00:00.000Z');
  assert.match(f[9].url, /REFD-F0270-0/);
  assert.equal(iemFrames(valid, NaN, now).length, 6); // no HRRR: past and now only
});
