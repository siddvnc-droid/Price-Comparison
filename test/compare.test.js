import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareRides, estimateRoute } from '../src/compare.js';
import { DEFAULT_MARKET } from '../src/markets.js';

const timesSquare = { lat: 40.758, lon: -73.9855, label: 'Times Square' };
const barclays = { lat: 40.6826, lon: -73.9754, label: 'Barclays Center' };
const astoria = { lat: 40.7644, lon: -73.9235, label: 'Astoria' };
const flushing = { lat: 40.7580, lon: -73.8303, label: 'Flushing' };
const unionStation = { lat: 38.8977, lon: -77.0065, label: 'Union Station' };
const dupontCircle = { lat: 38.9096, lon: -77.0434, label: 'Dupont Circle' };
const chicagoLoop = { lat: 41.8781, lon: -87.6298, label: 'Chicago Loop' };
const ohare = { lat: 41.9742, lon: -87.9073, label: "O'Hare" };

const weekdayNoon = new Date('2026-10-21T16:00:00Z'); // Wed 12:00 PM in New York
const weekdayRush = new Date('2026-10-21T21:30:00Z'); // Wed 5:30 PM in New York

const road = (distanceMiles, durationMinutes, path) => ({ distanceMiles, durationMinutes, path, source: 'road' });
const service = (result, id) => result.services.find((s) => s.id === id);
const product = (result, serviceId, productId) => service(result, serviceId).products.find((p) => p.id === productId);
const hasLine = (quote, label) => quote.breakdown.some((line) => line.label.startsWith(label));

test('NYC trip prices all four services and ranks them cheapest first', () => {
  const result = compareRides({ from: timesSquare, to: barclays, route: road(6, 25, [timesSquare, barclays]), at: weekdayNoon });

  assert.equal(result.market.id, 'nyc');
  assert.deepEqual(result.services.map((s) => s.id).sort(), ['curb', 'empower', 'lyft', 'uber']);
  assert.ok(result.services.every((s) => s.status === 'available' && s.best));
  const lows = result.services.map((s) => s.best.low);
  assert.deepEqual(lows, [...lows].sort((a, b) => a - b), 'sorted by cheapest option');
  assert.equal(result.cheapest.serviceId, result.services[0].id);
  assert.ok(result.savings > 0);

  // Road routes are light-traffic times, scaled up for city traffic.
  assert.ok(Math.abs(result.trip.durationMinutes - 25 * 1.35) < 1e-9);

  for (const s of result.services) {
    for (const p of s.products) {
      assert.ok(p.low <= p.standard + 0.01 || p.demand[0] < 1, `${p.name} low <= standard`);
      assert.ok(p.high >= p.low, `${p.name} high >= low`);
    }
  }
});

test('Manhattan trips pick up the congestion surcharge and toll; outer-borough trips do not', () => {
  const manhattan = compareRides({ from: timesSquare, to: barclays, route: road(6, 25, [timesSquare, barclays]), at: weekdayNoon });
  assert.deepEqual(manhattan.zones.sort(), ['congestionReliefZone', 'manhattanSouthOf96th']);
  const uberX = product(manhattan, 'uber', 'uberx');
  assert.ok(hasLine(uberX, 'NY State congestion surcharge'));
  assert.ok(hasLine(uberX, 'MTA congestion toll'));
  assert.ok(!hasLine(product(manhattan, 'empower', 'empower'), 'NY State congestion surcharge'), 'Empower adds no city fees');

  const queens = compareRides({ from: astoria, to: flushing, route: road(6, 20, [astoria, flushing]), at: weekdayNoon });
  assert.deepEqual(queens.zones, []);
  assert.ok(!hasLine(product(queens, 'uber', 'uberx'), 'NY State congestion surcharge'));
});

test('taxi rush hour surcharge only applies on weekday evenings', () => {
  const route = road(6, 25, [astoria, flushing]);
  const noon = compareRides({ from: astoria, to: flushing, route, at: weekdayNoon });
  const rush = compareRides({ from: astoria, to: flushing, route, at: weekdayRush });
  const noonTaxi = product(noon, 'curb', 'taxi');
  const rushTaxi = product(rush, 'curb', 'taxi');
  assert.ok(!hasLine(noonTaxi, 'Rush hour surcharge'));
  assert.ok(hasLine(rushTaxi, 'Rush hour surcharge'));
  assert.equal(Math.round((rushTaxi.standard - noonTaxi.standard) * 100) / 100, 2.5);
});

test('DC: Empower is shown but never picked as cheapest because its availability is uncertain', () => {
  const result = compareRides({ from: unionStation, to: dupontCircle, route: road(2.6, 12, [unionStation, dupontCircle]), at: weekdayNoon });
  assert.equal(result.market.id, 'dc');
  const empower = service(result, 'empower');
  assert.equal(empower.status, 'limited');
  assert.ok(empower.best.low > 0);
  assert.notEqual(result.cheapest.serviceId, 'empower');
  assert.equal(result.services.at(-1).id, 'empower', 'limited services sort after available ones');
});

test('outside NYC and DC: US-average rates and Empower marked unavailable', () => {
  const result = compareRides({ from: chicagoLoop, to: ohare, route: road(17, 30, [chicagoLoop, ohare]), at: weekdayNoon });
  assert.equal(result.market.id, 'us');
  const empower = service(result, 'empower');
  assert.equal(empower.status, 'unavailable');
  assert.equal(empower.best, null);
  assert.equal(result.services.at(-1).id, 'empower');
  assert.equal(service(result, 'curb').status, 'limited');
  assert.ok(['uber', 'lyft'].includes(result.cheapest.serviceId));
});

test('without a road route, the trip is estimated from a straight line', () => {
  const result = compareRides({ from: timesSquare, to: barclays, route: null, at: weekdayNoon });
  assert.equal(result.trip.source, 'estimate');
  assert.ok(result.trip.distanceMiles > 5 && result.trip.distanceMiles < 8, `got ${result.trip.distanceMiles}`);
  assert.ok(result.services.every((s) => s.best));

  const estimate = estimateRoute(chicagoLoop, ohare, DEFAULT_MARKET);
  assert.ok(Math.abs(estimate.durationMinutes - (estimate.distanceMiles / 22) * 60) < 1e-9);
});
