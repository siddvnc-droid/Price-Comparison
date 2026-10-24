// Puts it together: picks the market, measures the trip, prices every service and ranks them.

import { quoteService } from './fares.js';
import { haversineMiles, pathTouchesPolygon } from './geo.js';
import { findMarket, SERVICE_ORDER } from './markets.js';
import { SERVICES } from './links.js';
import { localTime } from './time.js';

// Roads are rarely straight; this turns crow-flies distance into a typical driving distance.
const DETOUR_FACTOR = 1.3;

/** Rough trip when no road route is available: straight line, padded for real streets. */
export function estimateRoute(from, to, market) {
  const distanceMiles = haversineMiles(from, to) * DETOUR_FACTOR;
  return {
    distanceMiles,
    durationMinutes: (distanceMiles / market.fallbackSpeedMph) * 60,
    path: [from, to],
    source: 'estimate',
  };
}

const STATUS_RANK = { available: 0, limited: 1, unavailable: 2 };

/**
 * from / to: { lat, lon, label? }
 * route: result of getRoute() (source 'road'), or null to fall back to an estimate.
 * at: departure time, for time-based surcharges.
 */
export function compareRides({ from, to, route = null, at = new Date() }) {
  const market = findMarket(from);
  const measured = route ?? estimateRoute(from, to, market);
  // Road routing reports light-traffic times; scale up to typical city traffic.
  const durationMinutes =
    measured.source === 'road' ? measured.durationMinutes * market.trafficFactor : measured.durationMinutes;
  const trip = { distanceMiles: measured.distanceMiles, durationMinutes };

  const path = [from, ...(measured.path ?? []), to];
  const zones = new Set(
    Object.entries(market.zones)
      .filter(([, polygon]) => pathTouchesPolygon(path, polygon))
      .map(([id]) => id),
  );
  const local = localTime(at, market.timeZone);

  const services = SERVICE_ORDER.map((id) => ({
    id,
    name: SERVICES[id].name,
    ...quoteService(market.services[id], trip, { zones, local }),
  })).sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus || !a.best || !b.best) return byStatus;
    return a.best.low - b.best.low;
  });

  const bookable = services.filter((s) => s.status === 'available' && s.best);
  const cheapest = bookable[0] ?? null;
  const priciest = bookable.at(-1) ?? null;

  return {
    market: { id: market.id, name: market.name, timeZone: market.timeZone },
    trip: { ...trip, source: measured.source, path: measured.path ?? [from, to] },
    zones: [...zones],
    departure: at,
    services,
    cheapest: cheapest && { serviceId: cheapest.id, name: cheapest.name, product: cheapest.best },
    priciest: priciest && { serviceId: priciest.id, name: priciest.name, product: priciest.best },
    // Normal-demand saving of the cheapest ride against the priciest service's cheapest ride.
    savings: cheapest && priciest ? Math.max(0, priciest.best.standard - cheapest.best.standard) : 0,
  };
}
