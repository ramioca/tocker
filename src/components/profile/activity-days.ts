/**
 * Daily fill counts → the dense, oldest-first series the calendar heatmap draws.
 *
 * The query returns only days that had fills, keyed by UTC day number (days since the
 * epoch). A heatmap needs every day of the window, including the empty ones, and the
 * same `t` (UTC midnight, ms) the mock series uses.
 */
export const DAY_MS = 86_400_000;

export function fillActivityDays(
  counts: ReadonlyArray<{ day: number; n: number }>,
  days: number,
  now: number = Date.now(),
): Array<{ t: number; value: number }> {
  const byDay = new Map<number, number>();
  for (const row of counts) byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.n);
  const today = Math.floor(now / DAY_MS);
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i);
    return { t: day * DAY_MS, value: byDay.get(day) ?? 0 };
  });
}
