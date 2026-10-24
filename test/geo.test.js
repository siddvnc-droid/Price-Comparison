import assert from 'node:assert/strict';
import { test } from 'node:test';

import { haversineMiles, pathTouchesPolygon, pointInPolygon } from '../src/geo.js';
import { DEFAULT_MARKET, findMarket, MARKETS } from '../src/markets.js';

const nyc = MARKETS.find((m) => m.id === 'nyc');
const place = (lat, lon) => ({ lat, lon });

test('haversineMiles matches a known distance', () => {
  // Times Square to the Empire State Building is roughly 0.6 miles as the crow flies.
  const miles = haversineMiles(place(40.758, -73.9855), place(40.7484, -73.9857));
  assert.ok(miles > 0.6 && miles < 0.72, `got ${miles}`);
  assert.equal(haversineMiles(place(40, -74), place(40, -74)), 0);
});

test('pointInPolygon handles inside, outside and concave shapes', () => {
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
  assert.equal(pointInPolygon(place(5, 5), square), true);
  assert.equal(pointInPolygon(place(15, 5), square), false);

  const ushape = [[0, 0], [0, 10], [10, 10], [10, 7], [3, 7], [3, 3], [10, 3], [10, 0]];
  assert.equal(pointInPolygon(place(5, 5), ushape), false, 'inside the notch');
  assert.equal(pointInPolygon(place(5, 1), ushape), true);
});

test('pathTouchesPolygon catches a line that crosses a zone with no point inside it', () => {
  const zone = [[4, 4], [4, 6], [6, 6], [6, 4]];
  assert.equal(pathTouchesPolygon([place(5, 0), place(5, 10)], zone), true);
  assert.equal(pathTouchesPolygon([place(0, 0), place(0, 10)], zone), false);
  assert.equal(pathTouchesPolygon([place(5, 5)], zone), true);
});

test('findMarket picks the city from the pickup point', () => {
  assert.equal(findMarket(place(40.758, -73.9855)).id, 'nyc', 'Times Square');
  assert.equal(findMarket(place(40.6413, -73.7781)).id, 'nyc', 'JFK');
  assert.equal(findMarket(place(40.5795, -74.1502)).id, 'nyc', 'Staten Island');
  assert.equal(findMarket(place(40.8448, -73.8648)).id, 'nyc', 'Bronx');
  assert.equal(findMarket(place(40.744, -74.0324)), DEFAULT_MARKET, 'Hoboken, NJ is not NYC');
  assert.equal(findMarket(place(40.7178, -74.0431)), DEFAULT_MARKET, 'Jersey City, NJ is not NYC');
  assert.equal(findMarket(place(38.8977, -77.0065)).id, 'dc', 'Union Station, DC');
  assert.equal(findMarket(place(38.8512, -77.0402)).id, 'dc', 'Reagan National Airport');
  assert.equal(findMarket(place(41.8781, -87.6298)), DEFAULT_MARKET, 'Chicago');
});

test('Manhattan surcharge zones have the right shape', () => {
  const { manhattanSouthOf96th: south96, congestionReliefZone: crz } = nyc.zones;
  const timesSquare = place(40.758, -73.9855);
  const upperWestSide80th = place(40.7838, -73.9775);
  const harlem = place(40.8116, -73.9465);
  const williamsburg = place(40.7081, -73.9571);
  const longIslandCity = place(40.7447, -73.9485);
  const jerseyCity = place(40.7178, -74.0431);

  assert.equal(pointInPolygon(timesSquare, south96), true);
  assert.equal(pointInPolygon(timesSquare, crz), true);
  assert.equal(pointInPolygon(upperWestSide80th, south96), true);
  assert.equal(pointInPolygon(upperWestSide80th, crz), false);
  for (const outside of [harlem, williamsburg, longIslandCity, jerseyCity]) {
    assert.equal(pointInPolygon(outside, south96), false);
    assert.equal(pointInPolygon(outside, crz), false);
  }
});
