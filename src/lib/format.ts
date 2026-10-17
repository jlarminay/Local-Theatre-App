import dayjs from 'dayjs';

// Showtime `start` values are theatre-local wall times without an offset, which
// dayjs reads as local time — right as long as the phone is in Victoria.

export function formatDay(start: string): string {
  const days = dayjs(start).startOf('day').diff(dayjs().startOf('day'), 'day');
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return dayjs(start).format('ddd, MMM D');
}

export function formatTime(start: string): string {
  return dayjs(start).format('h:mm a');
}

/** e.g. "Fri, Oct 16, 3:45 pm" */
export function formatDateTime(when: number | string): string {
  return dayjs(when).format('ddd, MMM D, h:mm a');
}

/** Calendar day of a showtime, for grouping, e.g. "2026-10-16". */
export function dayKey(start: string): string {
  return dayjs(start).format('YYYY-MM-DD');
}

/** `now` lets a ticking ref (useNow) drive re-renders. */
export function timeAgo(epochMs: number, now: number = Date.now()): string {
  const minutes = dayjs(now).diff(epochMs, 'minute');
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = dayjs(now).diff(epochMs, 'hour');
  if (hours < 24) return `${hours} h ago`;
  return `${dayjs(now).diff(epochMs, 'day')} d ago`;
}

export const LOW_SEATS = 20;
