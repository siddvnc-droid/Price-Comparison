// Display formatting.

export function formatMoney(amount) {
  return `$${amount.toFixed(2)}`;
}

/** "$18–25" (rounded outward to whole dollars), or "$18" when the range collapses. */
export function formatRange(low, high) {
  const from = Math.floor(low);
  const to = Math.ceil(high);
  return from === to ? `$${from}` : `$${from}–${to}`;
}

export function formatMiles(miles) {
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export function formatDuration(minutes) {
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function formatPercentChange(multiplier) {
  return `${multiplier >= 1 ? '+' : '−'}${Math.round(Math.abs(multiplier - 1) * 100)}%`;
}
