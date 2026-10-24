import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describePlace, getRoute, searchPlaces } from '../src/api.js';
import { formatDuration, formatMiles, formatPercentChange, formatRange } from '../src/format.js';
import { bookingLink } from '../src/links.js';

const fakeFetch = (body, { ok = true, status = 200 } = {}) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok, status, json: async () => body };
  };
  return { fetchImpl, calls };
};

const feature = (lon, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

test('describePlace builds a readable title and context line', () => {
  assert.deepEqual(
    describePlace({ name: 'Empire State Building', housenumber: '350', street: '5th Avenue', city: 'New York', state: 'New York' }),
    { title: 'Empire State Building', subtitle: '350 5th Avenue, New York', label: 'Empire State Building, 350 5th Avenue, New York' },
  );
  assert.deepEqual(describePlace({ housenumber: '50', street: 'Massachusetts Avenue NE', city: 'Washington', state: 'District of Columbia' }), {
    title: '50 Massachusetts Avenue NE',
    subtitle: 'Washington, District of Columbia',
    label: '50 Massachusetts Avenue NE, Washington, District of Columbia',
  });
});

test('searchPlaces parses Photon results, prefers US places and sends the location bias', async () => {
  const { fetchImpl, calls } = fakeFetch({
    features: [
      feature(-0.1236, 51.5308, { name: 'Union Station', city: 'London', countrycode: 'GB' }),
      feature(-77.0065, 38.8977, { name: 'Union Station', city: 'Washington', state: 'District of Columbia', countrycode: 'US' }),
      feature(-77.0065, 38.8977, { name: 'Union Station', city: 'Washington', state: 'District of Columbia', countrycode: 'US' }),
    ],
  });
  const places = await searchPlaces('union station', { near: { lat: 38.9, lon: -77.03 }, fetchImpl });
  assert.equal(places.length, 1, 'non-US and duplicate results dropped');
  assert.deepEqual(
    { lat: places[0].lat, lon: places[0].lon, label: places[0].label },
    { lat: 38.8977, lon: -77.0065, label: 'Union Station, Washington, District of Columbia' },
  );
  const url = new URL(calls[0]);
  assert.equal(url.origin + url.pathname, 'https://photon.komoot.io/api/');
  assert.equal(url.searchParams.get('q'), 'union station');
  assert.equal(url.searchParams.get('lat'), '38.9000');
  assert.equal(url.searchParams.get('lon'), '-77.0300');
});

test('searchPlaces surfaces HTTP errors', async () => {
  const { fetchImpl } = fakeFetch({}, { ok: false, status: 429 });
  await assert.rejects(searchPlaces('anything', { fetchImpl }), /429/);
});

test('getRoute converts OSRM meters/seconds to miles/minutes and [lon, lat] to points', async () => {
  const { fetchImpl, calls } = fakeFetch({
    code: 'Ok',
    routes: [{ distance: 8046.72, duration: 900, geometry: { coordinates: [[-73.9855, 40.758], [-73.9754, 40.6826]] } }],
  });
  const route = await getRoute({ lat: 40.758, lon: -73.9855 }, { lat: 40.6826, lon: -73.9754 }, { fetchImpl });
  assert.ok(Math.abs(route.distanceMiles - 5) < 1e-9);
  assert.equal(route.durationMinutes, 15);
  assert.deepEqual(route.path, [{ lat: 40.758, lon: -73.9855 }, { lat: 40.6826, lon: -73.9754 }]);
  assert.equal(route.source, 'road');
  assert.match(calls[0], /\/route\/v1\/driving\/-73\.9855,40\.758;-73\.9754,40\.6826\?/);
});

test('getRoute rejects when OSRM finds no route', async () => {
  const { fetchImpl } = fakeFetch({ code: 'NoRoute', routes: [] });
  await assert.rejects(getRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, { fetchImpl }), /NoRoute/);
});

test('booking links carry pickup and drop-off for Uber and Lyft', () => {
  const from = { lat: 40.758, lon: -73.9855, label: 'Times Square' };
  const to = { lat: 40.6826, lon: -73.9754, label: 'Barclays Center' };

  const uber = new URL(bookingLink('uber', from, to));
  assert.equal(uber.origin + uber.pathname, 'https://m.uber.com/ul/');
  assert.equal(uber.searchParams.get('action'), 'setPickup');
  assert.equal(uber.searchParams.get('pickup[latitude]'), '40.758');
  assert.equal(uber.searchParams.get('dropoff[longitude]'), '-73.9754');
  assert.equal(uber.searchParams.get('dropoff[formatted_address]'), 'Barclays Center');

  const lyft = new URL(bookingLink('lyft', from, to));
  assert.equal(lyft.origin + lyft.pathname, 'https://lyft.com/ride');
  assert.equal(lyft.searchParams.get('id'), 'lyft');
  assert.equal(lyft.searchParams.get('destination[latitude]'), '40.6826');

  assert.equal(bookingLink('curb', from, to), 'https://gocurb.com/');
  assert.equal(bookingLink('empower', from, to), 'https://www.driveempower.com/');
});

test('formatting helpers', () => {
  assert.equal(formatRange(18.4, 24.2), '$18–25');
  assert.equal(formatRange(18, 18), '$18');
  assert.equal(formatMiles(4.83), '4.8 mi');
  assert.equal(formatMiles(23.6), '24 mi');
  assert.equal(formatDuration(0.2), '1 min');
  assert.equal(formatDuration(42.4), '42 min');
  assert.equal(formatDuration(60), '1 hr');
  assert.equal(formatDuration(95), '1 hr 35 min');
  assert.equal(formatPercentChange(1.45), '+45%');
  assert.equal(formatPercentChange(0.9), '−10%');
});
