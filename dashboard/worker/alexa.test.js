// The Worker runs on UTC (Cloudflare), and the demo day is worked out as it does (alexa.js wallClock).
process.env.TZ = 'UTC';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCert, certUrlOk, tabOf, handleAlexa, todaySpeech, isoSeconds } from './alexa.js';

// Throwaway certificates made with openssl for each run (nothing key-like is kept in the repo).
let dir, amazon, other, key;
const make = (name, san) => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, name + '.key'), '-out', join(dir, name + '.pem'),
    '-days', '2', '-subj', '/CN=' + san.split(',')[0], '-addext', 'subjectAltName=' + san.split(',').map((d) => 'DNS:' + d).join(',')], { stdio: 'ignore' });
  return readFileSync(join(dir, name + '.pem'), 'utf8');
};
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'alexa-'));
  amazon = make('amazon', 'echo-api.amazon.com');
  other = make('other', 'example.com,www.example.com');
  key = readFileSync(join(dir, 'amazon.key'), 'utf8');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('alexa certificate: names, validity and key read from the PEM', () => {
  const c = readCert(amazon);
  assert.deepEqual(c.names, ['echo-api.amazon.com']);
  assert.ok(c.notBefore <= Date.now() && c.notAfter > Date.now());
  assert.equal(c.spki[0], 0x30);
  assert.deepEqual(readCert(other).names, ['example.com', 'www.example.com']);
  assert.throws(() => readCert('nothing'));
});

test('alexa certificate address: only Amazon\'s echo.api folder on s3, over https', () => {
  assert.ok(certUrlOk('https://s3.amazonaws.com/echo.api/echo-api-cert.pem'));
  assert.ok(certUrlOk('https://S3.AMAZONAWS.COM:443/echo.api/../echo.api/echo-api-cert.pem'));
  for (const u of ['http://s3.amazonaws.com/echo.api/c.pem', 'https://notamazon.com/echo.api/c.pem', 'https://s3.amazonaws.com/EcHo.aPi/c.pem',
    'https://s3.amazonaws.com:563/echo.api/c.pem', 'https://s3.amazonaws.com/invalid.path/c.pem', 'https://s3.amazonaws.com/echo.api/../evil/c.pem', ''])
    assert.equal(certUrlOk(u), false, u);
});

test('alexa words: tabs', () => {
  assert.equal(tabOf('Calendar'), 'calendar');
  assert.equal(tabOf('tasks'), 'todo');
  assert.equal(tabOf('videos'), 'videos');
  assert.equal(tabOf('garage'), null);
});

// A request as Amazon sends it: signed with the test certificate's key, served from a stubbed fetch.
const CERT_URL = 'https://s3.amazonaws.com/echo.api/test-cert.pem';
function signed(request, { skill = 'amzn1.ask.skill.test', user = 'amzn1.ask.account.me', pem, at = new Date(), attributes } = {}) {
  const body = JSON.stringify({
    version: '1.0',
    ...(attributes ? { session: { attributes } } : {}),
    context: { System: { application: { applicationId: skill }, user: { userId: user }, device: { deviceId: 'dev1' }, apiEndpoint: 'https://api.amazonalexa.com', apiAccessToken: 't' } },
    request: { timestamp: at.toISOString(), ...request },
  });
  const sig = createSign('RSA-SHA256').update(body).sign(key, 'base64');
  return { req: new Request('https://w/api/alexa', { method: 'POST', body, headers: { SignatureCertChainUrl: CERT_URL, 'Signature-256': sig } }), pem };
}
function stub(pem) {
  const cache = new Map();
  globalThis.caches = { default: { match: async (r) => (cache.has(r.url) ? new Response(cache.get(r.url)) : undefined), put: async (r, res) => { cache.set(r.url, await res.text()); } } };
  globalThis.fetch = async (u) => {
    if (u === CERT_URL) return new Response(pem);
    if (String(u).includes('System.timeZone')) return Response.json('America/Chicago');
    throw new Error('unexpected fetch ' + u);
  };
}
const env = { ALEXA_SKILL_ID: 'amzn1.ask.skill.test', YOUTUBE_VIDEOS: '' };
const speech = async (res) => (await res.json()).response.outputSpeech.text;

test('alexa: a signed request for this skill is answered; the frame gets the command', async () => {
  stub(amazon);
  const sent = [];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => ({ events: [] }), videoGroups: () => ['Songs', 'Trucks'], meals: async () => ({ meals: [] }), rotations: () => [] };
  let res = await handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'ShowTabIntent', slots: { tab: { value: 'calendar' } } } }).req, env, deps);
  assert.equal(await speech(res), 'Okay.');
  res = await handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'PlayVideosIntent', slots: { group: { value: "truck's" } } } }).req, env, deps);
  assert.match(await speech(res), /Playing Trucks/);
  res = await handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'TodayIntent' } }).req, env, deps);
  assert.equal(await speech(res), 'Nothing on the calendar.');
  assert.deepEqual(sent, [['show', { tab: 'calendar' }], ['playgroup', { group: 'Trucks' }], ['show', { tab: 'home' }]]); // today shows Home
});

test('alexa: refused when the signature, certificate, skill, account or time is wrong', async () => {
  const deps = { command: async () => 1, calendar: async () => ({}), videoGroups: () => [] };
  const launch = { type: 'LaunchRequest' };
  stub(other); // signed with the right key, but the certificate served isn't Amazon's
  assert.equal((await handleAlexa(signed(launch).req, env, deps)).status, 403);
  stub(amazon);
  const { req } = signed(launch);
  const tampered = new Request(req.url, { method: 'POST', headers: req.headers, body: (await req.text()).replace('LaunchRequest', 'IntentRequest') });
  assert.equal((await handleAlexa(tampered, env, deps)).status, 403);
  assert.equal((await handleAlexa(signed(launch, { skill: 'amzn1.ask.skill.someone-else' }).req, env, deps)).status, 403);
  assert.equal((await handleAlexa(signed(launch, { at: new Date(Date.now() - 300000) }).req, env, deps)).status, 400);
  const unsigned = new Request('https://w/api/alexa', { method: 'POST', body: '{}' });
  assert.equal((await handleAlexa(unsigned, env, deps)).status, 403);
  const res = await handleAlexa(signed(launch, { user: 'amzn1.ask.account.stranger' }).req, { ...env, ALEXA_USER_IDS: 'amzn1.ask.account.me' }, deps);
  assert.match(await speech(res), /only listens/);
  assert.equal((await handleAlexa(signed(launch).req, { ...env, ALEXA_USER_IDS: 'amzn1.ask.account.me' }, deps)).status, 200);
});

test('alexa: what\'s for dinner opens the recipe, or Meals when there are several', async () => {
  stub(amazon);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  let sent = [];
  let plan = [{ date: day, type: 'Dinner', title: 'Chicken Tacos', id: 'r1' }, { date: day, type: 'Lunch', title: 'Soup' }];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => ({}), videoGroups: () => [], meals: async () => ({ configured: true, meals: plan }), rotations: () => [] };
  const ask = () => handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'DinnerIntent' } }).req, env, deps);
  assert.equal(await speech(await ask()), 'Dinner is Chicken Tacos.');
  assert.deepEqual(sent, [['recipe', { id: 'r1', title: 'Chicken Tacos' }]]);
  sent = [];
  plan = [...plan, { date: day, type: 'Dinner', title: 'Salad' }];
  assert.equal(await speech(await ask()), 'Dinner is Chicken Tacos and Salad.');
  assert.deepEqual(sent, [['meals', undefined]]);
  plan = [];
  assert.equal(await speech(await ask()), 'Nothing is planned for dinner today.');
});

test('alexa: today reads Home\'s Today card in its order', () => {
  const tz = 'America/New_York';
  const now = new Date('2026-10-17T13:00:00Z'); // 9 AM there: up early hasn't switched yet
  const rules = [
    { name: 'Up early', switchAt: '10:00', days: { sat: 'Alex', sun: 'Sam' } },
    { name: 'Bedtime', alternate: { from: '2026-10-17', who: ['Alex', 'Sam'], what: ['Mia', 'Leo'] } },
  ];
  const cal = { events: [
    { allDay: false, start: '2026-10-17T19:30:00Z', title: 'Football' },
    { allDay: true, start: '2026-10-17', end: '2026-10-18', title: 'Trash day' },
    { allDay: false, start: '2026-10-18T19:30:00Z', title: 'Tomorrow thing' },
  ] };
  const meals = [{ date: '2026-10-17', type: 'Dinner', title: 'Tacos' }, { date: '2026-10-18', type: 'Dinner', title: 'Soup' }];
  assert.equal(todaySpeech({ cal, meals, rules, tz, now }),
    'Up early: Alex. Dinner: Tacos. 2 events: at 3:30 PM, Football; all day, Trash day. Bedtime: Alex with Mia, Sam with Leo.');
  // After 10 AM, up early moves to tomorrow, at the end.
  assert.match(todaySpeech({ cal: {}, meals: [], rules, tz, now: new Date('2026-10-17T15:00:00Z') }), /^Nothing on the calendar\. Bedtime: .*\. Tomorrow, Up early: Sam\.$/);
});

test('alexa: in demo mode, today and dinner read the frame\'s invented day', async () => {
  stub(amazon);
  const sent = [];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => { throw new Error('real calendar read in demo'); },
    videoGroups: () => [], meals: async () => { throw new Error('real meals read in demo'); }, rotations: () => [], demo: async () => true };
  const ask = (name) => handleAlexa(signed({ type: 'IntentRequest', intent: { name } }).req, env, deps);
  assert.match(await speech(await ask('TodayIntent')), /Dinner: Cajun spiced fish tacos\./);
  assert.equal(await speech(await ask('DinnerIntent')), 'Dinner is Cajun spiced fish tacos.');
  assert.deepEqual(sent, [['show', { tab: 'home' }], ['recipe', { id: 'mdb:52819', title: 'Cajun spiced fish tacos' }]]); // today shows Home; tonight's dish opens
});

test('alexa: in demo mode, a Videos group goes by its shown name', async () => {
  stub(amazon);
  const sent = [];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => ({}), videoGroups: () => ['Sam', 'Trucks'],
    meals: async () => ({}), rotations: () => [], demo: async () => true };
  const res = await handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'PlayVideosIntent', slots: { group: { value: 'kiddo' } } } }).req,
    { ...env, DEMO_NAMES: '{"Sam":"Kiddo"}' }, deps);
  assert.equal(await speech(res), 'Playing Kiddo on the frame. Tap it for sound.');
  assert.deepEqual(sent, [['playgroup', { group: 'Sam' }]]); // the frame plays the real group
});

import { demoMeals } from '../src/lib/demo.js';
test('demo meals: picked from the recipe library by date, the same every time', () => {
  const recipes = Array.from({ length: 12 }, (_, i) => ({ id: 'pap:r' + i, title: i === 0 ? 'Blueberry Pancakes' : 'Dish ' + i, hasImage: true, categories: i === 0 ? ['Breakfast'] : ['Dinner'] }));
  const now = new Date('2026-10-17T12:00:00');
  const a = demoMeals(now, recipes), b = demoMeals(now, [...recipes].reverse());
  assert.deepEqual(a, b);
  assert.ok(a.every((m) => m.title === 'Leftovers' || m.id.startsWith('pap:')));
  assert.equal(a.find((m) => m.type === 'Breakfast').title, 'Blueberry Pancakes');
  assert.equal(demoMeals(now, [])[0].id, 'mdb:52819'); // no library: TheMealDB dishes
});

test('alexa: adding to a list shows that list on the frame', async () => {
  stub(amazon);
  const sent = [];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => ({}), videoGroups: () => [], meals: async () => ({}), rotations: () => [] };
  const listEnv = { ...env, TODO_SOURCE: 'reminders', BRIDGE: { idFromName: () => 'home', get: () => ({ fetch: async () => new Response('{}') }) } };
  const res = await handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'AddTaskIntent', slots: { item: { value: 'call the dentist' } } } }).req, listEnv, deps);
  assert.equal(await speech(res), 'Added call the dentist to Tasks.');
  assert.deepEqual(sent, [['show', { tab: 'todo' }]]);
});

test('alexa: "show" with the screen missing asks which, and "go home" shows Home', async () => {
  stub(amazon);
  const sent = [];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => ({}), videoGroups: () => [], meals: async () => ({}), rotations: () => [] };
  const ask = async (name, slots) => (await handleAlexa(signed({ type: 'IntentRequest', intent: { name, slots } }).req, env, deps)).json();
  const r = await ask('ShowTabIntent', { tab: { name: 'tab' } });
  assert.match(r.response.outputSpeech.text, /^Which screen\?/);
  assert.equal(r.response.shouldEndSession, false);
  assert.equal((await ask('AMAZON.NavigateHomeIntent')).response.outputSpeech.text, 'Okay.');
  assert.deepEqual(sent, [['show', { tab: 'home' }]]);
});

test('alexa durations: ISO 8601 as seconds', () => {
  assert.equal(isoSeconds('PT10M'), 600);
  assert.equal(isoSeconds('PT1H30M'), 5400);
  assert.equal(isoSeconds('PT45S'), 45);
  assert.equal(isoSeconds('PT1.5M'), 90);
  assert.equal(isoSeconds('P1D'), 0);
  assert.equal(isoSeconds(''), 0);
});

test('alexa timers: start one on the frame, ask how long when unsaid, cancel and add', async () => {
  stub(amazon);
  const sent = [];
  const deps = { command: async (name, data) => { sent.push([name, data]); return 1; }, calendar: async () => ({}), videoGroups: () => [], meals: async () => ({}), rotations: () => [] };
  const ask = async (name, slots, attributes) => (await handleAlexa(signed({ type: 'IntentRequest', intent: { name, slots } }, { attributes }).req, env, deps)).json();
  let r = await ask('StartTimerIntent', { duration: { value: 'PT10M' }, name: { value: 'pasta' } });
  assert.equal(r.response.outputSpeech.text, 'Pasta timer, 10 minutes, on the frame.');
  r = await ask('StartTimerIntent', { duration: { value: 'PT5M' }, name: {} });
  assert.equal(r.response.outputSpeech.text, 'Timer, 5 minutes, on the frame.');
  // No time: Alexa asks, and the name said comes back with the answer.
  r = await ask('StartTimerIntent', { name: { value: 'bread' } });
  assert.equal(r.response.outputSpeech.text, 'For how long?');
  assert.equal(r.response.shouldEndSession, false);
  assert.deepEqual(r.sessionAttributes, { timerName: 'bread' });
  r = await ask('StartTimerIntent', { duration: { value: 'PT1H' } }, r.sessionAttributes);
  assert.equal(r.response.outputSpeech.text, 'Bread timer, 1 hour, on the frame.');
  assert.match((await ask('StartTimerIntent', { duration: { value: 'PT25H' } })).response.outputSpeech.text, /up to 24 hours/);
  assert.equal((await ask('CancelTimerIntent', { name: { value: 'pasta' } })).response.outputSpeech.text, 'Okay, cancelled.');
  assert.equal((await ask('AddTimeIntent', {})).response.outputSpeech.text, 'Added 1 minute.');
  assert.deepEqual(sent, [
    ['timer', { action: 'start', label: 'Pasta', seconds: 600 }],
    ['timer', { action: 'start', label: '5 min', seconds: 300 }],
    ['timer', { action: 'start', label: 'Bread', seconds: 3600 }],
    ['timer', { action: 'cancel', label: 'pasta' }],
    ['timer', { action: 'add', label: '', seconds: 60 }],
  ]);
  // The frame not connected: Alexa says so.
  deps.command = async () => 0;
  assert.match((await ask('StartTimerIntent', { duration: { value: 'PT3M' } })).response.outputSpeech.text, /isn't connected/);
});

import { skillEntry, heardEntry } from './alexa-log.js';
test('alexa log: each request the skill answers is noted with what it understood, said and sent', async () => {
  stub(amazon);
  const logged = [];
  const deps = { command: async () => 1, calendar: async () => ({}), videoGroups: () => [], meals: async () => ({}), rotations: () => [], log: (e) => logged.push(e) };
  await handleAlexa(signed({ type: 'IntentRequest', intent: { name: 'ShowTabIntent', slots: { tab: { name: 'tab', value: 'calendar' } } } }).req, env, deps);
  assert.deepEqual(logged[0], { source: 'skill', type: 'IntentRequest', intent: 'ShowTabIntent', slots: { tab: 'calendar' }, said: 'Okay.', directives: undefined, sent: 'show calendar', refused: undefined });
  await handleAlexa(signed({ type: 'LaunchRequest' }, { skill: 'amzn1.ask.skill.other' }).req, env, deps);
  assert.equal(logged[1].refused, 'another skill');
  assert.deepEqual(heardEntry({ device: 'Kitchen Dot', heard: 'alexa ask kitchen friend to go home', intent: 'AnnounceIntent', reply: 'announcing' }),
    { source: 'alexa', device: 'Kitchen Dot', heard: 'alexa ask kitchen friend to go home', intent: 'AnnounceIntent', reply: 'announcing', at: undefined });
  assert.equal(heardEntry({}), null);
  assert.equal(skillEntry({}, null, []).source, 'skill');
});
