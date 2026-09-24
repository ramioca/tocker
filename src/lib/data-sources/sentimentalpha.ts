/**
 * SentimentAlpha — real-time X (Twitter) narrative alpha.
 *
 * The endpoint is real and the 402 is real: re-probed live 2026-09-21,
 * `https://sentimentalpha.ai/v1/narrative-alpha` answers HTTP 402 with an x402 **v1**
 * body (`accepts[0].maxAmountRequired = "10000"` = $0.01, `network: "base"`, asset
 * `0x8335…2913`) plus the legacy `x-payment-*` headers.
 *
 * What is *not* real yet is a settled payment. Its `accepts[0].extra` declares
 * `{ name: "USDC", version: "2" }`, but Base USDC's own EIP-712 domain is
 * `name = "USD Coin"` (read on-chain: `name()` → `"USD Coin"`, `version()` → `"2"`,
 * `DOMAIN_SEPARATOR()` → `0x02fa7265…`). `@x402/evm` signs the EIP-3009 authorization
 * with whatever name the *server* advertises
 * (`chunk-7KWSWAVE.mjs` → `signAuthorization`), so the signature lands under the wrong
 * domain and the facilitator rejects it with `ErrEip3009TokenNameMismatch`. Nothing is
 * lost when that happens — the transfer never executes — but the call always fails.
 *
 * W7 corrects the domain inside `paidFetch` (an `x402Client.registerPolicy` transform
 * that rewrites `extra.name`/`extra.version` to the values read from the token itself,
 * for EIP-3009 requirements on assets we have verified). That fix is unit-tested but has
 * never been proven against the live facilitator, because proving it means spending real
 * money — so this source stays `experimental: true` and out of
 * `DEFAULT_AGENT_CONFIG.dataSources`. One successful $0.01 call is all it takes to
 * promote it; `x-search` is the sentiment source that ships on by default until then.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import fixture from "./fixtures/sentimentalpha.json";
import {
  asNumber,
  asArray,
  asString,
  clampSentiment,
  clamp,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
} from "./normalize";

const inputSchema = z.object({
  query: z.string().min(2).max(300).describe("What to read the narrative on, e.g. 'solana memecoins' or 'BONK'"),
  watchlist: z.array(z.string().min(1).max(16)).max(10).optional().describe("Optional ticker watchlist"),
});

export const sentimentAlpha = defineSource({
  id: "sentimentalpha",
  name: "SentimentAlpha",
  summary: "Sentiment, narrative momentum and contrarian signals from X for a ticker or theme.",
  description:
    "Real-time X/Twitter narrative alpha: sentiment score, narrative velocity and a contrarian signal for a topic or ticker. Paid on Base at $0.01 a call. EXPERIMENTAL: this vendor advertises the wrong EIP-712 domain name for Base USDC; Tocker corrects it before signing, but no payment to it has settled yet — prefer x-search until one has.",
  category: "sentiment",
  network: "eip155:8453",
  priceUsd: 0.01,
  url: "https://sentimentalpha.ai/v1/narrative-alpha",
  experimental: true,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const res = await paidFetch(ctx, {
      sourceId: "sentimentalpha",
      url: "https://sentimentalpha.ai/v1/narrative-alpha",
      method: "POST",
      body: { query: input.query, ...(input.watchlist ? { watchlist: input.watchlist } : {}) },
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture,
    });

    const data = res.data;
    const narrative = pick(data, "narrative") ?? data;
    const sentiment = asNumber(pick(narrative, "sentiment_score")) ?? asNumber(pick(data, "sentiment")) ?? 0;
    const velocity = asNumber(pick(narrative, "narrative_velocity")) ?? asNumber(pick(data, "velocity")) ?? 0;
    const headline = asString(pick(narrative, "headline")) ?? `Narrative read on ${input.query}`;
    const body = asString(pick(narrative, "summary")) ?? "";
    const watch = asArray(pick(data, "watchlist"))
      .map((w) => {
        const sym = asString(pick(w, "symbol"));
        const s = asNumber(pick(w, "sentiment"));
        const v = asNumber(pick(w, "velocity"));
        return sym ? `${sym} sent ${(s ?? 0).toFixed(2)} / vel ${(v ?? 0).toFixed(2)}` : null;
      })
      .filter((x): x is string => x !== null);

    return {
      summary: truncate(
        [
          `${headline} — sentiment ${clampSentiment(sentiment).toFixed(2)}, velocity ${velocity.toFixed(2)}.`,
          body,
          watch.length > 0 ? `Watchlist: ${watch.join("; ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        700,
      ),
      data,
      signals: {
        sentiment: clampSentiment(sentiment),
        velocity: clamp(velocity, -1, 1),
      },
    };
  },
});
