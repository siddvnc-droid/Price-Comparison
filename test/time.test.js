import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inSchedule, localTime } from '../src/time.js';

test('localTime converts to the market time zone, including daylight saving', () => {
  // 2026-10-23 21:30 UTC is Friday 5:30 PM in New York (EDT, UTC-4).
  assert.deepEqual(localTime(new Date('2026-10-23T21:30:00Z'), 'America/New_York'), {
    day: 5,
    minutes: 17 * 60 + 30,
    date: '2026-10-23',
  });
  // 2026-01-10 03:15 UTC is Friday 10:15 PM the previous day in New York (EST, UTC-5).
  assert.deepEqual(localTime(new Date('2026-01-10T03:15:00Z'), 'America/New_York'), {
    day: 5,
    minutes: 22 * 60 + 15,
    date: '2026-01-09',
  });
  // Midnight must come out as 0, not 24.
  assert.equal(localTime(new Date('2026-10-24T04:00:00Z'), 'America/New_York').minutes, 0);
});

test('inSchedule handles weekday windows and windows that wrap past midnight', () => {
  const rush = { days: [1, 2, 3, 4, 5], start: '16:00', end: '20:00' };
  const overnight = { start: '20:00', end: '06:00' };
  const at = (day, hh, mm = 0) => ({ day, minutes: hh * 60 + mm });

  assert.equal(inSchedule(at(5, 16), rush), true);
  assert.equal(inSchedule(at(5, 19, 59), rush), true);
  assert.equal(inSchedule(at(5, 20), rush), false);
  assert.equal(inSchedule(at(6, 17), rush), false, 'Saturday');

  assert.equal(inSchedule(at(2, 23), overnight), true);
  assert.equal(inSchedule(at(2, 5, 59), overnight), true);
  assert.equal(inSchedule(at(2, 6), overnight), false);
  assert.equal(inSchedule(at(2, 12), overnight), false);
});
