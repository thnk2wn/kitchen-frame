// What each person's phone last sent (GET /api/fitness; lib/fitness.js has the shape and helpers).
// Fetched at start, every 10 minutes, and at once when the Worker says a phone just sent.
import { api, cached, changed } from './api.js';
import { demoFitness } from './fitness.js';

// loaded: a fetch has answered (or a saved copy exists), so an empty list really means nobody.
// guest: guest mode (worker/guest.js), { on }; while on, the Worker sends no one.
// The guest setting is saved with the people, so a frame that starts offline doesn't show them.
export const fitness = $state({ people: cached('fitness') || [], loaded: !!cached('fitness'), guest: cached('fitness-guest') || { on: false } });

// One fetch at a time; one asked for while another is under way (guest mode just turned on, say)
// runs after it, so it can't be lost behind an answer from before the change.
// gen: bumped when guest mode is set here, so an answer to a fetch from before can't undo it.
let busy = false, again = false, gen = 0;
export async function loadFitness() {
  if (busy) { again = true; return; }
  busy = true;
  const asked = gen;
  try {
    const data = await api('/api/fitness');
    if (asked !== gen) { again = true; return; }
    fitness.guest = data.guest || { on: false };
    changed('fitness-guest', fitness.guest);
    if (changed('fitness', data.people || [])) fitness.people = data.people || [];
    fitness.loaded = true;
  } catch {} finally {
    busy = false;
    if (again) { again = false; loadFitness(); }
  }
}

// Demo mode shows invented people instead; nobody sending, or guest mode, means no Fitness tab and
// no Home rings (the Worker sends no one in guest mode too; this is the frame's own check).
export const fitnessPeople = (demo, now) => (demo ? demoFitness(now) : fitness.guest.on ? [] : fitness.people);

// Settings' Guest mode switch: the Worker hides fitness (and tells the phones and Alexa), then the
// frame reloads what it may show.
export async function setGuest(on) {
  gen++;
  fitness.guest = await api('/api/frame/guest', { method: 'POST', body: JSON.stringify({ on }) });
  changed('fitness-guest', fitness.guest);
  await loadFitness();
}

// The Worker says something changed (a phone sent, or guest mode was set elsewhere): any answer already
// on its way is from before, so it's dropped and the fetch made again.
export function refreshFitness() { gen++; loadFitness(); }
