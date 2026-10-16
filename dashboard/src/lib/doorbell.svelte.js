// Doorbell pop-up: when a doorbell rings, its camera covers the screen (the clock screen too) for a
// minute and a half: live video when the camera streams over WebRTC, the latest snapshot until then
// or instead. Nothing household-specific lives here; it's all found in Home Assistant.
//
// Which doorbells: every HA event entity with device_class "doorbell" (Ring, Reolink, UniFi Protect,
// Nest, … all expose one), or the ones set with ?doorbell=event.a,binary_sensor.b; ?doorbell=off
// turns the pop-up off. The camera is the one on the doorbell's device, or ?doorbell_camera=camera.x.
// A snapshot companion (ring-mqtt's camera.<name>_snapshot) is used for the still when there is one.
import { log } from './log.svelte.js';
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
  log('doorbell.ring', { doorbell: d.name || d.entity, test: d.test || undefined });
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
// Each step that can stall is logged (camera.*), as live video has been the frame's touchiest part.
const MAX_FS = 0; // H.264 max frame size hint in macroblocks (0 = none): 8160 tried 2026-10-16, Ring ignored it
const RING_MAX_KBPS = 0; // a cap the frame asks Ring to stay under (0 = none): tried 1200 on 2026-10-15, Ring ignored it
export async function startLive(entity_id, video, onPlaying) {
  const t0 = Date.now(), ms = () => Date.now() - t0;
  log('camera.live_start', { camera: entity_id });
  const caps = await send({ type: 'camera/capabilities', entity_id }).catch((e) => { log('camera.live_error', { camera: entity_id, step: 'capabilities', error: e.message }, 'warn'); return null; });
  if (!caps || !(caps.frontend_stream_types || []).includes('web_rtc')) { if (caps) log('camera.no_webrtc', { camera: entity_id }); return null; }
  const cfg = await send({ type: 'camera/webrtc/get_client_config', entity_id }).catch(() => ({}));
  const pc = new RTCPeerConnection(cfg.configuration || {});
  if (cfg.dataChannel) pc.createDataChannel(cfg.dataChannel);
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.addTransceiver('video', { direction: 'recvonly' });
  const stream = new MediaStream();
  pc.ontrack = (e) => {
    tracks++;
    stream.addTrack(e.track);
    video.srcObject = stream;
    video.play().catch(() => {});
  };
  let played = false, tracks = 0;
  video.onplaying = () => {
    played = true;
    // The size that arrived, a few seconds in (it can start small and grow).
    log('camera.live', { camera: entity_id, ms: ms(), size: video.videoWidth + 'x' + video.videoHeight });
    setTimeout(() => { if (!stopped) log('camera.size', { camera: entity_id, size: video.videoWidth + 'x' + video.videoHeight, ms: ms() }); }, 8000);
    onPlaying();
  };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'failed' || st === 'disconnected') log('camera.ice', { camera: entity_id, state: st, ms: ms() }, 'warn');
  };

  let session = null, sub = null, stopped = false;
  const queued = [];
  const sendCandidate = (c) => send({ type: 'camera/webrtc/candidate', entity_id, session_id: session, candidate: c }).catch(() => {});
  pc.onicecandidate = (e) => {
    if (!e.candidate || cfg.getCandidatesUpfront) return;
    const c = { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex };
    if (session) sendCandidate(c); else queued.push(c);
  };
  // Ring's camera scales its video to what the viewer's link can take (on a weak link the frame got
  // 480x272; on a good one 1536x1536, which this frame's RK3326 can't decode: 1080p is its limit).
  // So for Ring's own live view the offer states a bandwidth cap (b=AS, which libwebrtc senders
  // honour), and Ring sends a smaller picture. Streams through go2rtc are passed through unchanged.
  const offer = await pc.createOffer();
  if (RING_MAX_KBPS && !/_stream$/.test(entity_id)) {
    offer.sdp = offer.sdp.replace(/(m=video[^\r\n]*\r\n(?:c=[^\r\n]*\r\n)?)/, '$1b=AS:' + RING_MAX_KBPS + '\r\n');
  }
  // The decoder's limit, stated on each H.264 format line (max-fs in 16x16 blocks: 8160 = 1920x1088,
  // what this frame's RK3326 decodes; max-mbps to match). A sender that honours it picks a picture
  // that fits; Ring's own live view otherwise sends 2624x1472 or 1968x1104, which never decode here.
  if (MAX_FS && !/_stream$/.test(entity_id)) {
    offer.sdp = offer.sdp.replace(/^(a=fmtp:\d+ [^\r\n]*profile-level-id=[0-9a-fA-F]{6}[^\r\n]*)$/gm, (line) => (/max-fs=/.test(line) ? line : line + ';max-fs=' + MAX_FS + ';max-mbps=' + MAX_FS * 30));
  }
  await pc.setLocalDescription(offer);
  if (cfg.getCandidatesUpfront) {
    // Some cameras want every candidate in the offer: wait for gathering (at most 3 s).
    await new Promise((done) => {
      if (pc.iceGatheringState === 'complete') return done();
      pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done();
      setTimeout(done, 3000);
    });
  }
  // Given up on before it played: what the connection had done, to tell a slow start from video that
  // arrives but won't decode (bytes and frames received, its size).
  const report = async () => {
    // The size the camera offered, from the answer, when no frame decoded to tell us.
    const sdp = (pc.remoteDescription && pc.remoteDescription.sdp) || '';
    const offered = (/a=imageattr:\S+ recv \[x=(\d+),y=(\d+)\]/.exec(sdp) || /a=framesize:\S+ (\d+)-(\d+)/.exec(sdp) || []).slice(1).join('x');
    const out = { camera: entity_id, ms: ms(), ice: pc.iceConnectionState, conn: pc.connectionState, tracks, answered: !!pc.remoteDescription, ...(offered ? { offered } : {}) };
    try {
      const stats = await pc.getStats();
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && (r.kind || r.mediaType) === 'video') {
          Object.assign(out, { bytes: r.bytesReceived || 0, frames: r.framesDecoded || 0, size: r.frameWidth ? r.frameWidth + 'x' + r.frameHeight : '' });
          // The video format sent (e.g. H264 with its profile), to see what the decoder was given.
          const c = r.codecId && stats.get(r.codecId);
          if (c) out.codec = (c.mimeType || '') + (c.sdpFmtpLine ? ' ' + c.sdpFmtpLine : '');
        }
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) out.pair = 'ok';
      });
    } catch {}
    log('camera.not_playing', out, 'warn');
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (!played) await report();
    try { pc.close(); } catch {}
    if (sub) unsubscribeFrom(sub);
    video.srcObject = null;
  };
  sub = await subscribeTo({ type: 'camera/webrtc/offer', entity_id, offer: pc.localDescription.sdp }, (ev) => {
    if (stopped) return;
    if (ev.type === 'session') { session = ev.session_id; queued.splice(0).forEach(sendCandidate); }
    else if (ev.type === 'answer') pc.setRemoteDescription({ type: 'answer', sdp: ev.answer }).catch((e) => { log('camera.live_error', { camera: entity_id, step: 'answer', error: e.message, ms: ms() }, 'warn'); stop(); });
    else if (ev.type === 'candidate') {
      const c = typeof ev.candidate === 'string' ? { candidate: ev.candidate, sdpMLineIndex: 0 } : ev.candidate;
      pc.addIceCandidate(c).catch(() => {});
    } else if (ev.type === 'error') { log('camera.live_error', { camera: entity_id, step: 'offer', code: ev.code, error: ev.message, ms: ms() }, 'warn'); stop(); }
  });
  // Has Home Assistant answered yet? A stream that has to be started up first (a battery camera
  // through ring-mqtt and a transcoder) can take 15-25 s to answer; the camera view waits for it.
  stop.answered = () => !!pc.remoteDescription;
  // Video bytes received so far: the camera view keeps waiting while they grow (see CameraView).
  stop.receivedBytes = async () => {
    let b = 0;
    try { (await pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && (r.kind || r.mediaType) === 'video') b = r.bytesReceived || 0; }); } catch {}
    return b;
  };
  return stop;
}
