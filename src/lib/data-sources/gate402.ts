/**
 * gate402 — Base launch radar and per-token momentum.
 *
 * REAL. Verified live at build time: both `https://gate402.app/v1/launches` and
 * `https://gate402.app/v1/momentum` answer 402 with an x402 **v2** `PAYMENT-REQUIRED`
 * header, `accepts[0] = { network: "eip155:8453", asset: USDC, amount: "20000" }`
 * = $0.02 USDC on Base. The 402 body carries a `extensions.bazaar.info` block that
 * gives both the request (`POST`, JSON body `{ minLiquidityUsd, limit }` for launches,
 * `{ address }` for momentum) and a worked output example — which is what the fixtures
 * mirror field for field.
 *
 * `launches` is the Base half of discovery's `paid_launches` feed; `momentum` is the
 * read on one token, and it is honeypot-gated upstream, so its `tradeable` flag is a
 * real sellability signal rather than a guess.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import launchesFixture from "./fixtures/gate402-launches.json";
import momentumFixture from "./fixtures/gate402-momentum.json";
import {
  asArray,
  asNumber,
  asString,
  clamp,
  clampRisk,
  clampSentiment,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
  type PaidLaunch,
  type Signals,
} from "./normalize";

const BASE_NETWORK = "eip155:8453";
const PRICE_USD = 0.02;

const inputSchema = z.object({
  mode: z
    .enum(["launches", "momentum"])
    .default("launches")
    .describe("launches = newest pre-screened Base pools, momentum = price/flow read on one Base token"),
  address: z.string().min(4).max(64).optional().describe("Base contract address, required for mode 'momentum'"),
  minLiquidityUsd: z.number().min(0).max(100_000_000).optional().describe("mode 'launches': pool liquidity floor, default $1,000"),
  limit: z.number().int().min(1).max(30).optional().describe("mode 'launches': how many launches, default 15"),
});

/** The `launches` payload → {@link PaidLaunch}[] for discovery's `paid_launches` feed. */
export function parseGate402Launches(data: unknown): PaidLaunch[] {
  const out: PaidLaunch[] = [];
  for (const row of asArray(pick(data, "launches"))) {
    const address = asString(pick(row, "address"));
    if (address === null) continue;
    const ageMinutes = asNumber(pick(row, "ageMinutes"));
    out.push({
      chain: "base",
      address,
      symbol: (asString(pick(row, "symbol")) ?? address.slice(0, 8)).toUpperCase(),
      name: asString(pick(row, "name")),
      // gate402 prints prices as strings ("0.0004") — `asNumber` handles both.
      priceUsd: asNumber(pick(row, "priceUsd")),
      liquidityUsd: asNumber(pick(row, "liquidityUsd")),
      volume24hUsd: asNumber(pick(row, "volumeUsd", "h24")),
      marketCapUsd: asNumber(pick(row, "fdvUsd")),
      // The radar reports no holder count; `scoreToken` fills it from GoPlus later.
      holderCount: null,
      ageHours: ageMinutes === null ? null : ageMinutes / 60,
      priceChange24hPct: asNumber(pick(row, "priceChangePct", "h24")),
    });
  }
  return out;
}

export const gate402BaseRadar = defineSource({
  id: "gate402-base-radar",
  name: "gate402 Base radar",
  summary: "New Base launches, pre-screened, plus a momentum read on a single token.",
  description:
    "Base-chain launch radar and momentum read, $0.02 a call. mode 'launches' returns the newest Base DEX pools pre-screened by liquidity, age and flow with quickFlags for obvious junk; mode 'momentum' classifies one Base token RISING/FALLING/FLAT and ACCUMULATION/DISTRIBUTION from 5m-24h price, buy/sell pressure and volume trend, behind a live honeypot check.",
  category: "onchain",
  network: BASE_NETWORK,
  priceUsd: PRICE_USD,
  url: "https://gate402.app/v1/launches",
  experimental: false,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    if (input.mode === "momentum" && !input.address) {
      throw new Error("gate402-base-radar: mode 'momentum' needs a Base address");
    }

    const res = await paidFetch(ctx, {
      sourceId: "gate402-base-radar",
      url: input.mode === "momentum" ? "https://gate402.app/v1/momentum" : "https://gate402.app/v1/launches",
      method: "POST",
      body:
        input.mode === "momentum"
          ? { address: input.address }
          : { minLiquidityUsd: input.minLiquidityUsd ?? 1_000, limit: input.limit ?? 15 },
      network: BASE_NETWORK,
      priceUsd: PRICE_USD,
      fixture: input.mode === "momentum" ? momentumFixture : launchesFixture,
    });

    const data = res.data;

    if (input.mode === "launches") {
      const launches = parseGate402Launches(data);
      const top = launches
        .slice(0, 5)
        .map(
          (l) =>
            `${l.symbol}${l.liquidityUsd === null ? "" : ` $${Math.round(l.liquidityUsd).toLocaleString("en-US")} liq`}${l.ageHours === null ? "" : ` ${Math.round(l.ageHours * 60)}m old`}`,
        )
        .join("; ");
      return {
        summary: truncate(
          `gate402: ${launches.length} fresh Base pool(s) past a $${(input.minLiquidityUsd ?? 1_000).toLocaleString("en-US")} liquidity floor. ${top}`,
          700,
        ),
        data,
      };
    }

    const symbol = asString(pick(data, "symbol")) ?? input.address ?? "token";
    const momentum = asString(pick(data, "momentum"));
    const flow = asString(pick(data, "flow"));
    const tradeable = pick(data, "tradeable");
    const honeypot = pick(data, "safety", "isHoneypot");
    const sellTax = asNumber(pick(data, "safety", "sellTaxPct"));
    const thin = pick(data, "safety", "thinLiquidity") === true;
    const buyPressure = asNumber(pick(data, "signals", "buyPressurePct", "h1"));
    const change1h = asNumber(pick(data, "signals", "priceChangePct", "h1"));
    const volumeTrend = asString(pick(data, "signals", "volumeTrend"));

    const signals: Signals = {};
    // Buy pressure is a percentage of trades that were buys: 50% is neutral by
    // construction, so it maps onto the -1..1 axis without any fitting.
    if (buyPressure !== null) signals.sentiment = clampSentiment((buyPressure - 50) / 50);
    else if (flow === "ACCUMULATION") signals.sentiment = 0.4;
    else if (flow === "DISTRIBUTION") signals.sentiment = -0.4;
    if (volumeTrend === "ACCELERATING") signals.velocity = 0.6;
    else if (volumeTrend === "DECELERATING") signals.velocity = -0.4;
    else if (change1h !== null) signals.velocity = clamp(change1h / 25, -1, 1);

    let risk: number | null = null;
    if (honeypot === true) risk = 1;
    else if (honeypot === false) risk = thin ? 0.5 : 0.2;
    if (risk !== null && sellTax !== null) risk = clampRisk(risk + Math.min(0.3, sellTax / 100));
    if (risk !== null) signals.risk = clampRisk(risk);

    // Only a *proven* result moves this: an absent honeypot field leaves sellability
    // unknown, and unknown must never read as "you cannot sell".
    if (honeypot === true || tradeable === false) signals.sellable = false;
    else if (honeypot === false && tradeable === true) signals.sellable = true;

    return {
      summary: truncate(
        `gate402 momentum for ${symbol}: ${momentum ?? "?"} / ${flow ?? "?"}, 1h ${change1h === null ? "?" : `${change1h > 0 ? "+" : ""}${change1h}%`}, buy pressure ${buyPressure === null ? "?" : `${buyPressure}%`}, volume ${volumeTrend ?? "?"}. Honeypot check: ${honeypot === true ? "FAILED — sells blocked" : honeypot === false ? "passed" : "inconclusive"}${thin ? ", liquidity flagged thin" : ""}.`,
        700,
      ),
      data,
      signals: Object.keys(signals).length === 0 ? undefined : signals,
    };
  },
});
