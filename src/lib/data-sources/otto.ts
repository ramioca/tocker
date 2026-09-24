/**
 * Otto AI — the cheap ambient read: what crypto Twitter is talking about, and a
 * four-sentence state of the market.
 *
 * REAL request, unverified response. Re-probed live 2026-09-21:
 * - `GET https://x402.ottoai.services/twitter-summary` — 402, x402 v2, `accepts[]`
 *   offering **$0.001** USDC on Base (`eip155:8453`), Base via Permit2, and Solana
 *   (with an `extra.feePayer`, so the facilitator covers the SOL fee); described by the
 *   service itself as "quick pulse check from crypto Twitter. Breaking news, trending
 *   narratives, and sentiment shifts at a glance". No parameters.
 * - `GET https://x402.ottoai.services/news-recaps` — same flow at **$0.003**; a 4-6
 *   sentence recap plus a ranked `stories[]` board.
 *
 * The service's OpenAPI types every 200 as `{ status, data }` where `data` is
 * "service-specific response data" with no properties, and it is settle-before-serve,
 * so the inner keys could not be established without paying. Hence `experimental:
 * true`, a fixture built from the documented prose, and parsing that reads whichever
 * of the plausible keys is actually present.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import pulseFixture from "./fixtures/otto-pulse.json";
import recapFixture from "./fixtures/otto-recap.json";
import {
  asArray,
  asNumber,
  asString,
  clampSentiment,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
  type Signals,
} from "./normalize";

const BASE_NETWORK = "eip155:8453";

const MODES = {
  pulse: { path: "/twitter-summary", priceUsd: 0.001 },
  recap: { path: "/news-recaps", priceUsd: 0.003 },
} as const;

const inputSchema = z.object({
  mode: z
    .enum(["pulse", "recap"])
    .default("pulse")
    .describe("pulse = crypto-Twitter pulse check ($0.001), recap = 4-6 sentence market recap with ranked stories ($0.003)"),
});

/** Sentiment words this service (and most like it) use, mapped onto the -1..1 axis. */
const SENTIMENT_WORDS: Record<string, number> = {
  "very bullish": 0.9,
  bullish: 0.6,
  positive: 0.5,
  optimistic: 0.4,
  neutral: 0,
  mixed: 0,
  cautious: -0.2,
  negative: -0.5,
  bearish: -0.6,
  "very bearish": -0.9,
  fearful: -0.7,
};

function firstString(source: unknown, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(pick(source, key));
    if (value !== null && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * Sentiment out of whatever the payload offers: a number in -1..1 (or 0-100, which
 * some feeds use) wins; a word is next; nothing at all leaves the axis unset rather
 * than guessing neutral, because "no reading" and "balanced" are different facts.
 */
function sentimentOf(source: unknown): number | null {
  const raw = asNumber(pick(source, "sentimentScore")) ?? asNumber(pick(source, "sentiment_score")) ?? asNumber(pick(source, "sentiment"));
  if (raw !== null) return clampSentiment(Math.abs(raw) > 1 ? (raw - 50) / 50 : raw);
  const word = firstString(source, "sentiment", "marketSentiment", "market_sentiment", "direction", "tone");
  if (word !== null) {
    const hit = SENTIMENT_WORDS[word.trim().toLowerCase()];
    if (hit !== undefined) return hit;
  }
  return null;
}

function narrativesOf(source: unknown): string[] {
  for (const key of ["narratives", "trending", "trendingNarratives", "topics", "themes"]) {
    const rows = asArray(pick(source, key));
    if (rows.length === 0) continue;
    const names = rows
      .map((row) => (typeof row === "string" ? row : firstString(row, "name", "topic", "title", "narrative")))
      .filter((n): n is string => n !== null);
    if (names.length > 0) return names;
  }
  return [];
}

export const ottoPulse = defineSource({
  id: "otto-pulse",
  name: "Otto AI pulse",
  summary: "A quick pulse of crypto Twitter: breaking news, trending narratives and sentiment.",
  description:
    "The cheapest read in your kit. mode 'pulse' ($0.001) is a crypto-Twitter pulse check — breaking news, trending narratives and sentiment shifts at a glance; mode 'recap' ($0.003) is a 4-6 sentence market recap with the ranked stories behind it. Market-wide context, not a per-token signal: use it to decide what kind of tick this is, not which token to buy. EXPERIMENTAL: the response envelope is verified but its inner keys are undocumented.",
  category: "news",
  network: BASE_NETWORK,
  // Probed 2026-09-21: the 402 also offers Solana USDC, so a Solana-only agent can pay for it.
  networks: [BASE_NETWORK, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  priceUsd: MODES.pulse.priceUsd,
  url: "https://x402.ottoai.services/twitter-summary",
  experimental: true,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const mode = MODES[input.mode];
    const res = await paidFetch(ctx, {
      sourceId: "otto-pulse",
      url: `https://x402.ottoai.services${mode.path}`,
      network: BASE_NETWORK,
      priceUsd: mode.priceUsd,
      fixture: input.mode === "recap" ? recapFixture : pulseFixture,
    });

    const data = res.data;
    // The documented envelope is `{ status, data }`, but a service that drops the
    // wrapper later must not break this — so read through it, or straight off the root.
    const body = pick(data, "data") ?? data;

    const prose =
      firstString(body, "summary", "recap", "text", "overview", "analysis") ??
      firstString(data, "summary", "recap", "text") ??
      "";
    const sentiment = sentimentOf(body) ?? sentimentOf(data);
    const narratives = narrativesOf(body);
    const stories = asArray(pick(body, "stories"))
      .map((s) => firstString(s, "title", "headline"))
      .filter((t): t is string => t !== null);

    const signals: Signals | undefined = sentiment === null ? undefined : { sentiment };

    const tail =
      narratives.length > 0
        ? ` Narratives: ${narratives.slice(0, 6).join(", ")}.`
        : stories.length > 0
          ? ` Top stories: ${stories.slice(0, 3).join(" · ")}.`
          : "";

    return {
      summary: truncate(
        `${input.mode === "recap" ? "Otto market recap" : "Otto crypto-Twitter pulse"}${sentiment === null ? "" : ` (sentiment ${sentiment.toFixed(2)})`}: ${prose || "no prose in the payload"}.${tail}`,
        700,
      ),
      data,
      ...(signals ? { signals } : {}),
    };
  },
});
