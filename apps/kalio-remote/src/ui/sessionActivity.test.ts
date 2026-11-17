import { describe, expect, it } from 'vitest';
import { formatSessionActivity } from './sessionActivity';

const now = Date.parse('2026-11-15T12:00:00Z');

describe('formatSessionActivity', () => {
  it.each([undefined, '', 'bad', '2026-02-30T12:00:00Z', '12:00', '2026-11-15'])(
    'shows no activity for missing or invalid data (%s)',
    (value) => expect(formatSessionActivity(value, now)).toBeNull(),
  );

  it('formats the durable timestamp in Polish local time and preserves a machine-readable value', () => {
    const local = new Date(2026, 10, 15, 9, 35);
    expect(formatSessionActivity(local.toISOString(), local.getTime())).toEqual({
      dateTime: local.toISOString(),
      absolute: '15 lis 2026, 09:35',
      elapsed: 'Przed chwilą',
    });
  });

  it.each([
    ['2026-11-15T12:00:00Z', 'Przed chwilą'],
    ['2026-11-15T11:59:01Z', 'Przed chwilą'],
    ['2026-11-15T11:59:00Z', '1 minutę temu'],
    ['2026-11-15T11:01:00Z', '59 minut temu'],
    ['2026-11-15T11:00:00Z', '1 godzinę temu'],
    ['2026-11-14T12:01:00Z', '23 godziny temu'],
    ['2026-11-14T12:00:00Z', '1 dzień temu'],
    ['2026-11-08T11:59:00Z', '7 dni temu'],
    ['2026-11-15T12:00:01Z', 'Czas w przyszłości'],
  ])('formats elapsed time for %s', (timestamp, elapsed) => {
    expect(formatSessionActivity(timestamp, now)?.elapsed).toBe(elapsed);
  });
});
