// Optimistic music controls. Home Assistant (and Spotify behind it) takes seconds to report a change,
// and reports the steps on the way: a volume drag comes back as a run of older values, play/pause
// as nothing at all for a while. So the screen shows what was asked for straight away, and ignores
// the player's own reports for that setting until they agree or a few seconds pass.
import { ha } from './ha.svelte.js';

const WAIT_MS = 8000;
// entity_id -> { state?, volume?, title?, until }; title is the song that was on when Next/Previous
// was tapped, so the buttons look busy until it changes.
export const pending = $state({});

export function expect(entity, patch) {
  pending[entity] = { ...pending[entity], ...patch, until: Date.now() + WAIT_MS };
  setTimeout(() => { if (pending[entity] && Date.now() >= pending[entity].until) delete pending[entity]; }, WAIT_MS + 50);
}

const settled = (p, w) => ({
  state: w.state == null || p.state === w.state,
  volume: w.volume == null || (p.volume_level != null && Math.abs(p.volume_level - w.volume) < 0.015),
  title: w.title == null || p.media_title !== w.title,
});

// Forget each expectation once the player agrees with it.
$effect.root(() => {
  $effect(() => {
    for (const p of ha.players) {
      const w = pending[p.entity_id];
      if (!w) continue;
      const ok = settled(p, w);
      if (ok.state && ok.volume && ok.title) delete pending[p.entity_id];
    }
  });
});

// The player as the screen should show it: what was asked for, until the player catches up.
export function shown(p) {
  const w = p && pending[p.entity_id];
  if (!w) return p;
  const ok = settled(p, w);
  return { ...p, ...(ok.state ? {} : { state: w.state }), ...(ok.volume ? {} : { volume_level: w.volume }) };
}

// Is this player still catching up on a control? ('state', 'volume' or 'title')
export function busy(p, key) {
  const w = p && pending[p.entity_id];
  const raw = w && (ha.players.find((x) => x.entity_id === p.entity_id) || p); // as HA reports it
  return !!(w && w[key] != null && !settled(raw, w)[key]);
}

// Record what a control asks for, before sending it.
export function expectFor(p, service, data = {}) {
  if (!p) return;
  if (service === 'media_play_pause') expect(p.entity_id, { state: p.state === 'playing' ? 'paused' : 'playing' });
  if (service === 'media_next_track' || service === 'media_previous_track') expect(p.entity_id, { title: p.media_title || '' });
  if (service === 'volume_set') expect(p.entity_id, { volume: data.volume_level });
}
