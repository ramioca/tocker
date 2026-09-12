/**
 * Shared plumbing for the free token-data providers.
 *
 * Four rules, enforced here so no provider has to remember them:
 *   1. every request has an 8s timeout;
 *   2. every failure — network, non-2xx, bad JSON, abort — returns `null`;
 *   3. results (including negative ones) are cached in-process on a TTL, because a
 *      discovery sweep asks about the same mints repeatedly;
 *   4. fan-out to one provider never exceeds {@link MAX_CONCURRENCY}.
 *
 * With `TOKENS_MOCK=1` providers read local fixtures instead and the process makes
 * no network calls at all. The test suite and `pnpm demo` set it for determinism.
 *
 * This is deliberately independent of `X402_MOCK`: every provider here is free and
 * keyless, so a keyless dev setup still sees real, live launches being scored while
 * the x402 payments stay simulated.
 */

export const REQUEST_TIMEOUT_MS = 8_000;
/** Never more than this many in-flight requests against a single provider. */
export const MAX_CONCURRENCY = 8;

/** True when discovery and scoring should run entirely from fixtures. */
export function isTokensMock(): boolean {
  return process.env.TOKENS_MOCK === "1";
}

interface Entry<T> {
  at: number;
  value: T;
}

/** A tiny TTL cache. Negative results are cached too, for a tenth of the TTL. */
export class TtlCache<T> {
  private readonly map = new Map<string, Entry<T | null>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries = 2_000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): { hit: true; value: T | null } | { hit: false } {
    const entry = this.map.get(key);
    if (!entry) return { hit: false };
    const ttl = entry.value === null ? this.ttlMs / 10 : this.ttlMs;
    if (Date.now() - entry.at > ttl) {
      this.map.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  set(key: string, value: T | null): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { at: Date.now(), value });
  }

  clear(): void {
    this.map.clear();
  }
}

/** GETs JSON, returning `null` for any failure at all. Never throws. */
export async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with a hard concurrency ceiling, preserving input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index] as T;
      out[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- defensive readers ----------

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Accepts numbers and numeric strings ("0.05"); rejects NaN, Infinity and junk. */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** GoPlus-style flags: real booleans, or the strings "1"/"0". */
export function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value === "1") return true;
    if (value === "0") return false;
  }
  return null;
}

/** ISO timestamp → epoch ms. */
export function isoMs(value: unknown): number | null {
  const s = str(value);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
