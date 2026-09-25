import type { Page } from "@/server/types";

/**
 * How far "Show older" can stack before the list stops growing: this many pages of
 * the notifications query (30 rows each), walked in one render. Past it the page says
 * how much it is showing rather than walking the cursor without end.
 */
export const MAX_NOTIFICATION_PAGES = 20;

/**
 * `?pages=` as the notifications page reads it — how many pages "Show older" has
 * asked for. The URL is hand-editable, so anything that is not a whole number in
 * range falls back to the first page, and a large one is capped.
 */
export function pagesParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return 1;
  return Math.min(MAX_NOTIFICATION_PAGES, Math.max(1, Number(value)));
}

/**
 * The first `pages` pages of a cursor-paginated query, as one page: every row in
 * order, and the cursor after the last one (null once the rows run out). Stops early
 * when the rows do, so asking for more pages than exist costs nothing extra.
 */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  pages: number,
): Promise<Page<T>> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < pages; index++) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return { items, nextCursor: cursor };
}
