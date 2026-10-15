// The unlock PIN's arithmetic (pin.svelte.js holds its state): a salted PBKDF2 hash, never the PIN
// itself, and how long to wait after wrong guesses. Plain JS so it can be tested in Node.
//
// What this protects: someone at the screen unlocking a door, like the PIN Alexa asks for. Not the
// device itself: anyone who can root the frame can read its Home Assistant token and unlock without
// the dashboard, and four digits hashed are quickly guessed offline. The hash just keeps the PIN out
// of plain sight (the settings backup, the event log).
export const PIN_LENGTH = 4;
const ITERATIONS = 60000;
const FREE_TRIES = 5;

const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITERATIONS }, key, 256));
}

export async function makePin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPin(pin, salt) };
}

export async function pinMatches(pin, saved) {
  if (!saved || !saved.salt || !saved.hash) return false;
  const h = await hashPin(pin, saved.salt);
  let d = h.length ^ saved.hash.length;
  for (let i = 0; i < h.length && i < saved.hash.length; i++) d |= h.charCodeAt(i) ^ saved.hash.charCodeAt(i);
  return d === 0;
}

// After five wrong PINs in a row: a minute's wait, doubling with each further miss, up to 15 minutes.
export const waitAfter = (fails) => (fails < FREE_TRIES ? 0 : Math.min(60000 * 2 ** (fails - FREE_TRIES), 15 * 60000));
export const triesLeft = (fails) => Math.max(FREE_TRIES - fails, 0);
