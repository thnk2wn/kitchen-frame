// Doorbell pop-up: when a doorbell rings, its camera covers the screen (the clock screen too) for a
// minute and a half: live video when the camera streams over WebRTC, the latest snapshot until then
// or instead. Nothing household-specific lives here; it's all found in Home Assistant.
//
// Which doorbells: every HA event entity with device_class "doorbell" (Ring, Reolink, UniFi Protect,
// Nest, … all expose one), or the ones set with ?doorbell=event.a,binary_sensor.b; ?doorbell=off
// turns the pop-up off. The camera is the one on the doorbell's device, or ?doorbell_camera=camera.x.
// A snapshot companion (ring-mqtt's camera.<name>_snapshot) is used for the still when there is one.
import { send, subscribeTo, unsubscribeFrom, callService, onHAConnect, onHAStates, applyEntityDiff } from './ha.svelte.js';
import { companionsOf } from './house.svelte.js';

const SHOW_MS = 90 * 1000;
const KEYS = { doorbell: 'frame-doorbell', doorbell_camera: 'frame-doorbell-camera' };
{
  // One-time setup from the URL like the other frame settings (dashboard/scripts/frame-url.sh).
  const q = new URLSearchParams(location.search);
  let found = false;
  for (const [param, key] of Object.entries(KEYS)) {
    if (q.has(param)) { found = true; const v = q.get(param); v ? localStorage.setItem(key, v) : localStorage.removeItem(key); q.delete(param); }
  }
  if (found) history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
}

export const bell = $state({
  doorbells: [],   // [{ entity, name, live, still, button }] found on the last connection
  ringing: null,   // the doorbell being shown, plus { at }
  states: {},      // its cameras' states (entity_picture changes with each new snapshot)
});

let watched = [];   // subscription ids
let closeTimer = null;
let ready = false;  // the first state after subscribing is the current one, not a ring

onHAStates((states) => { find(states).catch((e) => console.error('doorbell', e)); });
onHAConnect(() => { watched = []; }); // subscriptions die with the old connection

async function find(states) {
  for (const id of watched) unsubscribeFrom(id);
  watched = [];
  const pref = (localStorage.getItem(KEYS.doorbell) || '').trim();
  if (pref === 'off') { bell.doorbells = []; return; }
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const ids = pref ? pref.split(',').map((x) => x.trim()).filter((x) => byId.has(x))
    : states.filter((s) => s.entity_id.startsWith('event.') && s.attributes && s.attributes.device_class === 'doorbell').map((s) => s.entity_id);
  if (!ids.length) { bell.doorbells = []; return; }

  // The doorbell's own camera: the camera entity on the same device (entity registry), else one
  // whose id starts with the doorbell's ("event.front_door_ding" -> "camera.front_door…").
  let registry = [];
  try { registry = (await send({ type: 'config/entity_registry/list_for_display' })).entities || []; } catch {}
  const deviceOf = new Map(registry.map((e) => [e.ei, e.di]));
  const prefCam = localStorage.getItem(KEYS.doorbell_camera) || '';
  bell.doorbells = ids.map((entity) => {
    const base = entity.split('.')[1].replace(/_(ding|doorbell|ring|press|button|visitor)$/, '');
    const dev = deviceOf.get(entity);
    const cams = states.map((s) => s.entity_id).filter((e) => e.startsWith('camera.'));
    const live = (prefCam && byId.has(prefCam) && prefCam)
      || cams.find((c) => dev && deviceOf.get(c) === dev)
      || cams.find((c) => c.startsWith('camera.' + base) && !/_(snapshot|stream)$/.test(c)) || null;
    const [snap, button, stream] = live ? companionsOf(live) : [];
    const name = String((byId.get(entity).attributes || {}).friendly_name || base)
      .replace(/\s+(ding|doorbell|ring|press(ed)?|button|visitor)$/i, '');
    // video: the camera to stream, its <name>_stream companion when there is one (see companionsOf).
    return { entity, name, live, video: stream && byId.has(stream) && byId.get(stream).state !== 'unavailable' ? stream : live, still: snap && byId.has(snap) ? snap : live, button: button && byId.has(button) ? button : null };
  });

  // Watch the doorbells, plus their cameras so the still follows each new snapshot.
  ready = false;
  const watch = [...new Set(bell.doorbells.flatMap((d) => [d.entity, d.live, d.still]).filter(Boolean))];
  const map = new Map();
  watched.push(await subscribeTo({ type: 'subscribe_entities', entity_ids: watch }, (ev) => {
    const rang = ready ? bell.doorbells.filter((d) => rings(ev, d.entity)) : [];
    applyEntityDiff(map, ev);
    bell.states = Object.fromEntries(map);
    ready = true;
    if (rang.length) ring(rang[0]);
  }));
}

// An event entity's state is the time of its last event, so any new state is a ring; a binary
// sensor rings when it turns on.
function rings(ev, entity) {
  const c = ev.c && ev.c[entity];
  const s = c && c['+'] && c['+'].s;
  if (!s) return false;
  return entity.startsWith('binary_sensor.') ? s === 'on' : s !== 'unavailable' && s !== 'unknown';
}

export function ring(d) {
  bell.ringing = { ...d, at: Date.now() };
  // Ask for a fresh still right away (ring-mqtt snapshots take a few seconds to arrive).
  if (d.button) callService('button', 'press', {}, { entity_id: d.button }).catch(() => {});
  clearTimeout(closeTimer);
  closeTimer = setTimeout(dismiss, SHOW_MS);
}
export function dismiss() {
  clearTimeout(closeTimer);
  bell.ringing = null;
}

// Live video over HA's WebRTC signalling (HA 2024.11+): offer -> session id, answer and ICE
// candidates come back as subscription events. Resolves to a stop function, or null when the
// camera doesn't stream over WebRTC (the pop-up keeps showing the still).
export async function startLive(entity_id, video, onPlaying) {
  const caps = await send({ type: 'camera/capabilities', entity_id }).catch(() => null);
  if (!caps || !(caps.frontend_stream_types || []).includes('web_rtc')) return null;
  const cfg = await send({ type: 'camera/webrtc/get_client_config', entity_id }).catch(() => ({}));
  const pc = new RTCPeerConnection(cfg.configuration || {});
  if (cfg.dataChannel) pc.createDataChannel(cfg.dataChannel);
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.addTransceiver('video', { direction: 'recvonly' });
  const stream = new MediaStream();
  pc.ontrack = (e) => {
    stream.addTrack(e.track);
    video.srcObject = stream;
    video.play().catch(() => {});
  };
  video.onplaying = onPlaying;

  let session = null, sub = null, stopped = false;
  const queued = [];
  const sendCandidate = (c) => send({ type: 'camera/webrtc/candidate', entity_id, session_id: session, candidate: c }).catch(() => {});
  pc.onicecandidate = (e) => {
    if (!e.candidate || cfg.getCandidatesUpfront) return;
    const c = { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex };
    if (session) sendCandidate(c); else queued.push(c);
  };
  await pc.setLocalDescription(await pc.createOffer());
  if (cfg.getCandidatesUpfront) {
    // Some cameras want every candidate in the offer: wait for gathering (at most 3 s).
    await new Promise((done) => {
      if (pc.iceGatheringState === 'complete') return done();
      pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done();
      setTimeout(done, 3000);
    });
  }
  const stop = () => {
    stopped = true;
    try { pc.close(); } catch {}
    if (sub) unsubscribeFrom(sub);
    video.srcObject = null;
  };
  sub = await subscribeTo({ type: 'camera/webrtc/offer', entity_id, offer: pc.localDescription.sdp }, (ev) => {
    if (stopped) return;
    if (ev.type === 'session') { session = ev.session_id; queued.splice(0).forEach(sendCandidate); }
    else if (ev.type === 'answer') pc.setRemoteDescription({ type: 'answer', sdp: ev.answer }).catch(stop);
    else if (ev.type === 'candidate') {
      const c = typeof ev.candidate === 'string' ? { candidate: ev.candidate, sdpMLineIndex: 0 } : ev.candidate;
      pc.addIceCandidate(c).catch(() => {});
    } else if (ev.type === 'error') stop();
  });
  return stop;
}
