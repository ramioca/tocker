/**
 * Cursor-paginated public agents, for Discover's infinite scroll.
 *
 * `listPublicAgents` is a server query, so the client can't call it directly and the
 * matching server action doesn't exist. This route is the thinnest possible bridge.
 *
 * OWNER: ui-social. Foundation may replace it with a server action at merge — the
 * client only needs `{ items, nextCursor }`.
 */
import { NextResponse } from "next/server";
import { listPublicAgents } from "@/server/queries/agents";
import { withMock } from "@/lib/data";
import { mockPublicAgents } from "@/mocks/social";

const SORTS = new Set(["new", "pnl", "followers"]);
const LIMIT = 9;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSort = url.searchParams.get("sort") ?? "pnl";
  const sort = (SORTS.has(rawSort) ? rawSort : "pnl") as "new" | "pnl" | "followers";
  const cursor = url.searchParams.get("cursor");
  // Capped: a search box never needs more, and it bounds the ilike.
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 64);

  const page = await withMock(
    () => listPublicAgents({ cursor, limit: LIMIT, sort, query }),
    () => mockPublicAgents({ cursor, limit: LIMIT, sort, query }),
  );

  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}
