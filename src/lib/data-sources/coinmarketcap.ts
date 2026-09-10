/**
 * CoinMarketCap over x402 — no API key, pay per call.
 *
 * REAL: both endpoints verified live. They answer HTTP 402 with an x402 **v2**
 * base64 `PAYMENT-REQUIRED` header whose `accepts[]` includes USDC on Base
 * (`eip155:8453`, `amount: "10000"` = $0.01) alongside BSC options.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import quotesFixture from "./fixtures/cmc-quotes.json";
import dexFixture from "./fixtures/cmc-dex-search.json";
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

const QUOTES_URL = "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest";
const DEX_URL = "https://pro-api.coinmarketcap.com/x402/v1/dex/search";

const quotesInput = z.object({
  symbols: z
    .array(z.string().min(1).max(16))
    .min(1)
    .max(10)
    .describe("Ticker symbols, e.g. ['SOL','BONK']"),
});

export const cmcQuotes = defineSource({
  id: "cmc-quotes",
  name: "CoinMarketCap quotes",
  description: "Latest CMC market quotes (price, 24h volume, 1h/24h/7d change, market cap) for up to 10 symbols.",
  category: "prices",
  network: "eip155:8453",
  priceUsd: 0.01,
  url: QUOTES_URL,
  experimental: false,
  inputSchema: quotesInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const url = `${QUOTES_URL}?symbol=${encodeURIComponent(input.symbols.join(","))}`;
    const res = await paidFetch(ctx, {
      sourceId: "cmc-quotes",
      url,
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture: quotesFixture,
    });

    const data = res.data;
    const bySymbol = pick(data, "data");
    const lines: string[] = [];
    let momentum = 0;
    let counted = 0;
    if (bySymbol && typeof bySymbol === "object") {
      for (const [symbol, entry] of Object.entries(bySymbol as Record<string, unknown>)) {
        const usd = pick(entry, "quote", "USD");
        const price = asNumber(pick(usd, "price"));
        const change24 = asNumber(pick(usd, "percent_change_24h"));
        const change7 = asNumber(pick(usd, "percent_change_7d"));
        const vol = asNumber(pick(usd, "volume_24h"));
        if (price === null) continue;
        lines.push(
          `${symbol} $${price < 0.01 ? price.toExponential(3) : price.toFixed(4)} (24h ${(change24 ?? 0).toFixed(2)}%, 7d ${(change7 ?? 0).toFixed(2)}%, vol $${Math.round(vol ?? 0).toLocaleString("en-US")})`,
        );
        momentum += (change24 ?? 0) / 20;
        counted += 1;
      }
    }

    return {
      summary: truncate(lines.length > 0 ? lines.join(" · ") : "CoinMarketCap returned no quotes.", 700),
      data,
      signals: counted > 0 ? { sentiment: clamp(momentum / counted, -1, 1) } : undefined,
    };
  },
});

const dexInput = z.object({
  query: z.string().min(2).max(64).describe("Name, symbol or contract address to look up on DEXes"),
});

export const cmcDexSearch = defineSource({
  id: "cmc-dex-search",
  name: "CoinMarketCap DEX search",
  description: "Search DEX-listed tokens by name, symbol or contract and get price, liquidity and 24h volume.",
  category: "onchain",
  network: "eip155:8453",
  priceUsd: 0.01,
  url: DEX_URL,
  experimental: false,
  inputSchema: dexInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const url = `${DEX_URL}?q=${encodeURIComponent(input.query)}`;
    const res = await paidFetch(ctx, {
      sourceId: "cmc-dex-search",
      url,
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture: dexFixture,
    });

    const rows = asArray(pick(res.data, "data"));
    const lines = rows.slice(0, 6).map((row) => {
      const symbol = asString(pick(row, "symbol")) ?? "?";
      const network = asString(pick(row, "network_slug")) ?? "?";
      const address = asString(pick(row, "contract_address")) ?? "";
      const price = asNumber(pick(row, "price_usd"));
      const change = asNumber(pick(row, "percent_change_24h"));
      return `${symbol} (${network}) ${price === null ? "?" : `$${price < 0.01 ? price.toExponential(3) : price.toFixed(4)}`} 24h ${(change ?? 0).toFixed(2)}% — ${address}`;
    });

    return {
      summary: truncate(lines.length > 0 ? lines.join(" · ") : `No DEX matches for "${input.query}".`, 700),
      data: res.data,
    };
  },
});
