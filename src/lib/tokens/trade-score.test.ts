/**
 * What a fill remembers about the token's score.
 *
 * A reading no provider answered is an outage, not a verdict. The cache and the history
 * already refuse to keep one; the trade row is where it would be permanent and public,
 * as "0 · Avoid" on a fill whose token was simply not read. Pure: the real scorer on
 * captured payloads, no network and no database.
 */
import { describe, expect, it } from "vitest";
import type { TradeScoreSnapshot } from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { evaluateExits, toExitRules } from "@/lib/trading/exits";
import { toTradeRow, toTradeScore as readTradeScore } from "@/server/queries/_shared";
import type { TokenRef, TokenScore } from "@/server/types";
import { isNoData } from "./history";
import { toTradeScore } from "./index";
import { parseJupiterToken } from "./providers/jupiter";
import { parseRugcheckSummary } from "./providers/rugcheck";
import { scoreToken } from "./score";
import jupiterFixture from "./fixtures/jupiter.json";
import rugcheckFixture from "./fixtures/rugcheck.json";

const NOW = Date.parse("2026-09-11T18:00:00.000Z");
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const universe = DEFAULT_AGENT_CONFIG.universe;

/** What `getTokenScore` hands back when every provider failed: it never throws. */
function unanswered(): TokenScore {
  return scoreToken(
    { chain: "solana", address: BONK, symbol: "BONK", jupiter: null, rugcheck: null, dexscreener: null, goplus: null, gecko: null, now: NOW },
    universe,
  );
}

/** The same token with Jupiter and RugCheck answering. */
function answered(): TokenScore {
  const jupiter = parseJupiterToken((jupiterFixture as unknown as { tokens: Record<string, unknown> }).tokens[BONK]);
  const rugcheck = parseRugcheckSummary(BONK, (rugcheckFixture as unknown as Record<string, unknown>)[BONK]);
  expect(jupiter).not.toBeNull();
  expect(rugcheck).not.toBeNull();
  return scoreToken({ chain: "solana", address: BONK, symbol: "BONK", jupiter, rugcheck, now: NOW }, universe);
}

describe("toTradeScore: what is frozen onto a trade", () => {
  it("freezes nothing for a reading no provider answered", () => {
    const score = unanswered();
    // This is the reading that used to be published: a zero that reads as a verdict.
    expect(isNoData(score)).toBe(true);
    expect(score.total).toBe(0);
    expect(score.verdict).toBe("avoid");
    expect(score.warnings).toContain("low_confidence");

    expect(toTradeScore(score)).toBeNull();
  });

  it("freezes nothing when a source answered but with no market fact at all", () => {
    const score: TokenScore = { ...answered(), priceUsd: null, liquidityUsd: null, holderCount: null };
    expect(isNoData(score)).toBe(true);
    expect(toTradeScore(score)).toBeNull();
  });

  it("freezes a real reading exactly as it was, low scores included", () => {
    const score = answered();
    expect(isNoData(score)).toBe(false);
    expect(toTradeScore(score)).toEqual({
      total: score.total,
      verdict: score.verdict,
      components: score.components,
      blockers: score.blockers,
      warnings: score.warnings,
      liquidityUsd: score.liquidityUsd,
      ageHours: score.ageHours,
      scoredAt: score.scoredAt,
    });

    // A token that really scores zero was read, and its record says so.
    const poor: TokenScore = { ...score, total: 0, verdict: "avoid", blockers: ["honeypot"] };
    expect(toTradeScore(poor)?.total).toBe(0);
    expect(toTradeScore(poor)?.blockers).toEqual(["honeypot"]);
  });

  /**
   * Only the record changed. The exit engine never took a vote from this reading (it
   * would sell every holding into a provider outage), and it still does not.
   */
  it("leaves the exit rule alone: an unanswered reading still sells nothing", () => {
    const score = unanswered();
    const decisions = evaluateExits({
      rules: toExitRules({ ...DEFAULT_AGENT_CONFIG.risk, stopLossPct: null, takeProfitPct: null, exitScoreBelow: 40, exitOnLiquidityDropPct: 50 }),
      positions: [
        {
          tokenId: `solana:${BONK}`,
          chain: "solana",
          address: BONK,
          symbol: "BONK",
          amountToken: 10_000_000,
          avgCostUsd: 0.0000027,
          markPriceUsd: 0.0000027,
          peakPriceUsd: 0.0000027,
          openedAt: new Date(NOW - 3_600_000),
          entryScore: 74,
          entryLiquidityUsd: 310_000,
          score,
        },
      ],
      now: new Date(NOW),
    });
    expect(decisions).toEqual([]);
  });
});

describe("reading a stored snapshot back", () => {
  const stored = (over: Partial<TradeScoreSnapshot> = {}): TradeScoreSnapshot => ({
    total: 0,
    verdict: "avoid",
    components: { safety: 0, liquidity: 0, organic: 0, distribution: 0, momentum: 0, gecko: null, sentiment: null, smartMoney: null },
    blockers: ["liquidity_unknown", "holders_unknown", "age_unknown"],
    warnings: ["low_confidence", "safety_unscored", "rugcheck_unavailable"],
    liquidityUsd: null,
    ageHours: null,
    scoredAt: new Date(NOW).toISOString(),
    ...over,
  });

  it("shows a fill that froze an unanswered reading as not scored", () => {
    expect(readTradeScore(stored())).toBeNull();
  });

  it("keeps every snapshot that was a reading", () => {
    // A pool was seen: the token was read, and zero is its score.
    expect(readTradeScore(stored({ liquidityUsd: 1_200 }))?.total).toBe(0);
    // Thin data, but a number came out of it.
    expect(readTradeScore(stored({ total: 12 }))?.total).toBe(12);
    // Zero with nothing flagged is a verdict, not an outage.
    expect(readTradeScore(stored({ warnings: [] }))?.total).toBe(0);
  });

  it("gives the trade row no entry score and no badge for one", () => {
    const token: TokenRef = {
      id: `solana:${BONK}`,
      chain: "solana",
      address: BONK,
      symbol: "BONK",
      name: "Bonk",
      logoUrl: null,
      decimals: 5,
      lastPriceUsd: 0.0000027,
    };
    const trade = (scoreSnapshot: TradeScoreSnapshot | null) =>
      ({
        id: "t1",
        agentId: "a1",
        runId: null,
        ownerId: "u1",
        chain: "solana",
        side: "sell",
        tokenId: token.id,
        quoteTokenId: "solana:usdc",
        amountToken: "100",
        amountUsd: "1132.07",
        priceUsd: "11.3207",
        feeUsd: "0",
        status: "filled",
        isPaper: true,
        txHash: null,
        rationale: null,
        scoreSnapshot,
        origin: "guardian",
        exitReason: "take_profit",
        requestedUsd: null,
        proposedAt: null,
        decidedAt: null,
        decidedBy: null,
        error: null,
        createdAt: new Date(NOW),
        filledAt: new Date(NOW),
      }) as Parameters<typeof toTradeRow>[0];

    const unread = toTradeRow(trade(stored()), token, { isOwner: true });
    expect(unread.entryScore).toBeNull();
    expect(unread.score).toBeNull();

    const read = toTradeRow(trade(stored({ total: 71, verdict: "candidate", liquidityUsd: 310_000, warnings: [] })), token, { isOwner: true });
    expect(read.entryScore).toBe(71);
    expect(read.score?.total).toBe(71);
  });
});
