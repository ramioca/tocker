/**
 * What a person is shown as a holding's "now" score, and what a provider outage may
 * write over. Both rules exist because `token_scores` keeps one row per token and
 * whoever scored it last owns it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { getTokenScore, universeKey } from "@/lib/tokens";
import { loadDisplayScores } from "./score-cache";

// Every free provider is down: the shape of a rate limit or an outage.
vi.mock("@/lib/tokens/providers/jupiter", () => ({ getJupiterToken: async () => null }));
vi.mock("@/lib/tokens/providers/rugcheck", () => ({ getRugcheckSummary: async () => null }));
vi.mock("@/lib/tokens/providers/dexscreener", () => ({ getDexScreenerToken: async () => null }));
vi.mock("@/lib/tokens/providers/goplus", () => ({ getGoPlusSecurity: async () => null }));
vi.mock("@/lib/tokens/providers/geckoterminal", () => ({
  getGeckoTokenInfo: async () => null,
  getGeckoTokenPools: async () => [],
  deepestGeckoPool: () => null,
}));

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

const OWN_KEY = "own-universe";
const OTHER_KEY = "someone-elses-universe";

async function cacheRow(
  tokenId: string,
  over: Partial<typeof schema.tokenScores.$inferInsert> = {},
): Promise<void> {
  const [chain, address] = tokenId.split(":") as ["solana", string];
  await db.insert(schema.tokenScores).values({
    id: tokenId,
    chain,
    address,
    symbol: "TKN",
    total: "90.00",
    verdict: "strong",
    components: { safety: 90, liquidity: 90, organic: 90, distribution: 90, momentum: 90 },
    blockers: [],
    warnings: [],
    priceUsd: "1.000000000000",
    liquidityUsd: "500000.00",
    holderCount: 5_000,
    sources: ["jupiter"],
    universeKey: OWN_KEY,
    ...over,
  });
}

async function historyRow(tokenId: string, total: number, minutesAgo: number): Promise<void> {
  await db.insert(schema.tokenScoreHistory).values({
    id: nanoid(),
    tokenId,
    total: total.toFixed(2),
    verdict: "watch",
    components: {},
    blockers: ["liquidity_below_floor"],
    priceUsd: "1.000000000000",
    scoredAt: new Date(Date.now() - minutesAgo * 60_000),
  });
}

describe("loadDisplayScores", () => {
  it("uses the cached row, blockers and all, when it was scored under the viewer's universe", async () => {
    const id = `solana:own-${nanoid(6)}`;
    await cacheRow(id, { total: "31.00", verdict: "avoid", blockers: ["honeypot"] });
    const shown = (await loadDisplayScores([id], OWN_KEY)).get(id);
    expect(shown).toMatchObject({ total: 31, verdict: "avoid", blockers: ["honeypot"] });
  });

  it("never shows another universe's verdict: it falls back to the newest history total", async () => {
    const id = `solana:other-${nanoid(6)}`;
    await cacheRow(id, { total: "0.00", verdict: "avoid", blockers: ["mint_authority_unknown"], universeKey: OTHER_KEY });
    await historyRow(id, 55, 90);
    await historyRow(id, 59, 30);
    const shown = (await loadDisplayScores([id], OWN_KEY)).get(id);
    expect(shown).toMatchObject({ total: 59, verdict: null, blockers: null });
  });

  it("skips a cached reading no provider answered, even under the viewer's own universe", async () => {
    const id = `solana:nodata-${nanoid(6)}`;
    await cacheRow(id, { total: "0.00", verdict: "avoid", sources: [], priceUsd: null, liquidityUsd: null, holderCount: null });
    await historyRow(id, 72, 10);
    expect((await loadDisplayScores([id], OWN_KEY)).get(id)?.total).toBe(72);
  });

  it("shows nothing rather than a stranger's number when there is no fallback", async () => {
    const id = `solana:bare-${nanoid(6)}`;
    await cacheRow(id, { universeKey: OTHER_KEY });
    expect((await loadDisplayScores([id], OWN_KEY)).has(id)).toBe(false);
  });
});

describe("getTokenScore during a provider outage", () => {
  it("returns the no-data reading but keeps the last real score in the cache", async () => {
    const address = `NoProviders${nanoid(8)}`;
    const id = `solana:${address}`;
    const key = universeKey(DEFAULT_AGENT_CONFIG.universe);
    await cacheRow(id, { total: "59.00", verdict: "watch", universeKey: key });

    const score = await getTokenScore({
      chain: "solana",
      address,
      universe: DEFAULT_AGENT_CONFIG.universe,
      force: true,
    });
    // The caller still gets the blind reading, so a buy on it is still refused.
    expect(score.sources).toEqual([]);

    const [row] = await db.select().from(schema.tokenScores).where(eq(schema.tokenScores.id, id));
    expect(Number(row.total)).toBe(59);
    expect(row.verdict).toBe("watch");
  });
});
