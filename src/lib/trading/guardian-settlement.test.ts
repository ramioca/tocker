/**
 * Where the fee sweep sits in a guardian pass, and what happens when it goes wrong.
 *
 * Two properties, and they are the only two that matter:
 *
 *  1. **Exits happen first.** The sweep is observed from inside a mock, which counts the
 *     filled guardian exits already in the database at the moment it is called. If the
 *     order ever inverted, that count would be zero and this test would fail — which is
 *     stronger than reading the source, because it is the runtime order that can cost
 *     somebody a stop loss.
 *  2. **It cannot take the pass down.** A settlement that throws (it should not — the
 *     real one contains everything — but a bug is a bug) leaves the exits reported and
 *     the pass successful.
 *
 * Kept in its own file because it mocks a module, and the rest of `guardian.test.ts`
 * deliberately runs the real thing end to end.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { resetTokenCaches } from "@/lib/tokens";
import * as prices from "./prices";
import { seedKnownTokens, tokenId } from "./tokens";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** Observations the mocked sweep records, read back by the assertions below. */
const probe = vi.hoisted(() => ({
  /** Filled guardian exits present in the database when the sweep was called. */
  exitsAtSweep: [] as number[],
  throwOnSweep: false,
}));

vi.mock("@/lib/platform/settlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform/settlement")>();
  return {
    ...actual,
    settlePlatformFees: async (input: Parameters<typeof actual.settlePlatformFees>[0]) => {
      const { getDb, trades } = await import("@/db");
      const db = await getDb();
      const filled = await db
        .select({ id: trades.id })
        .from(trades)
        .where(
          and(
            eq(trades.agentId, input.agentId),
            eq(trades.origin, "guardian"),
            eq(trades.status, "filled"),
          ),
        );
      probe.exitsAtSweep.push(filled.length);
      if (probe.throwOnSweep) throw new Error("settlement exploded");
      return actual.settlePlatformFees(input);
    },
  };
});

const { runGuardian } = await import("./guardian");

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

/** BONK priced well below the seeded entry, so the stop loss is already broken. */
function stubPricing(price = 0.0000027): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: price } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(async () => {
  probe.exitsAtSweep = [];
  probe.throwOnSweep = false;
  prices.resetPriceCache();
  await resetTokenCaches();
  stubPricing();
});

async function seedBrokenStop(): Promise<{ agentId: string; userId: string }> {
  const seeded = await seedAgent(db, {
    config: {
      chains: ["solana"],
      risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null },
    },
  });
  await db.insert(schema.positions).values({
    agentId: seeded.agentId,
    tokenId: tokenId("solana", BONK),
    amountToken: toNumeric(50_000_000, 12),
    avgCostUsd: toNumeric(0.0000045, 12),
    realizedPnlUsd: "0",
    openedAt: new Date(Date.now() - 3_600_000),
    peakPriceUsd: toNumeric(0.0000045, 12),
  });
  return seeded;
}

describe("the fee sweep inside a guardian pass", () => {
  it("runs after the exits, never before", async () => {
    const { agentId } = await seedBrokenStop();

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits).toHaveLength(1);
    expect(result.exits[0]?.status).toBe("filled");

    // Called exactly once, and the exit was already filled and recorded by then.
    expect(probe.exitsAtSweep).toEqual([1]);
    expect(result.settlement).not.toBeNull();

    // And the exit itself was charged a fee, which only holds if the sweep came second:
    // a fee accrued by this very exit could not exist before it.
    const fees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.agentId, agentId));
    expect(fees).toHaveLength(1);
    expect(fees[0]?.tradeId).toBe(result.exits[0]?.tradeId);
  });

  it("cannot fail the pass, even if it throws", async () => {
    const { agentId } = await seedBrokenStop();
    probe.throwOnSweep = true;

    const result = await runGuardian({ agentId, trigger: "marks" });

    expect(result.error).toBeNull();
    expect(result.ran).toBe(true);
    expect(result.exits).toHaveLength(1);
    expect(result.exits[0]?.status).toBe("filled");
    // No settlement to report, because it blew up — but the exit is recorded and the
    // position is closed, which is the only thing that was urgent.
    expect(result.settlement).toBeNull();
    const [position] = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.agentId, agentId));
    expect(Number(position?.amountToken)).toBe(0);
  });

  it("is not attempted on a tick pass — the run owns that time", async () => {
    const { agentId } = await seedBrokenStop();
    const result = await runGuardian({ agentId, trigger: "tick" });
    expect(result.exits).toHaveLength(1);
    expect(probe.exitsAtSweep).toEqual([]);
    expect(result.settlement).toBeNull();
  });

  it("still sweeps a flat agent that owes fees", async () => {
    // Nothing to exit, but the ledger may still have rows from earlier fills: the sweep
    // has to be reached on the early return too, not only after an exit.
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits).toHaveLength(0);
    expect(probe.exitsAtSweep).toEqual([0]);
    expect(result.settlement?.attempted).toBe(false);
  });
});
