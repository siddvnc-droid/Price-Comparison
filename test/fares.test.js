import assert from 'node:assert/strict';
import { test } from 'node:test';

import { meteredFare, quoteProduct, quoteService, surchargeApplies } from '../src/fares.js';

const weekdayNoon = { day: 3, minutes: 12 * 60, date: '2026-10-21' };
const context = (overrides = {}) => ({ zones: new Set(), local: weekdayNoon, ...overrides });
const sum = (lines) => Math.round(lines.reduce((total, line) => total + line.amount, 0) * 100) / 100;

const uberLike = {
  id: 'x',
  name: 'Test X',
  seats: 4,
  demand: [1, 1.5],
  pricing: { type: 'rate', base: 2, perMile: 1.5, perMinute: 0.3, bookingFee: 2.5, minimum: 7 },
};

test('rate pricing: base + distance + time', () => {
  const { total, lines } = meteredFare(uberLike.pricing, { distanceMiles: 5, durationMinutes: 20 });
  assert.equal(total, 2 + 7.5 + 6);
  assert.deepEqual(lines.map((l) => l.amount), [2, 7.5, 6]);
});

test('meter pricing charges distance when moving and time when crawling', () => {
  const meter = { type: 'meter', flagDrop: 3, perMile: 3.5, perMinuteSlow: 0.7 };
  // Switch-over speed is 0.70 * 60 / 3.50 = 12 mph.
  // 6 miles in 20 minutes (18 mph): pure distance.
  assert.equal(meteredFare(meter, { distanceMiles: 6, durationMinutes: 20 }).total, 3 + 21);
  // 2 miles in 30 minutes (4 mph): every minute is slow, so it bills by time.
  assert.equal(meteredFare(meter, { distanceMiles: 2, durationMinutes: 30 }).total, 3 + 0.7 * 30);
  // 3 miles in 25 minutes: 15 minutes at 12 mph covers the distance, 10 minutes are slow.
  assert.equal(meteredFare(meter, { distanceMiles: 3, durationMinutes: 25 }).total, 3 + 10.5 + 7);
});

test('quoteProduct gives a demand range and a breakdown that adds up', () => {
  const quote = quoteProduct(uberLike, [], { distanceMiles: 5, durationMinutes: 20 }, context());
  // fare 15.50 + booking 2.50
  assert.equal(quote.standard, 18);
  assert.equal(quote.low, 18);
  assert.equal(quote.high, 15.5 * 1.5 + 2.5);
  assert.equal(sum(quote.breakdown), quote.standard);
});

test('minimum fare applies before the booking fee', () => {
  const quote = quoteProduct(uberLike, [], { distanceMiles: 0.5, durationMinutes: 2 }, context());
  // metered 2 + 0.75 + 0.60 = 3.35, topped up to the $7 minimum, plus $2.50 booking fee
  assert.equal(quote.standard, 9.5);
  assert.equal(quote.low, 9.5);
  assert.ok(quote.breakdown.some((l) => l.label.startsWith('Minimum fare top-up') && l.amount === 3.65));
  assert.equal(sum(quote.breakdown), quote.standard);
});

test('percent surcharges apply to fare plus booking fee; flat ones are added on top', () => {
  const surcharges = [
    { label: 'Tax', percent: 10 },
    { label: 'Zone fee', amount: 2.75, zone: 'downtown' },
  ];
  const trip = { distanceMiles: 5, durationMinutes: 20 };
  const outside = quoteProduct(uberLike, surcharges, trip, context());
  assert.equal(outside.standard, 18 * 1.1);
  const inside = quoteProduct(uberLike, surcharges, trip, context({ zones: new Set(['downtown']) }));
  assert.equal(inside.standard, 18 * 1.1 + 2.75);
  assert.equal(sum(inside.breakdown), inside.standard);
  // Busy-time pricing scales the fare, and tax follows it, but flat fees don't scale.
  assert.equal(inside.high, Math.round(((15.5 * 1.5 + 2.5) * 1.1 + 2.75) * 100) / 100);
});

test('surchargeApplies respects zones, schedules and end dates', () => {
  const rush = { label: 'Rush', amount: 2.5, schedule: { days: [1, 2, 3, 4, 5], start: '16:00', end: '20:00' } };
  assert.equal(surchargeApplies(rush, context()), false);
  assert.equal(surchargeApplies(rush, context({ local: { day: 3, minutes: 17 * 60, date: '2026-10-21' } })), true);

  const temporary = { label: 'Fuel', amount: 1, until: '2026-12-25' };
  assert.equal(surchargeApplies(temporary, context()), true);
  assert.equal(surchargeApplies(temporary, context({ local: { ...weekdayNoon, date: '2026-12-25' } })), true);
  assert.equal(surchargeApplies(temporary, context({ local: { ...weekdayNoon, date: '2026-12-26' } })), false);
});

test('quoteService picks the cheapest product and skips unavailable services', () => {
  const service = {
    status: 'available',
    products: [
      { ...uberLike, id: 'big', pricing: { ...uberLike.pricing, base: 6 } },
      uberLike,
    ],
  };
  const result = quoteService(service, { distanceMiles: 5, durationMinutes: 20 }, context());
  assert.equal(result.products.length, 2);
  assert.equal(result.best.id, 'x');

  const none = quoteService({ status: 'unavailable', note: 'Not here', products: [] }, { distanceMiles: 1, durationMinutes: 5 }, context());
  assert.deepEqual(none, { status: 'unavailable', note: 'Not here', products: [], best: null });
});
