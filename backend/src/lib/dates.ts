// Calendar dates are plain YYYY-MM-DD strings in the school's timezone.
// PostgreSQL DATE columns come back from Prisma as Date objects at 00:00 UTC.

export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toDbDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = toDbDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWeekend(date: string): boolean {
  return isoWeekday(date) >= 6;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Local date and minutes past midnight for an instant in a timezone. */
export function localNow(
  timezone: string,
  now: Date = new Date(),
): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** The UTC instant of 00:00 local time on a date in a timezone. */
export function zonedMidnightUtc(date: string, timezone: string): Date {
  const guess = new Date(`${date}T00:00:00.000Z`);
  const local = localNow(timezone, guess);
  const offsetMs =
    Date.parse(`${local.date}T00:00:00.000Z`) + local.minutes * 60_000 - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}
