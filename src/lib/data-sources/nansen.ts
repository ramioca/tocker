/**
 * Nansen Smart Money — where the wallets with a track record are putting money.
 *
 * REAL. Verified live at build time: `https://api.nansen.ai/api/v1/smart-money/netflow`
 * answers 402 with an x402 **v2** `PAYMENT-REQUIRED` header whose first accept is
 * `{ network: "eip155:8453", asset: USDC, amount: "50000" }` = $0.05 USDC on Base
 * (it also offers X Layer, BSC and others we hold no wallet for, which
 * `selectPaymentOption` filters out). `/holdings` and `/dex-trades` answer the same
 * 402 at the same price.
 *
 * The request shape comes from the 402's own `extensions.bazaar.info`: a JSON body of
 * `{ chains, filters, order_by, pagination }`. That block labels the method "GET"
 * while its schema only permits POST/PUT/PATCH — a contradiction in the listing — so
 * this sends POST, which the live endpoint accepts (it answers 402, not 405).
 *
 * Netflow is a *ranked table*, not a per-token lookup: the service returns the tokens
 * smart money moved most, and we pick this agent's token out of it. A token nobody
 * tracked has bought or sold is simply absent — which is itself information, and is
 * reported as "no tracked flow", never as a netflow of zero.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import fixture from "./fixtures/nansen-smart-money.json";
import {
  asArray,
  asNumber,
  asString,
  clamp,
  clampSentiment,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
  type Signals,
} from "./normalize";

const BASE_NETWORK = "eip155:8453";
const PRICE_USD = 0.05;

const ENDPOINTS = {
  netflow: "https://api.nansen.ai/api/v1/smart-money/netflow",
  holdings: "https://api.nansen.ai/api/v1/smart-money/holdings",
  "dex-trades": "https://api.nansen.ai/api/v1/smart-money/dex-trades",
} as const;

const inputSchema = z.object({
  endpoint: z
    .enum(["netflow", "holdings", "dex-trades"])
    .optional()
    .describe("netflow = net USD in/out per token (default), holdings = current positions, dex-trades = individual fills"),
  chains: z
    .array(z.enum(["solana", "base", "ethereum", "arbitrum", "bnb", "polygon"]))
    .min(1)
    .max(6)
    .describe("Chains to read, e.g. ['solana'] or ['base']"),
  tokenAddress: z
    .string()
    .min(3)
    .max(64)
    .optional()
    .describe("Pick this token out of the table. Omit to read the whole smart-money board."),
  symbol: z.string().min(1).max(24).optional().describe("Fallback match when you only know the ticker"),
  window: z
    .enum(["1h", "24h", "7d", "30d"])
    .optional()
    .describe("Which netflow column to rank and report on; defaults to 24h"),
  limit: z.number().int().min(1).max(100).optional().describe("Rows to fetch (default 50)"),
});

const FIELD_FOR_WINDOW = {
  "1h": "net_flow_1h_usd",
  "24h": "net_flow_24h_usd",
  "7d": "net_flow_7d_usd",
  "30d": "net_flow_30d_usd",
} as const;

interface NetflowRow {
  address: string | null;
  symbol: string | null;
  chain: string | null;
  netflowUsd: number | null;
  traderCount: number | null;
}

function sameToken(row: NetflowRow, address: string | undefined, symbol: string | undefined): boolean {
  if (address && row.address && row.address.toLowerCase() === address.toLowerCase()) return true;
  if (symbol && row.symbol && row.symbol.toLowerCase() === symbol.toLowerCase()) return true;
  return false;
}

function toRow(raw: unknown, field: string): NetflowRow {
  return {
    address: asString(pick(raw, "token_address")),
    symbol: asString(pick(raw, "token_symbol")),
    chain: asString(pick(raw, "chain")),
    netflowUsd: asNumber(pick(raw, field)) ?? asNumber(pick(raw, "net_flow_24h_usd")) ?? asNumber(pick(raw, "value_usd")),
    traderCount: asNumber(pick(raw, "trader_count")),
  };
}

function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Dollars → a -1..1 axis on a log scale: $10k of net flow is a whisper (0.2), $1M is
 * a shout (1.0). Deliberately *not* relative to liquidity here — the scorer does that
 * comparison, because only the scorer knows the pool.
 */
function flowSentiment(netflowUsd: number): number {
  const magnitude = Math.abs(netflowUsd);
  if (magnitude < 1_000) return 0;
  const scaled = Math.log10(magnitude / 10_000) / Math.log10(100);
  return clampSentiment(Math.sign(netflowUsd) * clamp(0.2 + scaled * 0.8, 0, 1));
}

export const nansenSmartMoney = defineSource({
  id: "nansen-smart-money",
  name: "Nansen Smart Money",
  summary: "Whether wallets with a proven record are buying or selling a token.",
  description:
    "Net USD flow into a token from Nansen-labelled smart-money wallets (funds and proven traders), per chain and per window. The tie-breaker signal: it does not tell you a token is safe, it tells you whether wallets with a record are on the same side as you.",
  category: "onchain",
  network: BASE_NETWORK,
  // Probed 2026-09-21: the 402 also offers Solana USDC, so a Solana-only agent can pay for it.
  networks: [BASE_NETWORK, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  priceUsd: PRICE_USD,
  url: ENDPOINTS.netflow,
  experimental: false,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const endpoint = input.endpoint ?? "netflow";
    const window = input.window ?? "24h";
    const field = FIELD_FOR_WINDOW[window];

    const res = await paidFetch(ctx, {
      sourceId: "nansen-smart-money",
      url: ENDPOINTS[endpoint],
      method: "POST",
      body: {
        chains: input.chains,
        filters: {
          include_smart_money_labels: ["Fund", "Smart Trader"],
          include_stablecoins: false,
          include_native_tokens: false,
        },
        ...(endpoint === "netflow" ? { order_by: [{ field, direction: "DESC" }] } : {}),
        pagination: { page: 1, per_page: input.limit ?? 50 },
      },
      network: BASE_NETWORK,
      priceUsd: PRICE_USD,
      fixture,
    });

    const data = res.data;
    const rows = asArray(pick(data, "data")).map((raw) => toRow(raw, field));
    const wanted = input.tokenAddress ?? input.symbol;
    const match = wanted ? rows.find((r) => sameToken(r, input.tokenAddress, input.symbol)) ?? null : null;

    if (wanted && match === null) {
      // Absence is a real reading, but it is not a zero: reporting 0 would let the
      // scorer treat "nobody tracked touched it" as "flow is balanced".
      return {
        summary: truncate(
          `No tracked smart-money ${endpoint} for ${wanted} on ${input.chains.join("/")} in the ${window} window — it is not on the board of ${rows.length} token(s).`,
          600,
        ),
        data,
      };
    }

    if (match !== null && match.netflowUsd !== null) {
      const signals: Signals = {
        smartMoneyNetflowUsd: match.netflowUsd,
        sentiment: flowSentiment(match.netflowUsd),
      };
      return {
        summary: truncate(
          `Smart money ${match.netflowUsd >= 0 ? "accumulated" : "distributed"} ${match.symbol ?? wanted} on ${match.chain ?? input.chains.join("/")}: ${money(match.netflowUsd)} net over ${window}${match.traderCount === null ? "" : ` across ${match.traderCount} tracked wallet(s)`}.`,
          600,
        ),
        data,
        signals,
      };
    }

    const board = rows
      .slice(0, 8)
      .map((r) => `${r.symbol ?? r.address?.slice(0, 8) ?? "?"} ${r.netflowUsd === null ? "—" : money(r.netflowUsd)}`)
      .join("; ");
    return {
      summary: truncate(
        `Smart-money ${endpoint} on ${input.chains.join("/")} over ${window}, ${rows.length} row(s). Top: ${board || "none"}.`,
        700,
      ),
      data,
    };
  },
});
