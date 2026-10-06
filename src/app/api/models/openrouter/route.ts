import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOpenRouterCatalog } from "@/lib/agent/openrouter-catalog";

export const dynamic = "force-dynamic";

/**
 * OpenRouter's catalogue, for the model picker in the builder and in agent settings.
 *
 * Public data, but only the app's own picker has a use for it, so it is behind a session
 * like the rest of `/api`: nobody gets a free mirror of someone else's API. No key is
 * read or needed. Never fails: with OpenRouter down it answers the short built-in list
 * and `live: false`.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const catalog = await getOpenRouterCatalog();
  return NextResponse.json(catalog, { headers: { "cache-control": "private, max-age=300" } });
}
