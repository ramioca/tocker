/**
 * x402 Bazaar discovery — the public CDP resource index, no API key required.
 * Used by the agent's `search_data_sources` tool and by the "Add data source" picker.
 */
import { searchX402Resources } from "@coinbase/cdp-sdk";
import type { DataSourceInfo } from "@/server/types";

export interface DiscoveredResource {
  /** Stable id for the registry: `bazaar:<url>`. */
  id: string;
  resource: string;
  description: string;
  serviceName: string | null;
  network: string;
  priceUsd: number | null;
  tags: string[];
}

export interface DiscoverySearchInput {
  query: string;
  network?: string;
  maxUsdPrice?: number;
  limit?: number;
  /** Narrow results to resources whose URL contains this (min 3 chars). */
  urlSubstring?: string;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: DiscoveredResource[] }>();

const ASSET_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6,
  epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v: 6,
};

interface RawAccept {
  network?: unknown;
  asset?: unknown;
  amount?: unknown;
  maxAmountRequired?: unknown;
}

function priceOf(accept: RawAccept | undefined): number | null {
  if (!accept) return null;
  const raw = accept.amount ?? accept.maxAmountRequired;
  const amount = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(amount)) return null;
  const asset = typeof accept.asset === "string" ? accept.asset.toLowerCase() : "";
  const decimals = ASSET_DECIMALS[asset] ?? 6;
  return amount / 10 ** decimals;
}

export function bazaarSourceId(resourceUrl: string): string {
  return `bazaar:${resourceUrl}`;
}

/** Full-text / semantic search over the Bazaar index, cached for 5 minutes. */
export async function searchDataSources(input: DiscoverySearchInput): Promise<DiscoveredResource[]> {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const res = await searchX402Resources({
    query: input.query,
    ...(input.network ? { network: input.network } : {}),
    ...(input.maxUsdPrice !== undefined ? { maxUsdPrice: String(input.maxUsdPrice) } : {}),
    ...(input.urlSubstring && input.urlSubstring.length >= 3 ? { urlSubstring: input.urlSubstring } : {}),
    limit: Math.min(Math.max(input.limit ?? 8, 1), 20),
  });

  const value: DiscoveredResource[] = res.resources.map((r) => {
    const accepts = (r.accepts ?? []) as unknown as RawAccept[];
    const cheapest = accepts
      .map((a) => ({ a, usd: priceOf(a) }))
      .filter((x): x is { a: RawAccept; usd: number } => x.usd !== null)
      .sort((x, y) => x.usd - y.usd)[0];
    return {
      id: bazaarSourceId(r.resource),
      resource: r.resource,
      description: r.description ?? "",
      serviceName: r.serviceName ?? null,
      network: typeof cheapest?.a.network === "string" ? cheapest.a.network : "unknown",
      priceUsd: cheapest?.usd ?? null,
      tags: r.tags ?? [],
    };
  });

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Presents a discovered resource with the same shape as a registry entry. */
export function toDataSourceInfo(r: DiscoveredResource): DataSourceInfo {
  return {
    id: r.id,
    name: r.serviceName ?? new URL(r.resource).hostname,
    description: r.description,
    category: "other",
    network: r.network,
    priceUsd: r.priceUsd,
    url: r.resource,
    experimental: true,
  };
}

export function resetDiscoveryCache(): void {
  cache.clear();
}
