/**
 * Plexa pre-trade check — "can I still get out of this?", measured on-chain.
 *
 * REAL. Verified live at build time: `POST https://api.getplexa.com/v1/pretrade/check`
 * is POST-only (a GET answers 405 with the contract in the body), costs $0.05, and
 * pays over x402 v2 on Base (`eip155:8453`), Polygon, Arbitrum or Solana — the live
 * 402's `accepts[]` is authoritative and `selectPaymentOption` picks the one this
 * agent holds. Request body `{ token, sizeUSD?, chain? }` with `sizeUSD` as a STRING,
 * and the full response schema, come from `https://api.getplexa.com/openapi.json`.
 *
 * The verdict vocabulary is the reason this source exists, and it is three-valued:
 * - `avoid` — a listed trap was PROVEN at this block (`triggers` names which of
 *   NO_EXIT_VENUE / EXIT_LIQUIDITY_DRAINED / TRADING_DISABLED fired);
 * - `clear` — none fired AND the liquidity sweep reached a conclusion;
 * - `unknown` — none fired but the sweep did not conclude.
 *
 * Only `avoid` sets `signals.sellable = false`, which is what raises the `cannot_sell`
 * hard gate in the scorer. `unknown` leaves `sellable` undefined on purpose: an
 * unfinished check is not a failed one, and blocking on it would let one AMM the
 * engine cannot read pool-by-pool veto every Base trade.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import fixture from "./fixtures/plexa-pretrade.json";
import {
  asArray,
  asNumber,
  asString,
  clampRisk,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
  type Signals,
} from "./normalize";

const BASE_NETWORK = "eip155:8453";
const PRICE_USD = 0.05;

const inputSchema = z.object({
  token: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Plexa checks EVM contracts, so this must be an 0x address")
    .describe("Base (or Polygon/Arbitrum) ERC-20 contract address"),
  sizeUsd: z
    .number()
    .positive()
    .max(10_000_000)
    .optional()
    .describe("The position size you would actually take, in USD — the exit is measured at YOUR size"),
  chain: z
    .enum(["base", "polygon", "arbitrum"])
    .optional()
    .describe("Chain the token lives on; defaults to base"),
});

/** `clear` is not a safety rating, so it never scores as safe as a clean contract. */
const RISK_BY_VERDICT: Record<string, number> = { avoid: 0.95, unknown: 0.6, clear: 0.3 };
const CONFIDENCE_PENALTY: Record<string, number> = { high: 0, medium: 0.05, low: 0.15 };

function money(n: number | null): string {
  if (n === null) return "unmeasured";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export const plexaPretrade = defineSource({
  id: "plexa-pretrade",
  name: "Plexa pre-trade check",
  summary: "Simulates selling a Base token at your size, so the agent never buys something it can't exit.",
  description:
    "Live sell simulation for a Base (or Polygon/Arbitrum) token at YOUR size: can the position actually be exited, and for how much. Returns avoid only when a trap is proven on-chain at this block — no exit venue, exit liquidity drained, or trading disabled — plus the exit pot in dollars, ownership, concentration and transfer restrictions. A proven 'avoid' raises the cannot_sell hard gate and makes the token unbuyable.",
  category: "onchain",
  network: BASE_NETWORK,
  // Probed 2026-09-21: the 402 also offers Solana USDC, so a Solana-only agent can pay for it.
  networks: [BASE_NETWORK, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  priceUsd: PRICE_USD,
  url: "https://api.getplexa.com/v1/pretrade/check",
  experimental: false,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const res = await paidFetch(ctx, {
      sourceId: "plexa-pretrade",
      url: "https://api.getplexa.com/v1/pretrade/check",
      method: "POST",
      body: {
        token: input.token,
        // The service takes sizes as strings, not numbers — see its OpenAPI pattern.
        ...(input.sizeUsd === undefined ? {} : { sizeUSD: String(input.sizeUsd) }),
        ...(input.chain === undefined ? {} : { chain: input.chain }),
      },
      network: BASE_NETWORK,
      priceUsd: PRICE_USD,
      fixture,
    });

    const data = res.data;
    const verdict = asString(pick(data, "verdict"));
    const confidence = asString(pick(data, "confidence")) ?? "medium";
    const triggers = asArray(pick(data, "triggers")).filter((t): t is string => typeof t === "string");
    const exitLiquidityUsd = asNumber(pick(data, "risk_profile", "liquidity", "exitLiquidityUsd"));
    const conclusive = pick(data, "liquidityCoverage", "conclusive");
    const symbol = asString(pick(data, "identity", "symbol")) ?? input.token.slice(0, 10);
    const impactBps = asNumber(pick(data, "quote", "priceImpactBps"));

    const signals: Signals = {};
    if (verdict === "avoid") signals.sellable = false;
    else if (verdict === "clear") signals.sellable = true;
    // `unknown` deliberately leaves `sellable` undefined.

    if (verdict !== null) {
      const base = RISK_BY_VERDICT[verdict] ?? 0.6;
      signals.risk = clampRisk(base + (CONFIDENCE_PENALTY[confidence] ?? 0));
    }

    const detail =
      verdict === "avoid"
        ? `PROVEN unsellable at this block: ${triggers.join(", ") || "trap fired"}.`
        : verdict === "unknown"
          ? `Inconclusive — the liquidity sweep did not finish (conclusive=${String(conclusive)}), so the absence of a trap is not established.`
          : `No provable trap fired and the sweep concluded. This is not a safety rating.`;

    return {
      summary: truncate(
        `Plexa pre-trade on ${symbol} (${input.chain ?? "base"}): ${verdict ?? "no verdict"}, confidence ${confidence}. ${detail} Exit liquidity reachable: ${money(exitLiquidityUsd)}${input.sizeUsd === undefined ? "" : ` against a $${input.sizeUsd.toLocaleString("en-US")} position`}${impactBps === null ? "" : `, price impact ${impactBps} bps at that size`}.`,
        700,
      ),
      data,
      signals: Object.keys(signals).length === 0 ? undefined : signals,
    };
  },
});
