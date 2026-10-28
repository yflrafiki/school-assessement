import { LEVEL_LABELS, WEEKDAY_LABELS, type Level } from '@school/shared';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** YYYY-MM-DD calendar date, shown as "Tue 27 Oct 2026". */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  return dateFmt.format(new Date(`${date}T00:00:00Z`));
}

export function formatShortDate(date: string | null | undefined): string {
  if (!date) return '';
  return shortDateFmt.format(new Date(`${date}T00:00:00Z`));
}

/** An instant (ISO timestamp) in the viewer's local time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  return dateTimeFmt.format(new Date(value));
}

export function relativeTime(value: string | Date): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDateTime(value);
}

export const levelLabel = (level: Level | string) => LEVEL_LABELS[level as Level] ?? level;
export const weekdayLabel = (day: number) => WEEKDAY_LABELS[day] ?? String(day);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function percent(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? 'n/a' : `${Math.round(rate * 100)}%`;
}
