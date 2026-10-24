// Local-time helpers used for time-based surcharges (rush hour, overnight, temporary fees).

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Wall-clock time for `date` in `timeZone` (an IANA name, or undefined for the device's zone).
 * Returns { day: 0-6 (Sunday = 0), minutes: minutes since midnight, date: "YYYY-MM-DD" }.
 */
export function localTime(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: WEEKDAYS[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function clockToMinutes(clock) {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * schedule: { days?: number[], start: "HH:MM", end: "HH:MM" }.
 * A window whose end is before its start wraps past midnight (e.g. 20:00-06:00).
 */
export function inSchedule(local, { days, start, end }) {
  if (days && !days.includes(local.day)) return false;
  const from = clockToMinutes(start);
  const to = clockToMinutes(end);
  return from <= to
    ? local.minutes >= from && local.minutes < to
    : local.minutes >= from || local.minutes < to;
}
