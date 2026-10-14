// Shared app state and the pollers that fill it. Each feed polls only while something on screen
// needs it (see start()), one request at a time, and unchanged results don't touch the screen.
import { api, cached, remember, changed, forget, withKey } from './api.js';
import { dayKey, recipeTitle, setCalendarColors } from './format.js';
import { demoCalendar, demoList, demoMeta, demoMeals } from './demo.js';
import { ha, announce } from './ha.svelte.js';
import { timers } from './timers.svelte.js';
import { presence, presenceArea, onArrive } from './presence.svelte.js';

const MIN = 60 * 1000;
const QUIET_FROM = 22, QUIET_TO = 7; // quiet hours: messages are shown but not read aloud
const quiet = () => { const h = new Date().getHours(); return h >= QUIET_FROM || h < QUIET_TO; };

// One request per feed at a time: a poll, a wake-up refresh and a tap share the request in flight.
const inflight = new Map();
function single(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}
// Preferred speaker for reading messages aloud until one is picked in Settings; if Home Assistant
// has no such speaker, the first Music Assistant speaker is used instead (see announceTarget).
const DEFAULT_SPEAKER = 'media_player.kitchen_display';
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
  openRecipe: q.get('open') ? { id: q.get('open'), title: '' } : null, theme: 'light', settingsOpen: false,
  // Index into weather.data.days while its detail sheet is open (?weather=<n> opens it, for screenshots).
  noticesOpen: false,                        // the Home Assistant notices sheet (lib/notices.svelte.js)
  // The event whose details are showing ({ uid, start }); ?event=<uid> opens one, for screenshots.
  event: q.get('event') ? { uid: q.get('event'), start: null } : null,
  weatherDay: /^[0-6]$/.test(q.get('weather') || '') ? Number(q.get('weather')) : null,
  themePref: pref('theme', 'auto'),          // auto | light | dark
  // Minutes untouched (and the room empty, with a presence area) before the clock screen; 0 = never.
  // 5 was the old default and is no longer offered, so it becomes 30.
  idleMinutes: Number(pref('idle', '30')) === 5 ? 30 : Number(pref('idle', '30')),
  recipeOpen: false,                         // a recipe page is showing (Recipes sets it); holds off the clock screen
  nightPhotos: pref('night-photos', 'on') === 'on', // slideshow after sunset (dimmed)
  demo: pref('demo', 'off') === 'on',          // sample data instead of real calendars, lists, photos
  clockColor: pref('clock-color', '#ffffff'),  // clock-screen text colour (dimmed at night)
  announceOn: pref('announce', DEFAULT_SPEAKER), // speaker that reads messages aloud, or 'off'
});
export function setSetting(key, value) {
  if (key === 'themePref') { ui.themePref = value; localStorage.setItem('frame-theme', value); applyTheme(); }
  if (key === 'idleMinutes') { ui.idleMinutes = value; localStorage.setItem('frame-idle', String(value)); rearmIdle(); }
  if (key === 'announceOn') { ui.announceOn = value; localStorage.setItem('frame-announce', value); }
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

// Our own recipes, synced read-only from Paprika by the Worker (GET /api/recipes/paprika).
// configured: null until the first answer, then whether the Worker has a Paprika account.
export const paprika = $state({ configured: cached('paprika')?.configured ?? null, recipes: cached('paprika')?.recipes || null, error: null });
export function loadPaprika() {
  return single('paprika', async () => {
    try {
      const data = await api('/api/recipes/paprika');
      if (changed('paprika', data)) { paprika.configured = data.configured; paprika.recipes = data.recipes; }
      paprika.error = null;
    } catch (err) { paprika.error = err.message; }
  });
}
export async function saveRecipe(recipe) {
  const res = await api('/api/recipes', { method: 'POST', body: JSON.stringify({ ...recipe, ref: recipe.id }) });
  await loadRecipes();
  return res;
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
export const photosVisible = () => ui.theme !== 'dark' || ui.nightPhotos;

// Messages arrive over a WebSocket the moment they're posted or dismissed (worker/messages.js).
// A "ping" every 30 s keeps the connection open through routers and proves it's alive; the server
// answers "pong" without waking (WebSocket hibernation). While the socket is down the frame
// reconnects with backoff and polls once a minute, so nothing is missed.
const PING_MS = 30 * 1000;
let socketUp = false;
let retryMs = 1000;
function connectMessages() {
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + withKey('/api/messages/live'));
  let alive = true, beat;
  ws.onopen = () => {
    socketUp = true;
    retryMs = 1000;
    beat = setInterval(() => { if (!alive) return ws.close(); alive = false; ws.send('ping'); }, PING_MS);
  };
  ws.onmessage = (e) => {
    alive = true;
    if (e.data !== 'pong') { try { showMessages(JSON.parse(e.data).messages); } catch {} }
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
  const target = announceTarget();
  if (ui.demo || !target || ha.status !== 'connected' || quiet()) return;
  for (const m of items) {
    if (announced.has(m.id) || m.speak === false || Date.now() - Date.parse(m.at) > 10 * MIN) continue;
    const text = (m.from ? 'Message from ' + m.from + '. ' : '') + [m.title, m.body].filter(Boolean).join('. ');
    announced.add(m.id); // claim it now so the next poll doesn't repeat it
    announce(text.slice(0, 400), target.entity_id).then(saveAnnounced, () => announced.delete(m.id));
  }
}
// The speaker that reads messages aloud: the chosen one if Home Assistant has it, else the first
// speaker; null when read-aloud is off or there are no speakers.
export function announceTarget() {
  if (ui.announceOn === 'off') return null;
  return ha.players.find((p) => p.entity_id === ui.announceOn) || ha.players[0] || null;
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
      const { items, sections = [], people = {}, project = '', waiting, stale } = await api('/api/lists/' + name);
      if (changed(name, items)) lists[name].items = items;
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

// Optimistic: the row disappears on tap and comes back if Todoist refuses.
export async function completeItem(name, item) {
  const list = lists[name];
  list.items = list.items.filter((i) => i.id !== item.id);
  if (ui.demo) return; // demo: never touches Todoist
  try {
    await api('/api/lists/' + name + '/' + item.id + '/done', { method: 'POST' });
    remember(name, list.items);
  } catch (err) {
    list.items = [item, ...list.items];
    list.error = 'Couldn’t complete “' + item.content + '”: ' + err.message;
  }
}

export async function addItem(name, content) {
  const list = lists[name];
  if (ui.demo) { list.items = [...(list.items || []), { id: 'demo-' + Date.now(), content }]; return true; }
  try {
    const item = await api('/api/lists/' + name, { method: 'POST', body: JSON.stringify({ content }) });
    list.items = [...(list.items || []), item];
    remember(name, list.items);
    return true;
  } catch (err) {
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
  onArrive(() => { if (ui.idle) exitIdle(); });
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
  try { if (ui.idle) sessionStorage.setItem('frame-resume-idle', '1'); } catch {}
  location.reload();
}

// The clock screen comes on after idleMinutes without a touch, and, with a presence area (see
// presence.svelte.js), without a sensor in the room seeing anyone either. Never while a recipe is open or a
// timer is running: hands are busy then and the screen is in use.
function idleCheck() {
  if (ui.idle || !ui.idleMinutes) return;
  if (ui.recipeOpen || timers.list.some((t) => !t.done)) return;
  const quietSince = Math.max(lastTouch, presenceArea() ? presence.lastSeen : 0);
  if (Date.now() - quietSince < ui.idleMinutes * MIN) return;
  ui.idle = true; ui.tab = 'home'; ui.settingsOpen = false; loadPhotos();
}
function rearmIdle() { lastTouch = Date.now(); } // a settings change counts as a touch

// Play button: show the clock screen / slideshow now.
export function startSlideshow() {
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
