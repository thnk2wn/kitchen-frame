// State changes worth a line in the event log (lib/log.svelte.js): the Home Assistant connection
// (and how long it was down), night starting and ending, and the clock screen coming on or going
// away, with why: how long since a touch and which sensor last saw someone, or what woke it.
import { ui } from './state.svelte.js';
import { ha } from './ha.svelte.js';
import { night } from './night.svelte.js';
import { presence, presenceArea } from './presence.svelte.js';
import { log } from './log.svelte.js';

const ago = (t) => (t ? Math.round((Date.now() - t) / 60000) : null);

// What this device's video decoder says it can play, once per load (camera.decoder): H.264 at a few
// picture sizes. Ring's newer cameras send 1536x1536 or 2560x1440; a frame's decoder may stop at 1080p.
async function probeDecoder() {
  const mc = typeof navigator !== 'undefined' && navigator.mediaCapabilities;
  if (!mc || !mc.decodingInfo) return;
  const out = {};
  for (const [w, h] of [[1280, 720], [1920, 1080], [1536, 1536], [2560, 1440]]) {
    for (const type of ['webrtc', 'media-source']) {
      try {
        const r = await mc.decodingInfo({ type, video: { contentType: type === 'webrtc' ? 'video/H264; profile-level-id=64001f' : 'video/mp4; codecs="avc1.64001f"', width: w, height: h, bitrate: 4000000, framerate: 15 } });
        out[type[0] + w + 'x' + h] = (r.supported ? 'yes' : 'no') + (r.powerEfficient ? '+hw' : '');
      } catch (e) { out[type[0] + w + 'x' + h] = 'err'; }
    }
  }
  log('camera.decoder', out);
}

export function startObserving() {
  probeDecoder();
  let haWas = null, downSince = null, nightWas = null, idleWas = null;
  $effect.root(() => {
    $effect(() => {
      const s = ha.status;
      if (s === haWas) return;
      if (s === 'connected') log('ha.connected', { downFor: downSince ? Math.round((Date.now() - downSince) / 1000) + ' s' : undefined });
      else if (haWas === 'connected') { downSince = Date.now(); log('ha.disconnected', {}, 'warn'); }
      if (s === 'error') log('ha.error', { error: ha.error }, 'error');
      haWas = s;
    });
    $effect(() => {
      const a = night.active;
      if (nightWas !== null && a !== nightWas) log(a ? 'night.start' : 'night.end', { from: night.from, to: night.to });
      nightWas = a;
    });
    $effect(() => {
      const idle = ui.idle;
      if (idleWas !== null && idle !== idleWas) {
        const sensor = presence.by && (presence.names[presence.by] || presence.by);
        if (idle) {
          log('screen.clock', { after: ui.idleMinutes + ' min', night: night.active || undefined,
            lastMotion: presenceArea() && presence.lastSeen ? ago(presence.lastSeen) + ' min ago' + (sensor ? ' (' + sensor + ')' : '') : undefined });
        } else {
          // Motion within the last few seconds woke it; otherwise a touch, an alert or a timer did.
          const byMotion = presenceArea() && presence.lastSeen && Date.now() - presence.lastSeen < 5000;
          log('screen.awake', { by: byMotion ? 'motion: ' + sensor : 'touch or alert' });
        }
      }
      idleWas = idle;
    });
  });
}
