// PINs. Each person sets their own in the phone app (worker/devices.js keeps its salted hash with
// their phone); any of them, or the frame's own unlock PIN (Settings → Home, the older way, until it's
// removed), works wherever a PIN is asked: unlocking a door, guest mode off, pairing, revoking. A
// person's own details (their weight) take only that person's PIN.
//
// The frame's unlock PIN (Settings → Home): when one is set, unlocking a lock from the House tab asks for it.
// Locking never does. A right PIN is trusted for a minute, so unlocking twice in a row asks once.
// Stored as a salted hash (lib/pin.js) in "frame-unlock-pin", backed up with the other settings;
// misses are counted in "frame-unlock-pin-fails", so a reload doesn't reset the wait. Attempts are
// logged (never the digits). Forgotten: scripts/frame-url.sh --clear-pin removes it over ADB.
import { makePin, pinMatches, waitAfter, triesLeft, PIN_LENGTH } from './pin.js';
import { log } from './log.svelte.js';
import { api } from './api.js';

const KEY = 'frame-unlock-pin';
const FAILS = 'frame-unlock-pin-fails';
const TRUST_MS = 60000;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// A forgotten PIN: ?clear_pin removes it (scripts/frame-url.sh --clear-pin, sent over ADB), then
// leaves the address bar. Typing it needs the address bar, which the kiosk doesn't show.
if (typeof location !== 'undefined') {
  const q = new URLSearchParams(location.search);
  if (q.has('clear_pin')) {
    if (read(KEY)) { write(KEY, null); log('pin.removed', { how: 'setup link' }, 'warn'); }
    write(FAILS, null);
    q.delete('clear_pin');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
}

// ask: the keypad on screen, or null. mode 'check' tests digits against the PIN; 'enter' just returns them.
// set: the frame's own PIN is set. people: the household's PINs, [{ person, fitnessId, salt, hash }].
// people starts from the last list loaded (kept here), so a reload, or the Worker out of reach, never
// leaves the frame with no PINs to ask for (unlocking a door in two taps).
const PEOPLE = 'frame-pins';
export const pin = $state({ set: !!read(KEY), ask: null, people: read(PEOPLE) || [] });
// Any PIN at all: the frame's, or anyone's.
export const anyPin = () => pin.set || pin.people.length > 0;
// Whether this person (by their fitness id) has a PIN of their own.
export const hasOwnPin = (fitnessId) => !!fitnessId && pin.people.some((p) => p.fitnessId === fitnessId);

// The household's PINs, from the device list (the frame's key may read it; a phone's may not).
export async function loadPins() {
  try {
    const { devices } = await api('/api/devices');
    if (!Array.isArray(devices)) return;
    pin.people = devices.filter((d) => d.pin && d.pin.salt && d.pin.hash).map((d) => ({ person: d.person || d.name, fitnessId: d.fitnessId || null, salt: d.pin.salt, hash: d.pin.hash }));
    write(PEOPLE, pin.people);
  } catch {} // kept as it was: the last list loaded
}
let trustedUntil = 0;

export const pinAvailable = () => typeof crypto !== 'undefined' && !!crypto.subtle;
export { PIN_LENGTH };

// person: only that person's PIN will do (their fitness id), for their own details.
function open(mode, title, note = '', person = null) {
  return new Promise((resolve) => { pin.ask = { mode, title, note, person, resolve }; });
}
// The keypad closes with digits (or true for a right PIN), or null when cancelled.
export function closePad(result) {
  const a = pin.ask;
  pin.ask = null;
  if (a) a.resolve(result);
}

// Before an unlock: true when there's no PIN, it was entered in the last minute, or it's entered now.
export async function allowUnlock(what) {
  if (!anyPin()) return true;
  if (Date.now() < trustedUntil) return true;
  const ok = await open('check', 'Enter PIN to unlock', what);
  if (!ok) log('pin.cancelled', { for: what });
  return !!ok;
}

// Settings asks for the current PIN with no minute of trust: changing or removing it always asks.
export const confirmPin = (title) => open('check', title).then((ok) => !!ok);
export const enterPin = (title, note) => open('enter', title, note);
// A person's own details: their PIN only, each time it's asked (the caller keeps them shown while
// its sheet is open). No PIN of their own: nothing to ask.
export const confirmOwnPin = (fitnessId, title, note) => (hasOwnPin(fitnessId) ? open('check', title, note, fitnessId).then((ok) => !!ok) : Promise.resolve(true));

// Called by the keypad with four digits: { ok } | { wrong, left } | { wait } (ms until it can try again).
export async function tryPin(digits) {
  // Misses at one person's details count apart from the rest, so guessing at someone's weight can't
  // hold up unlocking a door.
  const fails = pin.ask?.person ? FAILS + ':' + pin.ask.person : FAILS;
  const f = read(fails) || { n: 0, at: 0 };
  const wait = f.at + waitAfter(f.n) - Date.now();
  if (f.n && wait > 0) return { wait };
  // Whose PINs count: for a person's details, theirs; otherwise the frame's and everyone's.
  const person = pin.ask?.person;
  const candidates = person ? pin.people.filter((p) => p.fitnessId === person) : [{ person: 'frame', salt: '', hash: '', frame: true }, ...pin.people];
  for (const c of candidates) {
    if (await pinMatches(digits, c.frame ? read(KEY) : c)) {
      write(fails, null);
      if (!person) trustedUntil = Date.now() + TRUST_MS;
      log('pin.ok', { for: pin.ask?.note || pin.ask?.title, whose: c.person });
      return { ok: true };
    }
  }
  const n = f.n + 1;
  write(fails, { n, at: Date.now() });
  const next = waitAfter(n);
  log('pin.wrong', { for: pin.ask?.note || pin.ask?.title, misses: n, ...(next ? { waitSec: next / 1000 } : {}) }, 'warn');
  return next ? { wait: next } : { wrong: true, left: triesLeft(n) };
}
export function waitLeft() {
  const f = read(pin.ask?.person ? FAILS + ':' + pin.ask.person : FAILS);
  return f && f.n ? Math.max(f.at + waitAfter(f.n) - Date.now(), 0) : 0;
}

export async function savePin(digits) {
  write(KEY, await makePin(digits));
  write(FAILS, null);
  log('pin.set', {}, 'warn');
  pin.set = true;
}
export function removePin() {
  write(KEY, null);
  write(FAILS, null);
  trustedUntil = 0;
  log('pin.removed', {}, 'warn');
  pin.set = false;
}

// Another tab or a restore can change it underneath us.
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) pin.set = !!e.newValue; });
