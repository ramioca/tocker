/**
 * AgentData API — funding rates, volatility, market overview.
 *
 * REAL: verified live at build time. `https://agentdata-api.com/.well-known/x402`
 * lists 25 resources; each answers x402 v2 with USDC on Base. Prices vary per
 * endpoint ($0.001–$0.003), so `paidFetch` reads the actual amount from the 402
 * before paying and the registry price below is the worst case.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import fixture from "./fixtures/agentdata.json";
import {
  asArray,
  asNumber,
  asString,
  clamp,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
} from "./normalize";

const ENDPOINTS = {
  "market-overview": "Full market overview with sentiment and arbitrage signals",
  "funding-rates": "Perpetual funding rates with long/short signals",
  volatility: "Volatility, range and annualized vol for BTC/ETH/SOL",
  prices: "Real-time prices for BTC, ETH, SOL, BNB, XRP",
  correlation: "30-day price correlation matrix",
  "liquidation-levels": "Estimated liquidation zones by leverage",
} as const;

const inputSchema = z.object({
  endpoint: z
    .enum(["market-overview", "funding-rates", "volatility", "prices", "correlation", "liquidation-levels"])
    .default("market-overview")
    .describe("Which AgentData endpoint to pay for"),
});

export const agentData = defineSource({
  id: "agentdata",
  name: "AgentData",
  summary: "Market-wide context for major assets: funding rates, volatility, correlation and liquidation levels.",
  description: `Macro/derivatives context for major assets. Endpoints: ${Object.entries(ENDPOINTS)
    .map(([k, v]) => `${k} (${v})`)
    .join("; ")}.`,
  category: "prices",
  network: "eip155:8453",
  priceUsd: 0.003,
  url: "https://agentdata-api.com/api/market-overview",
  experimental: false,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const endpoint = input.endpoint;
    const res = await paidFetch(ctx, {
      sourceId: "agentdata",
      url: `https://agentdata-api.com/api/${endpoint}`,
      network: "eip155:8453",
      priceUsd: 0.003,
      fixture: { ...fixture, endpoint },
    });

    const data = res.data;
    const label = asString(pick(data, "sentiment", "label"));
    const fearGreed = asNumber(pick(data, "sentiment", "fear_greed"));
    const assetLines = asArray(pick(data, "assets"))
      .slice(0, 6)
      .map((a) => {
        const sym = asString(pick(a, "symbol")) ?? "?";
        const price = asNumber(pick(a, "price"));
        const change = asNumber(pick(a, "change_24h"));
        const funding = asNumber(pick(a, "funding_rate_8h"));
        return `${sym} $${price ?? "?"} (24h ${(change ?? 0).toFixed(2)}%${funding === null ? "" : `, funding ${(funding * 100).toFixed(3)}%`})`;
      });
    const signalLines = asArray(pick(data, "signals"))
      .slice(0, 4)
      .map((s) => asString(pick(s, "note")))
      .filter((s): s is string => s !== null);

    const sentiment = fearGreed === null ? null : clamp((fearGreed - 50) / 50, -1, 1);

    return {
      summary: truncate(
        [
          `AgentData /${endpoint}${label ? ` — market ${label}${fearGreed === null ? "" : ` (F&G ${fearGreed})`}` : ""}.`,
          assetLines.join(" · "),
          signalLines.join(" · "),
        ]
          .filter(Boolean)
          .join(" | "),
        700,
      ),
      data,
      signals: sentiment === null ? undefined : { sentiment },
    };
  },
});
