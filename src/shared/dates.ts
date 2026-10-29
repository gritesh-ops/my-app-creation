/**
 * Small UTC date helpers used by the planner. Everything is date-only
 * (YYYY-MM-DD) so a student in any timezone sees the same deadline.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function nextBusinessDay(date: Date): Date {
  let cursor = new Date(date.getTime());
  while (isWeekend(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

export function addBusinessDays(date: Date, days: number): Date {
  let cursor = nextBusinessDay(date);
  let remaining = days;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) remaining -= 1;
  }
  return cursor;
}

/** Business days from `from` to `to`, inclusive. Never negative. */
export function businessDaysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  let start = nextBusinessDay(parseDate(from));
  const end = parseDate(to);
  if (start > end) return 0;
  let count = 0;
  while (start <= end) {
    if (!isWeekend(start)) count += 1;
    start = addDays(start, 1);
  }
  return count;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  return parseDate(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatLongDate(iso: string | null): string {
  if (!iso) return '—';
  return parseDate(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function relativeDeadline(iso: string | null, today = todayISO()): string {
  if (!iso) return 'no date';
  const diff = Math.round((parseDate(iso).getTime() - parseDate(today).getTime()) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return `in ${diff} days`;
}
