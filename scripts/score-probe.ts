import { scoreToken, toFacts } from "@/lib/tokens/score";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { getJupiterToken } from "@/lib/tokens/providers/jupiter";
import { getRugcheckSummary } from "@/lib/tokens/providers/rugcheck";

async function main() {
  for (const [sym, mint] of [
    ["SOL", "So11111111111111111111111111111111111111112"],
    ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
    ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ] as const) {
    const [jupiter, rugcheck] = await Promise.all([getJupiterToken(mint), getRugcheckSummary(mint).catch(() => null)]);
    const input = { chain: "solana" as const, address: mint, symbol: sym, jupiter, rugcheck, universe: DEFAULT_AGENT_CONFIG.universe, maxTradeUsd: 400 } as Parameters<typeof scoreToken>[0];
    const s = scoreToken(input);
    const f = toFacts(input);
    console.log(sym, "jupiter?", jupiter !== null, "rugcheck?", rugcheck !== null, "| total", s.total, s.verdict, "| components", JSON.stringify(s.components), "| blockers", JSON.stringify(s.blockers), "| warnings", JSON.stringify(s.warnings), "| liq", f.liquidityUsd, "holders", f.holderCount);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
