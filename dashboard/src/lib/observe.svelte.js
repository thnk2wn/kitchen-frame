// State changes worth a line in the event log (lib/log.svelte.js): the Home Assistant connection
// (and how long it was down), night starting and ending, and the clock screen coming on or going
// away, with why: how long since a touch and which sensor last saw someone, or what woke it.
import { ui } from './state.svelte.js';
import { ha } from './ha.svelte.js';
import { night } from './night.svelte.js';
import { presence, presenceArea } from './presence.svelte.js';
import { log } from './log.svelte.js';

const ago = (t) => (t ? Math.round((Date.now() - t) / 60000) : null);

export function startObserving() {
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
