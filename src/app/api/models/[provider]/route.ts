import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isProvider } from "@/lib/agent/providers";
import { getPublicCatalog } from "@/lib/agent/providers-keys";

export const dynamic = "force-dynamic";

/**
 * A provider's published model list, for the model picker in the builder and in agent
 * settings: `/api/models/openrouter`, `/api/models/cerebras` and the rest whose row
 * says `modelList: "public"`.
 *
 * Public data, but only the app's own picker has a use for it, so it is behind a session
 * like the rest of `/api`: nobody gets a free mirror of someone else's API. No key is
 * read or needed, and none is sent: the list is fetched on the server with no
 * credential at all, at most once an hour per provider.
 *
 * The segment is whatever the caller typed. It is only ever compared against the
 * providers that are switched on, never put into an address: a provider that is not one
 * of them, or whose list is not public (it is asked by key, or built in), is a 404.
 * For one that is, this never fails: with the provider down it answers the short
 * built-in list and `live: false`.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { provider } = await params;
  const catalog = isProvider(provider) ? await getPublicCatalog(provider) : null;
  if (!catalog) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(catalog, { headers: { "cache-control": "private, max-age=300" } });
}
