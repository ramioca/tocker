import "server-only";
import { notFound, permanentRedirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Slugs are stored lower-case, so /agents/Momentum-Mike was a 404 for an agent that
 * exists. A mixed-case URL gets one permanent redirect to the canonical spelling instead
 * (the query string kept, so a `?tab=trades&trade=…` link still lands on its row), and
 * links and history never hold two spellings of an agent. A malformed escape is a 404.
 * Same rule as `canonicalHandle` on /u/[handle].
 *
 * `rest` is the path under the agent, e.g. "/runs/abc", so a sub-route redirects to itself.
 */
export async function canonicalSlug(
  params: Promise<{ slug: string }>,
  rest = "",
  searchParams?: Promise<SearchParams>,
): Promise<string> {
  const { slug: raw } = await params;
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const lower = slug.toLowerCase();
  if (slug !== lower) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
    }
    const search = query.size > 0 ? `?${query}` : "";
    permanentRedirect(`/agents/${encodeURIComponent(lower)}${rest}${search}`);
  }
  return slug;
}
