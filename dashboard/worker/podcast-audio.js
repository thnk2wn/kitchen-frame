// Podcasts on an Echo, through the Kitchen Frame Alexa skill (alexa.js) and Alexa's AudioPlayer: the skill
// streams the episode's own audio link on the Echo, from a given place. Two ways in:
//   - the frame (Media → Podcasts, "Play on <Echo>") stores the episode here (POST /api/podcasts/cast),
//     then asks that Echo, through Home Assistant, "ask Kitchen Frame to play my podcast";
//   - by voice: "Alexa, ask Kitchen Frame to play Science Friday" (its half-played or newest episode).
// Alexa reports playback (started, stopped with the place, finished); where each episode got to is
// kept, so the frame's Continue row and the next play pick up from there.
// What's playing on an Echo, the frame's last request and where each episode got to live in the message
// room's store (store.js), not KV: KV can serve a minute-old copy elsewhere, so the frame showed
// "Starting…" for a minute after the Echo began, and every progress report was a KV write.
// Without the room (tests), KV.
import { roomStore } from './store.js';
import { room } from './messages.js';
// Tells an open frame the Echo's podcast changed, so Home and Podcasts show it at once.
const tellFrame = (env) => (env.MESSAGES ? room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'refresh', what: 'podcast' }) }).catch(() => {}) : null);
const kvOf = (env) => (env.MESSAGES ? roomStore(env) : env.CALENDAR);

const CAST_KEY = 'podcast-cast';      // what the frame asked for last: { episode, show, position, at }
const NOW_KEY = 'podcast-now';        // what the Echo is (or was last) playing: { episode, show, position, state, at }
const SPOT_KEY = 'podcast-echo-spots'; // episode id -> { pos, at, done? }, the 200 most recent
const CAST_FRESH_MS = 10 * 60 * 1000;

const clean = (e = {}, s = {}) => ({
  episode: { id: String(e.id || '').slice(0, 80), title: String(e.title || '').slice(0, 300), url: /^https:\/\//i.test(e.url || '') ? String(e.url).slice(0, 1000) : '', seconds: Number(e.seconds) || undefined },
  show: { title: String(s.title || '').slice(0, 200), art: /^https:\/\//i.test(s.art || '') ? String(s.art).slice(0, 1000) : undefined },
});

export async function saveCast(env, body) {
  const c = clean(body.episode, body.show);
  if (!c.episode.id || !c.episode.url) return { status: 400, body: { error: 'an episode with an https audio link' } };
  await kvOf(env).put(CAST_KEY, JSON.stringify({ ...c, position: Math.max(0, Math.round(Number(body.position) || 0)), at: Date.now() }));
  return { status: 200, body: { ok: true } };
}

export const echoNow = async (env) => (await kvOf(env).get(NOW_KEY, 'json')) || null;
// Until the first write after the move, the places KV kept.
export const echoSpots = async (env) => (await kvOf(env).get(SPOT_KEY, 'json')) || (env.MESSAGES && (await env.CALENDAR.get(SPOT_KEY, 'json'))) || {};

async function noteSpot(env, id, pos, done = false) {
  const spots = await echoSpots(env);
  spots[id] = { pos: Math.round(pos), at: Date.now(), ...(done ? { done: true } : {}) };
  const keep = Object.entries(spots).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
  await kvOf(env).put(SPOT_KEY, JSON.stringify(Object.fromEntries(keep)));
}

// The AudioPlayer directive that streams an episode from `position` seconds.
export function playDirective(item, position = 0) {
  return {
    type: 'AudioPlayer.Play', playBehavior: 'REPLACE_ALL',
    audioItem: {
      stream: { url: item.episode.url, token: item.episode.id, offsetInMilliseconds: Math.max(0, Math.round(position * 1000)) },
      metadata: { title: item.episode.title, subtitle: item.show.title, ...(item.show.art ? { art: { sources: [{ url: item.show.art }] } } : {}) },
    },
  };
}
const played = (speech, directives) => ({ version: '1.0', response: { ...(speech ? { outputSpeech: { type: 'PlainText', text: speech } } : {}), directives, shouldEndSession: true } });
const quiet = (directives) => ({ version: '1.0', response: directives ? { directives } : {} });

// "Play my podcast" (what the frame just asked for), or a show by name: its half-played episode, else
// its newest. shows: the library (podcasts.js listPodcasts).
export async function playPodcast(env, asked, shows) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let item = null, position = 0;
  if (asked && !/^(my )?(podcasts?|episode|show)$/i.test(asked.trim())) {
    const a = norm(asked);
    const show = shows.find((s) => norm(s.title) === a) || shows.find((s) => norm(s.title).includes(a) || a.includes(norm(s.title).split(' ').slice(0, 3).join(' ')));
    if (!show || !show.episodes.length) return { version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'I couldn\'t find a podcast called ' + asked + '.' }, shouldEndSession: true } };
    const spots = await echoSpots(env);
    const at = (e) => { const s = spots[e.id]; return s && s.at > (Date.parse(e.touched || 0) || 0) ? (s.done ? 0 : s.pos) : (e.played ? 0 : e.position || 0); };
    const ep = show.episodes.find((e) => at(e) > 30) || show.episodes[0];
    item = clean(ep, show); position = at(ep);
  } else {
    const cast = await kvOf(env).get(CAST_KEY, 'json');
    const now = await echoNow(env);
    if (cast && Date.now() - cast.at < CAST_FRESH_MS) { item = cast; position = cast.position; }
    else if (now && now.episode) { item = now; position = now.state === 'finished' ? 0 : now.position; }
  }
  if (!item || !item.episode.url) return { version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'Pick an episode on the frame first, or say which podcast.' }, shouldEndSession: true } };
  await kvOf(env).put(NOW_KEY, JSON.stringify({ episode: item.episode, show: item.show, position, state: 'starting', at: Date.now() }));
  await tellFrame(env);
  return played('Playing ' + item.episode.title + '.', [playDirective(item, position)]);
}

// Alexa's reports while it plays (AudioPlayer.*) and the Echo's own buttons (PlaybackController.*);
// audio = context.AudioPlayer: { token, offsetInMilliseconds }.
export async function audioEvent(env, type, req, audio = {}) {
  const now = await echoNow(env);
  const token = req.token || audio.token;
  const pos = (req.offsetInMilliseconds ?? audio.offsetInMilliseconds ?? 0) / 1000;
  const mine = now && now.episode && now.episode.id === token;
  const save = async (state, done = false) => {
    if (!mine) return;
    await kvOf(env).put(NOW_KEY, JSON.stringify({ ...now, position: done ? 0 : Math.round(pos), state, at: Date.now() }));
    await noteSpot(env, token, pos, done);
    await tellFrame(env);
  };
  if (type === 'AudioPlayer.PlaybackStarted') await save('playing');
  else if (type === 'AudioPlayer.PlaybackStopped') await save('paused');
  else if (type === 'AudioPlayer.PlaybackFinished') await save('finished', true);
  else if (type === 'AudioPlayer.PlaybackFailed') { console.warn('podcast on the Echo failed: ' + JSON.stringify(req.error || {}).slice(0, 200)); await save('failed'); }
  else if (type === 'PlaybackController.PauseCommandIssued') { await save('paused'); return quiet([{ type: 'AudioPlayer.Stop' }]); }
  else if (type === 'PlaybackController.PlayCommandIssued') return resume(env, audio, true);
  return quiet();
}

// "Alexa, resume": the episode the Echo was playing, from where it stopped.
export async function resume(env, audio = {}, silent = false) {
  const now = await echoNow(env);
  if (!now || !now.episode || !now.episode.url) return silent ? quiet() : played('There\'s nothing to resume.', []);
  const pos = audio.token === now.episode.id && audio.offsetInMilliseconds != null ? audio.offsetInMilliseconds / 1000 : now.position;
  return silent ? quiet([playDirective(now, pos)]) : played(null, [playDirective(now, pos)]);
}
export const pause = () => quiet([{ type: 'AudioPlayer.Stop' }]);

// The Echo's places, laid over the library's (newer wins), so the frame's Continue row follows it.
export function withEchoSpots(shows, spots) {
  return shows.map((s) => ({ ...s, episodes: (s.episodes || []).map((e) => {
    const sp = spots[e.id];
    if (!sp || sp.at <= (Date.parse(e.touched || 0) || 0)) return e;
    return { ...e, position: sp.done ? undefined : sp.pos, played: sp.done || undefined, touched: new Date(sp.at).toISOString() };
  }) }));
}
