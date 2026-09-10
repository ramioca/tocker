/**
 * SentimentAlpha — real-time X (Twitter) narrative alpha.
 *
 * REAL: verified live at build time. `POST https://sentimentalpha.ai/v1/narrative-alpha`
 * answers HTTP 402 with an x402 **v1** body (`accepts[].maxAmountRequired = "10000"`,
 * USDC on Base) plus `x-payment-*` headers. $0.01 per query.
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
  description:
    "Real-time X/Twitter narrative alpha: sentiment score, narrative velocity and a contrarian signal for a topic or ticker.",
  category: "sentiment",
  network: "eip155:8453",
  priceUsd: 0.01,
  url: "https://sentimentalpha.ai/v1/narrative-alpha",
  experimental: false,
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
