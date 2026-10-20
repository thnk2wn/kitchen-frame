import { test } from 'node:test';
import assert from 'node:assert/strict';
import { time, longDate, dow, dayName, dueLabel, timeRange, formatDate } from './format.js';

// The cached formatters must read exactly as the toLocale…String calls they replaced.
const days = [new Date(2026, 0, 1, 0, 5), new Date(2026, 2, 8, 12, 0), new Date(2026, 9, 20, 16, 34), new Date(2026, 11, 31, 23, 59)];

test('time and longDate match toLocale…String', () => {
  for (const d of days) {
    assert.equal(time(d), d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    assert.equal(longDate(d), d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
  }
});

test('short dates match toLocaleDateString', () => {
  const now = new Date(2026, 9, 20, 9);
  assert.equal(dow('2026-10-22'), new Date('2026-10-22T12:00').toLocaleDateString([], { weekday: 'short' }));
  assert.equal(dayName({ allDay: true, start: '2026-10-21' }, now), 'Tomorrow');
  assert.equal(dayName({ allDay: true, start: '2026-10-24' }, now), new Date('2026-10-24T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
  assert.equal(dueLabel('2026-10-25', now), new Date(2026, 9, 25).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
});

test('timeRange across noon and within it', () => {
  const am = new Date(2026, 9, 20, 11), pm = new Date(2026, 9, 20, 13), pm2 = new Date(2026, 9, 20, 14, 30);
  assert.equal(timeRange({ start: am.toISOString(), end: pm.toISOString() }), `${time(am)} – ${time(pm)}`);
  assert.equal(timeRange({ start: pm.toISOString(), end: pm2.toISOString() }), `${time(pm).split(/\s/)[0]} – ${time(pm2)}`);
});

test('formatDate reuses one formatter per set of options', () => {
  const d = days[2];
  assert.equal(formatDate(d, { month: 'short', day: 'numeric' }), d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
  assert.equal(formatDate(d, { month: 'short', day: 'numeric' }), formatDate(new Date(d), { month: 'short', day: 'numeric' }));
});
