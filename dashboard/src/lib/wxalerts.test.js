import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeAlerts, toSay, spoken, unwrap, alertKey, eventKey, alertList, sections, areas, advice, summary, speech, readAll, shortEvent, isNew } from './wxalerts.js';

const NOW = Date.parse('2026-10-29T06:00:00');
const at = (h) => new Date(NOW + h * 3600000).toISOString();
const fog = { id: 'urn:fog', event: 'Special Weather Statement', severity: 'Moderate', ends: at(3),
  description: 'Patchy fog has developed this morning, with the lowest\nvisibilities along the interstate. Visibilities may be\nreduced.\n\nSlow down.' };
const tornado = { id: 'urn:tor', event: 'Tornado Warning', severity: 'Extreme', ends: at(1), description: '* WHAT...A tornado was\nreported.', instruction: 'Take cover now. Go to a basement.' };

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

test('weather alerts: said as the alert, until when, what is happening and the first advice', () => {
  assert.equal(spoken(fog, NOW), 'Weather: Special Weather Statement until 9:00 AM. Patchy fog has developed this morning, with the lowest visibilities along the interstate.');
  assert.equal(spoken(tornado, NOW), 'Weather: Tornado Warning until 7:00 AM. A tornado was reported. Take cover now.');
  assert.equal(spoken({ event: 'Heat Advisory', description: '' }, NOW), 'Weather: Heat Advisory.');
  // The model's words when the Worker has them.
  assert.equal(spoken({ ...tornado, ai: { summary: 'Tornado reported nearby', speech: 'A tornado was reported. Go to the basement now.' } }, NOW),
    'Weather: Tornado Warning until 7:00 AM. A tornado was reported. Go to the basement now.');
});

// As the Weather Service sent them (2026-11-06, places changed), trimmed.
const ffw = { id: 'urn:ffw', event: 'Flash Flood Warning', severity: 'Severe', sent: at(-0.25), ends: at(3),
  description: 'FFWRAH\n\nThe National Weather Service in Des Moines has issued a\n\n* Flash Flood Warning for...\nNortheastern Story County in central Iowa...\nSouthern Polk County in central Iowa...\nCentral Boone County in central Iowa...\n\n* Until 130 PM EST.\n\n* At 1031 AM EST, Doppler radar indicated thunderstorms producing\nheavy rain across the warned area. Between 1 and 2 inches of rain\nhave fallen.\n\nHAZARD...Flash flooding caused by thunderstorms.\n\nSOURCE...Radar indicated.\n\nIMPACT...Flash flooding of small creeks and streams.\n\n* Some locations that will experience flash flooding include...\nDes Moines, Ankeny,\nAmes and Saylorville Lake.',
  instruction: "Turn around, don't drown when encountering flooded roads. Most flood\ndeaths occur in vehicles." };
const advisory = { id: 'urn:fa1', event: 'Flood Advisory', severity: 'Minor', sent: at(-1), ends: at(2),
  description: '* WHAT...Urban area and small stream flooding caused by excessive\nrainfall is expected.\n\n* WHERE...Boone County in central Iowa.\n\n* WHEN...Until 100 PM EST.\n\n* IMPACTS...Minor flooding in low-lying and poor drainage areas.\n\n* ADDITIONAL DETAILS...\n- At 1005 AM EST, heavy rain.\n- Additional rainfall amounts of 1 to 2 inches are expected.\n- http://www.weather.gov/safety/flood',
  instruction: 'Turn around, don\'t drown.' };

test('weather alerts: the text as sections, without codes, preamble, end time, source or links', () => {
  assert.deepEqual(sections(ffw), [
    { label: 'Where', text: 'Northeastern Story County, Southern Polk County, Central Boone County (central Iowa)' },
    { label: 'What', text: 'At 1031 AM EST, Doppler radar indicated thunderstorms producing heavy rain across the warned area. Between 1 and 2 inches of rain have fallen.' },
    { label: 'Hazard', text: 'Flash flooding caused by thunderstorms.' },
    { label: 'Impacts', text: 'Flash flooding of small creeks and streams.' },
    { label: 'Places', text: 'Des Moines, Ankeny, Ames and Saylorville Lake.' },
  ]);
  assert.deepEqual(sections(advisory), [
    { label: 'What', text: 'Urban area and small stream flooding caused by excessive rainfall is expected.' },
    { label: 'Where', text: 'Boone County (central Iowa)' },
    { label: 'Impacts', text: 'Minor flooding in low-lying and poor drainage areas.' },
    { label: 'Details', text: 'At 1005 AM EST, heavy rain.\nAdditional rainfall amounts of 1 to 2 inches are expected.' },
  ]);
  assert.equal(areas('Portions of southwest Iowa, northwest Missouri.'), 'Portions of southwest Iowa, northwest Missouri.');
  assert.equal(advice(ffw), "Turn around, don't drown when encountering flooded roads. Most flood deaths occur in vehicles.");
});

test('weather alerts: a short line and the spoken version without the radar time stamp', () => {
  assert.equal(summary(ffw), 'Doppler radar indicated thunderstorms producing heavy rain across the warned area.');
  assert.equal(summary({ ...ffw, ai: { summary: 'Flash flooding underway around the metro' } }), 'Flash flooding underway around the metro');
  // The slogan isn't said; the next piece of advice is.
  assert.equal(speech(ffw, NOW), 'Flash Flood Warning until 9:00 AM. Doppler radar indicated thunderstorms producing heavy rain across the warned area. Most flood deaths occur in vehicles.');
  assert.equal(shortEvent('Flash Flood Warning'), 'Flash flood');
  assert.equal(shortEvent('Tornado'), 'Tornado');
  assert.ok(isNew(ffw, NOW) && !isNew(advisory, NOW));
});

test('weather alerts: worst first, the same kind merged, read all as names and end times', () => {
  const later = { ...advisory, id: 'urn:fa2', sent: at(-0.2), ends: at(2.5) };
  const list = alertList([fog, advisory, ffw, later, tornado], NOW);
  assert.deepEqual(list.map((a) => a.event), ['Tornado Warning', 'Flash Flood Warning', 'Flood Advisory', 'Special Weather Statement']);
  const fa = list[2];
  assert.equal(fa.count, 2);
  assert.equal(fa.id, 'urn:fa2');      // the newer one
  assert.equal(fa.ends, at(2.5));      // as long as the longest
  assert.equal(readAll(list.slice(0, 2), NOW), '2 weather alerts. Tornado Warning until 7:00 AM. Flash Flood Warning until 9:00 AM.');
  assert.equal(readAll([], NOW), '');
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

test('weather alerts: an update to an alert already said (a new id) stays quiet', () => {
  const update = { ...tornado, id: 'urn:tor.update' };
  assert.deepEqual(toSay([update], { mode: 'warnings', quiet: false, said: { [alertKey(tornado)]: NOW, [eventKey(tornado)]: NOW }, now: NOW }), []);
  // Once that kind has gone (its key forgotten), the next one is said.
  assert.deepEqual(toSay([update], { mode: 'warnings', quiet: false, said: { [alertKey(tornado)]: NOW }, now: NOW }), [update]);
});
