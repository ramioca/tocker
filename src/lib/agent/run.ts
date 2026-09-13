/**
 * One agent tick, end to end. See SPEC.md → "Agent run loop".
 *
 * Contract with the foundation workstream:
 *   - `runAgent(input)` creates its own `agent_runs` row and resolves when the run is
 *     over. `triggerRun` can call it fire-and-forget.
 *   - `startRun(input)` inserts the run row synchronously, returns `{ runId }`
 *     immediately, and finishes the work in the background — use this when the caller
 *     needs the id right away (e.g. to redirect to the run detail page).
 *
 * Concurrency: the run row is claimed with a conditional UPDATE that also asserts no
 * other run for this agent is `running`, so two schedulers racing produce one run and
 * one `skipped`.
 */
import { nanoid } from "nanoid";
import { generateText, hasToolCall, stepCountIs, type LanguageModel } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import { agentRuns, agents, getDb, llmKeys, notifications, tokens, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { parseAgentConfig } from "@/lib/agent/config";
import { decryptSecret } from "@/lib/crypto";
import { resolveDataSources } from "@/lib/data-sources/registry";
import { newBudget, type X402Context } from "@/lib/x402/types";
import { describeGuardian, runGuardian } from "@/lib/trading/guardian";
import { RunLogger } from "./logger";
import { createMockModel, isLlmMock } from "./mock-model";
import { getAgentWallets, getPortfolio, snapshotEquity } from "./portfolio";
import { buildSystemPrompt, buildTickPrompt, type RecentTrade } from "./prompts";
import { buildTools, type RunAgentRecord, type RunContext } from "./tools";

export interface RunAgentInput {
  agentId: string;
  trigger: "schedule" | "manual" | "webhook";
}

export interface RunAgentResult {
  runId: string;
  status: "succeeded" | "failed" | "skipped";
  summary?: string;
  error?: string;
}

/** Builds the language model for an agent from its owner's encrypted key. */
export async function resolveModel(agent: { llmKeyId: string | null; config: AgentConfig }): Promise<LanguageModel> {
  if (isLlmMock()) return createMockModel();

  if (!agent.llmKeyId) {
    throw new Error("This agent has no LLM API key attached. Add one in Settings and re-select it on the agent.");
  }
  const db = await getDb();
  const rows = await db.select().from(llmKeys).where(eq(llmKeys.id, agent.llmKeyId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("The LLM API key attached to this agent no longer exists.");

  // The decrypted key stays in this scope and is never logged or persisted.
  const apiKey = decryptSecret(row.encryptedKey);
  const modelId = agent.config.llm.model;

  switch (row.provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(modelId);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey })(modelId);
    }
    case "openrouter": {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      return createOpenRouter({ apiKey })(modelId);
    }
  }
}

async function loadRecentTrades(agentId: string, limit = 10): Promise<RecentTrade[]> {
  const db = await getDb();
  const rows = await db
    .select({ trade: trades, token: tokens })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    side: r.trade.side,
    symbol: r.token.symbol,
    chain: r.trade.chain,
    amountUsd: Number(r.trade.amountUsd),
    priceUsd: Number(r.trade.priceUsd),
    status: r.trade.status,
    createdAt: r.trade.createdAt,
    rationale: r.trade.rationale,
  }));
}

function nextRunAt(config: AgentConfig, from: Date): Date | null {
  if (config.schedule.intervalMinutes <= 0) return null;
  return new Date(from.getTime() + config.schedule.intervalMinutes * 60_000);
}

/**
 * Inserts a `queued` run row, or returns `null` when the agent does not exist (the
 * `agent_runs.agent_id` foreign key would reject the insert anyway).
 */
async function createRunRow(agentId: string, trigger: RunAgentInput["trigger"]): Promise<string | null> {
  const db = await getDb();
  const exists = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!exists[0]) return null;
  const runId = nanoid();
  await db.insert(agentRuns).values({ id: runId, agentId, trigger, status: "queued" });
  return runId;
}

/**
 * Atomically moves the run from `queued` to `running`, but only if no other run for
 * this agent is already `running`.
 */
async function claimRun(runId: string, agentId: string): Promise<boolean> {
  const db = await getDb();
  const claimed = await db
    .update(agentRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(
      and(
        eq(agentRuns.id, runId),
        eq(agentRuns.status, "queued"),
        sql`NOT EXISTS (SELECT 1 FROM ${agentRuns} AS other WHERE other.agent_id = ${agentId} AND other.status = 'running')`,
      ),
    )
    .returning({ id: agentRuns.id });
  return claimed.length > 0;
}

/**
 * Executes one tick. Safe to call concurrently: a second caller gets
 * `status: "skipped"` while the first is still running.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const runId = await createRunRow(input.agentId, input.trigger);
  if (runId === null) return { runId: "", status: "failed", error: "Agent not found" };
  return executeRun(runId, input);
}

/**
 * Creates the run row synchronously and returns its id, continuing the work in the
 * background. Foundation's `triggerRun` can use either this or `runAgent`.
 */
export async function startRun(input: RunAgentInput): Promise<{ runId: string }> {
  const runId = await createRunRow(input.agentId, input.trigger);
  if (runId === null) throw new Error("Agent not found");
  void executeRun(runId, input).catch(() => {
    // executeRun already records failures on the run row.
  });
  return { runId };
}

async function executeRun(runId: string, input: RunAgentInput): Promise<RunAgentResult> {
  const db = await getDb();
  const logger = new RunLogger(runId);

  const agentRows = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  const agentRow = agentRows[0];
  if (!agentRow) {
    await db
      .update(agentRuns)
      .set({ status: "failed", error: "Agent not found", finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    return { runId, status: "failed", error: "Agent not found" };
  }

  if (!(await claimRun(runId, input.agentId))) {
    await db
      .update(agentRuns)
      .set({ status: "cancelled", error: "Another run is already in progress", finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    return { runId, status: "skipped", error: "Another run is already in progress" };
  }

  const startedAt = new Date();
  let config: AgentConfig;
  try {
    config = parseAgentConfig(agentRow.config);
  } catch {
    config = agentRow.config;
  }

  const budget = newBudget(config.risk.maxDataSpendUsdPerRun);
  const wallets = await getAgentWallets(input.agentId);

  const agentRecord: RunAgentRecord = {
    id: agentRow.id,
    ownerId: agentRow.ownerId,
    slug: agentRow.slug,
    name: agentRow.name,
    mode: agentRow.mode,
    config,
  };

  const x402: X402Context = {
    agentId: agentRow.id,
    runId,
    mode: agentRow.mode,
    wallets,
    budget,
  };

  const ctx: RunContext = {
    runId,
    agent: agentRecord,
    x402,
    budget,
    logger,
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  };

  try {
    if (agentRow.mode === "live") {
      const usable = wallets.filter((w) => !w.walletId.startsWith("paper_") && w.address);
      const missing = config.chains.filter((c) => !usable.some((w) => w.chain === c));
      if (missing.length > 0) {
        throw new Error(
          `Live mode requires real Privy server wallets. Missing or placeholder wallet(s) for: ${missing.join(", ")}. Fund the agent or switch it back to paper.`,
        );
      }
    }

    const model = await resolveModel({ llmKeyId: agentRow.llmKeyId, config });
    const sources = resolveDataSources(config.dataSources);

    // The exit engine runs *before* the model thinks, so the book it reads is the book
    // after stops, targets and collapse rules have been enforced. Its trades join this
    // run's transcript, and whatever fired is handed to the prompt below.
    const guardian = await runGuardian({ agentId: input.agentId, trigger: "tick", runId, now: startedAt });
    if (guardian.exits.length > 0 || guardian.skipped.length > 0) {
      await logger.log({
        kind: "tool_result",
        toolName: "guardian",
        payload: {
          summary: describeGuardian(guardian),
          trigger: "tick",
          exits: guardian.exits.map((e) => ({
            symbol: e.symbol,
            reason: e.reason,
            status: e.status,
            amountUsd: e.amountUsd,
            priceUsd: e.priceUsd,
            rationale: e.rationale,
            error: e.error,
          })),
          skipped: guardian.skipped,
        },
      });
    }

    const portfolio = await getPortfolio(input.agentId);
    const recent = await loadRecentTrades(input.agentId, 10);

    const system = buildSystemPrompt(
      { name: agentRow.name, tagline: agentRow.tagline, mode: agentRow.mode, config },
      sources,
    );
    const prompt = buildTickPrompt({
      portfolio,
      config,
      recentTrades: recent,
      dataBudgetRemainingUsd: budget.maxUsd - budget.spentUsd,
      trigger: input.trigger,
      now: startedAt,
      exits: guardian.exits
        .filter((e) => e.status === "filled")
        .map((e) => ({ symbol: e.symbol, reason: e.reason, amountUsd: e.amountUsd, rationale: e.rationale })),
    });

    const result = await generateText({
      model,
      system,
      prompt,
      tools: buildTools(ctx),
      temperature: config.llm.temperature,
      stopWhen: [stepCountIs(config.llm.maxSteps), hasToolCall("finish")],
      onStepFinish: async (step) => {
        const text = step.text?.trim();
        if (text) await logger.log({ kind: "message", payload: { text } });
      },
    });

    const summary = ctx.finished.summary ?? result.text.trim() ?? null;
    await logger.flush();

    const finalPortfolio = await getPortfolio(input.agentId);
    await snapshotEquity(finalPortfolio);

    const finishedAt = new Date();
    await db
      .update(agentRuns)
      .set({
        status: "succeeded",
        summary,
        finishedAt,
        dataSpendUsd: budget.spentUsd.toFixed(6),
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      })
      .where(eq(agentRuns.id, runId));

    await db
      .update(agents)
      .set({ lastRunAt: finishedAt, nextRunAt: nextRunAt(config, finishedAt), updatedAt: finishedAt })
      .where(eq(agents.id, input.agentId));

    return { runId, status: "succeeded", summary: summary ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logger.log({ kind: "error", payload: { error: message } });
    await logger.flush();

    const finishedAt = new Date();
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        error: message,
        finishedAt,
        dataSpendUsd: budget.spentUsd.toFixed(6),
      })
      .where(eq(agentRuns.id, runId));

    await db
      .update(agents)
      .set({ lastRunAt: finishedAt, nextRunAt: nextRunAt(config, finishedAt), updatedAt: finishedAt })
      .where(eq(agents.id, input.agentId));

    await db.insert(notifications).values({
      id: nanoid(),
      userId: agentRow.ownerId,
      kind: "run_failed",
      title: `${agentRow.name} run failed`,
      body: message.slice(0, 500),
      href: `/agents/${agentRow.slug}`,
    });

    return { runId, status: "failed", error: message };
  }
}
