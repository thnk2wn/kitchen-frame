// Guest mode: while there's company, the frame shows nothing personal. For now that's Fitness (no
// tab, no rings on Home, Alexa won't read it); other things can join it later. On or off from the
// frame's Settings, the phone app's Remote tab or Alexa, and it stays as set until changed.
//   GET  /api/frame/guest  -> { on }
//   POST /api/frame/guest  { on } -> { on }
// Kept in the message room (messages.js), which every request reads the same, and which tells the
// frame at once. The Worker leaves the hidden things out of what it sends (GET /api/fitness), so the
// frame can't show them by mistake.
import { room } from './messages.js';

export async function guestMode(env) {
  return (await room(env).fetch(new Request('https://room/guest'))).json();
}

export async function setGuestMode(env, on) {
  return (await room(env).fetch(new Request('https://room/guest', { method: 'POST', body: JSON.stringify({ on: !!on }) }))).json();
}
