import { NextResponse } from "next/server";
import { searchTokens } from "@/server/queries/tokens";

/**
 * `GET /api/tokens/search?q=` — what ⌘K searches for tokens.
 *
 * Public and read-only: it returns symbol, name, chain and address for tokens the
 * platform has already seen. Nothing here is per-viewer, so it needs no session
 * and reveals nothing about who holds what.
 *
 * A route rather than a server action because the palette queries on every
 * keystroke and a GET is what caches and cancels properly.
 */
export const dynamic = "force-dynamic";

const MAX_RESULTS = 8;
/** An empty query lists the token table so ⌘K can filter it client-side. */
const LIST_LIMIT = 25;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const limit = query.length === 0 ? LIST_LIMIT : MAX_RESULTS;

  try {
    const tokens = await searchTokens(query.length === 0 ? "" : query, limit);
    return NextResponse.json(
      {
        tokens: tokens.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          chain: token.chain,
          address: token.address,
        })),
      },
      // Short and shared: the token list barely moves, and the palette hits this hard.
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } },
    );
  } catch {
    // The palette must never blow up over a failed lookup — no results is a fine answer.
    return NextResponse.json({ tokens: [] });
  }
}
