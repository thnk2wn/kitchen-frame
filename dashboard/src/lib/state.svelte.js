// Shared app state and the pollers that fill it. Each feed polls only while something on screen
// needs it (see start()), one request at a time, and unchanged results don't touch the screen.
import { loadFitness, refreshFitness } from './fitness.svelte.js';
import { api, cached, remember, changed, forget, mediaUrl } from './api.js';
import { loadPins, allowPerson } from './pin.svelte.js';
import { log } from './log.svelte.js';
import { dayKey, recipeTitle, setCalendarColors, formatDate } from './format.js';
import { demoCalendar, demoList, demoMeta, demoMeals } from './demo.js';
import { DEMO_ROTATIONS } from './rotations.js';
import { ha, haConfigured } from './ha.svelte.js';
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
const TAB_IDS = ['home', 'calendar', 'groceries', 'todo', 'recipes', 'music', 'house', 'fitness'];

// Settings live in localStorage so they survive reboots. ?theme= still works for ADB setup.
export const ui = $state({
  tab: TAB_IDS.includes(q.get('tab')) ? q.get('tab') : 'home', idle: false,
  // { id, title } for Recipes to open on arrival (a meal tapped on Home, or ?open=<recipe id>).
  openRecipe: q.get('open') ? { id: q.get('open'), title: '' } : null, openMeals: false, theme: 'light', settingsOpen: q.has('settings'), // ?settings=<tab> opens Settings (screenshots)
  // Index into weather.data.days while its detail sheet is open (?weather=<n> opens it, for screenshots).
  noticesOpen: false,                        // the Home Assistant notices sheet (lib/notices.svelte.js)
  // openMeals: Recipes opens on Meals once (Alexa's "what's for dinner" with several meals planned).
  // The event whose details are showing ({ uid, start }); ?event=<uid> opens one, for screenshots.
  event: q.get('event') ? { uid: q.get('event'), start: null } : null,
  media: ['tv', 'videos', 'podcasts'].includes(q.get('media')) ? q.get('media') : 'music', // the Media tab's view (?media=tv, videos or podcasts)
  // { list, id }: the list item whose sheet is open; ?task=<id> opens a task, for screenshots.
  task: q.get('task') ? { list: 'todo', id: q.get('task') } : null,
  weatherDay: /^[0-6]$/.test(q.get('weather') || '') ? Number(q.get('weather')) : null,
  themePref: pref('theme', 'auto'),          // auto | light | dark
  // Minutes untouched (and the room empty, with a presence area) before the clock screen; 0 = never.
  // 5 was the old default and is no longer offered, so it becomes 30.
  idleMinutes: Number(pref('idle', '30')) === 5 ? 30 : Number(pref('idle', '30')),
  recipeOpen: false,                         // a recipe page is showing (Recipes sets it); holds off the clock screen
  // Photos on the clock screen after sunset: 'auto' dims them only once the room is dark
  // (lib/roomlight.svelte.js; like 'on' without a light sensor), 'on' dims them from sunset, 'off'.
  nightPhotosMode: ['auto', 'on', 'off'].includes(pref('night-photos', 'auto')) ? pref('night-photos', 'auto') : 'auto',
  nightPhotos: pref('night-photos', 'auto') !== 'off', // shown at all after sunset (follows nightPhotosMode)
  photoDetails: pref('photo-details', 'off') === 'on', // each photo's date and place, small, on the slideshow
  slideVideos: pref('slide-videos', 'on') === 'on', // album videos play in the slideshow (muted); off: their stills
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
  if (key === 'nightPhotos') { ui.nightPhotosMode = value; ui.nightPhotos = value !== 'off'; localStorage.setItem('frame-night-photos', value); }
  if (key === 'slideVideos') { ui.slideVideos = value; localStorage.setItem('frame-slide-videos', value ? 'on' : 'off'); }
  if (key === 'photoDetails') { ui.photoDetails = value; localStorage.setItem('frame-photo-details', value ? 'on' : 'off'); }
  if (key === 'demo') {
    ui.demo = value;
    localStorage.setItem('frame-demo', value ? 'on' : 'off');
    lists.groceries.items = lists.todo.items = null; // demo lists are rebuilt fresh each time it's switched on
    forget('calendar', 'photos', 'todo', 'groceries', 'todo-meta', 'groceries-meta'); // real data must redraw
    loadCalendar(); loadList('todo'); loadList('groceries'); loadPhotos(); loadVideos();
    if (value) loadPaprika(); // demo meals are picked from the library
    import('./checkin.js').then((c) => c.reportDemo());
  }
}
export const clock = $state({ now: new Date() });
// In demo mode nothing real is shown at boot, even briefly, and nothing demo is cached as real.
export const calendar = $state({ data: null, raw: null, offline: false }); // filled by showCalendar below
export const weather = $state({ data: cached('weather'), error: null });
export const photos = $state({ items: ui.demo ? [] : cached('photos') || [], storage: null });

// The YouTube video playing, over every screen (components/YouTubePlayer.svelte): picked in Media →
// Videos, or shared from a phone. shared: it came without a tap here, so it starts muted.
export const nowVideo = $state({ list: null, index: 0, shared: false });

// YouTube videos for Media → Videos (worker/youtube.js): groups of chosen videos and playlists.
export const videos = $state({ groups: ui.demo && !haConfigured() ? [] : cached('youtube') || [] });
// When each video last played on this frame (id -> ms), for Videos' "recently played" order, and each
// group's order there (name -> 'recent' | 'az'). Kept on the frame.
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
export const videoPlays = $state(readJSON('frame-video-played'));
// A photo or video shared from a phone (worker/shared-media.js): { id, kind, title }, shown full screen
// by components/SharedMedia.svelte until closed.
export const sharedMedia = $state({ item: null });
export const videoSort = $state(readJSON('frame-video-sort'));
export function notePlay(id) {
  videoPlays[id] = Date.now();
  // The 300 most recent are plenty.
  const keep = Object.entries(videoPlays).sort((a, b) => b[1] - a[1]).slice(0, 300);
  try { localStorage.setItem('frame-video-played', JSON.stringify(Object.fromEntries(keep))); } catch {}
}
export function setVideoSort(group, how) {
  videoSort[group] = how;
  try { localStorage.setItem('frame-video-sort', JSON.stringify(videoSort)); } catch {}
}
export function loadVideos() {
  // Demo mode shows the real groups on a frame with Home Assistant (lib/demo-media.svelte.js renames
  // them), none without.
  if (ui.demo && !haConfigured()) { videos.groups = []; return Promise.resolve(); }
  return api('/api/youtube').then((d) => { const g = d.groups || []; if (changed('youtube', g)) videos.groups = g; }, () => {});
}
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
export const mealItems = () => (ui.demo ? demoMeals(clock.now, paprika.recipes) : meals.items);
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
  return (await addGroceries(items)).length;
}
// Several items onto Groceries at once ({ content, description }); returns them as added, for takeBack.
export async function addGroceries(items) {
  let added = [];
  if (ui.demo) added = items.map((x, n) => ({ id: 'demo-r' + Date.now() + n }));
  else for (let i = 0; i < items.length; i += 40) { // the Worker takes 40 at a time
    added = added.concat((await api('/api/lists/groceries', { method: 'POST', body: JSON.stringify({ items: items.slice(i, i + 40) }) })).items);
  }
  const list = lists.groceries;
  const made = added.map((a, n) => ({ id: a.id, content: items[n].content, note: items[n].description }));
  list.items = [...(list.items || []), ...made];
  if (!ui.demo) remember('groceries', list.items);
  return made;
}
// Undo for addGroceries: ticks those items off again. A Reminders item the Mac has created since has a
// new id, so after a fresh look at the list it's found by its words (and note) instead.
export async function takeBack(made) {
  const list = lists.groceries;
  if (!ui.demo) await loadList('groceries');
  const items = list.items || [];
  const gone = [];
  for (const m of made) {
    const it = items.find((i) => i.id === m.id) || items.find((i) => i.content === m.content && (i.note || '') === (m.note || '') && !gone.includes(i));
    if (it) gone.push(it);
  }
  list.items = items.filter((i) => !gone.includes(i));
  if (ui.demo) return gone.length;
  const failed = (await Promise.all(gone.map((i) => api('/api/lists/groceries/' + encodeURIComponent(i.id) + '/done', { method: 'POST' }).then(() => 0, () => 1)))).reduce((a, b) => a + b, 0);
  remember('groceries', list.items);
  if (failed) { list.error = 'Couldn’t take back ' + failed + ' item' + (failed > 1 ? 's' : ''); loadList('groceries'); }
  return gone.length - failed;
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
// The links the notes had (worker/calendar.js noteLinks): [{ label, url }], shown as QR codes.
export const eventLinks = (e) => (calendar.raw && calendar.raw.links && calendar.raw.links[e.uid]) || [];
// A calendar set to pin:<name> (CALENDAR_DETAILS) opens only after that person's PIN.
export const pinFor = (e) => (calendar.raw && calendar.raw.pins && calendar.raw.pins[e.cal]) || null;
export async function openEvent(e) {
  if (!canOpen(e)) return;
  const who = pinFor(e);
  if (who && !(await allowPerson(who, (calendarNames()[e.cal] || 'calendar') + ' event'))) return;
  ui.event = { uid: e.uid, start: e.start };
}

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
  // Demo mode never shows family photos: stock ones instead (worker/demo-photos.js), not cached as real.
  if (ui.demo) return single('demo-photos', () => api('/api/photos?demo').then((d) => { if (ui.demo) photos.items = d.photos || []; }, () => {}));
  return single('photos', async () => {
    try {
      const data = await api('/api/photos');
      const items = data.photos || [];
      if (ui.demo) return; // switched to demo while this was loading
      if (changed('photos', items)) photos.items = items;
      photos.storage = data.storage || null; // Cloudflare storage the album uses (through the Mac bridge)
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
      // A video shared from a phone: over whatever is showing, the clock screen included.
      if (d.command === 'play' && d.id) {
        if (ui.idle) exitIdle();
        sharedMedia.item = null;
        Object.assign(nowVideo, { list: [{ id: d.id, title: d.title || '' }], index: 0, shared: true });
        log('youtube.shared', { video: d.id });
      }
      // From Alexa (worker/alexa.js): show a tab, start the slideshow, wake, play a Videos group, timers.
      if (['show', 'wake', 'playgroup', 'recipe', 'meals', 'close', 'timer'].includes(d.command)) {
        lastTouch = Date.now(); // as if someone had tapped: the clock screen stays away a while
        if (ui.idle) exitIdle();
      }
      if (d.command === 'show') showTab(d.tab);
      if (d.command === 'slideshow') startSlideshow();
      if (d.command === 'playgroup') playGroup(d.group);
      // "Start a 10 minute pasta timer", "cancel the timer", "add a minute".
      // On Recipes a new timer joins the row along the bottom rather than covering the recipe.
      if (d.command === 'timer') import('./timers.svelte.js').then((m) => m.fromVoice(d, { full: ui.tab !== 'recipes' }));
      // "What's for dinner": tonight's recipe, or Recipes → Meals when there are several.
      if (d.command === 'recipe' && d.id) { ui.settingsOpen = false; ui.openRecipe = { id: d.id, title: d.title || '' }; ui.tab = 'recipes'; }
      if (d.command === 'meals') { ui.settingsOpen = false; ui.openMeals = true; ui.tab = 'recipes'; }
      // The Worker saw the Paprika meal plan change: fetch it now (Meals and Home's Today card).
      if (d.command === 'refresh' && d.what === 'meals') loadMeals();
      // A phone just sent its Activity rings (worker/fitness.js). KV can serve the old copy for up to a
      // minute after a write, so fetch again a minute later rather than waiting for the 10-minute poll.
      if (d.command === 'refresh' && d.what === 'fitness') { refreshFitness(); setTimeout(loadFitness, 70000); }
      // A phone set or cleared its owner's PIN (worker/devices.js).
      if (d.command === 'refresh' && d.what === 'pins') loadPins();
      // An Echo's podcast started, paused or ended (worker/podcast-audio.js).
      if (d.command === 'refresh' && d.what === 'podcast') import('./podcasts.svelte.js').then((m) => m.loadEchoNow());
      // "Hide notifications", "close that": whatever sheet is over the screen.
      if (d.command === 'media' && d.id) {
        lastTouch = Date.now();
        if (ui.idle) exitIdle();
        nowVideo.list = null; // one thing at a time: the newest share
        sharedMedia.item = { id: d.id, kind: d.kind, title: d.title || '', at: Date.now() };
        log('share.media', { kind: d.kind });
      }
      if (d.command === 'close') { sharedMedia.item = null; ui.noticesOpen = false; ui.settingsOpen = false; ui.event = null; ui.task = null; ui.weatherDay = null; }
      if (['show', 'slideshow', 'wake', 'playgroup', 'recipe', 'meals', 'close', 'timer'].includes(d.command)) log('alexa.command', { command: d.command, tab: d.tab, group: d.group, action: d.action });
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
        : stale ? 'The Mac last checked in ' + formatDate(new Date(stale), { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. Changes made here will reach Reminders when it’s back.' : null;
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
// One collator for every A–Z sort (localeCompare with options builds a new one per comparison).
const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export function sortList(name, items) {
  if (listSort[name] !== 'az') return items;
  return [...items].sort((a, b) => byName.compare(a.content, b.content));
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
  if (ui.demo) loadPaprika(); // demo meals are picked from the recipe library
  // Clock aligned to the minute boundary.
  (function tick() {
    clock.now = new Date();
    applyTheme();
    setTimeout(tick, MIN - (Date.now() % MIN) + 50);
  })();
  every(5 * MIN, loadCalendar);
  every(30 * MIN, loadMeals);
  every(60 * MIN, loadVideos);
  every(60 * MIN, loadRotations);
  every(10 * MIN, loadFitness); // the phones send when they have news; the Worker also says so (refresh)
  if (!ui.demo) { loadPins(); every(10 * MIN, loadPins); } // the household's PINs (lib/pin.svelte.js)
  if (!ui.demo) import('./podcasts.svelte.js').then((m) => m.loadEchoNow()); // a podcast already on an Echo
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
  if (!quiet || sharedMedia.item || document.querySelector('[role="alertdialog"]')) return;
  try { if (ui.idle) sessionStorage.setItem('frame-resume-idle', '1'); sessionStorage.setItem('frame-reload-reason', 'update'); } catch {}
  location.reload();
}

// The clock screen comes on after idleMinutes without a touch, and, with a presence area (see
// presence.svelte.js), without a sensor in the room seeing anyone either. Never while a recipe is open or a
// timer is running: hands are busy then and the screen is in use.
function idleCheck() {
  if (ui.idle) return;
  if (ui.recipeOpen || sharedMedia.item || timers.list.some((t) => !t.done)) return;
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

// Alexa's "show the calendar": a tab, one of Media's views (music, tv, videos), or the notices sheet.
function showTab(tab) {
  ui.settingsOpen = false;
  if (tab === 'notices') { ui.noticesOpen = true; return; }
  if (tab === 'music' || tab === 'tv' || tab === 'videos' || tab === 'podcasts') { ui.tab = 'music'; ui.media = tab; return; }
  if (TAB_IDS.includes(tab)) ui.tab = tab;
  if (tab === 'groceries' || tab === 'todo') loadList(tab); // an item just added by voice shows at once
  if (tab === 'fitness') loadFitness(); // "how's my fitness": the latest the phones sent
}
// Alexa's "play Sam's videos": the group, the ones least recently played here first.
function playGroup(name) {
  const g = videos.groups.find((x) => x.name === name);
  if (!g || !g.videos || !g.videos.length) return log('alexa.command', { command: 'playgroup', missing: name }, 'warn');
  const list = g.videos.map((v, i) => ({ v, i })).sort((a, b) => (videoPlays[a.v.id] || 0) - (videoPlays[b.v.id] || 0) || a.i - b.i).map((x) => x.v);
  Object.assign(nowVideo, { list, index: 0, shared: true });
}

export function exitIdle() {
  ui.idle = false;
  loadList('todo');
  if (ui.tab === 'home' || ui.tab === 'groceries') loadList('groceries');
}
