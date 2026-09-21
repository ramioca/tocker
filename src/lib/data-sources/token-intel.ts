/**
 * Solana token due diligence.
 *
 * `deepnets-token-safety` — REAL, re-probed live 2026-09-21:
 * `GET https://api.deepnets.ai/api/token-safety?mint=` answers 402 with an x402 **v2**
 * `PAYMENT-REQUIRED` header priced in **Solana** USDC
 * (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, `amount: "10000"` = $0.01) and carries an
 * `extra.feePayer`, so the facilitator pays the SOL network fee and the platform's
 * Solana wallet needs USDC only. This is the source that makes the **Solana** platform
 * wallet a real dependency, not an optional one — see `checkPlatformDataWallets` in
 * `src/lib/security/live-readiness.ts`.
 *
 * Two entries were removed in W7 rather than kept as fixtures that look like data:
 * `token-intel-sol` (`token-intel-x402.echolonius.deno.net`, **503 USAGE_EXCEEDED** —
 * the Deno Deploy project is suspended) and `rugmunch` (`x402.rugmunch.io/api/analyze`,
 * **404 `not_found`**). Both re-probed 2026-09-21.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import { CAIP2_SOLANA } from "@/lib/trading/tokens";
import deepnetsFixture from "./fixtures/deepnets.json";
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
    "Solana token safety analysis: overall risk level, wallet-network concentration, bundle detection, mint/freeze authority flags, critical risks and warnings. Paid on Solana at $0.01 a call, from the platform's Solana wallet.",
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
