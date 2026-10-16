// Shared app state and the pollers that fill it. Each feed polls only while something on screen
// needs it (see start()), one request at a time, and unchanged results don't touch the screen.
import { api, cached, remember, changed, forget, mediaUrl } from './api.js';
import { dayKey, recipeTitle, setCalendarColors } from './format.js';
import { demoCalendar, demoList, demoMeta, demoMeals } from './demo.js';
import { DEMO_ROTATIONS } from './rotations.js';
import { ha } from './ha.svelte.js';
import { say, speaker, speak } from './announce.svelte.js';
import { timers } from './timers.svelte.js';
import { presence, presenceArea, onArrive } from './presence.svelte.js';
import { night, NIGHT_IDLE_MS, quietNow } from './night.svelte.js';

const MIN = 60 * 1000;
// Quiet hours (messages shown but not read aloud): the night hours from Settings (lib/night.svelte.js).
const quiet = () => quietNow();

// One request per feed at a time: a poll, a wake-up refresh and a tap share the request in flight.
const inflight = new Map();
function single(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}
const pref = (k, d) => { try { return localStorage.getItem('frame-' + k) || d; } catch { return d; } };
// ?demo=on|off is saved like the other settings; ?tab= opens a tab once (screenshots, setup links),
// and ?weather=<day> opens that day's weather sheet.
const q = new URLSearchParams(location.search);
if (q.get('demo') === 'on' || q.get('demo') === 'off') { try { localStorage.setItem('frame-demo', q.get('demo')); } catch {} }
const TAB_IDS = ['home', 'calendar', 'groceries', 'todo', 'recipes', 'music', 'house'];

// Settings live in localStorage so they survive reboots. ?theme= still works for ADB setup.
export const ui = $state({
  tab: TAB_IDS.includes(q.get('tab')) ? q.get('tab') : 'home', idle: false,
  // { id, title } for Recipes to open on arrival (a meal tapped on Home, or ?open=<recipe id>).
  openRecipe: q.get('open') ? { id: q.get('open'), title: '' } : null, theme: 'light', settingsOpen: q.has('settings'), // ?settings=<tab> opens Settings (screenshots)
  // Index into weather.data.days while its detail sheet is open (?weather=<n> opens it, for screenshots).
  noticesOpen: false,                        // the Home Assistant notices sheet (lib/notices.svelte.js)
  // The event whose details are showing ({ uid, start }); ?event=<uid> opens one, for screenshots.
  event: q.get('event') ? { uid: q.get('event'), start: null } : null,
  media: q.get('media') === 'tv' ? 'tv' : 'music', // the Media tab's view (?media=tv opens TV)
  // { list, id }: the list item whose sheet is open; ?task=<id> opens a task, for screenshots.
  task: q.get('task') ? { list: 'todo', id: q.get('task') } : null,
  weatherDay: /^[0-6]$/.test(q.get('weather') || '') ? Number(q.get('weather')) : null,
  themePref: pref('theme', 'auto'),          // auto | light | dark
  // Minutes untouched (and the room empty, with a presence area) before the clock screen; 0 = never.
  // 5 was the old default and is no longer offered, so it becomes 30.
  idleMinutes: Number(pref('idle', '30')) === 5 ? 30 : Number(pref('idle', '30')),
  recipeOpen: false,                         // a recipe page is showing (Recipes sets it); holds off the clock screen
  nightPhotos: pref('night-photos', 'on') === 'on', // slideshow after sunset (dimmed)
  demo: pref('demo', 'off') === 'on',          // sample data instead of real calendars, lists, photos
  clockColor: pref('clock-color', '#ffffff'),  // clock-screen text colour (dimmed at night)
  cameraRefresh: Number(pref('camera-refresh', '1')), // House camera pictures: minutes between refreshes; 0 = off
});
export const cameraRefresh = () => ui.cameraRefresh;
export function setSetting(key, value) {
  if (key === 'themePref') { ui.themePref = value; localStorage.setItem('frame-theme', value); applyTheme(); }
  if (key === 'idleMinutes') { ui.idleMinutes = value; localStorage.setItem('frame-idle', String(value)); rearmIdle(); }
  if (key === 'cameraRefresh') { ui.cameraRefresh = value; localStorage.setItem('frame-camera-refresh', String(value)); }
  if (key === 'clockColor') { ui.clockColor = value; localStorage.setItem('frame-clock-color', value); }
  if (key === 'nightPhotos') { ui.nightPhotos = value; localStorage.setItem('frame-night-photos', value ? 'on' : 'off'); }
  if (key === 'demo') {
    ui.demo = value;
    localStorage.setItem('frame-demo', value ? 'on' : 'off');
    lists.groceries.items = lists.todo.items = null; // demo lists are rebuilt fresh each time it's switched on
    forget('calendar', 'photos', 'todo', 'groceries', 'todo-meta', 'groceries-meta'); // real data must redraw
    loadCalendar(); loadList('todo'); loadList('groceries'); loadPhotos();
  }
}
export const clock = $state({ now: new Date() });
// In demo mode nothing real is shown at boot, even briefly, and nothing demo is cached as real.
export const calendar = $state({ data: null, raw: null, offline: false }); // filled by showCalendar below
export const weather = $state({ data: cached('weather'), error: null });
export const photos = $state({ items: ui.demo ? [] : cached('photos') || [] });
// Recipes saved by agents or from Explore (GET /api/recipes).
export const recipes = $state({ saved: cached('recipes') || null, error: null });
export function loadRecipes() {
  return single('recipes', async () => {
    try {
      const { recipes: list } = await api('/api/recipes');
      if (changed('recipes', list)) recipes.saved = list;
      recipes.error = null;
    } catch (err) { recipes.error = err.message; }
  });
}
// Paprika meal plan around today (GET /api/meals): [{ date, type, title, id?, hasImage? }].
export const meals = $state({ items: cached('meals') || [], configured: null });
// What the screen shows: the real plan, or an invented week in demo mode.
export const mealItems = () => (ui.demo ? demoMeals(clock.now) : meals.items);
export function loadMeals() {
  return single('meals', async () => {
    try {
      const data = await api('/api/meals');
      meals.configured = data.configured;
      if (changed('meals', data.meals)) meals.items = data.meals;
    } catch {}
  });
}

// Household rotations (GET /api/rotations; lib/rotations.js), shown on Home's Today card.
export const rotations = $state({ rules: cached('rotations') || [] });
export const rotationRules = () => (ui.demo ? DEMO_ROTATIONS : rotations.rules);
export function loadRotations() {
  return single('rotations', async () => {
    try {
      const data = await api('/api/rotations');
      if (changed('rotations', data.rotations)) rotations.rules = data.rotations;
    } catch {}
  });
}

// Our own recipes, synced read-only from Paprika by the Worker (GET /api/recipes/paprika).
// configured: null until the first answer, then whether the Worker has a Paprika account.
export const paprika = $state({ configured: cached('paprika')?.configured ?? null, recipes: cached('paprika')?.recipes || null, updated: cached('paprika')?.updated || null, error: null });
export function loadPaprika() {
  return single('paprika', async () => {
    try {
      const data = await api('/api/recipes/paprika');
      if (changed('paprika', data)) { paprika.configured = data.configured; paprika.recipes = data.recipes; paprika.updated = data.updated || null; }
      paprika.error = null;
    } catch (err) { paprika.error = err.message; }
  });
}
export async function saveRecipe(recipe) {
  const res = await api('/api/recipes', { method: 'POST', body: JSON.stringify({ ...recipe, ref: recipe.id }) });
  // Saved into Paprika: the Worker syncs the library right after, so pick that up (it takes a few seconds).
  if (res && res.paprika) { forget('paprika'); setTimeout(loadPaprika, 8000); setTimeout(loadPaprika, 25000); }
  else await loadRecipes();
  return res;
}
// Is this recipe already in the Paprika library? By source link, else by title (normalised).
export const plainTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an|with|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
export function inPaprika(recipe) {
  if (!recipe || ui.demo) return null;
  const list = paprika.recipes || [];
  const t = plainTitle(recipe.title);
  return list.find((r) => (recipe.source && r.source && r.source === recipe.source) || (t && plainTitle(r.title) === t)) || null;
}
export async function removeRecipe(id) {
  recipes.saved = (recipes.saved || []).filter((r) => r.id !== id);
  try { await api('/api/recipes/' + id, { method: 'DELETE' }); } catch {}
  loadRecipes();
}
// Recipe ingredients -> Todoist Grocery List, each noting which recipe it's for.
export async function addToGroceries(recipe, ingredients) {
  const items = ingredients.map((i) => ({ content: i.measure ? i.name + ' (' + i.measure + ')' : i.name, description: 'For: ' + recipeTitle(recipe.title) }));
  const added = ui.demo
    ? items.map((x, n) => ({ id: 'demo-r' + Date.now() + n }))
    : (await api('/api/lists/groceries', { method: 'POST', body: JSON.stringify({ items }) })).items;
  const list = lists.groceries;
  list.items = [...(list.items || []), ...added.map((a, n) => ({ id: a.id, content: items[n].content, note: items[n].description }))];
  if (!ui.demo) remember('groceries', list.items);
  return items.length;
}

// Messages posted by agents (POST /api/messages); shown full-screen until dismissed.
export const messages = $state({ items: [] });
export const lists = $state({
  // sections (Todoist order) and people (assignee id -> name) come with each list.
  groceries: { items: ui.demo ? demoList('groceries', new Date()) : cached('groceries'), error: null, ...(ui.demo ? demoMeta('groceries') : cached('groceries-meta') || { sections: [], people: {} }) },
  todo: { items: ui.demo ? demoList('todo', new Date()) : cached('todo'), error: null, ...(ui.demo ? demoMeta('todo') : cached('todo-meta') || { sections: [], people: {} }) },
});

// Calendars hidden on this device (Calendar tab → Calendars), by position in CALENDAR_URLS.
// calendar.raw is the whole feed; calendar.data is what the screens show, without hidden ones.
export const hiddenCals = $state({ set: new Set(JSON.parse(pref('hidden-cals', '[]'))) });
function showCalendar(raw) {
  setCalendarColors(raw && raw.colors); // before the data, so views re-render with the colours
  calendar.raw = raw;
  calendar.data = raw && hiddenCals.set.size ? { ...raw, events: raw.events.filter((e) => !hiddenCals.set.has(e.cal)) } : raw;
}
export function toggleCalendar(cal) {
  const set = new Set(hiddenCals.set);
  set.has(cal) ? set.delete(cal) : set.add(cal);
  hiddenCals.set = set;
  try { localStorage.setItem('frame-hidden-cals', JSON.stringify([...set])); } catch {}
  showCalendar(calendar.raw);
}
showCalendar(ui.demo ? demoCalendar(new Date()) : cached('calendar')); // last copy, at boot

// Events on calendars set to open (CALENDAR_DETAILS) can be tapped for their details and notes.
export const canOpen = (e) => !!(calendar.raw && calendar.raw.details && calendar.raw.details[e.cal]);
export const eventNotes = (e) => (calendar.raw && calendar.raw.notes && calendar.raw.notes[e.uid]) || '';
export function openEvent(e) { if (canOpen(e)) ui.event = { uid: e.uid, start: e.start }; }

// Display names for the show/hide list: the feed's own name, numbered when names repeat.
export function calendarNames() {
  const raw = calendar.raw;
  if (!raw) return [];
  const n = raw.calendars || 0;
  const base = Array.from({ length: n }, (_, i) => (raw.names && raw.names[i]) || 'Calendar ' + (i + 1));
  return base.map((name, i) => (base.filter((x) => x === name).length > 1 ? name + ' ' + (base.slice(0, i + 1).filter((x) => x === name).length) : name));
}

export function loadCalendar() {
  if (ui.demo) { showCalendar(demoCalendar(new Date())); calendar.offline = false; return Promise.resolve(); }
  return single('calendar', async () => {
    try {
      const data = await api('/api/calendar');
      if (changed('calendar', data)) showCalendar(data);
      calendar.offline = false;
    } catch (err) {
      calendar.offline = true;
    }
  });
}

function loadWeather() {
  return single('weather', async () => {
    try {
      const w = await api('/api/weather');
      if (w.error) throw new Error(w.error);
      if (changed('weather', w)) { weather.data = w; applyTheme(); }
      weather.error = null;
    } catch (err) {
      weather.error = err.message;
    }
  });
}

export function loadPhotos() {
  if (ui.demo) { photos.items = []; return Promise.resolve(); } // demo mode never shows family photos
  return single('photos', async () => {
    try {
      const items = (await api('/api/photos')).photos || [];
      if (changed('photos', items)) photos.items = items;
    } catch {}
  });
}

// The clock screen shows photos by day, and at night only if Settings allows it.
export const photosVisible = () => !night.active && (ui.theme !== 'dark' || ui.nightPhotos);

// Messages arrive over a WebSocket the moment they're posted or dismissed (worker/messages.js).
// A "ping" every 30 s keeps the connection open through routers and proves it's alive; the server
// answers "pong" without waking (WebSocket hibernation). While the socket is down the frame
// reconnects with backoff and polls once a minute, so nothing is missed.
const PING_MS = 30 * 1000;
let socketUp = false;
let retryMs = 1000;
function connectMessages() {
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + mediaUrl('/api/messages/live'));
  let alive = true, beat;
  ws.onopen = () => {
    socketUp = true;
    retryMs = 1000;
    beat = setInterval(() => { if (!alive) return ws.close(); alive = false; ws.send('ping'); }, PING_MS);
  };
  ws.onmessage = (e) => {
    alive = true;
    if (e.data === 'pong') return;
    try {
      const d = JSON.parse(e.data);
      // A command from the Worker (lib/checkin.js listens): e.g. "checkin" now.
      if (d.command) window.dispatchEvent(new CustomEvent('frame-command', { detail: d.command }));
      if (d.messages) showMessages(d.messages);
    } catch {}
  };
  ws.onclose = () => {
    if (socketUp) loadMessages(); // catch anything sent while it was closing
    socketUp = false;
    clearInterval(beat);
    setTimeout(connectMessages, retryMs);
    retryMs = Math.min(retryMs * 2, 60 * 1000);
  };
}

function loadMessages() {
  return single('messages', async () => {
    try { showMessages((await api('/api/messages')).messages); } catch {}
  });
}

function showMessages(list) {
  // Keep ones dismissed on this frame hidden even if the server copy is a moment behind.
  const items = (list || []).filter((m) => !dismissed.has(m.id));
  if (JSON.stringify(items) !== JSON.stringify(messages.items)) messages.items = items;
  announceNew(items);
}

// Read new messages aloud through Home Assistant, once each (remembered across reloads).
// Not in demo mode, not during quiet hours (10 PM-7 AM), not when a message says speak: false,
// and only while it's fresh (under 10 minutes old) so a late reconnect doesn't read old news.
let announced = null;
function announceNew(items) {
  if (announced === null) {
    const saved = localStorage.getItem('frame-announced');
    // First run of this feature: treat messages already on the frame as announced.
    announced = new Set(saved ? JSON.parse(saved) : items.map((m) => m.id));
    if (!saved) saveAnnounced();
  }
  if (ui.demo || !say.messages || !speaker() || ha.status !== 'connected' || quiet()) return;
  for (const m of items) {
    if (announced.has(m.id) || m.speak === false || Date.now() - Date.parse(m.at) > 10 * MIN) continue;
    const text = (m.from ? 'Message from ' + m.from + '. ' : '') + [m.title, m.body].filter(Boolean).join('. ');
    announced.add(m.id); // claim it now so the next poll doesn't repeat it
    speak(text, { kind: 'message' }).then(saveAnnounced, () => announced.delete(m.id));
  }
}
function saveAnnounced() {
  try { localStorage.setItem('frame-announced', JSON.stringify([...announced].slice(-100))); } catch {}
}
const dismissed = new Set();
export async function dismissMessage(m) {
  dismissed.add(m.id);
  messages.items = messages.items.filter((x) => x.id !== m.id);
  try { await api('/api/messages/' + m.id + '/dismiss', { method: 'POST' }); } catch {}
}

export function loadList(name) {
  if (ui.demo) {
    // Keep demo edits (ticks, additions) until demo mode is switched off and on again.
    if (!lists[name].items) lists[name].items = demoList(name, new Date());
    Object.assign(lists[name], demoMeta(name));
    lists[name].error = null;
    return Promise.resolve();
  }
  return single('list:' + name, async () => {
    try {
      const { items, sections = [], people = {}, project = '', source = 'todoist', waiting, stale } = await api('/api/lists/' + name);
      // Items ticked here but still in their undo window stay hidden.
      if (changed(name, items)) lists[name].items = items.filter((i) => !undos.some((u) => u.name === name && u.item.id === i.id));
      lists[name].source = source;
      if (changed(name + '-meta', { sections, people, project })) Object.assign(lists[name], { sections, people, project });
      lists[name].error = null;
      // A list from Apple Reminders comes through a Mac at home (docs/lists.md); say so when it's quiet.
      lists[name].warning = waiting ? 'Waiting for the Mac to send this Reminders list.'
        : stale ? 'The Mac last checked in ' + new Date(stale).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. Changes made here will reach Reminders when it’s back.' : null;
    } catch (err) {
      lists[name].error = err.message;
    }
  });
}

// Each list's order on Home and the Lists tab: as its source keeps it ("added": Reminders in the
// order items were added, tasks with dates first; Todoist's own order), or A–Z. Remembered per list.
const sortPref = (name) => { try { return localStorage.getItem('frame-sort-' + name) === 'az' ? 'az' : 'added'; } catch { return 'added'; } };
export const listSort = $state({ groceries: sortPref('groceries'), todo: sortPref('todo') });
export function setListSort(name, order) {
  listSort[name] = order;
  try { localStorage.setItem('frame-sort-' + name, order); } catch {}
}
export function sortList(name, items) {
  if (listSort[name] !== 'az') return items;
  return [...items].sort((a, b) => a.content.localeCompare(b.content, undefined, { sensitivity: 'base', numeric: true }));
}

// Optimistic: the row disappears on tap and comes back if Todoist refuses. The completion is only
// sent after UNDO_MS, while "Completed … · Undo" shows, so an accidental tap never reaches the list.
const UNDO_MS = 8000;
export const undos = $state([]); // { key, name, item, index }, newest last; the toast shows the newest

export function completeItem(name, item) {
  const list = lists[name];
  const index = list.items.findIndex((i) => i.id === item.id);
  list.items = list.items.filter((i) => i.id !== item.id);
  if (ui.task && ui.task.id === item.id) ui.task = null;
  const key = name + ':' + item.id + ':' + Date.now();
  undos.push({ key, name, item, index });
  setTimeout(() => commitDone(key), UNDO_MS);
}

export function undoComplete() {
  const u = undos.pop();
  if (!u) return;
  const items = [...(lists[u.name].items || [])];
  items.splice(Math.min(Math.max(u.index, 0), items.length), 0, u.item);
  lists[u.name].items = items;
}

async function commitDone(key) {
  const at = undos.findIndex((u) => u.key === key);
  if (at < 0) return; // undone
  const { name, item, index } = undos.splice(at, 1)[0];
  if (ui.demo) return; // demo: never touches Todoist
  const list = lists[name];
  try {
    await api('/api/lists/' + name + '/' + item.id + '/done', { method: 'POST' });
    remember(name, list.items);
  } catch (err) {
    const items = [...list.items];
    items.splice(Math.min(index, items.length), 0, item);
    list.items = items;
    list.error = 'Couldn’t complete “' + item.content + '”: ' + err.message;
  }
}

// An item's sheet saves a new title and/or priority (0 clears it). Shown at once, dimmed until the
// list's source confirms (the Reminders bridge applies it within seconds).
export async function editItem(name, item, changes) {
  const list = lists[name];
  const before = list.items.find((i) => i.id === item.id);
  if (!before) return false;
  const after = { ...before, ...changes };
  if (!after.priority) delete after.priority;
  const swap = (to) => { list.items = list.items.map((i) => (i.id === item.id ? to : i)); };
  if (ui.demo) { swap(after); return true; }
  swap({ ...after, pending: true });
  try {
    await api('/api/lists/' + name + '/' + encodeURIComponent(item.id), { method: 'POST', body: JSON.stringify(changes) });
    if (list.source === 'reminders') setTimeout(() => loadList(name), 6000);
    else swap(after);
    remember(name, list.items);
    return true;
  } catch (err) {
    swap(before);
    list.error = 'Couldn’t change “' + before.content + '”: ' + err.message;
    return false;
  }
}

// priority: 3 high, 2 medium, 1 low, 0 none.
export async function addItem(name, content, priority = 0) {
  const list = lists[name];
  const extra = priority ? { priority } : {};
  if (ui.demo) { list.items = [...(list.items || []), { id: 'demo-' + Date.now(), content, ...extra }]; return true; }
  // Shown at once, dimmed, until the list's source has it. Todoist answers with the new item; the
  // Reminders bridge with a queued one (still pending until the Mac creates it, a few seconds later).
  const temp = { id: 'local-' + Date.now(), content, ...extra, pending: true };
  list.items = [...(list.items || []), temp];
  try {
    const r = await api('/api/lists/' + name, { method: 'POST', body: JSON.stringify({ content, ...extra }) });
    const item = r.items ? r.items[0] : r;
    const added = { ...item, ...(String(item.id).startsWith('pending-') ? { pending: true } : {}) };
    list.items = list.items.map((i) => (i.id === temp.id ? added : i));
    remember(name, list.items);
    if (added.pending) setTimeout(() => loadList(name), 6000); // pick up the Mac's real item soon
    return true;
  } catch (err) {
    list.items = list.items.filter((i) => i.id !== temp.id);
    list.error = 'Couldn’t add “' + content + '”: ' + err.message;
    return false;
  }
}

// Runs fn now (if when() allows) and then every ms (a number, or a function for a varying gap).
// The next run is scheduled after the previous one finishes, so slow requests never stack up.
function every(ms, fn, when = () => true) {
  const run = async () => {
    try { if (when()) await fn(); } catch {}
    setTimeout(run, typeof ms === 'function' ? ms() : ms);
  };
  run();
}

// Light from sunrise to sunset, dark otherwise (7 AM / 7 PM until weather arrives).
// Pin it with ?theme=light or ?theme=dark; ?theme=auto goes back to following the sun.
const themeParam = new URLSearchParams(location.search).get('theme');
if (themeParam) { localStorage.setItem('frame-theme', themeParam); ui.themePref = themeParam; }

function applyTheme() {
  let dark;
  if (ui.themePref === 'light' || ui.themePref === 'dark') {
    dark = ui.themePref === 'dark';
  } else {
    const now = clock.now;
    const today = weather.data && weather.data.days.find((d) => d.date === dayKey(now));
    const at = (h) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h);
    const rise = today && today.sunrise ? new Date(today.sunrise) : at(7);
    const set = today && today.sunset ? new Date(today.sunset) : at(19);
    dark = now < rise || now >= set;
  }
  ui.theme = dark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', ui.theme);
}

export function start() {
  // Clock aligned to the minute boundary.
  (function tick() {
    clock.now = new Date();
    applyTheme();
    setTimeout(tick, MIN - (Date.now() % MIN) + 50);
  })();
  every(5 * MIN, loadCalendar);
  every(30 * MIN, loadMeals);
  every(60 * MIN, loadRotations);
  every(15 * MIN, loadWeather);
  // Both lists show on Home; each also has its own tab (App loads a list when its tab opens).
  every(MIN, () => loadList('todo'), () => !ui.idle);
  every(MIN, () => loadList('groceries'), () => !ui.idle && (ui.tab === 'groceries' || ui.tab === 'home'));
  // Photos: once at start (for the next slide), then while the clock screen is up and showing photos.
  let photosOnce = true;
  every(5 * MIN, () => { photosOnce = false; return loadPhotos(); }, () => photosOnce || (ui.idle && photosVisible()));
  // Messages: pushed over a WebSocket; polled once a minute only while it's down.
  connectMessages();
  every(MIN, loadMessages, () => !socketUp);

  // Idle: no touch for the chosen time -> ambient screen. Any touch wakes it back to Home.
  addEventListener('pointerdown', () => { lastTouch = Date.now(); }, { passive: true });
  every(30 * 1000, idleCheck);
  // With a presence area, someone walking in brings the dashboard back without a tap.
  // Someone arriving wakes the clock screen, except just after it was started with the play button:
  // whoever pressed it is standing right there, and the motion sensor would end it at once.
  // At night (Settings → Night) motion doesn't: someone passing through doesn't need the dashboard lit.
  onArrive(() => { if (ui.idle && !night.active && Date.now() > manualUntil) exitIdle(); });
  // Back on the clock screen if a new version reloaded the page from there.
  try { if (sessionStorage.getItem('frame-resume-idle')) { sessionStorage.removeItem('frame-resume-idle'); startSlideshow(); } } catch {}
  every(10 * MIN, checkForUpdate);
  every(MIN, reloadIfUpdated, () => updateReady);
}

// New deploys: the page's script is named after its content hash (assets/index-<hash>.js), so a
// different name in a fresh copy of the page means a new version. It loads at a quiet moment: on
// the clock screen, or after 10 minutes untouched, and never over a timer alert or the doorbell.
// Timers and settings live in localStorage, so they carry over.
let lastTouch = Date.now();
let updateReady = false;
const scriptName = (html) => (/assets\/(index-[\w-]+\.js)/.exec(html) || [])[1] || null;
async function checkForUpdate() {
  if (updateReady || import.meta.env.DEV) return;
  const mine = scriptName(document.documentElement.innerHTML);
  const res = await fetch('/', { cache: 'no-store' });
  const latest = res.ok ? scriptName(await res.text()) : null;
  if (mine && latest && latest !== mine) updateReady = true;
}
function reloadIfUpdated() {
  const quiet = ui.idle || Date.now() - lastTouch > 10 * MIN;
  if (!quiet || document.querySelector('[role="alertdialog"]')) return;
  try { if (ui.idle) sessionStorage.setItem('frame-resume-idle', '1'); sessionStorage.setItem('frame-reload-reason', 'update'); } catch {}
  location.reload();
}

// The clock screen comes on after idleMinutes without a touch, and, with a presence area (see
// presence.svelte.js), without a sensor in the room seeing anyone either. Never while a recipe is open or a
// timer is running: hands are busy then and the screen is in use.
function idleCheck() {
  if (ui.idle) return;
  if (ui.recipeOpen || timers.list.some((t) => !t.done)) return;
  // At night: two minutes after the last touch, whatever the motion sensors say.
  if (night.active) { if (Date.now() - lastTouch >= NIGHT_IDLE_MS) { ui.idle = true; ui.tab = 'home'; ui.settingsOpen = false; } return; }
  if (!ui.idleMinutes) return;
  const quietSince = Math.max(lastTouch, presenceArea() ? presence.lastSeen : 0);
  if (Date.now() - quietSince < ui.idleMinutes * MIN) return;
  ui.idle = true; ui.tab = 'home'; ui.settingsOpen = false; loadPhotos();
}
function rearmIdle() { lastTouch = Date.now(); } // a settings change counts as a touch

// Play button: show the clock screen / slideshow now. For MANUAL_MS, motion in the room doesn't end
// it (a tap still does).
const MANUAL_MS = 15 * MIN;
let manualUntil = 0;
export function startSlideshow() {
  manualUntil = Date.now() + MANUAL_MS;
  ui.settingsOpen = false;
  ui.tab = 'home';
  ui.idle = true;
  loadPhotos();
}

export function exitIdle() {
  ui.idle = false;
  loadList('todo');
  if (ui.tab === 'home' || ui.tab === 'groceries') loadList('groceries');
}
