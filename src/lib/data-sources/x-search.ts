/**
 * X / Twitter search over x402.
 *
 * Two entries live here:
 *
 * - `x-search` — REAL. Found through Bazaar discovery
 *   (`https://twitter.use.x402atlas.com/search`); verified live, x402 v2, USDC on
 *   Base, `amount: "5000"` = $0.005. Returns up to 20 normalized tweets.
 * - `xquik-search` — EXPERIMENTAL. `https://xquik.com` was reachable at build time but
 *   exposes no `/.well-known/x402` and no 402 on any probed API path, so it ships with
 *   a fixture and `experimental: true`. Swap the URL in once the vendor documents it.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import fixture from "./fixtures/x-search.json";
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
} from "./normalize";

const ATLAS_URL = "https://twitter.use.x402atlas.com/search";
const XQUIK_URL = "https://xquik.com/api/x402/search";

const inputSchema = z.object({
  query: z.string().min(2).max(200).describe("X/Twitter search query, e.g. '$BONK' or 'from:solana bonk'"),
  limit: z.number().int().min(1).max(20).optional().describe("Max tweets to return (default 20)"),
});

const BULLISH = /\b(bullish|send|pump|moon|ripping|breakout|accumulat|long|buying|up only|ath)\b/i;
const BEARISH = /\b(bearish|dump|rug|scam|exit|selling|short|distribution|dead|top signal|crash)\b/i;

interface TweetView {
  text: string;
  author: string;
  followers: number;
  engagement: number;
}

function extractTweets(data: unknown): TweetView[] {
  const raw = asArray(pick(data, "tweets")).concat(asArray(pick(data, "results")), asArray(pick(data, "data")));
  return raw
    .map((t): TweetView | null => {
      const text = asString(pick(t, "text")) ?? asString(pick(t, "full_text"));
      if (!text) return null;
      const author = asString(pick(t, "author", "username")) ?? asString(pick(t, "username")) ?? "unknown";
      const followers = asNumber(pick(t, "author", "followers")) ?? asNumber(pick(t, "followers_count")) ?? 0;
      const likes = asNumber(pick(t, "metrics", "likes")) ?? asNumber(pick(t, "favorite_count")) ?? 0;
      const rts = asNumber(pick(t, "metrics", "retweets")) ?? asNumber(pick(t, "retweet_count")) ?? 0;
      return { text, author, followers, engagement: likes + rts * 2 };
    })
    .filter((t): t is TweetView => t !== null);
}

function score(tweets: TweetView[]): { sentiment: number; velocity: number } {
  if (tweets.length === 0) return { sentiment: 0, velocity: 0 };
  let weighted = 0;
  let weight = 0;
  for (const t of tweets) {
    const w = 1 + Math.log10(1 + t.engagement);
    const s = (BULLISH.test(t.text) ? 1 : 0) - (BEARISH.test(t.text) ? 1 : 0);
    weighted += s * w;
    weight += w;
  }
  const totalEngagement = tweets.reduce((acc, t) => acc + t.engagement, 0);
  return {
    sentiment: clampSentiment(weight === 0 ? 0 : weighted / weight),
    velocity: clamp(Math.log10(1 + totalEngagement) / 5, -1, 1),
  };
}

function normalize(query: string, data: unknown): NormalizedResult {
  const tweets = extractTweets(data);
  const signals = score(tweets);
  const top = tweets
    .slice()
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 3)
    .map((t) => `@${t.author} (${t.followers.toLocaleString("en-US")} followers): ${truncate(t.text, 160)}`);
  return {
    summary: truncate(
      [
        `${tweets.length} tweets for "${query}" — weighted sentiment ${signals.sentiment.toFixed(2)}, attention ${signals.velocity.toFixed(2)}.`,
        ...top,
      ].join(" | "),
      800,
    ),
    data,
    signals,
  };
}

export const xSearch = defineSource({
  id: "x-search",
  name: "X/Twitter search (x402Atlas)",
  description:
    "Search X/Twitter and get up to 20 normalized tweets with text, author, follower count and engagement, plus a weighted sentiment read.",
  category: "social",
  network: "eip155:8453",
  priceUsd: 0.005,
  url: ATLAS_URL,
  experimental: false,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const url = `${ATLAS_URL}?query=${encodeURIComponent(input.query)}${input.limit ? `&limit=${input.limit}` : ""}`;
    const res = await paidFetch(ctx, {
      sourceId: "x-search",
      url,
      network: "eip155:8453",
      priceUsd: 0.005,
      fixture,
    });
    return normalize(input.query, res.data);
  },
});

export const xquikSearch = defineSource({
  id: "xquik-search",
  name: "Xquik tweet search",
  description:
    "Xquik X/Twitter search. EXPERIMENTAL: the vendor exposes no public x402 endpoint yet, so this returns a fixture until the path is documented.",
  category: "social",
  network: "eip155:8453",
  priceUsd: 0.005,
  url: XQUIK_URL,
  experimental: true,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const url = `${XQUIK_URL}?q=${encodeURIComponent(input.query)}`;
    const res = await paidFetch(ctx, {
      sourceId: "xquik-search",
      url,
      network: "eip155:8453",
      priceUsd: 0.005,
      fixture,
    });
    return normalize(input.query, res.data);
  },
});
