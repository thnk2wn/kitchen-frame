import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expand, merge, prefilter, cleanNotes, splitNotes, place } from './calendar.js';

const DAY = 864e5;
const now = Date.parse('2026-10-12T12:00:00Z');
const from = now - DAY, to = now + 14 * DAY;
const google = readFileSync(new URL('./fixtures/google.ics', import.meta.url), 'utf8');
const icloud = readFileSync(new URL('./fixtures/icloud.ics', import.meta.url), 'utf8');

const titles = (evs, t) => evs.filter((e) => e.title === t);

test('weekly recurrence honours EXDATE, moved and cancelled instances', () => {
  const evs = expand(google, 0, from, to);
  const soccer = titles(evs, 'Soccer practice').map((e) => e.start).sort();
  // Mon/Wed 5 PM CDT = 22:00Z. Oct 14 is EXDATE, Oct 19 moved, Oct 21 cancelled.
  assert.deepEqual(soccer, ['2026-10-12T22:00:00.000Z']); // Oct 26 starts after the window
  const late = titles(evs, 'Soccer practice (late start)');
  assert.equal(late.length, 1);
  assert.equal(late[0].start, '2026-10-19T23:00:00.000Z');
  assert.equal(late[0].end, '2026-10-20T00:30:00.000Z');
  assert.equal(titles(evs, 'Soccer practice')[0].location, 'Riverside Park, Field 3');
});

test('daily event since 1995 expands only inside the window', () => {
  const vit = titles(expand(google, 0, from, to), 'Vitamins');
  assert.equal(vit.length, 15); // Oct 11 (ends after `from`) through Oct 25
  assert.ok(vit.every((e) => e.start.endsWith('T12:00:00.000Z'))); // 7 AM CDT
});

test('all-day multi-day events keep plain dates, end exclusive', () => {
  const [g] = titles(expand(google, 0, from, to), 'Grandma visiting');
  assert.deepEqual([g.allDay, g.start, g.end], [true, '2026-10-16', '2026-10-19']);
});

test('old one-off events are dropped before parsing', () => {
  const reduced = prefilter(google, from, to);
  assert.ok(!reduced.includes('Old event'));
  assert.ok(reduced.includes('BEGIN:VTIMEZONE'));
  assert.equal(titles(expand(google, 0, from, to), 'Old event').length, 0);
});

test('iCloud feed: folded lines, TZID, floating time and all-day', () => {
  const evs = expand(icloud, 1, from, to);
  assert.equal(evs.find((e) => e.uid === '6A1B2C3D-BOOK-CLUB').title,
    "Book club at Sarah's with a deliberately long title so the line gets folded");
  assert.equal(evs.find((e) => e.uid === '6A1B2C3D-BOOK-CLUB').start, '2026-10-15T23:00:00.000Z'); // 7 PM EDT
  // Floating time uses the calendar's X-WR-TIMEZONE (New York).
  assert.equal(titles(evs, 'Farmers market')[0].start, '2026-10-17T14:00:00.000Z');
  assert.deepEqual(titles(evs, 'Trash pickup').map((e) => [e.start, e.end]), [['2026-10-20', '2026-10-21']]);
});

test('merge sorts both calendars and drops the shared invite duplicate', () => {
  const evs = merge([expand(google, 0, from, to), expand(icloud, 1, from, to)]);
  assert.equal(titles(evs, 'Dentist').length, 1);
  assert.deepEqual(new Set(evs.map((e) => e.cal)), new Set([0, 1]));
  const starts = evs.map((e) => Date.parse(e.start));
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(!('startMs' in evs[0]));
});

test('DST change keeps wall-clock time', () => {
  const nov = Date.parse('2026-10-30T00:00:00Z');
  const vit = titles(expand(google, 0, nov, nov + 5 * DAY), 'Vitamins').map((e) => e.start);
  assert.ok(vit.includes('2026-10-31T12:00:00.000Z')); // CDT
  assert.ok(vit.includes('2026-11-02T13:00:00.000Z')); // CST
});

test('fast-forwarded monthly and yearly rules match a full walk', () => {
  const feed = (rule) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r\r\nSUMMARY:R\r\nDTSTART;TZID=America/Chicago:20030115T090000\r\nDTEND;TZID=America/Chicago:20030115T100000\r\nRRULE:${rule}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  for (const [rule, expected] of [
    ['FREQ=MONTHLY', ['2026-10-15T14:00:00.000Z']],
    ['FREQ=MONTHLY;INTERVAL=5', ['2026-10-15T14:00:00.000Z']], // Oct 2026 is 285 = 5 × 57 months on
    ['FREQ=MONTHLY;INTERVAL=7', []], // 285 isn't a multiple of 7
    ['FREQ=MONTHLY;INTERVAL=3', ['2026-10-15T14:00:00.000Z']],
    ['FREQ=MONTHLY;BYDAY=2TU', ['2026-10-13T14:00:00.000Z']],
    ['FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=20', ['2026-10-20T14:00:00.000Z']],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', ['2026-10-22T14:00:00.000Z']],
  ]) {
    // COUNT disables fast-forward, so the same rule with a huge COUNT is the reference walk.
    const full = expand(feed(rule + ';COUNT=100000'), 0, from, to).map((e) => e.start);
    const fast = expand(feed(rule), 0, from, to).map((e) => e.start);
    assert.deepEqual(fast, full, rule);
    assert.deepEqual(fast, expected, rule);
  }
});

test('events tagged #private or marked private never reach the frame', () => {
  const ev = (uid, lines) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20261013T150000Z\r\nDTEND:20261013T160000Z\r\n${lines}\r\nEND:VEVENT\r\n`;
  const feed = 'BEGIN:VCALENDAR\r\n' +
    ev('a', 'SUMMARY:Dentist') +
    ev('b', 'SUMMARY:Anniversary dinner #private') +
    ev('c', 'SUMMARY:Pick up gift\r\nDESCRIPTION:Jeweller on Main St. #Private') +
    ev('d', 'SUMMARY:Planning call\r\nCLASS:CONFIDENTIAL') +
    ev('e', 'SUMMARY:Lunch #privateish') +
    'END:VCALENDAR\r\n';
  assert.deepEqual(expand(feed, 0, from, to).map((e) => e.title).sort(), ['Dentist', 'Lunch #privateish']);
});

const withNotes = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:swim', 'SUMMARY:Swim lesson', 'DTSTART:20261012T210000Z', 'DTEND:20261012T214500Z',
  'RRULE:FREQ=WEEKLY;COUNT=3', 'DESCRIPTION:Swim lesson\\nBring goggles\\nSign up: https://pool.example.com/x', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

test('event notes are kept only when asked for, once per event', () => {
  assert.ok(expand(withNotes, 0, from, to).every((e) => !('notes' in e))); // off by default
  const evs = merge([expand(withNotes, 1, from, to, 'UTC', { notes: true })]);
  assert.equal(evs.length, 2); // Oct 12 and 19 (Oct 26 is after the window)
  assert.ok(evs.every((e) => e.notes === 'Bring goggles'));
  assert.deepEqual(splitNotes(evs), { swim: 'Bring goggles' });
  assert.ok(evs.every((e) => !('notes' in e)));
});

test('notes: links, bare labels, a repeated title and HTML are cleaned up', () => {
  const sports = '[W] Football vs Furman\nW 56-9\nTV: SEC Network+\nStreaming Video: https://www.espn.com/watch/x\nTickets: https://tickets.example.com/y';
  assert.equal(cleanNotes(sports, '[W] Football vs Furman'), 'W 56-9\nTV: SEC Network+');
  // Unencoded spaces in a link (seen in a real ticket link) don't leave its tail behind.
  assert.equal(cleanNotes('TV: ABC\nTickets: https://tickets.example.com/e/1?utm_medium=schedule page&utm_campaign=F26 vs Alabama&CAMEFROM=X'), 'TV: ABC');
  assert.equal(cleanNotes('<p>Bring <b>snacks</b> &amp; water<br>Gate 3</p><p>Join: <a href="https://zoom.us/j/1">https://zoom.us/j/1</a></p>'), 'Bring snacks & water\nGate 3');
  assert.equal(cleanNotes('Agenda\n________________\n\n\n\nItem one'), 'Agenda\n\nItem one');
  assert.equal(cleanNotes('x'.repeat(1500)).length, 1000);
  assert.equal(cleanNotes('  '), '');
});

test('place: links in a location are dropped; a meeting link alone becomes "Video call"', () => {
  assert.equal(place('https://acme.zoom.us/j/123456789?pwd=abc'), 'Video call');
  assert.equal(place('Microsoft Teams Meeting'), 'Video call');
  assert.equal(place('https://teams.microsoft.com/l/meetup-join/19%3a…'), 'Video call');
  assert.equal(place('Room 4B; https://zoom.us/j/123'), 'Room 4B');
  assert.equal(place('https://example.com/signup'), '');
  assert.equal(place('Riverside Park, Field 3'), 'Riverside Park, Field 3');
  assert.equal(place('  '), '');
});

test('alarm: the event\'s own reminder, in minutes, when 0 to 120 minutes before it starts', () => {
  const ics = (alarms) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261020T150000Z',
    'DTEND:20261020T160000Z', 'SUMMARY:Swim lesson', ...alarms.flatMap((t) => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER' + t, 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const at = (alarms) => expand(ics(alarms), 0, Date.UTC(2026, 9, 19), Date.UTC(2026, 9, 22), 'UTC')[0].alarm;
  assert.equal(at([':-PT10M']), 10);
  assert.equal(at([':-PT10M', ':-PT30M', ':-P1D']), 30);   // the longest within two hours
  assert.equal(at([':-P1D']), undefined);                   // only a day before: none
  assert.equal(at([';RELATED=END:-PT5M']), undefined);      // relative to the end: skipped
  assert.equal(at([]), undefined);
});
