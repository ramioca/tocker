import { NextResponse } from "next/server";
import { searchPublicAgents } from "@/server/queries/agents";
import { searchTokens } from "@/server/queries/tokens";
import { searchUsers } from "@/server/queries/users";

/**
 * `GET /api/tokens/search?q=` — what ⌘K searches for tokens, public agents and people.
 *
 * Public and read-only: it returns symbol, name, chain and address for tokens the
 * platform has already seen, slug, name, tagline and mode for public agents, and
 * handle and display name for their owners. Nothing here is per-viewer, so it needs
 * no session and reveals nothing about who holds what — and never a strategy.
 *
 * A route rather than a server action because the palette queries on every
 * keystroke and a GET is what caches and cancels properly.
 */
export const dynamic = "force-dynamic";

const MAX_RESULTS = 8;
/** Agents and people are searched from this many characters; one letter matches everyone. */
const MIN_PEOPLE_QUERY = 2;
/** An empty query lists the token table so ⌘K can filter it client-side. */
const LIST_LIMIT = 25;
/** No symbol, name or address is longer; anything past this is not a search. */
const MAX_QUERY = 64;

/**
 * The query as it reaches `searchTokens`: LIKE wildcards and the escape character
 * stripped (so `%` cannot turn a keystroke into a full-table scan, and `_` cannot
 * match what it should not), then capped. No token symbol, name or address needs
 * any of the three.
 */
function normalizeSearchQuery(raw: string | null): string {
  return (raw ?? "").replace(/[%_\\]/g, "").trim().slice(0, MAX_QUERY);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = normalizeSearchQuery(params.get("q"));
  const limit = query.length === 0 ? LIST_LIMIT : MAX_RESULTS;

  const withPeople = query.length >= MIN_PEOPLE_QUERY;

  try {
    const [tokens, agents, users] = await Promise.all([
      searchTokens(query.length === 0 ? "" : query, limit),
      withPeople ? searchPublicAgents(query, MAX_RESULTS) : Promise.resolve([]),
      withPeople ? searchUsers(query, MAX_RESULTS) : Promise.resolve([]),
    ]);
    return NextResponse.json(
      {
        tokens: tokens.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          chain: token.chain,
          address: token.address,
        })),
        // Mapped field by field so nothing beyond these can ever ride along.
        agents: agents.map((agent) => ({
          slug: agent.slug,
          name: agent.name,
          tagline: agent.tagline,
          mode: agent.mode,
        })),
        users: users.map((user) => ({ handle: user.handle, displayName: user.displayName })),
      },
      // Short and shared: the lists barely move, and the palette hits this hard.
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } },
    );
  } catch {
    // The palette must never blow up over a failed lookup — no results is a fine answer.
    return NextResponse.json({ tokens: [], agents: [], users: [] });
  }
}
