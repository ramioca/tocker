/**
 * `review_positions` — the tool that makes an agent look at what it already owns.
 *
 * Every other tool points outward: discover, score, buy. This one points at the book. It
 * rescores each holding (free providers only, no x402), measures it against the exit
 * rules the guardian enforces, and hands back a verdict per position so the model can
 * act on the ones the rules do *not* cover: a thesis that broke, a name drifting
 * sideways, cash better used elsewhere.
 *
 * It never trades. Decisions stay with `place_trade`, and the automatic exits stay with
 * `src/lib/trading/guardian.ts`.
 *
 * Registration is deliberately *not* done here: `buildTools` lives in `./tools.ts`,
 * which another workstream owns. Merge with
 *   `return { ...buildTools(ctx), ...buildPositionTools(ctx) }`
 * or spread `...buildPositionTools(ctx)` into the object `buildTools` returns.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { exitDistances } from "@/lib/pnl";
import { evaluateExits, liquidityText, priceText, toExitRules, type ExitPosition } from "@/lib/trading/exits";
import { getTokenScore } from "@/lib/tokens";
import type { TokenScore } from "@/server/types";
import { getPortfolio } from "./portfolio";
import type { RunContext } from "./tools";

type ToolOutcome = Record<string, unknown>;

/**
 * Same contract as the wrapper in `./tools.ts`: a `tool_call` step before, a
 * `tool_result` (with duration) after, an `error` step instead of a throw. Duplicated
 * rather than exported from there because that file belongs to another workstream and a
 * shared edit would be a merge conflict for no gain.
 */
function logged(
  ctx: RunContext,
  name: string,
  fn: (input: Record<string, unknown>) => Promise<ToolOutcome>,
): (input: Record<string, unknown>) => Promise<ToolOutcome> {
  return async (input) => {
    const startedAt = Date.now();
    await ctx.logger.log({ kind: "tool_call", toolName: name, payload: { input } });
    try {
      const result = await fn(input);
      await ctx.logger.log({
        kind: "tool_result",
        toolName: name,
        payload: { result },
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.logger.log({
        kind: "error",
        toolName: name,
        payload: { error: message },
        durationMs: Date.now() - startedAt,
      });
      return { ok: false, reason: message };
    }
  };
}

export type PositionVerdict = "hold" | "watch" | "exit_candidate";

export interface PositionReview {
  symbol: string;
  chain: "solana" | "base";
  address: string;
  amountToken: number;
  valueUsd: number | null;
  heldHours: number | null;
  avgCostUsd: number;
  markPriceUsd: number | null;
  /** Mark against entry, in percent. */
  returnPct: number | null;
  peakPriceUsd: number | null;
  /** Mark against the highest mark since entry, in percent (always ≤ 0). */
  fromPeakPct: number | null;
  entryScore: number | null;
  currentScore: number | null;
  scoreVerdict: string | null;
  blockers: string[];
  entryLiquidityUsd: number | null;
  currentLiquidityUsd: number | null;
  liquidityChangePct: number | null;
  /** Percentage points of headroom; negative means the level is already breached. */
  stopDistancePct: number | null;
  takeProfitDistancePct: number | null;
  trailingStopDistancePct: number | null;
  hoursUntilMaxHold: number | null;
  verdict: PositionVerdict;
  reason: string;
  /** Set when the guardian will close this position on its next pass. */
  pendingExitReason: string | null;
}

function pp(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}pp`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
}

/** A compact table; models read these far better than they read nested JSON. */
export function renderReviews(reviews: readonly PositionReview[]): string {
  if (reviews.length === 0) return "No open positions.";
  const lines = reviews.map((r) => {
    const bits = [
      `${r.symbol} [${r.chain}]`,
      r.valueUsd === null ? "unpriced" : `$${r.valueUsd.toFixed(2)}`,
      r.returnPct === null ? "" : pct(r.returnPct),
      r.heldHours === null ? "" : `held ${r.heldHours < 1 ? `${Math.round(r.heldHours * 60)}m` : `${r.heldHours.toFixed(1)}h`}`,
      r.entryScore === null && r.currentScore === null
        ? ""
        : `score ${r.entryScore === null ? "?" : r.entryScore.toFixed(0)}→${r.currentScore === null ? "?" : r.currentScore.toFixed(0)}`,
      r.currentLiquidityUsd === null
        ? ""
        : `liq ${liquidityText(r.entryLiquidityUsd)}→${liquidityText(r.currentLiquidityUsd)}`,
      r.stopDistancePct === null ? "" : `stop ${pp(r.stopDistancePct)}`,
      r.takeProfitDistancePct === null ? "" : `tp ${pp(r.takeProfitDistancePct)}`,
      r.trailingStopDistancePct === null ? "" : `trail ${pp(r.trailingStopDistancePct)}`,
      `→ ${r.verdict.toUpperCase()}: ${r.reason}`,
    ].filter((b) => b !== "");
    return `  ${bits.join(" · ")}`;
  });
  return lines.join("\n");
}

export function buildPositionTools(ctx: RunContext): ToolSet {
  const { agent } = ctx;
  const rules = toExitRules(agent.config.risk);

  return {
    review_positions: tool({
      description:
        "Look at what you already own. Rescores every holding (free), then reports held time, return since entry, entry score vs current score, entry liquidity vs current liquidity, and how far each position sits from your stop, take-profit, trailing stop and max-hold — plus a verdict: hold, watch or exit_candidate. Those four rules are enforced automatically by the exit engine, so use this for the exits code cannot judge: a thesis that broke, a name going sideways, cash you want back. Free, and worth calling every tick you hold anything.",
      inputSchema: z.object({}),
      execute: logged(ctx, "review_positions", async () => {
        const now = new Date();
        const portfolio = await getPortfolio(agent.id);
        if (portfolio.positions.length === 0) {
          return {
            ok: true,
            count: 0,
            positions: [],
            rendered: "No open positions — you are flat.",
            note: "Nothing to review. Cash is a position too: say so if you are sitting this tick out.",
          };
        }

        // Free rescoring, one token at a time. A failure means "no current score", not a
        // failed tool: the rest of the review is still worth reading.
        const scores = new Map<string, TokenScore>();
        for (const p of portfolio.positions) {
          try {
            scores.set(
              p.token.id,
              await getTokenScore({
                chain: p.token.chain,
                address: p.token.address,
                universe: agent.config.universe,
                maxTradeUsd: agent.config.risk.maxTradeUsd,
                symbolHint: p.token.symbol,
              }),
            );
          } catch {
            // leave it unscored
          }
        }

        const exitPositions: ExitPosition[] = portfolio.positions.map((p) => {
          const score = scores.get(p.token.id) ?? null;
          return {
            tokenId: p.token.id,
            chain: p.token.chain,
            address: p.token.address,
            symbol: p.token.symbol,
            amountToken: p.amountToken,
            avgCostUsd: p.avgCostUsd,
            markPriceUsd: p.markPriceUsd,
            peakPriceUsd: p.peakPriceUsd,
            openedAt: p.openedAt === null ? null : new Date(p.openedAt),
            entryScore: p.entryScore,
            entryLiquidityUsd: p.entryLiquidityUsd,
            score:
              score === null
                ? null
                : {
                    total: score.total,
                    verdict: score.verdict,
                    blockers: score.blockers,
                    liquidityUsd: score.liquidityUsd,
                  },
          };
        });
        const pending = new Map(evaluateExits({ rules, positions: exitPositions, now }).map((d) => [d.tokenId, d]));

        const reviews: PositionReview[] = portfolio.positions.map((p) => {
          const score = scores.get(p.token.id) ?? null;
          const distances = exitDistances({
            unrealizedPct: p.unrealizedPnlPct,
            stopLossPct: rules.stopLossPct,
            takeProfitPct: rules.takeProfitPct,
          });
          const heldHours =
            p.openedAt === null ? null : Math.max(0, (now.getTime() - new Date(p.openedAt).getTime()) / 3_600_000);
          const fromPeakPct =
            p.peakPriceUsd !== null && p.peakPriceUsd > 0 && p.markPriceUsd !== null
              ? ((p.markPriceUsd - p.peakPriceUsd) / p.peakPriceUsd) * 100
              : null;
          const trailingStopDistancePct =
            rules.trailingStopPct === null || fromPeakPct === null ? null : rules.trailingStopPct + fromPeakPct;
          const liquidityChangePct =
            p.entryLiquidityUsd !== null && p.entryLiquidityUsd > 0 && score?.liquidityUsd != null
              ? ((score.liquidityUsd - p.entryLiquidityUsd) / p.entryLiquidityUsd) * 100
              : null;
          const scoreDrift = p.entryScore !== null && score !== null ? score.total - p.entryScore : null;
          const fired = pending.get(p.token.id) ?? null;

          let verdict: PositionVerdict = "hold";
          let reason: string;
          if (fired !== null) {
            verdict = "exit_candidate";
            reason = `the exit engine will close this on its next pass (${fired.reason}); no action needed from you`;
          } else if (score !== null && (score.verdict === "avoid" || score.blockers.length > 0)) {
            verdict = "exit_candidate";
            reason = `rescores ${score.total.toFixed(0)}/100 (${score.verdict})${score.blockers.length > 0 ? ` with blockers: ${score.blockers.join(", ")}` : ""} — you could not buy this today`;
          } else if (distances.stopDistancePct !== null && distances.stopDistancePct <= 5) {
            verdict = "watch";
            reason = `only ${pp(distances.stopDistancePct)} above the ${rules.stopLossPct}% stop`;
          } else if (trailingStopDistancePct !== null && trailingStopDistancePct <= 5) {
            verdict = "watch";
            reason = `${pp(trailingStopDistancePct)} from the ${rules.trailingStopPct}% trail, ${pct(fromPeakPct ?? 0)} off the ${priceText(p.peakPriceUsd ?? 0)} peak`;
          } else if (liquidityChangePct !== null && liquidityChangePct <= -25) {
            verdict = "watch";
            reason = `pool is ${pct(liquidityChangePct)} since entry (${liquidityText(p.entryLiquidityUsd)} → ${liquidityText(score?.liquidityUsd ?? null)})`;
          } else if (scoreDrift !== null && scoreDrift <= -15) {
            verdict = "watch";
            reason = `score has drifted ${scoreDrift.toFixed(0)} points since entry (${p.entryScore?.toFixed(0)} → ${score?.total.toFixed(0)})`;
          } else if (distances.takeProfitDistancePct !== null && distances.takeProfitDistancePct <= 5) {
            verdict = "watch";
            reason = `${pp(distances.takeProfitDistancePct)} from the ${rules.takeProfitPct}% take-profit, which will sell it automatically`;
          } else {
            reason =
              p.unrealizedPnlPct === null
                ? "no mark, so no rule can judge it — price it before you decide anything"
                : `${pct(p.unrealizedPnlPct)} on the trade and no rule is close`;
          }

          return {
            symbol: p.token.symbol,
            chain: p.token.chain,
            address: p.token.address,
            amountToken: p.amountToken,
            valueUsd: p.valueUsd,
            heldHours,
            avgCostUsd: p.avgCostUsd,
            markPriceUsd: p.markPriceUsd,
            returnPct: p.unrealizedPnlPct,
            peakPriceUsd: p.peakPriceUsd,
            fromPeakPct,
            entryScore: p.entryScore,
            currentScore: score?.total ?? null,
            scoreVerdict: score?.verdict ?? null,
            blockers: score?.blockers ?? [],
            entryLiquidityUsd: p.entryLiquidityUsd,
            currentLiquidityUsd: score?.liquidityUsd ?? null,
            liquidityChangePct,
            stopDistancePct: distances.stopDistancePct,
            takeProfitDistancePct: distances.takeProfitDistancePct,
            trailingStopDistancePct,
            hoursUntilMaxHold:
              rules.maxHoldHours === null || heldHours === null ? null : rules.maxHoldHours - heldHours,
            verdict,
            reason,
            pendingExitReason: fired?.reason ?? null,
          };
        });

        return {
          ok: true,
          count: reviews.length,
          rescored: scores.size,
          positions: reviews,
          rendered: renderReviews(reviews),
          note: "Distances are in percentage points; negative means the level is already breached. Positions the exit engine will close need nothing from you — sell only what the rules do not cover.",
        };
      }),
    }),
  };
}
