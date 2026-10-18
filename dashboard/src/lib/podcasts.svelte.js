// Media → Podcasts: the Apple Podcasts library, through the Mac bridge and the Worker
// (worker/podcasts.js), played on the frame from the episode's own audio link.
//
// One <audio> for the whole app, outside any view, so an episode keeps playing on other tabs. Where it
// starts: wherever this frame or the phone stopped, whichever was later (the phone's place comes with
// the library; the frame's is kept here). The frame's own listening doesn't reach the phone.
import { api, cached, changed } from './api.js';
import { ha, send, callService } from './ha.svelte.js';
import { log } from './log.svelte.js';

export const podcasts = $state({ configured: null, shows: cached('podcasts') || [] });
export function loadPodcasts() {
  return api('/api/podcasts').then((d) => {
    podcasts.configured = !!d.configured;
    const shows = d.shows || [];
    if (changed('podcasts', shows)) podcasts.shows = shows;
  }, () => {});
}

// Half-played episodes from every show, latest first: the Continue row.
export function inProgress(shows, mine) {
  const out = [];
  for (const s of shows) for (const e of s.episodes || []) {
    const here = mine[e.id];
    const pos = startAt(e, here);
    if (pos > 30 && !(here && here.done)) out.push({ show: s, ep: e, at: Math.max(Date.parse(e.touched || 0) || 0, here ? here.at : 0) });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}

// Where this frame stopped each episode: id -> { pos, at, done? }. The 200 most recent are kept.
const POS_KEY = 'frame-podcast-positions';
export const positions = $state((() => { try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch { return {}; } })());
function remember(id, pos, done = false) {
  positions[id] = { pos: Math.round(pos), at: Date.now(), ...(done ? { done: true } : {}) };
  const keep = Object.entries(positions).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
  try { localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(keep))); } catch {}
}
// Seconds in to start from: the frame's place or the phone's, whichever was set later.
export function startAt(ep, here = positions[ep.id]) {
  const phone = ep.position || 0, phoneAt = Date.parse(ep.touched || 0) || 0;
  if (here && here.at > phoneAt) return here.done ? 0 : here.pos;
  return ep.played ? 0 : phone;
}

export const pod = $state({ show: null, ep: null, playing: false, loading: false, position: 0, duration: 0, error: null,
  volume: Number(localStorage.getItem('frame-podcast-volume')) || 70 });
let audio = null;
let lastSaved = 0;
function player() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = pod.volume / 100;
  audio.addEventListener('timeupdate', () => {
    pod.position = audio.currentTime;
    if (pod.ep && Date.now() - lastSaved > 15000) { lastSaved = Date.now(); remember(pod.ep.id, audio.currentTime); }
  });
  audio.addEventListener('durationchange', () => { if (Number.isFinite(audio.duration)) pod.duration = audio.duration; });
  audio.addEventListener('playing', () => { pod.playing = true; pod.loading = false; });
  audio.addEventListener('waiting', () => { pod.loading = true; });
  audio.addEventListener('pause', () => { pod.playing = false; if (pod.ep) remember(pod.ep.id, audio.currentTime); });
  audio.addEventListener('ended', () => { pod.playing = false; if (pod.ep) remember(pod.ep.id, 0, true); });
  audio.addEventListener('error', () => {
    pod.playing = false; pod.loading = false;
    pod.error = 'This episode wouldn’t play here.';
    log('podcast.error', { code: audio.error && audio.error.code }, 'warn');
  });
  return audio;
}

// A tap on an episode: play it (from where it was left), or pause/resume the one already playing.
export function playEpisode(show, ep) {
  const a = player();
  if (pod.ep && pod.ep.id === ep.id) return toggle();
  if (pod.ep) remember(pod.ep.id, a.currentTime);
  Object.assign(pod, { show, ep, playing: false, loading: true, position: startAt(ep), duration: ep.seconds || 0, error: null });
  a.src = ep.url;
  const from = startAt(ep);
  const seekThere = () => { a.removeEventListener('loadedmetadata', seekThere); if (from > 0) a.currentTime = from; };
  a.addEventListener('loadedmetadata', seekThere);
  a.play().catch((e) => { pod.loading = false; pod.error = e.message; });
  log('podcast.play', { from: Math.round(from) });
}
export function toggle() {
  if (!audio || !pod.ep) return;
  if (audio.paused) audio.play().catch((e) => (pod.error = e.message)); else audio.pause();
}
export function skip(sec) { if (audio && pod.ep) audio.currentTime = Math.max(0, Math.min((pod.duration || 1e9) - 1, audio.currentTime + sec)); }
export function seekTo(frac) { if (audio && pod.duration) audio.currentTime = Math.max(0, Math.min(1, frac)) * pod.duration; }
export function setVolume(v) {
  pod.volume = Math.max(0, Math.min(100, v));
  if (audio) audio.volume = pod.volume / 100;
  try { localStorage.setItem('frame-podcast-volume', String(pod.volume)); } catch {}
}
export function stopPodcast() {
  if (!audio) return;
  if (pod.ep) remember(pod.ep.id, audio.currentTime);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  Object.assign(pod, { show: null, ep: null, playing: false, loading: false, position: 0, duration: 0, error: null });
}

// ---- On an Echo (worker/podcast-audio.js): the frame hands the Worker the episode and its place, then
// asks the Echo, through Home Assistant's Alexa Devices integration, "ask Kitchen Frame to play my
// podcast"; the skill streams it there. What the Echo is doing comes back from the Worker.
const SKILL = 'kitchen frame'; // the skill's invocation name (docs/alexa.md)
export const echo = $state({ list: [], target: localStorage.getItem('frame-podcast-speaker') || 'frame', now: null, error: null, starting: false, busy: false });
let devices = null; // media_player entity -> its Alexa device id
export async function loadEchos() {
  if (!devices) {
    try {
      const reg = (await send({ type: 'config/entity_registry/list_for_display' })).entities || [];
      devices = new Map(reg.filter((e) => e.pl === 'alexa_devices' && e.di && String(e.ei).startsWith('media_player.')).map((e) => [e.ei, e.di]));
    } catch { devices = new Map(); }
  }
  echo.list = ha.players.filter((p) => devices.has(p.entity_id)).map((p) => ({ id: p.entity_id, name: p.friendly_name || p.label }));
  if (echo.target !== 'frame' && !echo.list.some((e) => e.id === echo.target)) echo.target = 'frame';
}
export function setTarget(id) { echo.target = id; try { localStorage.setItem('frame-podcast-speaker', id); } catch {} }
const say = (words) => callService('alexa_devices', 'send_text_command', { device_id: devices.get(echo.target), text_command: words });

export async function playOnEcho(show, ep) {
  if (echo.starting || echo.busy) return;
  echo.error = null; echo.starting = true;
  if (audio && pod.ep) { remember(pod.ep.id, audio.currentTime); audio.pause(); }
  const from = pod.ep && pod.ep.id === ep.id && audio ? audio.currentTime : startAt(ep);
  Object.assign(pod, { show, ep, playing: false, loading: false, position: from, duration: ep.seconds || 0, error: null });
  echo.now = { episode: { id: ep.id, title: ep.title }, position: from, state: 'starting' };
  try {
    await api('/api/podcasts/cast', { method: 'POST', body: JSON.stringify({ episode: ep, show: { title: show.title, art: show.art }, position: from }) });
    await say('ask ' + SKILL + ' to play my podcast');
    log('podcast.echo', { from: Math.round(from) });
    watchEcho();
  } catch (e) { echo.error = 'Couldn’t start it on the Echo: ' + e.message; echo.now = null; }
  finally { echo.starting = false; }
}
// Pause, resume and stop go to the skill by name ("ask Kitchen Frame to pause"), never a bare "resume",
// which would restart whatever the Echo last played (Spotify, say). One at a time; the bar changes at
// once and then follows what Alexa reports.
export async function echoCommand(what) {
  if (echo.busy || echo.starting || !echo.now) return;
  echo.busy = true; echo.error = null;
  const was = echo.now.state;
  echo.now = { ...echo.now, state: what === 'resume' ? 'starting' : 'paused' };
  try {
    await say('ask ' + SKILL + ' to ' + (what === 'stop' ? 'pause' : what));
    if (what === 'stop') { echo.now = null; Object.assign(pod, { show: null, ep: null, position: 0, duration: 0 }); clearInterval(watching); }
    else watchEcho();
  } catch (e) { echo.error = e.message; echo.now = { ...echo.now, state: was }; }
  finally { echo.busy = false; }
}
async function checkEcho() {
  try {
    const now = (await api('/api/podcasts/now')).now;
    // Keep "starting" until Alexa reports this episode playing (or failing).
    if (now && echo.now && echo.now.state === 'starting' && now.episode && now.episode.id === echo.now.episode.id && now.state === 'starting') return;
    if (echo.now) echo.now = now;
  } catch {}
}
// After a tap: every 2 s for half a minute, then every 15 s while something is on the Echo.
let watching = null;
function watchEcho() {
  clearInterval(watching);
  let n = 0;
  const tick = () => {
    checkEcho();
    if (++n === 15) { clearInterval(watching); watching = setInterval(tick, 15000); }
    if (!echo.now || ['finished', 'failed'].includes(echo.now.state)) clearInterval(watching);
  };
  watching = setInterval(tick, 2000);
}
