/**
 * `pnpm tsx scripts/demo-run.ts` — the end-to-end proof.
 *
 * Seeds a minimal user + paper agent + the known tokens if the database is empty,
 * runs one full tick with `X402_MOCK=1` and `LLM_MOCK=1`, then prints the step log,
 * the x402 payments, the resulting trades, positions and feed posts.
 *
 * Requires nothing but the embedded PGlite database (`pnpm db:push` first).
 */
import { nanoid } from "nanoid";
import { asc, desc, eq } from "drizzle-orm";
import {
  agentRunSteps,
  agents,
  getDb,
  positions,
  posts,
  tokens,
  trades,
  users,
  wallets,
  x402Payments,
} from "../src/db";
import { DEFAULT_AGENT_CONFIG } from "../src/lib/agent/config";
import { runAgent } from "../src/lib/agent/run";
import { getPortfolio } from "../src/lib/agent/portfolio";
import { seedKnownTokens } from "../src/lib/trading/tokens";

process.env.X402_MOCK = process.env.X402_MOCK ?? "1";
process.env.LLM_MOCK = process.env.LLM_MOCK ?? "1";

const DEMO_USER_ID = "did:privy:demo-runtime";
const DEMO_AGENT_SLUG = "demo-momentum";

function rule(title: string): void {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

async function seed(): Promise<string> {
  const db = await getDb();
  await seedKnownTokens();

  const existingAgent = await db.select().from(agents).where(eq(agents.slug, DEMO_AGENT_SLUG)).limit(1);
  if (existingAgent[0]) return existingAgent[0].id;

  await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      handle: "demo",
      displayName: "Demo Trader",
      email: "demo@vibe.local",
    })
    .onConflictDoNothing({ target: users.id });

  const agentId = nanoid();
  await db.insert(agents).values({
    id: agentId,
    ownerId: DEMO_USER_ID,
    slug: DEMO_AGENT_SLUG,
    name: "Demo Momentum",
    tagline: "buys the narrative before the chart",
    avatarSeed: "demo-momentum",
    mode: "paper",
    status: "active",
    isPublic: true,
    llmKeyId: null,
    config: {
      ...DEFAULT_AGENT_CONFIG,
      dataSources: ["sentimentalpha", "cmc-quotes", "deepnets-token-safety"],
      chains: ["solana"],
      risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 250, maxDataSpendUsdPerRun: 0.25 },
    },
    paperStartingUsd: "10000",
    nextRunAt: new Date(),
  });

  // Paper placeholders: `paper_` walletIds are what tell the runtime this agent
  // cannot sign anything on-chain.
  for (const chain of ["solana", "base"] as const) {
    await db.insert(wallets).values({
      id: `paper_${agentId}_${chain}`,
      kind: "agent_server",
      chain,
      address: chain === "solana" ? `PaperSol${agentId.slice(0, 12)}` : `0xpaper${agentId.slice(0, 12)}`,
      userId: DEMO_USER_ID,
      agentId,
    });
  }

  console.log(`Seeded demo user + agent (${agentId}).`);
  return agentId;
}

async function main(): Promise<void> {
  const agentId = await seed();
  const db = await getDb();

  rule(`Running agent ${agentId} (X402_MOCK=${process.env.X402_MOCK}, LLM_MOCK=${process.env.LLM_MOCK})`);
  const started = Date.now();
  const result = await runAgent({ agentId, trigger: "manual" });
  console.log(`run ${result.runId} → ${result.status} in ${Date.now() - started}ms`);
  if (result.error) console.log(`error: ${result.error}`);
  if (result.summary) console.log(`summary: ${result.summary}`);

  rule("Step log");
  const steps = await db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, result.runId))
    .orderBy(asc(agentRunSteps.seq));
  for (const s of steps) {
    const duration = s.durationMs === null ? "" : ` (${s.durationMs}ms)`;
    const payload = JSON.stringify(s.payload);
    console.log(
      `  #${String(s.seq).padStart(2, "0")} ${s.kind.padEnd(11)} ${(s.toolName ?? "-").padEnd(20)}${duration} ${payload.slice(0, 220)}${payload.length > 220 ? "…" : ""}`,
    );
  }

  rule("x402 payments");
  const payments = await db.select().from(x402Payments).where(eq(x402Payments.agentId, agentId));
  if (payments.length === 0) console.log("  (none)");
  for (const p of payments) {
    console.log(
      `  ${p.sourceId.padEnd(24)} $${p.amountUsd} ${p.network} simulated=${p.simulated} settled=${p.settled} ${p.url}`,
    );
  }

  rule("Trades");
  const tradeRows = await db
    .select({ t: trades, tk: tokens })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.createdAt));
  if (tradeRows.length === 0) console.log("  (none)");
  for (const { t, tk } of tradeRows) {
    console.log(
      `  ${t.side.toUpperCase().padEnd(4)} ${tk.symbol.padEnd(6)} $${Number(t.amountUsd).toFixed(2)} @ ${Number(t.priceUsd).toExponential(4)} → ${Number(t.amountToken).toLocaleString("en-US")} ${tk.symbol} · fee $${Number(t.feeUsd).toFixed(4)} · ${t.status} · paper=${t.isPaper} · tx=${t.txHash ?? "-"}`,
    );
    if (t.rationale) console.log(`       "${t.rationale}"`);
    if (t.error) console.log(`       error: ${t.error}`);
  }

  rule("Positions");
  const portfolio = await getPortfolio(agentId);
  console.log(`  cash $${portfolio.cashUsd.toFixed(2)} · equity $${portfolio.equityUsd.toFixed(2)}`);
  const held = await db.select().from(positions).where(eq(positions.agentId, agentId));
  for (const p of held) {
    console.log(`  ${p.tokenId} amount=${p.amountToken} avgCost=${p.avgCostUsd} realized=${p.realizedPnlUsd}`);
  }

  rule("Feed posts");
  const feed = await db.select().from(posts).where(eq(posts.agentId, agentId)).orderBy(desc(posts.createdAt));
  if (feed.length === 0) console.log("  (none)");
  for (const p of feed) {
    console.log(`  [${p.kind}] ${p.body ?? ""}`);
  }

  const filled = tradeRows.filter((r) => r.t.status === "filled");
  rule("Result");
  console.log(
    filled.length > 0 && feed.length > 0
      ? `PASS — ${filled.length} filled paper trade(s) and ${feed.length} post row(s).`
      : "FAIL — expected at least one filled trade and one post.",
  );
  process.exit(filled.length > 0 && feed.length > 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
