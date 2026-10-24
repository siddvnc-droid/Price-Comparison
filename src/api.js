// Free, keyless map services (both allow calls straight from the browser):
//   Photon (OpenStreetMap data) for address search: https://photon.komoot.io
//   OSRM for driving routes:                         https://project-osrm.org
// Both are public demo servers with fair-use limits. For heavier use, point these at
// your own instances.

export const ENDPOINTS = {
  photon: 'https://photon.komoot.io',
  osrm: 'https://router.project-osrm.org',
};

const METERS_PER_MILE = 1609.344;

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
}

async function getJson(url, { signal, timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, { signal: withTimeout(signal, timeoutMs) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

/** Turn Photon's address parts into a short title and a context line. */
export function describePlace(props) {
  const street = [props.housenumber, props.street].filter(Boolean).join(' ');
  const title = props.name || street || props.city || props.county || 'Unnamed place';
  const locality = props.city || props.town || props.village || props.locality || props.district || props.county;
  const context = [street !== title && street, locality !== title && locality, props.state !== locality && props.state]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
  const subtitle = context.join(', ');
  return { title, subtitle, label: subtitle ? `${title}, ${subtitle}` : title };
}

function toPlace(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  return { lat, lon, countryCode: feature.properties.countrycode, ...describePlace(feature.properties) };
}

/**
 * Address / place search. `near` ({ lat, lon }) nudges results toward a location.
 * Returns up to 6 places, US results first (all four services are US-based).
 */
export async function searchPlaces(query, { near, signal, fetchImpl } = {}) {
  const params = new URLSearchParams({ q: query, limit: '10', lang: 'en' });
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lon.toFixed(4));
  }
  const data = await getJson(`${ENDPOINTS.photon}/api/?${params}`, { signal, fetchImpl });
  const places = (data.features ?? []).map(toPlace);
  const seen = new Set();
  const unique = places.filter((place) => !seen.has(place.label) && seen.add(place.label));
  const inUS = unique.filter((place) => place.countryCode?.toUpperCase() === 'US');
  return (inUS.length ? inUS : unique).slice(0, 6);
}

/** Name for a coordinate (used for "use my location"). */
export async function reversePlace({ lat, lon }, { signal, fetchImpl } = {}) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: 'en' });
  const data = await getJson(`${ENDPOINTS.photon}/reverse?${params}`, { signal, fetchImpl });
  const feature = data.features?.[0];
  return feature ? describePlace(feature.properties) : null;
}

/** Driving route: { distanceMiles, durationMinutes, path: [{ lat, lon }], source: 'road' }. */
export async function getRoute(from, to, { signal, fetchImpl } = {}) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const params = new URLSearchParams({ overview: 'simplified', geometries: 'geojson', alternatives: 'false', steps: 'false' });
  const data = await getJson(`${ENDPOINTS.osrm}/route/v1/driving/${coords}?${params}`, { signal, fetchImpl });
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route) throw new Error(`No route found (${data.code ?? 'unknown error'})`);
  return {
    distanceMiles: route.distance / METERS_PER_MILE,
    durationMinutes: route.duration / 60,
    path: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    source: 'road',
  };
}
