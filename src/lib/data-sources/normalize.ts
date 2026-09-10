/**
 * Every data source, paid or free, returns the same normalized shape so the model
 * (and the run-step log) sees one consistent contract instead of seven vendor schemas.
 */
import { z } from "zod";
import type { DataSourceInfo } from "@/server/types";
import type { X402Context } from "@/lib/x402/types";

export interface Signals {
  /** -1 (max bearish) .. 1 (max bullish). */
  sentiment?: number;
  /** Rate of change of attention. Positive = accelerating. Roughly -1..1. */
  velocity?: number;
  /** 0 (safe) .. 1 (rug-adjacent). */
  risk?: number;
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
  description: string;
  category: DataSourceInfo["category"];
  network: string;
  priceUsd: number | null;
  url: string;
  experimental: boolean;
  inputSchema: S;
  query(ctx: X402Context, input: z.infer<S>): Promise<NormalizedResult>;
}): DataSource {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    network: def.network,
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
