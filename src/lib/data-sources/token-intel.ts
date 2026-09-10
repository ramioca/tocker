/**
 * Solana token due-diligence sources.
 *
 * - `deepnets-token-safety` — REAL. `GET https://api.deepnets.ai/api/token-safety?mint=`
 *   verified live: x402 v2, **Solana** USDC (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`,
 *   `amount: "10000"` = $0.01). This is the one source an agent pays for from its
 *   Solana wallet rather than its Base wallet.
 * - `token-intel-sol` — EXPERIMENTAL. `token-intel-x402.echolonius.deno.net` returned
 *   503 USAGE_EXCEEDED at build time (Deno Deploy suspended), so it ships with a fixture.
 * - `rugmunch` — EXPERIMENTAL. `x402.rugmunch.io` is behind Cloudflare (403 at the root,
 *   404 on probed paths) and is not in the Bazaar index; fixture only.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import { CAIP2_SOLANA } from "@/lib/trading/tokens";
import deepnetsFixture from "./fixtures/deepnets.json";
import tokenIntelFixture from "./fixtures/token-intel-sol.json";
import rugmunchFixture from "./fixtures/rugmunch.json";
import {
  asArray,
  asNumber,
  asString,
  clampRisk,
  defineSource,
  pick,
  truncate,
  type NormalizedResult,
} from "./normalize";

const mintInput = z.object({
  mint: z.string().min(32).max(50).describe("Solana token mint address"),
});

const SAFETY_LEVEL_RISK: Record<string, number> = {
  ok: 0.15,
  low: 0.2,
  caution: 0.5,
  medium: 0.5,
  warning: 0.7,
  high: 0.85,
  critical: 0.95,
  danger: 0.95,
};

export const deepnetsTokenSafety = defineSource({
  id: "deepnets-token-safety",
  name: "Deepnets token safety",
  description:
    "Solana token safety analysis: overall risk level, wallet-network concentration, bundle detection, mint/freeze authority flags, critical risks and warnings.",
  category: "onchain",
  network: CAIP2_SOLANA,
  priceUsd: 0.01,
  url: "https://api.deepnets.ai/api/token-safety",
  experimental: false,
  inputSchema: mintInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const res = await paidFetch(ctx, {
      sourceId: "deepnets-token-safety",
      url: `https://api.deepnets.ai/api/token-safety?mint=${encodeURIComponent(input.mint)}`,
      network: CAIP2_SOLANA,
      priceUsd: 0.01,
      fixture: deepnetsFixture,
    });

    const data = res.data;
    const level = (asString(pick(data, "overallSafetyLevel")) ?? "").toLowerCase();
    const topTen = asNumber(pick(data, "topTenOwnership"));
    const network = asNumber(pick(data, "topNetworkOwnership"));
    const mintable = pick(data, "isMintable") === true;
    const freezable = pick(data, "isFreezable") === true;
    const bundled = pick(data, "bundleDetected") === true;
    const critical = asArray(pick(data, "criticalRisks")).length;

    let risk = SAFETY_LEVEL_RISK[level] ?? 0.5;
    if (mintable) risk += 0.15;
    if (freezable) risk += 0.1;
    if (bundled) risk += 0.15;
    risk += Math.min(0.2, critical * 0.1);

    return {
      summary: truncate(
        `Deepnets safety for ${input.mint}: ${level || "unknown"}. Top-10 holders ${topTen ?? "?"}%, largest wallet network ${network ?? "?"}%. mintable=${mintable} freezable=${freezable} bundled=${bundled}, ${critical} critical risk(s).`,
        600,
      ),
      data,
      signals: { risk: clampRisk(risk) },
    };
  },
});

export const tokenIntelSol = defineSource({
  id: "token-intel-sol",
  name: "Token Intel (Solana)",
  description:
    "Solana token due diligence: mint/freeze authority, LP lock, holder concentration, honeypot checks. EXPERIMENTAL: upstream was suspended (503) at build time, so this returns a fixture.",
  category: "onchain",
  network: CAIP2_SOLANA,
  priceUsd: 0.01,
  url: "https://token-intel-x402.echolonius.deno.net/intel",
  experimental: true,
  inputSchema: mintInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const res = await paidFetch(ctx, {
      sourceId: "token-intel-sol",
      url: `https://token-intel-x402.echolonius.deno.net/intel?mint=${encodeURIComponent(input.mint)}`,
      network: CAIP2_SOLANA,
      priceUsd: 0.01,
      fixture: tokenIntelFixture,
      timeoutMs: 10_000,
    });

    const data = res.data;
    const risk = asNumber(pick(data, "risk_score"));
    const verdict = asString(pick(data, "verdict")) ?? "unknown";
    const lp = asNumber(pick(data, "checks", "lp_locked_pct"));
    const top10 = asNumber(pick(data, "checks", "top10_holder_pct"));
    return {
      summary: truncate(
        `Token Intel verdict "${verdict}" for ${input.mint}: LP locked ${lp ?? "?"}%, top-10 holders ${top10 ?? "?"}%, risk score ${risk ?? "?"}.`,
        600,
      ),
      data,
      signals: risk === null ? undefined : { risk: clampRisk(risk) },
    };
  },
});

export const rugMunch = defineSource({
  id: "rugmunch",
  name: "Rug Munch",
  description:
    "Rug-probability grade for a Solana token: deployer history, liquidity locks, buy/sell tax, sellability. EXPERIMENTAL: the service is Cloudflare-gated and undocumented, so this returns a fixture.",
  category: "onchain",
  network: CAIP2_SOLANA,
  priceUsd: 0.01,
  url: "https://x402.rugmunch.io/api/analyze",
  experimental: true,
  inputSchema: mintInput,
  async query(ctx, input): Promise<NormalizedResult> {
    const res = await paidFetch(ctx, {
      sourceId: "rugmunch",
      url: `https://x402.rugmunch.io/api/analyze?mint=${encodeURIComponent(input.mint)}`,
      network: CAIP2_SOLANA,
      priceUsd: 0.01,
      fixture: rugmunchFixture,
      timeoutMs: 10_000,
    });

    const data = res.data;
    const p = asNumber(pick(data, "rug_probability"));
    const grade = asString(pick(data, "grade")) ?? "?";
    const canSell = pick(data, "trading", "can_sell") !== false;
    return {
      summary: truncate(
        `Rug Munch grade ${grade} for ${input.mint}: rug probability ${p ?? "?"}, sellable=${canSell}, ${asArray(pick(data, "flags")).length} flag(s).`,
        600,
      ),
      data,
      signals: p === null ? undefined : { risk: clampRisk(p) },
    };
  },
});
