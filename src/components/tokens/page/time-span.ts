/**
 * Words for a stretch of history. Shared by the token page's heading and its score
 * chart, so a chart whose points all fall on one afternoon neither calls itself
 * "last 30 days" nor labels both ends of its axis "Sep 24".
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Under this, an axis is about hours, not days. */
const TIME_AXIS_MS = 36 * HOUR_MS;

/**
 * "last 6 hours", "last 12 days" — how far back the oldest reading goes, measured to
 * now, so the phrase is true however stale the newest reading is. Capped at the window
 * the history query reads (30 days).
 *
 * `nowMs` defaults to the clock. The token page is a server component rendered once per
 * request, so reading the time here does not make it re-render differently.
 */
export function recentWindowLabel(fromMs: number, nowMs: number = Date.now(), capDays = 30): string {
  const span = Math.max(0, nowMs - fromMs);
  if (span <= HOUR_MS) return "last hour";
  const hours = Math.ceil(span / HOUR_MS);
  if (hours < 48) return `last ${hours} hours`;
  return `last ${Math.min(capDays, Math.ceil(span / DAY_MS))} days`;
}

/**
 * The two x-axis end labels. Over 36 hours or more they are dates ("Sep 24", "Oct 3");
 * under it they are times, with the date on the first label and on the last only when
 * the span crosses midnight ("Sep 24 08:10" … "14:05").
 *
 * `timeZone` is for tests; the chart leaves it to the viewer's own.
 */
export function axisLabels(firstMs: number, lastMs: number, timeZone?: string): [string, string] {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
  if (lastMs - firstMs >= TIME_AXIS_MS) return [date.format(firstMs), date.format(lastMs)];
  const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const firstDay = date.format(firstMs);
  const lastDay = date.format(lastMs);
  return [
    `${firstDay} ${time.format(firstMs)}`,
    lastDay === firstDay ? time.format(lastMs) : `${lastDay} ${time.format(lastMs)}`,
  ];
}
