/**
 * The exit engine — pure decision layer.
 *
 * Stop losses and take profits used to be prose in the system prompt: "guidance" the
 * model was free to ignore, and did, because nothing ran between ticks. This module is
 * the deterministic half. It takes the agent's risk rules, the book, fresh marks and
 * (optionally) a fresh score per held token, and returns the exits that must happen.
 * No database, no network, no clock of its own — `now` is an input — so every rule is
 * unit-testable to the edge case.
 *
 * `src/lib/trading/guardian.ts` is the only caller that executes these; it runs before
 * every LLM tick and every five minutes in between, so an agent cannot bleed out while
 * its model is asleep.
 *
 * ## The rules, in priority order
 *
 * | # | reason | fires when |
 * |---|---|---|
 * | 1 | `stop_loss`           | mark ≤ avgCost × (1 − stopLossPct/100) |
 * | 2 | `take_profit`         | mark ≥ avgCost × (1 + takeProfitPct/100) |
 * | 3 | `trailing_stop`       | mark ≤ peak × (1 − trailingStopPct/100), while still in profit |
 * | 4 | `max_hold`            | now − openedAt ≥ maxHoldHours |
 * | 5 | `score_collapse`      | fresh total < exitScoreBelow, or verdict `avoid` with blockers |
 * | 6 | `liquidity_collapse`  | fresh liquidity < entryLiquidity × (1 − pct/100) |
 *
 * A `null` rule is off. At most one decision per position: when several rules fire the
 * highest-priority one wins, because the trade is a full exit either way and the reason
 * is what gets published.
 *
 * Two deliberate refusals:
 *  - **No mark, no exit.** An unpriceable position is not sold blind; the risk guard
 *    refuses that sell anyway.
 *  - **Dust is left alone.** A position worth less than {@link DUST_VALUE_USD} costs more
 *    in fees and feed noise than it is worth, and a residual sliver left by a rounded
 *    fill would otherwise re-trigger every five minutes forever.
 *
 * The `trailing_stop` guard deserves its own note: it only fires while the mark is still
 * *above* entry (and the peak ever got above entry). A trail that fires underwater would
 * front-run the fixed stop loss and turn a −5% wobble into a realised loss the operator
 * never asked for. Below entry, `stop_loss` is the floor and the only floor.
 */
import { fmtUsd } from "@/lib/money";
import type { Chain, ExitReason, ScoreVerdict } from "@/server/types";

/** The exit-relevant half of `AgentConfig["risk"]`. Every field null = the engine is off. */
export interface ExitRules {
  stopLossPct: number | null;
  takeProfitPct: number | null;
  trailingStopPct: number | null;
  maxHoldHours: number | null;
  exitScoreBelow: number | null;
  exitOnLiquidityDropPct: number | null;
}

/** A freshly-taken score for a held token. Only the two collapse rules need it. */
export interface ExitScoreInput {
  total: number;
  verdict: ScoreVerdict;
  blockers: string[];
  liquidityUsd: number | null;
  /** Scorer warnings; a `low_confidence` score (providers failed) has no vote on exits. */
  warnings?: string[];
}

export interface ExitPosition {
  tokenId: string;
  chain: Chain;
  address: string;
  symbol: string;
  amountToken: number;
  /** Cost per token, fees included (see `positions.applyFillToPosition`). */
  avgCostUsd: number;
  /** Fresh mark. `null` means we could not price it — never exit blind. */
  markPriceUsd: number | null;
  /** Highest mark seen since entry. `null` on a position opened before peaks existed. */
  peakPriceUsd: number | null;
  openedAt: Date | null;
  entryScore: number | null;
  entryLiquidityUsd: number | null;
  /** Present only when the guardian rescored this token on this pass. */
  score?: ExitScoreInput | null;
}

export interface ExitDecision {
  tokenId: string;
  chain: Chain;
  address: string;
  symbol: string;
  reason: ExitReason;
  /** 1 is the highest priority; see the table in the module doc. */
  priority: number;
  /** Full exit: the whole position valued at the current mark. */
  amountUsd: number;
  amountToken: number;
  markPriceUsd: number;
  /** Unrealised PnL at the moment of the decision, in percent. */
  unrealizedPnlPct: number | null;
  /**
   * The owner's account of the exit: which rule fired, at what threshold, against what
   * entry. Stored on the trade and sent to the owner. The threshold is their strategy,
   * so it never reaches anyone else — see {@link publicRationale}.
   */
  rationale: string;
  /**
   * What anyone may read: what happened, never the rule value that made it happen.
   * "past my 35% target" next to a public fill price hands a non-owner the take-profit
   * setting, which `visibleExitDistances` exists to keep private. The feed post and
   * follower notifications carry this one.
   */
  publicRationale: string;
}

export interface EvaluateExitsInput {
  rules: ExitRules;
  positions: readonly ExitPosition[];
  now?: Date;
  /** Positions worth less than this are skipped. Default {@link DUST_VALUE_USD}. */
  minValueUsd?: number;
}

/** Priority order. Index + 1 is the `priority` on a decision. */
export const EXIT_PRIORITY: readonly ExitReason[] = [
  "stop_loss",
  "take_profit",
  "trailing_stop",
  "max_hold",
  "score_collapse",
  "liquidity_collapse",
];

/** Below this notional a position is dust: not worth a fill, a fee or a feed post. */
export const DUST_VALUE_USD = 1;

/** Narrows an agent's risk config to what the engine reads. */
export function toExitRules(risk: ExitRules): ExitRules {
  return {
    stopLossPct: risk.stopLossPct,
    takeProfitPct: risk.takeProfitPct,
    trailingStopPct: risk.trailingStopPct,
    maxHoldHours: risk.maxHoldHours,
    exitScoreBelow: risk.exitScoreBelow,
    exitOnLiquidityDropPct: risk.exitOnLiquidityDropPct,
  };
}

/** True when at least one rule is armed — the guardian skips agents with none. */
export function hasAnyExitRule(rules: ExitRules): boolean {
  return (
    rules.stopLossPct !== null ||
    rules.takeProfitPct !== null ||
    rules.trailingStopPct !== null ||
    rules.maxHoldHours !== null ||
    rules.exitScoreBelow !== null ||
    rules.exitOnLiquidityDropPct !== null
  );
}

/** True when a rule needs a fresh score, i.e. the guardian must rescore holdings. */
export function needsRescore(rules: ExitRules): boolean {
  return rules.exitScoreBelow !== null || rules.exitOnLiquidityDropPct !== null;
}

// ---------- formatting (the public rationale is the whole feed message) ----------

function positive(n: number | null): boolean {
  return n !== null && Number.isFinite(n) && n > 0;
}

/** Price text tuned for memecoins: 3 significant digits, never exponential. */
export function priceText(value: number): string {
  if (!Number.isFinite(value)) return "$?";
  const abs = Math.abs(value);
  if (abs === 0) return "$0";
  if (abs >= 1000) return `$${value.toFixed(0)}`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  const digits = Math.min(18, Math.ceil(-Math.log10(abs)) + 2);
  return `$${value.toFixed(digits).replace(/0+$/, "")}`;
}

/** "$2,141.37" — grouped, so a four-figure exit does not read as "$2141". */
function usdText(value: number): string {
  return fmtUsd(value);
}

/** "+42.5%" / "−16.2%" with a typographic minus, because this text is read, not parsed. */
function pctText(value: number, digits = 1): string {
  const body = `${Math.abs(value).toFixed(digits)}%`;
  if (value > 0) return `+${body}`;
  if (value < 0) return `−${body}`;
  return body;
}

/** Bare magnitude, for "fell 21.0% from its peak". */
function magnitudeText(value: number, digits = 1): string {
  return `${Math.abs(value).toFixed(digits)}%`;
}

/** "$310k" / "$1.2M" — pool depth, where the order of magnitude is the point. */
export function liquidityText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

function holdText(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function ruleText(pct: number): string {
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/**
 * The public line for an exit: the rule's name, the token and where the trade ended up.
 * No threshold, no peak, no hold limit and no pool depth, because each of those sits one
 * step from the operator's private setting. Deterministic in its inputs so
 * `visibleRationale` can rebuild the same line for rows written before this existed.
 */
export function publicExitText(reason: ExitReason, symbol: string, pnlPct: number | null): string {
  const at = pnlPct === null || !Number.isFinite(pnlPct) ? "" : ` at ${pctText(pnlPct)} from entry`;
  switch (reason) {
    case "stop_loss":
      return `Stop loss: closed ${symbol}${at}.`;
    case "take_profit":
      return `Take profit: sold ${symbol}${at}.`;
    case "trailing_stop":
      return `Trailing stop: sold ${symbol} off its high${at}.`;
    case "max_hold":
      return `Max hold: closed ${symbol}${at}.`;
    case "score_collapse":
      return `Score collapse: sold ${symbol}${at} after its score fell.`;
    case "liquidity_collapse":
      return `Liquidity collapse: sold ${symbol}${at} as its pool thinned.`;
    default:
      return `Exit: sold ${symbol}${at}.`;
  }
}

/** The "$95.00 out." tail both rationales end with. */
export function exitValueText(amountUsd: number): string {
  return `${usdText(amountUsd)} out.`;
}

// ---------- the rules ----------

interface Candidate {
  reason: ExitReason;
  rationale: string;
}

/** Hours a position has been open; null when we never recorded an entry time. */
export function heldHours(openedAt: Date | null, now: Date): number | null {
  if (openedAt === null) return null;
  const ms = now.getTime() - openedAt.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, ms / 3_600_000);
}

/** The price at which the fixed stop fires, or null when the rule is off. */
export function stopPrice(avgCostUsd: number, stopLossPct: number | null): number | null {
  if (stopLossPct === null || !positive(avgCostUsd)) return null;
  return avgCostUsd * (1 - stopLossPct / 100);
}

/** The price at which the take-profit fires, or null when the rule is off. */
export function takeProfitPrice(avgCostUsd: number, takeProfitPct: number | null): number | null {
  if (takeProfitPct === null || !positive(avgCostUsd)) return null;
  return avgCostUsd * (1 + takeProfitPct / 100);
}

/** The price at which the trail fires, or null when it is off or not yet armed. */
export function trailingStopPrice(
  peakPriceUsd: number | null,
  avgCostUsd: number,
  trailingStopPct: number | null,
): number | null {
  if (trailingStopPct === null || peakPriceUsd === null || !positive(peakPriceUsd)) return null;
  // Not armed until the position has actually been in profit: see the module doc.
  if (!positive(avgCostUsd) || peakPriceUsd <= avgCostUsd) return null;
  return peakPriceUsd * (1 - trailingStopPct / 100);
}

function evaluateOne(position: ExitPosition, rules: ExitRules, now: Date): Candidate | null {
  const { symbol } = position;
  const mark = position.markPriceUsd;
  if (mark === null || !Number.isFinite(mark) || mark <= 0) return null;
  const avgCost = position.avgCostUsd;
  const pnlPct = positive(avgCost) ? ((mark - avgCost) / avgCost) * 100 : null;

  // 1 — stop loss.
  const stop = stopPrice(avgCost, rules.stopLossPct);
  if (stop !== null && mark <= stop) {
    return {
      reason: "stop_loss",
      rationale: `Stop loss: ${symbol} at ${priceText(mark)}, ${pctText(pnlPct ?? 0)} from entry (${priceText(avgCost)}), through my ${ruleText(rules.stopLossPct as number)} stop. Closed the position.`,
    };
  }

  // 2 — take profit.
  const target = takeProfitPrice(avgCost, rules.takeProfitPct);
  if (target !== null && mark >= target) {
    return {
      reason: "take_profit",
      rationale: `Take profit: ${symbol} at ${priceText(mark)}, ${pctText(pnlPct ?? 0)} from entry (${priceText(avgCost)}), past my ${ruleText(rules.takeProfitPct as number)} target. Banked it.`,
    };
  }

  // 3 — trailing stop, only while still in profit.
  const trail = trailingStopPrice(position.peakPriceUsd, avgCost, rules.trailingStopPct);
  if (trail !== null && mark <= trail && mark > avgCost) {
    const peak = position.peakPriceUsd as number;
    const fromPeak = ((mark - peak) / peak) * 100;
    return {
      reason: "trailing_stop",
      rationale: `Trailing stop: ${symbol} fell ${magnitudeText(fromPeak)} from its ${priceText(peak)} peak to ${priceText(mark)}, through my ${ruleText(rules.trailingStopPct as number)} trail. Still ${pctText(pnlPct ?? 0)} on the trade, so I took the win rather than watch it round-trip.`,
    };
  }

  // 4 — max hold.
  const held = heldHours(position.openedAt, now);
  if (rules.maxHoldHours !== null && held !== null && held >= rules.maxHoldHours) {
    return {
      reason: "max_hold",
      rationale: `Max hold: ${symbol} has been open ${holdText(held)}, past my ${holdText(rules.maxHoldHours)} limit, at ${pctText(pnlPct ?? 0)}. The thesis had its window; closing it out.`,
    };
  }

  // 5 — score collapse. Needs a fresh score; no score means no opinion. Only
  // *deterioration* condemns a holding: an entry-shape gate (age window, blocklist)
  // or a provider that could not answer (`*_unknown`) is never a reason to sell.
  // A score the providers could not back is not a low score, it is no score: when
  // Jupiter or DexScreener are down for a pass, every holding would otherwise read
  // as a collapse and get sold into the outage.
  const raw = position.score ?? null;
  const score = raw && raw.warnings?.includes("low_confidence") ? null : raw;
  if (rules.exitScoreBelow !== null && score) {
    const belowFloor = score.total < rules.exitScoreBelow;
    const deterioration = score.blockers.filter(isDeteriorationBlocker);
    const condemned = score.verdict === "avoid" && deterioration.length > 0;
    if (belowFloor || condemned) {
      const entry = position.entryScore === null ? null : position.entryScore;
      const drift = entry === null ? "" : ` against ${entry.toFixed(0)} at entry`;
      const blockers = deterioration.length > 0 ? ` Blockers: ${deterioration.join(", ")}.` : "";
      const why = belowFloor
        ? `under my exit floor of ${rules.exitScoreBelow}`
        : `and the verdict is now "avoid" with hard-gate failures`;
      return {
        reason: "score_collapse",
        rationale: `Score collapse: ${symbol} now scores ${score.total.toFixed(1)}/100 (${score.verdict})${drift}, ${why}.${blockers} Out at ${priceText(mark)}, ${pctText(pnlPct ?? 0)}.`,
      };
    }
  }

  // 6 — liquidity collapse.
  const drop = rules.exitOnLiquidityDropPct;
  const entryLiq = position.entryLiquidityUsd;
  const nowLiq = score?.liquidityUsd ?? null;
  if (drop !== null && entryLiq !== null && entryLiq > 0 && nowLiq !== null && nowLiq < entryLiq * (1 - drop / 100)) {
    const fell = ((entryLiq - nowLiq) / entryLiq) * 100;
    return {
      reason: "liquidity_collapse",
      rationale: `Liquidity collapse: ${symbol}'s pool is down ${magnitudeText(fell, 0)} since I bought (${liquidityText(entryLiq)} → ${liquidityText(nowLiq)}), past my ${ruleText(drop)} limit. The exit door is closing, so I used it at ${priceText(mark)}, ${pctText(pnlPct ?? 0)}.`,
    };
  }

  return null;
}

/**
 * The exits that must happen right now, at most one per position.
 *
 * Pure: same inputs, same output, no clock and no io. Order follows the input, so a
 * caller can zip decisions back against its own list.
 */
/**
 * Blockers that can only be true because the token got worse *after* entry. A mint or
 * freeze authority cannot be re-enabled once revoked, and top-10 concentration is an
 * entry appetite — if either is true now it was true when the agent bought, so they
 * are not collapses. Age windows, the blocklist and any `*_unknown` describe the
 * operator's rules or a provider gap, never the token. What is left is what actually
 * moves against a holder: a honeypot flip, a tax switched on, the pool or the holder
 * base falling through the floor.
 *
 * `cannot_sell` belongs here for the same reason `honeypot` does: it is a paid
 * pre-trade check *proving*, at this block, that the exit does not exist — the exit
 * venue drained, or trading was switched off. Both can become true long after a clean
 * entry, and both describe the token, not the operator's appetite. (The check is only
 * ever run when the agent pays for it, so its absence says nothing and blocks nothing.)
 */
export function isDeteriorationBlocker(blocker: string): boolean {
  return (
    blocker === "honeypot" ||
    blocker === "cannot_sell" ||
    blocker === "liquidity_below_floor" ||
    blocker === "holders_below_floor" ||
    blocker.startsWith("buy_tax_") ||
    blocker.startsWith("sell_tax_")
  );
}

export function evaluateExits(input: EvaluateExitsInput): ExitDecision[] {
  const now = input.now ?? new Date();
  const minValue = input.minValueUsd ?? DUST_VALUE_USD;
  const out: ExitDecision[] = [];

  for (const position of input.positions) {
    if (!positive(position.amountToken)) continue;
    const mark = position.markPriceUsd;
    if (mark === null || !Number.isFinite(mark) || mark <= 0) continue;

    const value = position.amountToken * mark;
    if (!Number.isFinite(value) || value < minValue) continue;

    const candidate = evaluateOne(position, input.rules, now);
    if (!candidate) continue;

    const priority = EXIT_PRIORITY.indexOf(candidate.reason) + 1;
    const avgCost = position.avgCostUsd;
    const pnlPct = positive(avgCost) ? ((mark - avgCost) / avgCost) * 100 : null;
    out.push({
      tokenId: position.tokenId,
      chain: position.chain,
      address: position.address,
      symbol: position.symbol,
      reason: candidate.reason,
      priority,
      amountUsd: value,
      amountToken: position.amountToken,
      markPriceUsd: mark,
      unrealizedPnlPct: pnlPct,
      rationale: `${candidate.rationale} ${exitValueText(value)}`,
      publicRationale: `${publicExitText(candidate.reason, position.symbol, pnlPct)} ${exitValueText(value)}`,
    });
  }

  return out;
}

/** One-line summary of a pass, for the run transcript and the tick prompt. */
export function describeExits(
  decisions: readonly Pick<ExitDecision, "reason" | "symbol" | "amountUsd" | "unrealizedPnlPct">[],
): string {
  if (decisions.length === 0) return "No exit rules fired.";
  return decisions
    .map((d) => `${d.reason} → sold ${d.symbol} (${usdText(d.amountUsd)}${d.unrealizedPnlPct === null ? "" : `, ${pctText(d.unrealizedPnlPct)}`})`)
    .join("; ");
}
