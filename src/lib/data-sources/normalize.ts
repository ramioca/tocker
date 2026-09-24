/**
 * Every data source, paid or free, returns the same normalized shape so the model
 * (and the run-step log) sees one consistent contract instead of seven vendor schemas.
 */
import { z } from "zod";
import type { DataSourceInfo } from "@/server/types";
import { chainForNetwork, type X402Context } from "@/lib/x402/types";
import type { Chain } from "@/server/types";

/** The platform's chains among a list of CAIP-2 networks, deduplicated, stable order. */
export function chainsForNetworks(networks: readonly string[]): Chain[] {
  const out: Chain[] = [];
  for (const network of networks) {
    const chain = chainForNetwork(network);
    if (chain && !out.includes(chain)) out.push(chain);
  }
  return out.sort();
}

export interface Signals {
  /** -1 (max bearish) .. 1 (max bullish). */
  sentiment?: number;
  /** Rate of change of attention. Positive = accelerating. Roughly -1..1. */
  velocity?: number;
  /** 0 (safe) .. 1 (rug-adjacent). */
  risk?: number;
  /**
   * Net USD flow from tracked "smart money" wallets into this token over the source's
   * headline window. Positive = accumulation. Absolute dollars, not normalised: the
   * scorer weighs it against the token's own liquidity.
   */
  smartMoneyNetflowUsd?: number;
  /**
   * A live sell simulation says the position can still be exited. `false` only when a
   * source *proved* the sell fails; an inconclusive check leaves this undefined, since
   * "we could not tell" must never read as "you cannot sell".
   */
  sellable?: boolean;
}

/**
 * One token off a *paid* discovery feed, in the shape `src/lib/tokens/discover.ts`
 * needs to build a `TokenCandidate` without a second round-trip. Deliberately the
 * same vocabulary as `TokenFacts`, so discovery never learns a vendor schema.
 */
export interface PaidLaunch {
  chain: "solana" | "base";
  address: string;
  symbol: string;
  name: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  ageHours: number | null;
  priceChange24hPct: number | null;
}

export interface NormalizedResult {
  summary: string;
  data: unknown;
  signals?: Signals;
}

export interface DataSource extends DataSourceInfo {
  inputSchema: z.ZodType;
  query(ctx: X402Context, input: unknown): Promise<NormalizedResult>;
}

/**
 * Declares a source with a typed input schema while exposing the erased
 * `query(ctx, input: unknown)` signature the registry and the tool layer use.
 */
export function defineSource<S extends z.ZodType>(def: {
  id: string;
  name: string;
  /** What the owner reads in the picker. One plain sentence — see `DataSourceInfo.summary`. */
  summary: string;
  description: string;
  category: DataSourceInfo["category"];
  network: string;
  /**
   * Every CAIP-2 network the source's 402 accepts, when it accepts more than
   * `network`. Probed live; keep it in the file header's probe notes. Defaults to
   * `[network]`.
   */
  networks?: string[];
  priceUsd: number | null;
  url: string;
  experimental: boolean;
  inputSchema: S;
  query(ctx: X402Context, input: z.infer<S>): Promise<NormalizedResult>;
}): DataSource {
  return {
    id: def.id,
    name: def.name,
    summary: def.summary,
    description: def.description,
    category: def.category,
    network: def.network,
    chains: chainsForNetworks(def.networks ?? [def.network]),
    priceUsd: def.priceUsd,
    url: def.url,
    experimental: def.experimental,
    inputSchema: def.inputSchema,
    query: (ctx, input) => def.query(ctx, def.inputSchema.parse(input) as z.infer<S>),
  };
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function clampSentiment(n: number): number {
  return clamp(n, -1, 1);
}

export function clampRisk(n: number): number {
  return clamp(n, 0, 1);
}

/** Safe nested lookup that never throws and never returns `any`. */
export function pick(source: unknown, ...path: string[]): unknown {
  let cur: unknown = source;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Trims a payload so a single tool result never floods the model's context. */
export function truncate(text: string, max = 600): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
