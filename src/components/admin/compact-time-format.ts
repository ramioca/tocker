/**
 * "Sep 25, 06:38": the day and minute, 24-hour, no seconds or zone. For a pinned table
 * column on a phone, where the full "Sep 25, 6:38:41 AM UTC" took two-thirds of the
 * scroller; the exact string is the cell's tooltip.
 */
export function formatCompactTime(isoDate: string, timeZone?: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  });
}
