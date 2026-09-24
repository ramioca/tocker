/**
 * DripMetrics — BTC/ETH/SOL market microstructure. The *regime* layer: it says
 * nothing about a memecoin, it says what kind of tape that memecoin is trading into.
 *
 * REAL, both sources. Verified live at build time:
 * - `GET https://api.dripmetrics.ai/market/summary` → 402, x402 **v2**
 *   (`PAYMENT-REQUIRED` header, `accepts[0] = { network: "eip155:8453", amount:
 *   "250000" }` = $0.25 USDC on Base). Query params `pair` (BTC | BTCUSDT | BTC-USD)
 *   and `window` (30m | 1h | 2h | 3h) come from the live OpenAPI document, and the
 *   402's `extensions.bazaar.info.output.example` is what `fixtures/` mirrors.
 * - `GET https://api.dripmetrics.ai/metrics/{metric}` and `/orderbook/{metric}`, $0.05
 *   per metric — except `orderbook/execution-impact`, which the same document prices
 *   at $0.25. That per-call price (not the registry's headline $0.05) is what is
 *   checked against the run budget, so the model cannot buy a $0.25 metric on $0.06.
 *
 * Free discovery lives at `/catalog` and `/openapi.json`; neither is paid, neither is
 * called from here — the allowlist below is a snapshot of `/catalog` instead.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import summaryFixture from "./fixtures/dripmetrics-summary.json";
import metricFixture from "./fixtures/dripmetrics-metric.json";
import {
  asNumber,
  asString,
  clamp,
  clampRisk,
  clampSentiment,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
  type Signals,
} from "./normalize";

const BASE_NETWORK = "eip155:8453";

const summaryInput = z.object({
  pair: z
    .enum(["BTC", "BTCUSDT", "BTC-USD"])
    .optional()
    .describe("BTC only in this phase of the service; defaults to BTC-USD"),
  window: z.enum(["30m", "1h", "2h", "3h"]).optional().describe("Lookback window; defaults to 30m"),
});

export const dripmetricsSummary = defineSource({
  id: "dripmetrics-summary",
  name: "DripMetrics market summary",
  summary: "A read on the overall BTC market: order flow, liquidity and volatility.",
  description:
    "One-call BTC market regime read: order-flow toxicity (VPIN vs its baseline), buy/sell imbalance, liquidity in dollars-per-basis-point, realized vol, dealer gamma and an AI-written paragraph explaining the tape. Use it to decide whether this is a tick to take risk at all, not to pick a token.",
  category: "prices",
  network: BASE_NETWORK,
  priceUsd: 0.25,
  url: "https://api.dripmetrics.ai/market/summary",
  experimental: false,
  inputSchema: summaryInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const params = new URLSearchParams({ pair: input.pair ?? "BTC-USD", window: input.window ?? "30m" });
    const res = await paidFetch(ctx, {
      sourceId: "dripmetrics-summary",
      url: `https://api.dripmetrics.ai/market/summary?${params.toString()}`,
      network: BASE_NETWORK,
      priceUsd: 0.25,
      fixture: summaryFixture,
    });

    const data = res.data;
    const metrics = pick(data, "metrics");
    const signals = pick(data, "signals");
    // `buySellImbalance` is already a signed share of volume, so it *is* the sentiment
    // axis — no invented mapping. Absent, the qualitative order-flow word stands in.
    const imbalance = asNumber(pick(metrics, "buySellImbalance"));
    const orderFlow = asString(pick(signals, "orderFlow"));
    const sentiment =
      imbalance !== null
        ? clampSentiment(imbalance)
        : orderFlow === "buy-leaning"
          ? 0.3
          : orderFlow === "sell-leaning"
            ? -0.3
            : orderFlow === null
              ? null
              : 0;
    // A log return over the window: 2% inside the window reads as full velocity.
    const momentum = asNumber(pick(metrics, "momentumLogReturn"));
    const velocity = momentum === null ? null : clamp(momentum * 50, -1, 1);
    // Excess VPIN is flow toxicity net of the finite-sample baseline: the closest thing
    // this service has to "how likely am I the liquidity someone is picking off".
    const toxicity = asNumber(pick(metrics, "vpinExcess")) ?? asNumber(pick(metrics, "vpin"));

    const out: Signals = {};
    if (sentiment !== null) out.sentiment = sentiment;
    if (velocity !== null) out.velocity = velocity;
    if (toxicity !== null) out.risk = clampRisk(toxicity);

    const prose = asString(pick(data, "summary")) ?? "";
    const pair = asString(pick(data, "pair")) ?? input.pair ?? "BTC";
    const window = asString(pick(data, "window")) ?? input.window ?? "30m";
    const regime = [
      asString(pick(signals, "orderFlow")),
      asString(pick(signals, "liquidity")) === null ? null : `liquidity ${asString(pick(signals, "liquidity"))}`,
      asString(pick(signals, "volatility")) === null ? null : `vol ${asString(pick(signals, "volatility"))}`,
      asString(pick(signals, "priceTrend")),
    ]
      .filter((x): x is string => x !== null)
      .join(", ");

    return {
      summary: truncate(
        `${pair} ${window} regime: ${regime || "unclassified"}. ${prose}`.trim(),
        700,
      ),
      data,
      signals: Object.keys(out).length === 0 ? undefined : out,
    };
  },
});

/**
 * The metrics an agent may buy. A closed list on purpose: the catalog carries 22 of
 * them plus a Kraken xStocks shelf, and a model handed the whole menu spends the run
 * budget learning what `roll-spread` is.
 */
const METRICS = [
  "buy-sell-volume-imbalance",
  "cvd",
  "amihud-illiquidity",
  "realized-vol",
  "momentum",
  "orderbook/execution-impact",
] as const;

type Metric = (typeof METRICS)[number];

/** `orderbook/execution-impact` is priced at $0.25; every other metric here is $0.05. */
function priceOf(metric: Metric): number {
  return metric === "orderbook/execution-impact" ? 0.25 : 0.05;
}

const metricInput = z
  .object({
    metric: z.enum(METRICS).describe("Which microstructure metric to buy"),
    pair: z
      .string()
      .min(2)
      .max(20)
      .optional()
      .describe("Exchange-native pair: BTCUSDT / ETHUSDT / SOLUSDT (binance), BTC-USD (coinbase), BTC (hyperliquid)"),
    exchange: z.enum(["binance", "coinbase", "hyperliquid"]).optional().describe("Exchange adapter; defaults to the BTC cache"),
    window: z.enum(["30m", "1h", "2h", "3h"]).optional().describe("Lookback window (2h/3h are BTC-only); defaults to 30m"),
    side: z.enum(["buy", "sell"]).optional().describe("orderbook/execution-impact only: direction of the hypothetical order"),
    notionalUsd: z
      .number()
      .min(10)
      .max(2_000_000)
      .optional()
      .describe("orderbook/execution-impact only: order size in USD, $10-$2M"),
  })
  .refine((v) => v.metric !== "orderbook/execution-impact" || v.side !== undefined, {
    message: "orderbook/execution-impact needs a side (buy or sell)",
    path: ["side"],
  });

export const dripmetricsMetric = defineSource({
  id: "dripmetrics-metric",
  name: "DripMetrics metric",
  summary: "Order-flow and liquidity metrics for BTC, ETH and SOL, including what an order would cost to fill.",
  description:
    "One microstructure metric for BTC/ETH/SOL: buy-sell-volume-imbalance, cvd, amihud-illiquidity, realized-vol, momentum ($0.05 each), or orderbook/execution-impact ($0.25) — what a given order size would actually cost to fill. execution-impact is the sizing tool: buy it before a clip that is large against the book, not for every candidate.",
  category: "prices",
  network: BASE_NETWORK,
  priceUsd: 0.05,
  url: "https://api.dripmetrics.ai/metrics/{metric}",
  experimental: false,
  inputSchema: metricInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const orderbook = input.metric === "orderbook/execution-impact";
    const params = new URLSearchParams();
    if (input.pair) params.set("pair", input.pair);
    if (orderbook) {
      params.set("side", input.side ?? "buy");
      params.set("notionalUsd", String(input.notionalUsd ?? 10_000));
    } else {
      if (input.exchange) params.set("exchange", input.exchange);
      params.set("window", input.window ?? "30m");
    }

    const path = orderbook ? "/orderbook/execution-impact" : `/metrics/${input.metric}`;
    const query = params.toString();
    const res = await paidFetch(ctx, {
      sourceId: "dripmetrics-metric",
      url: `https://api.dripmetrics.ai${path}${query ? `?${query}` : ""}`,
      network: BASE_NETWORK,
      priceUsd: priceOf(input.metric),
      fixture: metricFixture,
    });

    const data = res.data;
    const value = asNumber(pick(data, "value"));
    const pair = asString(pick(data, "pair")) ?? input.pair ?? "BTC";
    const window = asString(pick(data, "window")) ?? input.window ?? "—";

    const signals: Signals = {};
    if (value !== null) {
      // Only metrics with a defined, bounded reading get an axis. `cvd` is cumulative
      // base-asset volume — unbounded and pair-relative — so it stays data, not signal.
      if (input.metric === "buy-sell-volume-imbalance") signals.sentiment = clampSentiment(value);
      if (input.metric === "momentum") signals.velocity = clamp(value * 50, -1, 1);
      if (input.metric === "realized-vol") signals.risk = clampRisk(value / 2); // 200% annualised = max
      if (input.metric === "amihud-illiquidity") signals.risk = clampRisk(value);
    }
    if (orderbook) {
      const impactBps = asNumber(pick(data, "components", "impactBps")) ?? (value === null ? null : value);
      // 500 bps of impact on your own order is the point where the fill is the trade.
      if (impactBps !== null) signals.risk = clampRisk(impactBps / 500);
    }

    return {
      summary: truncate(
        orderbook
          ? `Execution impact on ${pair}: ${value === null ? "unavailable" : value} for a ${input.side ?? "buy"} of $${(input.notionalUsd ?? 10_000).toLocaleString("en-US")}.`
          : `${input.metric} for ${pair} over ${window}: ${value === null ? "unavailable" : value}.`,
        600,
      ),
      data,
      signals: Object.keys(signals).length === 0 ? undefined : signals,
    };
  },
});
