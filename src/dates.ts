/* Small local-calendar helpers for check-back dates and the look-back sheet. */

const DAY = 86_400_000;

export function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar days (safe across daylight-saving changes). */
export function addDays(ts: number, n: number) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Calendar months; the day of month is clamped (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(ts: number, n: number) {
  const d = new Date(ts);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/** Whole calendar days from today to `ts` (negative = in the past). */
const daysFromToday = (ts: number) => Math.round((startOfDay(ts) - startOfDay(Date.now())) / DAY);

/** "Mon, Dec 25"; the year is added when it isn't this year. */
export function fmtDay(ts: number) {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "today", "tomorrow", "yesterday", "in 30 days", "3 days ago". */
export function relDay(ts: number) {
  const n = daysFromToday(ts);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "a month ago", "3 months ago", "a year ago". */
export function relPast(ts: number) {
  const d = -daysFromToday(ts);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const unit = (n: number, one: string) => (n === 1 ? `a ${one} ago` : `${n} ${one}s ago`);
  if (d < 30) return unit(Math.floor(d / 7), 'week');
  if (d < 365) return unit(Math.floor(d / 30), 'month');
  return unit(Math.floor(d / 365), 'year');
}

/** The start of tomorrow: the earliest custom check-back date. */
export const tomorrow = (now = Date.now()) => addDays(startOfDay(now), 1);

/** Check-back quick picks, counted from the start of today. */
export function quickPicks(now = Date.now()) {
  const today = startOfDay(now);
  return [
    { label: '1 week', at: addDays(today, 7) },
    { label: '1 month', at: addMonths(today, 1) },
    { label: '3 months', at: addMonths(today, 3) },
  ];
}
