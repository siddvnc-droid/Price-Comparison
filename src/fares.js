// Fare engine: turns a rate card plus a trip into a price range and an itemized breakdown.

import { inSchedule } from './time.js';

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `$${n.toFixed(2)}`;
const miles = (n) => `${n.toFixed(1)} mi`;
const minutes = (n) => `${Math.round(n)} min`;

/** Fare before minimums, fees and surcharges, with the lines that make it up. */
export function meteredFare(pricing, trip) {
  const { distanceMiles, durationMinutes } = trip;

  if (pricing.type === 'meter') {
    // A taxi meter charges by distance while moving and by time while crawling. At the
    // switch-over speed both rates are equal, so: full distance charge, plus the extra
    // minutes beyond what the trip would take at that speed.
    const switchSpeedMph = pricing.slowSpeedMph ?? (pricing.perMinuteSlow * 60) / pricing.perMile;
    const slowMinutes = Math.max(0, durationMinutes - (distanceMiles / switchSpeedMph) * 60);
    const lines = [
      { label: 'Flag drop', amount: pricing.flagDrop },
      { label: `Distance (${miles(distanceMiles)} × ${money(pricing.perMile)})`, amount: distanceMiles * pricing.perMile },
    ];
    if (slowMinutes >= 0.5) {
      lines.push({
        label: `Slow traffic (${minutes(slowMinutes)} × ${money(pricing.perMinuteSlow)})`,
        amount: slowMinutes * pricing.perMinuteSlow,
      });
    }
    return finish(lines);
  }

  if (pricing.type === 'rate') {
    return finish([
      { label: 'Base fare', amount: pricing.base },
      { label: `Distance (${miles(distanceMiles)} × ${money(pricing.perMile)})`, amount: distanceMiles * pricing.perMile },
      { label: `Time (${minutes(durationMinutes)} × ${money(pricing.perMinute)})`, amount: durationMinutes * pricing.perMinute },
    ]);
  }

  throw new Error(`Unknown pricing type: ${pricing.type}`);
}

function finish(lines) {
  const rounded = lines.map((line) => ({ ...line, amount: round2(line.amount) }));
  return { lines: rounded, total: rounded.reduce((sum, line) => sum + line.amount, 0) };
}

/** context: { zones: Set of zone ids the trip touches, local: localTime(...) result } */
export function surchargeApplies(surcharge, context) {
  if (surcharge.zone && !context.zones.has(surcharge.zone)) return false;
  if (surcharge.schedule && !inSchedule(context.local, surcharge.schedule)) return false;
  if (surcharge.until && context.local.date > surcharge.until) return false;
  return true;
}

/**
 * Price one product (e.g. UberX).
 * Returns { id, name, seats, low, high, standard, breakdown, demand }.
 * `standard` is the normal-demand price; `breakdown` itemizes it and sums to it exactly.
 */
export function quoteProduct(product, surcharges, trip, context) {
  const { pricing } = product;
  const metered = meteredFare(pricing, trip);
  const minimum = pricing.minimum ?? 0;
  const bookingFee = pricing.bookingFee ?? 0;
  const applicable = surcharges.filter((s) => surchargeApplies(s, context));
  const flatFees = applicable.filter((s) => s.amount != null);
  const percentFees = applicable.filter((s) => s.percent != null);

  const totalAt = (multiplier) => {
    const fare = Math.max(metered.total * multiplier, minimum);
    const taxable = fare + bookingFee;
    const percent = percentFees.reduce((sum, s) => sum + (taxable * s.percent) / 100, 0);
    const flat = flatFees.reduce((sum, s) => sum + s.amount, 0);
    return taxable + percent + flat;
  };

  const breakdown = [...metered.lines];
  if (metered.total < minimum) {
    breakdown.push({ label: `Minimum fare top-up (minimum ${money(minimum)})`, amount: round2(minimum - metered.total) });
  }
  if (bookingFee) breakdown.push({ label: 'Booking fee', amount: bookingFee });
  const taxable = Math.max(metered.total, minimum) + bookingFee;
  for (const s of percentFees) {
    breakdown.push({ label: `${s.label} (${s.percent}%)`, amount: round2((taxable * s.percent) / 100) });
  }
  for (const s of flatFees) breakdown.push({ label: s.label, amount: s.amount });

  const [lowDemand, highDemand] = product.demand ?? [1, 1];
  return {
    id: product.id,
    name: product.name,
    seats: product.seats,
    demand: [lowDemand, highDemand],
    low: round2(totalAt(lowDemand)),
    high: round2(totalAt(highDemand)),
    standard: round2(breakdown.reduce((sum, line) => sum + line.amount, 0)),
    breakdown,
  };
}

/** Price every product a service offers in this market. */
export function quoteService(serviceConfig, trip, context) {
  const { status, note, surcharges = [], products = [] } = serviceConfig;
  if (status === 'unavailable') return { status, note, products: [], best: null };

  const quotes = products.map((product) =>
    quoteProduct(product, [...surcharges, ...(product.surcharges ?? [])], trip, context),
  );
  const best = quotes.reduce((a, b) => (b.low < a.low ? b : a), quotes[0]) ?? null;
  return { status, note, products: quotes, best };
}
