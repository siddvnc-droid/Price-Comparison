// Page wiring: address search, map, and rendering the comparison.

import { getRoute, reversePlace, searchPlaces } from './api.js';
import { compareRides } from './compare.js';
import { formatDuration, formatMiles, formatMoney, formatPercentChange, formatRange } from './format.js';
import { haversineMiles } from './geo.js';
import { bookingLink } from './links.js';

class UserError extends Error {}

const $ = (selector) => document.querySelector(selector);
const form = $('#trip-form');
const compareButton = $('#compare-btn');
const statusLine = $('#form-status');
const resultsSection = $('#results');
const summaryCard = $('#summary');
const serviceList = $('#service-list');
const inputs = { from: $('#from-input'), to: $('#to-input') };

const state = { from: null, to: null, busy: false };

/** Tiny element builder. Strings become text nodes, so external data is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

function svgIcon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function showStatus(message, kind = 'info') {
  statusLine.textContent = message;
  statusLine.classList.toggle('is-error', kind === 'error');
}

function setBusy(busy) {
  state.busy = busy;
  compareButton.setAttribute('aria-busy', String(busy));
  compareButton.textContent = busy ? 'Comparing…' : 'Compare prices';
}

// ---------- Map ----------

let map = null;
let tripLayer = null;

function initMap() {
  const L = window.L;
  if (!L) {
    // Map library didn't load (offline or blocked). Everything else still works.
    $('.map-card').hidden = true;
    return;
  }
  map = L.map('map', { scrollWheelZoom: false }).setView([39.5, -97], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  tripLayer = L.layerGroup().addTo(map);
}

function pinIcon(letter) {
  return window.L.divIcon({
    className: '',
    html: `<div class="map-pin pin-${letter.toLowerCase()}">${letter}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Show the chosen points, plus the route line once we have one. */
function drawMap(path = null, isEstimate = false) {
  if (!map) return;
  const L = window.L;
  tripLayer.clearLayers();
  const points = [];
  if (path) {
    const line = path.map((p) => [p.lat, p.lon]);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#2f6fed';
    L.polyline(line, { color, weight: 5, opacity: 0.85, dashArray: isEstimate ? '8 10' : null }).addTo(tripLayer);
    points.push(...line);
  }
  for (const [key, letter] of [['from', 'A'], ['to', 'B']]) {
    const place = state[key];
    if (!place) continue;
    L.marker([place.lat, place.lon], { icon: pinIcon(letter), title: place.label, keyboard: false }).addTo(tripLayer);
    points.push([place.lat, place.lon]);
  }
  if (points.length === 1) map.setView(points[0], 14);
  else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
}

// ---------- Place fields ----------

function setPlace(key, place) {
  state[key] = place;
  inputs[key].value = place ? place.label : '';
  resultsSection.hidden = true;
  drawMap();
}

/** Search-as-you-type combobox for one input. */
function setUpPlaceField(key) {
  const input = inputs[key];
  const list = $(`#${key}-list`);
  let results = [];
  let active = -1;
  let timer = null;
  let request = null;

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const choose = (index) => {
    const place = results[index];
    close();
    if (!place) return;
    setPlace(key, place);
    showStatus('');
    if (state.from && state.to) compare();
    else inputs[key === 'from' ? 'to' : 'from'].focus();
  };

  const render = () => {
    list.replaceChildren(
      ...results.map((place, index) =>
        h(
          'li',
          {
            id: `${list.id}-${index}`,
            class: 'suggestion',
            role: 'option',
            'aria-selected': String(index === active),
            // mousedown fires before the input loses focus
            onmousedown: (event) => {
              event.preventDefault();
              choose(index);
            },
          },
          h('span', { class: 'suggestion-title', text: place.title }),
          place.subtitle && h('span', { class: 'suggestion-sub', text: place.subtitle }),
        ),
      ),
    );
    list.hidden = results.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', () => {
    state[key] = null;
    clearTimeout(timer);
    request?.abort();
    const query = input.value.trim();
    if (query.length < 3) {
      results = [];
      close();
      return;
    }
    timer = setTimeout(async () => {
      request = new AbortController();
      try {
        results = await searchPlaces(query, { near: nearPoint(key), signal: request.signal });
        active = -1;
        render();
      } catch (error) {
        if (error.name === 'AbortError') return;
        results = [];
        close();
        showStatus("Address search isn't responding right now. Try again in a moment.", 'error');
      }
    }, 300);
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden || !results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % results.length;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + results.length) % results.length;
      render();
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  return { close };
}

/** Bias search toward the other end of the trip, so "Union Station" finds the nearby one. */
function nearPoint(key) {
  return state[key === 'from' ? 'to' : 'from'] ?? state[key] ?? null;
}

/** Use the chosen suggestion, or fall back to the top search result for whatever was typed. */
async function resolvePlace(key) {
  if (state[key]) return state[key];
  const text = inputs[key].value.trim();
  if (!text) throw new UserError(key === 'from' ? 'Enter a pickup location.' : 'Enter a drop-off location.');
  let places;
  try {
    places = await searchPlaces(text, { near: nearPoint(key) });
  } catch {
    throw new UserError("Address search isn't responding right now. Try again in a moment.");
  }
  if (!places.length) throw new UserError(`Couldn't find “${text}”. Try a fuller address.`);
  setPlace(key, places[0]);
  return places[0];
}

// ---------- Compare ----------

async function compare() {
  if (state.busy) return;
  fields.from.close();
  fields.to.close();
  setBusy(true);
  showStatus('');
  try {
    const from = await resolvePlace('from');
    const to = await resolvePlace('to');
    if (haversineMiles(from, to) < 0.05) throw new UserError('Pickup and drop-off are the same place.');

    let route = null;
    try {
      route = await getRoute(from, to);
    } catch {
      route = null; // compareRides falls back to a straight-line estimate
    }
    const result = compareRides({ from, to, route });
    renderResults(result, from, to);
    drawMap(result.trip.path, result.trip.source === 'estimate');
    saveToUrl(from, to);
  } catch (error) {
    if (error instanceof UserError) showStatus(error.message, 'error');
    else {
      console.error(error);
      showStatus('Something went wrong. Check your connection and try again.', 'error');
    }
  } finally {
    setBusy(false);
  }
}

// ---------- Rendering ----------

function departureLabel(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

function rangeNote([low, high]) {
  if (low === 1 && high === 1) return null;
  if (low === 1) return `Higher end covers busy times: up to ${formatPercentChange(high)} on the fare.`;
  return `Range covers quiet times (${formatPercentChange(low)}) to busy times (${formatPercentChange(high)}).`;
}

function renderSummary(result) {
  const { trip, market, cheapest, priciest, savings } = result;
  const facts = [
    formatMiles(trip.distanceMiles),
    `about ${formatDuration(trip.durationMinutes)}`,
    `${market.name} rates`,
    departureLabel(result.departure, market.timeZone),
  ];
  const children = [h('ul', { class: 'trip-facts' }, facts.map((fact) => h('li', { text: fact })))];

  if (cheapest) {
    children.push(
      h('h2', { class: 'headline' }, `${cheapest.name} looks cheapest: ${formatRange(cheapest.product.low, cheapest.product.high)}`),
    );
    const price = `about ${formatMoney(cheapest.product.standard)} at normal demand.`;
    const sub = [cheapest.product.name === cheapest.name ? `That's ${price}` : `${cheapest.product.name}, ${price}`];
    if (priciest && savings >= 1) sub.push(`Saves about ${formatMoney(savings)} compared with ${priciest.name}.`);
    children.push(h('p', { class: 'headline-sub', text: sub.join(' ') }));
  }
  if (trip.source === 'estimate') {
    children.push(
      h('p', {
        class: 'notice',
        text: "Couldn't reach the routing service, so distance and time are estimated from a straight line. Prices are rougher than usual.",
      }),
    );
  }
  summaryCard.replaceChildren(...children);
}

function renderProduct(product) {
  const note = rangeNote(product.demand);
  return h(
    'li',
    {},
    h(
      'details',
      {},
      h(
        'summary',
        {},
        h('span', { class: 'product-name' }, product.name, h('span', { class: 'product-seats', text: `${product.seats} seats` })),
        h('span', { class: 'product-price', text: formatRange(product.low, product.high) }),
      ),
      h(
        'div',
        { class: 'breakdown-wrap' },
        h(
          'table',
          { class: 'breakdown' },
          h('caption', { class: 'sr-only', text: `${product.name} fare breakdown` }),
          h(
            'tbody',
            {},
            product.breakdown.map((line) =>
              h('tr', {}, h('td', { text: line.label }), h('td', { class: 'num', text: formatMoney(line.amount) })),
            ),
          ),
          h(
            'tfoot',
            {},
            h('tr', {}, h('th', { scope: 'row', text: 'Normal-demand estimate' }), h('td', { class: 'num', text: formatMoney(product.standard) })),
          ),
        ),
        note && h('p', { class: 'range-note', text: note }),
      ),
    ),
  );
}

function renderService(service, result, from, to) {
  const isCheapest = result.cheapest?.serviceId === service.id;
  const badges = [];
  if (isCheapest) badges.push(h('span', { class: 'badge badge-good', text: 'Cheapest' }));
  if (service.status === 'limited') badges.push(h('span', { class: 'badge badge-warn', text: 'Limited availability' }));
  if (service.status === 'unavailable') badges.push(h('span', { class: 'badge', text: 'Not available here' }));

  const link = bookingLink(service.id, from, to);
  return h(
    'li',
    {},
    h(
      'article',
      {
        class: `card service${service.status === 'unavailable' ? ' is-unavailable' : ''}`,
        'data-service': service.id,
        'aria-label': service.name,
      },
      h(
        'header',
        { class: 'service-head' },
        h('div', { class: 'service-title' }, h('h3', { text: service.name }), badges),
        service.best && h('div', { class: 'service-price', text: formatRange(service.best.low, service.best.high) }),
      ),
      service.products.length > 0 && h('ul', { class: 'products' }, service.products.map(renderProduct)),
      service.note && h('p', { class: 'service-note', text: service.note }),
      service.status !== 'unavailable' &&
        link &&
        h(
          'a',
          { class: 'open-link', href: link, target: '_blank', rel: 'noopener' },
          `Open ${service.name}`,
          svgIcon(['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5']),
        ),
    ),
  );
}

function renderResults(result, from, to) {
  renderSummary(result);
  serviceList.replaceChildren(...result.services.map((service) => renderService(service, result, from, to)));
  resultsSection.hidden = false;
  if (window.matchMedia('(max-width: 899px)').matches) {
    summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------- Shareable URLs ----------

function saveToUrl(from, to) {
  const params = new URLSearchParams({
    from: `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`,
    fromName: from.label,
    to: `${to.lat.toFixed(5)},${to.lon.toFixed(5)}`,
    toName: to.label,
  });
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function placeFromUrl(params, key) {
  const value = params.get(key);
  if (!value) return null;
  const [lat, lon] = value.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const label = params.get(`${key}Name`) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return { lat, lon, label, title: label, subtitle: '' };
}

// ---------- Buttons ----------

function useMyLocation(button) {
  if (!navigator.geolocation) {
    showStatus("This browser can't share your location.", 'error');
    return;
  }
  button.disabled = true;
  showStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const point = { lat: coords.latitude, lon: coords.longitude };
      let label = 'Current location';
      try {
        label = (await reversePlace(point))?.label ?? label;
      } catch {
        // Keep the generic label; the coordinates are what matter.
      }
      setPlace('from', { ...point, label, title: label, subtitle: '' });
      button.disabled = false;
      showStatus('');
      if (state.to) compare();
      else inputs.to.focus();
    },
    (error) => {
      button.disabled = false;
      showStatus(error.code === error.PERMISSION_DENIED ? 'Location access was blocked.' : "Couldn't get your location.", 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

function swapPlaces() {
  const { from, to } = state;
  const fromText = inputs.from.value;
  const toText = inputs.to.value;
  state.from = to;
  state.to = from;
  inputs.from.value = toText;
  inputs.to.value = fromText;
  resultsSection.hidden = true;
  drawMap();
  if (state.from && state.to) compare();
}

// ---------- Start ----------

const fields = { from: setUpPlaceField('from'), to: setUpPlaceField('to') };
initMap();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  compare();
});
$('#locate-btn').addEventListener('click', (event) => useMyLocation(event.currentTarget));
$('#swap-btn').addEventListener('click', swapPlaces);

const params = new URLSearchParams(location.search);
const sharedFrom = placeFromUrl(params, 'from');
const sharedTo = placeFromUrl(params, 'to');
if (sharedFrom) setPlace('from', sharedFrom);
if (sharedTo) setPlace('to', sharedTo);
if (sharedFrom && sharedTo) compare();
