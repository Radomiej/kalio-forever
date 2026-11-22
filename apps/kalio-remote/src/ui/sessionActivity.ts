const absolute = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('pl-PL', { numeric: 'always' });

export function formatSessionActivity(updatedAt: string | undefined, now: number) {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  // The protocol emits UTC ISO timestamps. Demo values may omit milliseconds.
  if (updatedAt !== iso && updatedAt !== iso.replace('.000Z', 'Z')) return null;

  const minutes = Math.floor((now - date.getTime()) / 60_000);
  let elapsed: string;
  if (now < date.getTime()) elapsed = 'Czas w przyszłości';
  else if (minutes === 0) elapsed = 'Przed chwilą';
  else if (minutes < 60) elapsed = relative.format(-minutes, 'minute');
  else if (minutes < 1440) elapsed = relative.format(-Math.floor(minutes / 60), 'hour');
  else elapsed = relative.format(-Math.floor(minutes / 1440), 'day');

  return { dateTime: iso, absolute: absolute.format(date), elapsed };
}
