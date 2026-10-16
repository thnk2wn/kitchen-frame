// Live video straight from a camera relay on the home network: go2rtc on an always-on computer
// (bridge/camera-relay/) that shrinks cameras too big for the frame's decoder and adds their
// sound. The frame talks to it directly (WebRTC signalling over go2rtc's WebSocket API, through a gate
// that checks a token: bridge/camera-relay/relay-gate.py), not through
// Home Assistant, which abandons a source that is silent for ~10 s: a cold Ring stream through a
// transcoder can take longer than that. The relay's addresses come from the Worker (CAMERA_RELAY).
// When the relay doesn't answer (the computer is asleep, off or has a new address) the camera view
// falls back to the camera's own live view, and says so.
import { api } from './api.js';
import { log } from './log.svelte.js';
import { peer } from './doorbell.svelte.js';

const CONFIG_MS = 10 * 60 * 1000;
const PROBE_MS = 2500;
let config = null, configAt = 0;
let reachable = null, reachableAt = 0; // the address that answered last, for a minute

async function relays() {
  if (config && Date.now() - configAt < CONFIG_MS) return config;
  try {
    const { relays: list = [] } = await api('/api/camera-relay');
    config = list.map((s) => { try { return new URL(s); } catch { return null; } }).filter(Boolean);
    configAt = Date.now();
  } catch { if (!config) config = []; }
  return config;
}

// Does the relay serve this camera (its name, as in camera.<name>_stream)? Without asking it.
export async function relayServes(name) {
  return (await relays()).some((u) => (u.searchParams.get('cameras') || '').split(',').map((c) => c.trim()).includes(name));
}

// The first address that answers. A no-cors request resolves on any HTTP answer and fails only when
// nothing is there.
async function find() {
  if (reachable && Date.now() - reachableAt < 60000) return reachable;
  const list = await relays();
  const probe = (u) => new Promise((ok, fail) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), PROBE_MS);
    fetch(u.origin + '/', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
      .then(() => { clearTimeout(t); ok(u); }, (e) => { clearTimeout(t); fail(e); });
  });
  try {
    reachable = await Promise.any(list.map(probe));
    reachableAt = Date.now();
    return reachable;
  } catch {
    reachable = null;
    return null;
  }
}

// Plays the relay's <name>_av stream (video and sound) into video. Resolves to a stop function like
// startLive's (with answered, failed and receivedBytes), or 'offline' when no relay address answers.
// The relay's sound and picture come from separate processes with unrelated clocks. In one remote
// stream the browser keeps them in lip sync, and on the frame that held the picture still once the
// sound was unmuted (2026-10-16). Each gets its own stream id, so neither waits for the other.
function unsynced(sdp) {
  return sdp.split(/\r\n(?=m=)/).map((sec) => {
    const kind = (/^m=(audio|video)/.exec(sec) || [])[1];
    if (!kind) return sec;
    const lines = sec.split('\r\n').filter((l) => !/^a=msid:/.test(l) && !/^a=ssrc:\d+ (msid|mslabel|label):/.test(l));
    const at = lines.findIndex((l) => /^a=/.test(l));
    lines.splice(at < 0 ? lines.length : at, 0, 'a=msid:relay-' + kind + ' relay-' + kind + '-track');
    return lines.join('\r\n');
  }).join('\r\n');
}

// onFail: called when the relay refuses or drops the request, so the view needn't wait to notice.
export async function startRelayLive(name, video, onPlaying, onFail = () => {}) {
  const t0 = Date.now();
  const label = 'relay:' + name;
  log('camera.live_start', { camera: label });
  const u = await find();
  if (!u) { log('camera.relay_offline', { camera: name, ms: Date.now() - t0 }, 'warn'); return 'offline'; }
  const p = peer(label, video, onPlaying, {}, t0);
  const pc = p.pc;
  let stopped = false, failed = false;
  // The address is http://<host>:<port>/<token>/?cameras=…: go2rtc's WebSocket API behind the token.
  const ws = new WebSocket('ws://' + u.host + u.pathname.replace(/\/$/, '') + '/api/ws?src=' + encodeURIComponent(name + '_av'));
  const fail = (step, error) => {
    if (stopped || failed) return;
    failed = true;
    log('camera.live_error', { camera: label, step, error, ms: p.ms() }, 'warn');
    onFail();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate && ws.readyState === 1) ws.send(JSON.stringify({ type: 'webrtc/candidate', value: e.candidate.candidate }));
  };
  ws.onopen = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'webrtc/offer', value: pc.localDescription.sdp }));
    } catch (e) { fail('offer', e.message); }
  };
  ws.onmessage = (ev) => {
    if (stopped) return;
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'webrtc/answer') pc.setRemoteDescription({ type: 'answer', sdp: unsynced(m.value) }).catch((e) => fail('answer', e.message));
    else if (m.type === 'webrtc/candidate') pc.addIceCandidate({ candidate: m.value, sdpMid: '0' }).catch(() => {});
    else if (m.type === 'error') fail('relay', String(m.value || '').slice(0, 200));
  };
  // Closed before answering: a wrong password, or the relay gave up on the camera.
  ws.onclose = (e) => { if (!pc.remoteDescription) fail('socket', 'closed ' + e.code); };
  const stop = async () => {
    if (stopped) return;
    await p.close();
    stopped = true;
    try { ws.close(); } catch {}
  };
  stop.answered = () => !!pc.remoteDescription;
  stop.failed = () => failed;
  stop.receivedBytes = p.receivedBytes;
  return stop;
}
