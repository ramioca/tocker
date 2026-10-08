/**
 * Nansen Smart Money — what the wallets with a track record did with a token, and
 * which tokens they are buying.
 *
 * Two things are sold under this one id, at two prices.
 *
 * ## The per-token read, $0.01 (`endpoint: "token"`)
 *
 * `POST https://api.nansen.ai/api/v1/tgm/flow-intelligence`. This is the read a scored
 * token gets. It names the token, so the answer is about that token: for each of six
 * wallet groups (smart traders, top-PnL wallets, whales, fresh wallets, public figures,
 * exchanges) a net flow in USD and a wallet count over the window.
 *
 * Confirmed, probed with no payment on 2026-10-08:
 *  - the endpoint answers 402 with an x402 **v2** `PAYMENT-REQUIRED` header; its accepts
 *    include `{ network: "eip155:8453", asset: USDC, amount: "10000" }` = $0.01 on Base
 *    and the same amount on Solana, beside networks the platform holds no wallet for;
 *  - the request, from the 402's own `extensions.bazaar` block and Nansen's API
 *    reference: a JSON body with `chain` and `token_address` required, `timeframe`
 *    ("5m" | "1h" | "6h" | "12h" | "1d" | "7d", default "1d") and `filters` optional, and
 *    no other property allowed. Solana and Base are both listed chains;
 *  - the answer's *documented* shape, from the same two places: `{ data: [row], warnings? }`
 *    where a row has `<group>_net_flow_usd`, `<group>_avg_flow_usd` and
 *    `<group>_wallet_count` for public_figure, top_pnl, whale, smart_trader, exchange and
 *    fresh_wallets. The 402's worked example is `{ "data": [] }`.
 *
 * NOT confirmed: nobody here has paid for an answer, so no live body has been seen. That
 * a token nothing tracked has traded answers with an empty `data` is read off the worked
 * example, not observed. The reference says the exchange and fresh-wallet counts are
 * always 0 and that fresh-wallet figures exist only for "1d" and "7d"; neither is relied
 * on. {@link parseFlowIntelligence} therefore reads tolerantly and never throws: an answer
 * that is not the documented shape is no reading at all, never a reading of zero. The
 * documented types (re-probed 2026-10-08) are `number` for a flow and `integer` for a
 * count, so a smart trader or top-PnL field holding anything else is not that shape.
 *
 * ## The boards, $0.05 (`endpoint: "netflow" | "holdings" | "dex-trades"`)
 *
 * `POST https://api.nansen.ai/api/v1/smart-money/netflow` and its two siblings. Probed
 * again on 2026-10-08: 402, x402 v2, `amount: "50000"` = $0.05 on Base and on Solana.
 * The request shape comes from the 402's own `extensions.bazaar.info`: a JSON body of
 * `{ chains, filters, order_by, pagination }`. That block labels the method "GET"
 * while its schema only permits POST/PUT/PATCH — a contradiction in the listing — so
 * this sends POST, which the live endpoint accepts (it answers 402, not 405).
 *
 * Netflow is a *ranked table*, not a per-token lookup: the tokens the tracked wallets
 * moved most on a chain. Scoring used to buy it once for every token and look the token
 * up in its fifty rows, which a coin a few hours old is never on. It is now what it is
 * good for: discovery's `smart_money` feed buys it once per chain and its rows become
 * candidates ({@link parseNetflowBoard}).
 *
 * A call that names a token address is a question about that token and is the per-token
 * read, never a board, unless a board is asked for by name ({@link smartMoneyEndpoint}).
 * Which boards an agent's model may buy through `query_data_source` is decided there,
 * with that function: none while the owner's `smart_money` feed is off, and never the
 * netflow board, which discovery has bought or will buy in the same tick.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import { smartMoneyLine, smartMoneyReading } from "@/lib/tokens/smart-money";
import emptyFlowFixture from "./fixtures/nansen-flow-intelligence-empty.json";
import flowFixture from "./fixtures/nansen-flow-intelligence.json";
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
  type SmartMoneyBoardRow,
  type SmartMoneyRead,
  type WalletFlow,
} from "./normalize";

const BASE_NETWORK = "eip155:8453";
/** What the two kinds of call cost. The registry's headline price is the per-token read's. */
const PRICE_USD = { token: 0.01, board: 0.05 } as const;

const ENDPOINTS = {
  token: "https://api.nansen.ai/api/v1/tgm/flow-intelligence",
  netflow: "https://api.nansen.ai/api/v1/smart-money/netflow",
  holdings: "https://api.nansen.ai/api/v1/smart-money/holdings",
  "dex-trades": "https://api.nansen.ai/api/v1/smart-money/dex-trades",
} as const;

const inputSchema = z.object({
  endpoint: z
    .enum(["token", "netflow", "holdings", "dex-trades"])
    .optional()
    .describe(
      "token = what smart traders, top-PnL wallets, whales and fresh wallets did with ONE token ($0.01; needs tokenAddress and exactly one chain). netflow = the chain's board of net USD in/out per token, holdings = current positions, dex-trades = individual fills ($0.05 each). Default: token when tokenAddress is given, otherwise netflow",
    ),
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
    .describe("The token to read (endpoint token), or to pick out of a board. Omit to read a whole board."),
  symbol: z.string().min(1).max(24).optional().describe("Fallback match on a board when you only know the ticker"),
  window: z
    .enum(["1h", "24h", "7d", "30d"])
    .optional()
    .describe("The window to report on; defaults to 24h. Endpoint token has no 30d"),
  limit: z.number().int().min(1).max(100).optional().describe("Rows of a board to fetch (default 50)"),
});

const FIELD_FOR_WINDOW = {
  "1h": "net_flow_1h_usd",
  "24h": "net_flow_24h_usd",
  "7d": "net_flow_7d_usd",
  "30d": "net_flow_30d_usd",
} as const;

/** The per-token read's own names for the windows it has. It has no thirty-day one. */
const TIMEFRAME_FOR_WINDOW = { "1h": "1h", "24h": "1d", "7d": "7d", "30d": null } as const;

type Endpoint = keyof typeof ENDPOINTS;

/**
 * Which endpoint a call buys. A token address is a question about that token, so it is
 * the per-token read unless a board was asked for by name. It never falls back to a
 * board, not for a token on several chains and not for a window the read lacks: that
 * fallback is the five-cent lookup this source used to make for every scored token.
 */
function endpointFor(input: { endpoint?: Endpoint; tokenAddress?: string }): Endpoint {
  return input.endpoint ?? (input.tokenAddress ? "token" : "netflow");
}

/**
 * The same for parameters as a model sent them, before anything is paid, so a caller
 * can refuse a board it may not buy. `null` when the parameters are not this source's;
 * the query itself refuses those.
 */
export function smartMoneyEndpoint(params: unknown): Endpoint | null {
  const parsed = inputSchema.safeParse(params);
  return parsed.success ? endpointFor(parsed.data) : null;
}

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

// ---------- the per-token read ----------

/** The six groups a flow-intelligence row reports, by the prefix of their three fields. */
const GROUPS = {
  smartTraders: "smart_trader",
  topPnl: "top_pnl",
  whales: "whale",
  freshWallets: "fresh_wallets",
  publicFigures: "public_figure",
  exchanges: "exchange",
} as const satisfies Record<keyof SmartMoneyRead, string>;

function walletFlow(row: unknown, prefix: string): WalletFlow {
  const wallets = asNumber(pick(row, `${prefix}_wallet_count`));
  return {
    netFlowUsd: asNumber(pick(row, `${prefix}_net_flow_usd`)),
    wallets: wallets === null || wallets < 0 ? null : Math.round(wallets),
  };
}

const NO_FLOW: WalletFlow = { netFlowUsd: null, wallets: null };

/** The four fields the score is made from. Every other field is context for the sentence. */
const SCORED_FIELDS = [GROUPS.smartTraders, GROUPS.topPnl].flatMap((prefix) => [
  `${prefix}_net_flow_usd`,
  `${prefix}_wallet_count`,
]);

/**
 * A scored field can be read when it is absent, null, a finite number, or that number
 * written out. `asNumber` alone is too forgiving for these four: it reads "" as 0 and
 * turns what it cannot read into "no number", and either one beside a zero count says
 * that nobody traded the token.
 */
function readable(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

/**
 * A flow-intelligence answer → the read, or `null` when it is not an answer this can read.
 *
 * Never throws, whatever it is handed. Three outcomes, and they are different facts:
 *  - a row: the read it carries, each missing or null field left `null`;
 *  - an empty `data`: the documented answer for a token none of the groups moved, which
 *    is a read with nothing in it;
 *  - anything else (no `data` list, a row that is not an object or has none of the
 *    documented fields, a smart trader or top-PnL field that is there and is not a
 *    number, wallets counted with no flow beside them): `null`. Nothing may be concluded
 *    from it, least of all that nobody traded the token.
 */
export function parseFlowIntelligence(data: unknown): SmartMoneyRead | null {
  const rows = pick(data, "data");
  if (!Array.isArray(rows)) return null;
  if (rows.length === 0) {
    return { smartTraders: NO_FLOW, topPnl: NO_FLOW, whales: NO_FLOW, freshWallets: NO_FLOW, publicFigures: NO_FLOW, exchanges: NO_FLOW };
  }
  const row: unknown = rows[0];
  if (row === null || typeof row !== "object" || Array.isArray(row)) return null;
  const prefixes = Object.values(GROUPS);
  if (!prefixes.some((prefix) => `${prefix}_net_flow_usd` in row || `${prefix}_wallet_count` in row)) return null;
  if (SCORED_FIELDS.some((field) => !readable(pick(row, field)))) return null;

  const read: SmartMoneyRead = {
    smartTraders: walletFlow(row, GROUPS.smartTraders),
    topPnl: walletFlow(row, GROUPS.topPnl),
    whales: walletFlow(row, GROUPS.whales),
    freshWallets: walletFlow(row, GROUPS.freshWallets),
    publicFigures: walletFlow(row, GROUPS.publicFigures),
    exchanges: walletFlow(row, GROUPS.exchanges),
  };
  // Smart money wallets counted and no flow for them is half an answer: there is no
  // number to score, and "nobody traded it" would be false.
  const counted = (read.smartTraders.wallets ?? 0) + (read.topPnl.wallets ?? 0);
  if (counted > 0 && read.smartTraders.netFlowUsd === null && read.topPnl.netFlowUsd === null) return null;
  return read;
}

/**
 * The tokens the mock answers a per-token read for: the ones the board fixture shows
 * smart money buying. Every other token gets the documented empty answer, which is what
 * a coin no tracked wallet has traded really reads as.
 */
const FIXTURE_TOKENS: readonly string[] = [
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK (Solana)
  "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS", // KNOTS (Solana)
  "0x532f27101965dd16442E59d40670FaF5eBB142E4", // BRETT (Base)
].map((address) => address.toLowerCase());

function flowFixtureFor(tokenAddress: string): unknown {
  return FIXTURE_TOKENS.includes(tokenAddress.toLowerCase()) ? flowFixture : emptyFlowFixture;
}

// ---------- the board ----------

/**
 * The netflow board → the rows discovery's `smart_money` feed can use: a token on one of
 * the platform's two chains, with an address and a 24-hour net flow. Rows on other
 * chains, and rows missing either, are dropped. Never throws.
 */
export function parseNetflowBoard(data: unknown): SmartMoneyBoardRow[] {
  const out: SmartMoneyBoardRow[] = [];
  for (const raw of asArray(pick(data, "data"))) {
    const chain = asString(pick(raw, "chain"))?.toLowerCase();
    const address = asString(pick(raw, "token_address"));
    const netflow24hUsd = asNumber(pick(raw, "net_flow_24h_usd"));
    if ((chain !== "solana" && chain !== "base") || !address || netflow24hUsd === null) continue;
    out.push({ chain, address, symbol: asString(pick(raw, "token_symbol")), netflow24hUsd });
  }
  return out;
}

export const nansenSmartMoney = defineSource({
  id: "nansen-smart-money",
  name: "Nansen Smart Money",
  summary: "What wallets with a proven record did with a token, and which tokens they are buying.",
  description:
    "Nansen-labelled wallets. endpoint 'token' ($0.01) reads ONE token over a window: how many smart traders and top-PnL wallets traded it and what they net bought or sold in USD, plus the net flow of whales, fresh wallets, public figures and exchanges. A token none of them traded answers with nothing, which is information, not a failed read. endpoints 'netflow', 'holdings' and 'dex-trades' ($0.05 each) are chain-wide boards of what funds and smart traders moved most; they are bought only when your owner switched on the smart money feed, and netflow only by discover_tokens. The tie-breaker signal: it does not tell you a token is safe, it tells you whether wallets with a record are on the same side as you.",
  category: "onchain",
  network: BASE_NETWORK,
  // Probed 2026-09-21 and 2026-10-08: every endpoint's 402 also offers Solana USDC, so a
  // Solana-only agent can pay for it.
  networks: [BASE_NETWORK, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  priceUsd: PRICE_USD.token,
  url: ENDPOINTS.token,
  experimental: false,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const window = input.window ?? "24h";
    const endpoint = endpointFor(input);

    if (endpoint === "token") {
      // Both refusals come before anything is paid. They are worded for a caller that
      // named a token and no endpoint, which is how a model reaches this branch.
      const [chain] = input.chains;
      if (!input.tokenAddress || input.chains.length !== 1 || !chain) {
        throw new Error(
          "nansen-smart-money: the per-token read (endpoint 'token') needs tokenAddress and exactly one chain, the one the token is on",
        );
      }
      const timeframe = TIMEFRAME_FOR_WINDOW[window];
      if (timeframe === null) {
        throw new Error("nansen-smart-money: the per-token read (endpoint 'token') covers window 1h, 24h or 7d, not 30d");
      }

      const res = await paidFetch(ctx, {
        sourceId: "nansen-smart-money",
        url: ENDPOINTS.token,
        method: "POST",
        // No `filters`: a filter drops the row it does not match, and a dropped row is
        // indistinguishable from a token nobody traded.
        body: { chain, token_address: input.tokenAddress, timeframe },
        network: BASE_NETWORK,
        priceUsd: PRICE_USD.token,
        fixture: flowFixtureFor(input.tokenAddress),
      });

      const read = parseFlowIntelligence(res.data);
      if (read === null) {
        return {
          summary: "Nansen answered the per-token smart money read in a shape this app does not know. Nothing was read from it.",
          data: res.data,
        };
      }
      const reading = smartMoneyReading(read);
      // No reading leaves the signal unset: reporting 0 would let the scorer treat
      // "nobody tracked touched it" as "flow is balanced".
      const signals: Signals | undefined =
        reading === null
          ? undefined
          : { smartMoneyNetflowUsd: reading.netflowUsd, sentiment: flowSentiment(reading.netflowUsd) };
      return { summary: truncate(smartMoneyLine(read, window), 600), data: res.data, ...(signals ? { signals } : {}) };
    }

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
      priceUsd: PRICE_USD.board,
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
