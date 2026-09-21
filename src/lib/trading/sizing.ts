/**
 * Position sizing — how big a ticket is allowed to be.
 *
 * Before this module there was one answer: `maxTradeUsd`, a fixed dollar amount that
 * meant one thing on day one and something very different after the book doubled or
 * halved. Three modes now, all pure, all decided here so the risk guard, the model's
 * prompt and the manual sheet can never disagree about the number:
 *
 * | mode | one sentence |
 * |---|---|
 * | `fixed_usd` | Every ticket is the same dollar amount, capped by `maxTradeUsd` — the size never moves, whatever the book does. |
 * | `percent_equity` | Every ticket is a fixed share of current equity, so the agent scales itself down after losses and up after gains. |
 * | `volatility_scaled` | Starts from that same share of equity and shrinks it in proportion to how wide the token has been ranging, so a violent token gets a smaller ticket than a calm one. |
 *
 * Three invariants, in order of importance:
 *
 * 1. **`maxTradeUsd` is the ceiling over every mode.** It is the number the operator
 *    typed as "never more than this", and no computed size may exceed it. A
 *    percent-of-equity agent that 10×s does not silently start writing $1,000 tickets.
 * 2. **`volatility_scaled` only ever shrinks.** A token quieter than the reference
 *    range is not sized *up* — a mode sold as conservative that levers into calm
 *    markets is not conservative, it is leveraged. `scale ≤ 1`, always.
 * 3. **Missing inputs degrade downwards, never upwards.** No equity figure, no range
 *    data, a nonsense config: each one falls back to the smaller of what we can
 *    justify, and the reason is written in English on the result.
 *
 * Nothing here reads a database, a clock or the network, so every edge is testable.
 */
import type { AgentRiskWithSizing, PositionSizingConfig, PositionSizingMode } from "@/db/schema";

export type { PositionSizingConfig, PositionSizingMode };

/** What an agent with no `sizing` block does: exactly what it did before sizing existed. */
export const DEFAULT_SIZING: PositionSizingConfig = {
  mode: "fixed_usd",
  percentOfEquity: 10,
  referenceRangePct: 25,
  minTradeUsd: 5,
};

/** One sentence per mode, shown in the UI and given to the model. */
export const SIZING_EXPLANATIONS: Record<PositionSizingMode, string> = {
  fixed_usd:
    "Every ticket is the same dollar amount, capped by your max trade size — the size never moves, whatever the book does.",
  percent_equity:
    "Every ticket is a fixed share of current equity, so the agent scales itself down after a drawdown and back up as it recovers.",
  volatility_scaled:
    "Starts from that same share of equity and shrinks it in proportion to how wide the token has recently been ranging, so a violent token gets a smaller ticket than a calm one.",
};

export const SIZING_LABELS: Record<PositionSizingMode, string> = {
  fixed_usd: "Fixed USD",
  percent_equity: "Percent of equity",
  volatility_scaled: "Volatility-scaled",
};

function isMode(value: unknown): value is PositionSizingMode {
  return value === "fixed_usd" || value === "percent_equity" || value === "volatility_scaled";
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads the sizing block off a risk config, tolerating every shape a stored config can
 * actually have: absent (legacy rows), partial (a half-written form), or nonsense.
 * Never throws — a bad sizing block must not stop an agent from trading, it must make
 * it trade the old way.
 */
export function readSizing(risk: AgentRiskWithSizing | null | undefined): PositionSizingConfig {
  const raw = risk?.sizing;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SIZING };
  return {
    mode: isMode(raw.mode) ? raw.mode : DEFAULT_SIZING.mode,
    percentOfEquity: num(raw.percentOfEquity, DEFAULT_SIZING.percentOfEquity, 0.1, 100),
    referenceRangePct: num(raw.referenceRangePct, DEFAULT_SIZING.referenceRangePct, 1, 500),
    minTradeUsd: num(raw.minTradeUsd, DEFAULT_SIZING.minTradeUsd, 0, 1_000_000),
  };
}

/**
 * How much a token's recent range shrinks a ticket, in `(0, 1]`.
 *
 * `rangePct` is the high-to-low range over the recent window as a percentage of price:
 * a token that traded between $0.90 and $1.10 has ranged 20%. At or below the
 * reference range the scale is 1 (full size); above it the scale is the ratio, so a
 * token ranging twice as wide as the reference gets half the ticket.
 *
 * Never returns more than 1 (invariant 2) and never returns 0 — a scale of zero would
 * be a silent refusal, and a refusal should say so out loud.
 */
export function volatilityScale(rangePct: number | null, referenceRangePct: number): number {
  if (rangePct === null || !Number.isFinite(rangePct) || rangePct <= 0) return 1;
  const reference = Number.isFinite(referenceRangePct) && referenceRangePct > 0 ? referenceRangePct : DEFAULT_SIZING.referenceRangePct;
  if (rangePct <= reference) return 1;
  // Floored at 1% so an absurd range (a token that 50×'d and came back) produces a
  // tiny ticket rather than a zero one the caller has to special-case.
  return Math.max(0.01, reference / rangePct);
}

export interface SizingInput {
  sizing: PositionSizingConfig;
  /** The hard ceiling from `risk.maxTradeUsd`. */
  maxTradeUsd: number;
  /** Current equity (cash + marks). Null or 0 falls back to `fixed_usd`. */
  equityUsd: number | null;
  /**
   * Recent high-to-low range as a percent of price, for `volatility_scaled`. Null when
   * we have no range data — the mode then behaves as `percent_equity` and says so.
   */
  rangePct?: number | null;
}

export interface SizedOrder {
  /** The largest ticket this configuration permits, in USD. */
  amountUsd: number;
  /** The mode that actually produced it — may differ from the config when inputs were missing. */
  effectiveMode: PositionSizingMode;
  /** True when `maxTradeUsd` is what bound the size, rather than the mode. */
  cappedByMaxTrade: boolean;
  /** The volatility scale applied, 1 when none was. */
  scale: number;
  /** One line, written for a human: how this number was reached. */
  explanation: string;
  /**
   * True when the computed ceiling fell under `minTradeUsd`.
   *
   * **Advisory, not enforced (W7).** Nothing in `riskGuard` reads this: a ticket under
   * the floor is placed like any other. It is deliberately left that way for now — the
   * first-trade preset caps `maxTradeUsd` at $2 while `DEFAULT_SIZING.minTradeUsd` is
   * $5, so turning this into a rule would refuse every trade of the exact configuration
   * the product recommends to a new operator. Any UI that reads this flag must say "this
   * is smaller than your floor", not "the agent will skip it".
   *
   * To make it a rule later, lower `minTradeUsd` in `FIRST_TRADE_PRESET` in the same
   * change, and check the *order*, not just the ceiling.
   */
  belowMinimum: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The size this agent is allowed to write for one order. Pure.
 *
 * The result is a *ceiling*, not an instruction: the model or the operator may ask for
 * less. The risk guard refuses anything above it.
 */
export function sizeOrder(input: SizingInput): SizedOrder {
  const maxTradeUsd = Number.isFinite(input.maxTradeUsd) && input.maxTradeUsd > 0 ? input.maxTradeUsd : 0;
  const { sizing } = input;
  const equity = input.equityUsd !== null && Number.isFinite(input.equityUsd) && input.equityUsd > 0 ? input.equityUsd : null;

  const capped = (amount: number, effectiveMode: PositionSizingMode, scale: number, how: string): SizedOrder => {
    const bounded = Math.min(amount, maxTradeUsd);
    const amountUsd = round2(Math.max(0, bounded));
    return {
      amountUsd,
      effectiveMode,
      cappedByMaxTrade: amount > maxTradeUsd + 1e-9,
      scale,
      explanation:
        amount > maxTradeUsd + 1e-9
          ? `${how}, capped at your max trade size of $${round2(maxTradeUsd)}.`
          : `${how}.`,
      belowMinimum: amountUsd < sizing.minTradeUsd,
    };
  };

  if (sizing.mode === "fixed_usd") {
    return capped(maxTradeUsd, "fixed_usd", 1, `Fixed ticket of $${round2(maxTradeUsd)}`);
  }

  if (equity === null) {
    // No equity figure (a brand-new agent before its first snapshot, or a pricing
    // outage). Sizing off an unknown book is guessing; fall back to the fixed ticket.
    return capped(
      maxTradeUsd,
      "fixed_usd",
      1,
      `No equity figure available, so this falls back to the fixed $${round2(maxTradeUsd)} ticket`,
    );
  }

  const base = (equity * sizing.percentOfEquity) / 100;

  if (sizing.mode === "percent_equity") {
    return capped(
      base,
      "percent_equity",
      1,
      `${round2(sizing.percentOfEquity)}% of $${round2(equity)} equity = $${round2(base)}`,
    );
  }

  const rangePct = input.rangePct ?? null;
  if (rangePct === null) {
    return capped(
      base,
      "percent_equity",
      1,
      `No recent range for this token, so volatility scaling has nothing to shrink: ${round2(
        sizing.percentOfEquity,
      )}% of $${round2(equity)} equity = $${round2(base)}`,
    );
  }

  const scale = volatilityScale(rangePct, sizing.referenceRangePct);
  const scaled = base * scale;
  const how =
    scale >= 1
      ? `${round2(sizing.percentOfEquity)}% of $${round2(equity)} equity = $${round2(base)}; ${round2(
          rangePct,
        )}% recent range is inside the ${round2(sizing.referenceRangePct)}% reference, so no shrink`
      : `${round2(sizing.percentOfEquity)}% of $${round2(equity)} equity = $${round2(
          base,
        )}, shrunk ×${scale.toFixed(2)} because the ${round2(rangePct)}% recent range is wider than the ${round2(
          sizing.referenceRangePct,
        )}% reference = $${round2(scaled)}`;
  return capped(scaled, "volatility_scaled", scale, how);
}

/**
 * Recent high-to-low range as a percent of the current price, from whatever price
 * points we already have (score history, marks). Returns null for fewer than three
 * points or a nonsense series — the sizing functions treat null as "no opinion".
 */
export function rangePctFrom(prices: ReadonlyArray<number | null | undefined>): number | null {
  const usable = prices.filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  if (usable.length < 3) return null;
  const hi = Math.max(...usable);
  const lo = Math.min(...usable);
  const last = usable[usable.length - 1];
  if (!(last > 0) || hi <= lo) return 0;
  return ((hi - lo) / last) * 100;
}
