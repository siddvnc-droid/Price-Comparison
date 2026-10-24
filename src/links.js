// Service names and "open in app" links.
// Uber and Lyft accept pickup/drop-off in their links; Curb and Empower don't publish
// a link format, so those open the service's website (which points to the app).

export const SERVICES = {
  uber: { name: 'Uber', website: 'https://www.uber.com/' },
  lyft: { name: 'Lyft', website: 'https://www.lyft.com/' },
  curb: { name: 'Curb', website: 'https://gocurb.com/' },
  empower: { name: 'Empower', website: 'https://www.driveempower.com/' },
};

/** from / to: { lat, lon, label? } */
export function bookingLink(serviceId, from, to) {
  if (serviceId === 'uber') {
    const params = new URLSearchParams({
      action: 'setPickup',
      'pickup[latitude]': from.lat,
      'pickup[longitude]': from.lon,
      'dropoff[latitude]': to.lat,
      'dropoff[longitude]': to.lon,
    });
    if (from.label) params.set('pickup[formatted_address]', from.label);
    if (to.label) params.set('dropoff[formatted_address]', to.label);
    return `https://m.uber.com/ul/?${params}`;
  }
  if (serviceId === 'lyft') {
    const params = new URLSearchParams({
      id: 'lyft',
      'pickup[latitude]': from.lat,
      'pickup[longitude]': from.lon,
      'destination[latitude]': to.lat,
      'destination[longitude]': to.lon,
    });
    return `https://lyft.com/ride?${params}`;
  }
  return SERVICES[serviceId]?.website ?? null;
}
