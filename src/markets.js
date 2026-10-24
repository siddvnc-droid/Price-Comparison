// Rate cards for each city ("market").
//
// None of these four companies publish a live price API, so fares are estimated from the
// rates below. They are approximations gathered from public sources in October 2026:
// city regulators (NYC TLC, DC DFHV) for taxi meters, and rider-facing rate summaries for
// Uber and Lyft. Edit the numbers here to tune the estimates.
//
// Pricing models:
//   type 'rate'  -> base + perMile * miles + perMinute * minutes (Uber, Lyft, Empower)
//   type 'meter' -> taxi meter: flagDrop + perMile while moving, or perMinuteSlow when
//                   crawling below the meter's switch-over speed (Curb / taxis)
//   bookingFee   -> flat fee added after the fare (not affected by demand pricing)
//   minimum      -> minimum fare before fees
//   demand       -> [low, high] multipliers on the fare. Gives the estimate range
//                   (quiet times vs. busy/surge times).
//
// Surcharges (per service, optionally per product):
//   { label, amount }   flat fee         { label, percent }   percent of fare + booking fee
//   Optional conditions: zone (trip starts, ends or passes through a zone polygon),
//   schedule { days, start, end } in the market's local time, until "YYYY-MM-DD".
//
// status: 'available' | 'limited' (shown, but not picked as the cheapest because
// availability is uncertain) | 'unavailable'.

import { pointInPolygon } from './geo.js';

export const SERVICE_ORDER = ['uber', 'lyft', 'curb', 'empower'];

const WEEKDAYS = [1, 2, 3, 4, 5];

// Rough outlines, accurate to roughly 100 m. Polygons are [lat, lon] pairs.
const NYC_AREA = [
  [40.9155, -73.9195], // Riverdale, NYC / Yonkers line at the Hudson
  [40.905, -73.85],
  [40.89, -73.78], // Pelham Bay
  [40.8, -73.76],
  [40.765, -73.7], // Queens / Nassau line
  [40.69, -73.725],
  [40.64, -73.735],
  [40.595, -73.738], // Far Rockaway
  [40.54, -73.94], // Breezy Point
  [40.57, -74.015], // Sea Gate
  [40.49, -74.26], // Tottenville, Staten Island
  [40.555, -74.245],
  [40.638, -74.19], // Goethals Bridge
  [40.642, -74.07], // St. George
  [40.69, -74.03], // Upper Bay
  [40.7, -74.02], // The Battery
  [40.76, -74.008], // Hudson River, Midtown
  [40.85, -73.953], // George Washington Bridge
  [40.88, -73.925],
];

// Manhattan east and west shorelines, used to build the two Manhattan surcharge zones.
const MANHATTAN_EAST_SHORE_BELOW_60TH = [
  [40.759, -73.9585], // E 60th St / Queensboro Bridge
  [40.7485, -73.968], // E 42nd St
  [40.7445, -73.9715], // E 34th St
  [40.736, -73.9745], // E 23rd St
  [40.7285, -73.972], // E 14th St
  [40.718, -73.976], // Houston St
  [40.711, -73.978], // Corlears Hook
  [40.709, -73.9915], // Manhattan Bridge
  [40.7058, -74.0015], // South Street Seaport
  [40.7015, -74.0125], // Whitehall
  [40.7005, -74.017], // The Battery
  [40.7105, -74.0185], // Battery Park City
  [40.718, -74.015], // Tribeca
  [40.729, -74.0125], // Pier 40
  [40.742, -74.01], // W 14th St
  [40.757, -74.0055], // W 34th St
  [40.763, -74.001], // W 42nd St
  [40.7715, -73.995], // W 57th St
];

// NY State congestion surcharge area: Manhattan south of 96th Street.
const MANHATTAN_SOUTH_OF_96TH = [
  [40.7975, -73.9765], // W 96th St at the Hudson
  [40.7825, -73.9425], // E 96th St at the East River
  [40.7757, -73.944], // E 86th St
  [40.766, -73.9505], // E 72nd St
  ...MANHATTAN_EAST_SHORE_BELOW_60TH,
  [40.7815, -73.9885], // W 72nd St
];

// MTA Congestion Relief Zone: Manhattan at and south of 60th Street (started Jan 2025).
const CONGESTION_RELIEF_ZONE = [
  [40.774, -73.994], // W 60th St at the Hudson
  ...MANHATTAN_EAST_SHORE_BELOW_60TH,
];

const NYC = {
  id: 'nyc',
  name: 'New York City',
  area: NYC_AREA,
  timeZone: 'America/New_York',
  // Routing engines assume light traffic; city trips usually take longer than that.
  trafficFactor: 1.35,
  fallbackSpeedMph: 11,
  zones: {
    manhattanSouthOf96th: MANHATTAN_SOUTH_OF_96TH,
    congestionReliefZone: CONGESTION_RELIEF_ZONE,
  },
  services: {
    uber: {
      status: 'available',
      surcharges: [
        { label: 'Black Car Fund', percent: 2.5 },
        { label: 'Sales tax', percent: 8.875 },
        { label: 'NY State congestion surcharge', amount: 2.75, zone: 'manhattanSouthOf96th' },
        { label: 'MTA congestion toll', amount: 1.5, zone: 'congestionReliefZone' },
      ],
      products: [
        { id: 'uberx', name: 'UberX', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.55, perMile: 1.75, perMinute: 0.35, minimum: 8 } },
        { id: 'comfort', name: 'Uber Comfort', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 3.2, perMile: 2.2, perMinute: 0.45, minimum: 10 } },
        { id: 'uberxl', name: 'UberXL', seats: 6, demand: [1, 1.45],
          pricing: { type: 'rate', base: 3.85, perMile: 2.85, perMinute: 0.55, minimum: 12 } },
        { id: 'black', name: 'Uber Black', seats: 4, demand: [1, 1.3],
          pricing: { type: 'rate', base: 7, perMile: 3.75, perMinute: 0.65, minimum: 15 } },
      ],
    },
    lyft: {
      status: 'available',
      surcharges: [
        { label: 'Black Car Fund', percent: 2.5 },
        { label: 'Sales tax', percent: 8.875 },
        { label: 'NY State congestion surcharge', amount: 2.75, zone: 'manhattanSouthOf96th' },
        { label: 'MTA congestion toll', amount: 1.5, zone: 'congestionReliefZone' },
      ],
      products: [
        { id: 'standard', name: 'Lyft Standard', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.5, perMile: 1.69, perMinute: 0.33, minimum: 7.75 } },
        { id: 'extra_comfort', name: 'Lyft Extra Comfort', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 3.2, perMile: 2.15, perMinute: 0.43, minimum: 10 } },
        { id: 'xl', name: 'Lyft XL', seats: 6, demand: [1, 1.45],
          pricing: { type: 'rate', base: 3.75, perMile: 2.75, perMinute: 0.53, minimum: 12 } },
      ],
    },
    curb: {
      status: 'available',
      // NYC TLC yellow taxi rates: $3.00 initial, 70 cents per 1/5 mile or per minute in slow traffic.
      surcharges: [
        { label: 'Improvement surcharge', amount: 1 },
        { label: 'MTA state surcharge', amount: 0.5 },
        { label: 'Rush hour surcharge', amount: 2.5, schedule: { days: WEEKDAYS, start: '16:00', end: '20:00' } },
        { label: 'Overnight surcharge', amount: 1, schedule: { start: '20:00', end: '06:00' } },
        { label: 'NY State congestion surcharge', amount: 2.5, zone: 'manhattanSouthOf96th' },
        { label: 'MTA congestion toll', amount: 0.75, zone: 'congestionReliefZone' },
      ],
      products: [
        { id: 'taxi', name: 'Yellow taxi', seats: 4, demand: [1, 1.1],
          pricing: { type: 'meter', flagDrop: 3, perMile: 3.5, perMinuteSlow: 0.7, bookingFee: 2 } },
      ],
    },
    empower: {
      status: 'available',
      note: 'Drivers set their own prices. Empower is not licensed by the NYC TLC and the city has sued to shut it down, so it does not add city surcharges.',
      products: [
        // Reported to average roughly 25-35% below Uber and Lyft (Obi, Q1 2026).
        { id: 'empower', name: 'Empower', seats: 4, demand: [0.9, 1.25],
          pricing: { type: 'rate', base: 2.5, perMile: 1.4, perMinute: 0.3, minimum: 7 } },
      ],
    },
  },
};

const DC = {
  id: 'dc',
  name: 'Washington, DC',
  area: [
    [39.03, -77.2],
    [39.03, -76.88],
    [38.76, -76.88],
    [38.76, -77.2],
  ],
  timeZone: 'America/New_York',
  trafficFactor: 1.3,
  fallbackSpeedMph: 14,
  zones: {},
  services: {
    uber: {
      status: 'available',
      products: [
        { id: 'uberx', name: 'UberX', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 1.85, perMile: 1.45, perMinute: 0.28, bookingFee: 2.35, minimum: 7 } },
        { id: 'comfort', name: 'Uber Comfort', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.4, perMile: 1.85, perMinute: 0.36, bookingFee: 2.35, minimum: 9 } },
        { id: 'uberxl', name: 'UberXL', seats: 6, demand: [1, 1.45],
          pricing: { type: 'rate', base: 3, perMile: 2.3, perMinute: 0.42, bookingFee: 2.35, minimum: 10 } },
        { id: 'black', name: 'Uber Black', seats: 4, demand: [1, 1.3],
          pricing: { type: 'rate', base: 8, perMile: 3.55, perMinute: 0.6, minimum: 15 } },
      ],
    },
    lyft: {
      status: 'available',
      products: [
        { id: 'standard', name: 'Lyft Standard', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 1.75, perMile: 1.4, perMinute: 0.26, bookingFee: 2.4, minimum: 6.75 } },
        { id: 'extra_comfort', name: 'Lyft Extra Comfort', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.3, perMile: 1.8, perMinute: 0.34, bookingFee: 2.4, minimum: 8.75 } },
        { id: 'xl', name: 'Lyft XL', seats: 6, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.9, perMile: 2.25, perMinute: 0.4, bookingFee: 2.4, minimum: 9.75 } },
      ],
    },
    curb: {
      status: 'available',
      // DC DFHV taxi rates (Aug 2024): $4.00 flag drop, $2.56/mile, $25/hour waiting.
      surcharges: [{ label: 'Fuel surcharge (temporary)', amount: 1, until: '2026-12-25' }],
      products: [
        { id: 'taxi', name: 'DC taxi', seats: 4, demand: [1, 1.1],
          pricing: { type: 'meter', flagDrop: 4, perMile: 2.56, perMinuteSlow: 25 / 60, bookingFee: 2 } },
      ],
    },
    empower: {
      status: 'limited',
      note: 'A DC court order reportedly forced Empower to stop operating in the District in April 2026. Check the app before counting on it.',
      products: [
        // Empower has advertised fares about 20% below Uber and Lyft in DC.
        { id: 'empower', name: 'Empower', seats: 4, demand: [0.9, 1.25],
          pricing: { type: 'rate', base: 1.5, perMile: 1.15, perMinute: 0.22, minimum: 6 } },
      ],
    },
  },
};

// Used everywhere else: US-average rates.
export const DEFAULT_MARKET = {
  id: 'us',
  name: 'US average',
  timeZone: undefined, // the device's own time zone
  trafficFactor: 1.15,
  fallbackSpeedMph: 22,
  zones: {},
  services: {
    uber: {
      status: 'available',
      products: [
        { id: 'uberx', name: 'UberX', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 1.25, perMile: 0.97, perMinute: 0.32, bookingFee: 2.75, minimum: 7 } },
        { id: 'comfort', name: 'Uber Comfort', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 1.7, perMile: 1.3, perMinute: 0.4, bookingFee: 2.75, minimum: 8.5 } },
        { id: 'uberxl', name: 'UberXL', seats: 6, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.25, perMile: 1.65, perMinute: 0.45, bookingFee: 2.75, minimum: 9.5 } },
        { id: 'black', name: 'Uber Black', seats: 4, demand: [1, 1.3],
          pricing: { type: 'rate', base: 7, perMile: 3.25, perMinute: 0.55, minimum: 15 } },
      ],
    },
    lyft: {
      status: 'available',
      products: [
        { id: 'standard', name: 'Lyft Standard', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 1.2, perMile: 0.95, perMinute: 0.3, bookingFee: 2.7, minimum: 6.75 } },
        { id: 'extra_comfort', name: 'Lyft Extra Comfort', seats: 4, demand: [1, 1.45],
          pricing: { type: 'rate', base: 1.65, perMile: 1.25, perMinute: 0.38, bookingFee: 2.7, minimum: 8.25 } },
        { id: 'xl', name: 'Lyft XL', seats: 6, demand: [1, 1.45],
          pricing: { type: 'rate', base: 2.2, perMile: 1.6, perMinute: 0.42, bookingFee: 2.7, minimum: 9.25 } },
      ],
    },
    curb: {
      status: 'limited',
      note: 'Curb works with taxi fleets in major metros such as Boston, Chicago, Los Angeles, Miami, Philadelphia and San Francisco. This is a typical US taxi meter rate.',
      products: [
        { id: 'taxi', name: 'Taxi', seats: 4, demand: [1, 1.1],
          pricing: { type: 'meter', flagDrop: 3.25, perMile: 2.7, perMinuteSlow: 0.5, bookingFee: 2 } },
      ],
    },
    empower: {
      status: 'unavailable',
      note: 'Empower mainly operates in New York City, with smaller footprints reported in Washington DC, Baltimore, South Florida and Winston-Salem / Greensboro.',
      products: [],
    },
  },
};

export const MARKETS = [NYC, DC];

/** The market whose area contains the pickup point, or the US-average fallback. */
export function findMarket(point) {
  return MARKETS.find((market) => pointInPolygon(point, market.area)) ?? DEFAULT_MARKET;
}
