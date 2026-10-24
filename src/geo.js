// Small geometry helpers. Points are { lat, lon }; polygons are arrays of [lat, lon].

const EARTH_RADIUS_MILES = 3958.8;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in miles. */
export function haversineMiles(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** bounds: [[south, west], [north, east]] */
export function inBounds({ lat, lon }, [[south, west], [north, east]]) {
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon({ lat, lon }, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const crosses =
      latI > lat !== latJ > lat && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(p, q, r) {
  const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  return Math.sign(value);
}

function segmentsIntersect(p1, p2, q1, q2) {
  // Collinear overlaps are ignored; they don't matter for zone checks.
  return (
    orientation(p1, p2, q1) !== orientation(p1, p2, q2) &&
    orientation(q1, q2, p1) !== orientation(q1, q2, p2)
  );
}

/**
 * True when a path (array of points) starts, ends, or passes through the polygon.
 * Checks edge crossings too, so a sparse route line that cuts through a zone still counts.
 */
export function pathTouchesPolygon(path, polygon) {
  if (path.some((point) => pointInPolygon(point, polygon))) return true;
  for (let i = 1; i < path.length; i++) {
    const a = [path[i - 1].lat, path[i - 1].lon];
    const b = [path[i].lat, path[i].lon];
    for (let j = 0, k = polygon.length - 1; j < polygon.length; k = j++) {
      if (segmentsIntersect(a, b, polygon[k], polygon[j])) return true;
    }
  }
  return false;
}
