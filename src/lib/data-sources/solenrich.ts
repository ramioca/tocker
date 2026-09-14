/**
 * SolEnrich — Solana on-chain intelligence, and the one paid source in this batch
 * that is billed to the agent's **Solana** wallet.
 *
 * REAL request shape, EXPERIMENTAL response shape. Verified live at build time:
 * `https://api.solenrich.com/.well-known/x402` lists 44 `POST /entrypoints/<name>/invoke`
 * resources, each with its price and `network:
 * "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"` (alt `eip155:8453`), and the service's
 * OpenAPI document gives the exact request body for the three exposed here:
 * - `new-tokens` ($0.012) — "recently launched tokens from DexScreener, filtered by
 *   liquidity and risk, ranked safest first"; body `{ min_liquidity_usd, max_risk_score,
 *   limit, format }`. This is the feed behind discovery's `paid_launches` on Solana.
 * - `enrich-token-full` ($0.004) — body `{ mint, include_holders, format }`; top-20
 *   holders, HHI concentration, volatility, slippage.
 * - `query` ($0.003) — body `{ question, format }`; plain-English router.
 *
 * What could **not** be verified is the response body: the OpenAPI declares every
 * 200 as a bare `{"type": "object"}` ("shape depends on `format`"), and the service
 * is settle-before-serve, so nothing short of paying reveals the keys. Hence
 * `experimental: true`, a fixture built from the documented prose, and parsing that
 * accepts any of the plausible spellings rather than betting on one.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import { CAIP2_SOLANA } from "@/lib/trading/tokens";
import fixture from "./fixtures/solenrich-launches.json";
import {
  asArray,
  asNumber,
  asString,
  clampRisk,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
  type PaidLaunch,
  type Signals,
} from "./normalize";

const MODES = {
  launches: { path: "new-tokens", priceUsd: 0.012 },
  token: { path: "enrich-token-full", priceUsd: 0.004 },
  ask: { path: "query", priceUsd: 0.003 },
} as const;

const inputSchema = z.object({
  mode: z
    .enum(["launches", "token", "ask"])
    .default("launches")
    .describe("launches = new Solana tokens ranked safest first ($0.012), token = deep dive on one mint ($0.004), ask = plain-English question ($0.003)"),
  mint: z.string().min(32).max(44).optional().describe("Solana mint, required for mode 'token'"),
  question: z.string().min(3).max(500).optional().describe("Plain-English question, required for mode 'ask'"),
  minLiquidityUsd: z.number().min(0).max(100_000_000).optional().describe("mode 'launches': liquidity floor, default $1,000"),
  maxRiskScore: z.number().min(0).max(1).optional().describe("mode 'launches': drop anything riskier than this 0-1 score, default 0.8"),
  limit: z.number().int().min(1).max(20).optional().describe("mode 'launches': how many tokens, default 10"),
});

/** Every spelling of "the list of tokens" this service might use, tried in order. */
function launchRows(data: unknown): unknown[] {
  for (const path of [["tokens"], ["data", "tokens"], ["result", "tokens"], ["new_tokens"], ["data"], ["results"]]) {
    const rows = asArray(pick(data, ...path));
    if (rows.length > 0) return rows;
  }
  return Array.isArray(data) ? data : [];
}

function firstNumber(row: unknown, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(pick(row, key));
    if (value !== null) return value;
  }
  return null;
}

function firstString(row: unknown, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(pick(row, key));
    if (value !== null && value.length > 0) return value;
  }
  return null;
}

function ageHoursOf(row: unknown): number | null {
  const minutes = firstNumber(row, "age_minutes", "ageMinutes");
  if (minutes !== null) return minutes / 60;
  const hours = firstNumber(row, "age_hours", "ageHours");
  if (hours !== null) return hours;
  const created = firstString(row, "created_at", "createdAt", "pair_created_at");
  if (created !== null) {
    const at = Date.parse(created);
    if (Number.isFinite(at)) return Math.max(0, (Date.now() - at) / 3_600_000);
  }
  return null;
}

/**
 * The `new-tokens` payload → {@link PaidLaunch}[], for discovery's `paid_launches`
 * feed. Rows without an address are dropped rather than guessed at.
 */
export function parseSolEnrichLaunches(data: unknown): PaidLaunch[] {
  const out: PaidLaunch[] = [];
  for (const row of launchRows(data)) {
    const address = firstString(row, "mint", "address", "token_address", "tokenAddress");
    if (address === null) continue;
    out.push({
      chain: "solana",
      address,
      symbol: (firstString(row, "symbol", "ticker") ?? address.slice(0, 6)).toUpperCase(),
      name: firstString(row, "name", "token_name"),
      priceUsd: firstNumber(row, "price_usd", "priceUsd"),
      liquidityUsd: firstNumber(row, "liquidity_usd", "liquidityUsd"),
      volume24hUsd: firstNumber(row, "volume_24h_usd", "volume24hUsd", "volume_24h"),
      marketCapUsd: firstNumber(row, "market_cap_usd", "marketCapUsd", "fdv_usd"),
      holderCount: firstNumber(row, "holder_count", "holders", "holderCount"),
      ageHours: ageHoursOf(row),
      priceChange24hPct: firstNumber(row, "price_change_24h_pct", "priceChange24hPct"),
    });
  }
  return out;
}

export const solEnrichLaunches = defineSource({
  id: "solenrich-launches",
  name: "SolEnrich launches",
  description:
    "Solana new-launch radar and token due diligence, paid from your SOLANA wallet. mode 'launches' returns freshly launched tokens already filtered by liquidity and a 0-1 risk score and ranked safest first; mode 'token' adds top-20 holders, HHI concentration, volatility and slippage for one mint; mode 'ask' routes a plain-English question. EXPERIMENTAL: the request shape is verified live but the response keys are undocumented, so fields may arrive named differently.",
  category: "onchain",
  network: CAIP2_SOLANA,
  priceUsd: MODES.launches.priceUsd,
  url: "https://api.solenrich.com/entrypoints/new-tokens/invoke",
  experimental: true,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const mode = MODES[input.mode];
    if (input.mode === "token" && !input.mint) {
      throw new Error("solenrich-launches: mode 'token' needs a mint");
    }
    if (input.mode === "ask" && !input.question) {
      throw new Error("solenrich-launches: mode 'ask' needs a question");
    }

    const body =
      input.mode === "token"
        ? { mint: input.mint, include_holders: true, format: "both" }
        : input.mode === "ask"
          ? { question: input.question, format: "both" }
          : {
              min_liquidity_usd: input.minLiquidityUsd ?? 1_000,
              max_risk_score: input.maxRiskScore ?? 0.8,
              limit: input.limit ?? 10,
              format: "both",
            };

    const res = await paidFetch(ctx, {
      sourceId: "solenrich-launches",
      url: `https://api.solenrich.com/entrypoints/${mode.path}/invoke`,
      method: "POST",
      body,
      network: CAIP2_SOLANA,
      priceUsd: mode.priceUsd,
      fixture,
      timeoutMs: 10_000,
    });

    const data = res.data;
    // `format: "both"` asks for a prose rendering alongside the JSON; when it is there
    // it is the best one-line summary available, so it wins over anything we compose.
    const prose = firstString(data, "llm", "summary", "answer") ?? firstString(pick(data, "data"), "llm", "summary");

    if (input.mode === "launches") {
      const launches = parseSolEnrichLaunches(data);
      const riskScores = launchRows(data)
        .map((row) => firstNumber(row, "risk_score", "riskScore"))
        .filter((r): r is number => r !== null);
      const signals: Signals | undefined =
        riskScores.length === 0
          ? undefined
          : { risk: clampRisk(riskScores.reduce((a, b) => a + b, 0) / riskScores.length) };
      const top = launches
        .slice(0, 5)
        .map((l) => `${l.symbol}${l.liquidityUsd === null ? "" : ` $${Math.round(l.liquidityUsd).toLocaleString("en-US")} liq`}`)
        .join("; ");
      return {
        summary: truncate(
          prose ?? `SolEnrich: ${launches.length} new Solana launch(es) past a $${(input.minLiquidityUsd ?? 1_000).toLocaleString("en-US")} liquidity floor, safest first. ${top}`,
          700,
        ),
        data,
        ...(signals ? { signals } : {}),
      };
    }

    if (input.mode === "token") {
      const risk = firstNumber(data, "risk_score", "riskScore") ?? firstNumber(pick(data, "data"), "risk_score", "riskScore");
      const hhi = firstNumber(data, "hhi", "concentration_hhi") ?? firstNumber(pick(data, "data"), "hhi", "concentration_hhi");
      return {
        summary: truncate(
          prose ?? `SolEnrich deep dive on ${input.mint}: risk ${risk ?? "?"}, holder HHI ${hhi ?? "?"}.`,
          700,
        ),
        data,
        ...(risk === null ? {} : { signals: { risk: clampRisk(risk) } }),
      };
    }

    return { summary: truncate(prose ?? `SolEnrich answered: ${input.question ?? ""}`, 700), data };
  },
});
