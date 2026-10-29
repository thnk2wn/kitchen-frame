import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeAlerts, toSay, spoken, unwrap, alertKey } from './wxalerts.js';

const NOW = Date.parse('2026-10-29T06:00:00');
const at = (h) => new Date(NOW + h * 3600000).toISOString();
const fog = { id: 'urn:fog', event: 'Special Weather Statement', severity: 'Moderate', ends: at(3),
  text: 'Patchy fog has developed this morning, with the lowest\nvisibilities along the interstate. Visibilities may be\nreduced.\n\nSlow down.' };
const tornado = { id: 'urn:tor', event: 'Tornado Warning', severity: 'Extreme', ends: at(1), text: '* WHAT...A tornado was\nreported. Take cover now.' };

test('weather alerts: gone once they end, kept without an end', () => {
  assert.deepEqual(activeAlerts([fog, tornado], NOW).length, 2);
  assert.deepEqual(activeAlerts([fog, tornado], NOW + 2 * 3600000), [fog]);
  assert.deepEqual(activeAlerts([fog], Date.parse(fog.ends)), []);
  assert.equal(activeAlerts([{ ...fog, ends: null }], NOW + 99 * 3600000).length, 1);
  assert.deepEqual(activeAlerts(undefined), []);
});

test('weather alerts: hard-wrapped lines joined, paragraphs kept', () => {
  assert.equal(unwrap('a\nb\n\nc\nd'), 'a b\n\nc d');
});

test('weather alerts: said as the alert, until when, and its first sentence', () => {
  assert.equal(spoken(fog, NOW), 'Weather: Special Weather Statement until 9:00 AM. Patchy fog has developed this morning, with the lowest visibilities along the interstate.');
  assert.equal(spoken(tornado, NOW), 'Weather: Tornado Warning until 7:00 AM. A tornado was reported.');
  assert.equal(spoken({ event: 'Heat Advisory', text: '' }, NOW), 'Weather: Heat Advisory.');
});

test('weather alerts: which are said, by setting', () => {
  const all = [fog, tornado];
  const ids = (l) => l.map((a) => a.id);
  assert.deepEqual(toSay(all, { mode: 'off', quiet: false, said: {}, now: NOW }), []);
  assert.deepEqual(ids(toSay(all, { mode: 'warnings', quiet: false, said: {}, now: NOW })), ['urn:tor']);
  assert.deepEqual(ids(toSay(all, { mode: 'all', quiet: false, said: {}, now: NOW })), ['urn:fog', 'urn:tor']);
});

test('weather alerts: once each; overnight, only warnings, the rest held for morning', () => {
  const all = [fog, tornado];
  assert.deepEqual(toSay(all, { mode: 'all', quiet: false, said: { [alertKey(fog)]: NOW, [alertKey(tornado)]: NOW }, now: NOW }), []);
  // Overnight: the warning now, the statement waits.
  assert.deepEqual(toSay(all, { mode: 'all', quiet: true, said: {}, now: NOW }), [tornado]);
  // Morning, still in effect: said then.
  assert.deepEqual(toSay(all, { mode: 'all', quiet: false, said: { [alertKey(tornado)]: NOW }, now: NOW + 3600000 }), [fog]);
  // Ended overnight: never said.
  assert.deepEqual(toSay([fog], { mode: 'all', quiet: false, said: {}, now: NOW + 4 * 3600000 }), []);
});
