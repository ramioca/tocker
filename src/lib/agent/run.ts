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
 *
 * Liveness (W7 B3): on a serverless platform the function is frozen the moment the
 * response is sent, so a run continued on a detached promise dies mid-flight and leaves
 * its row `running` forever — and that row then blocks every future run through the
 * `NOT EXISTS` above. Two fixes, both here:
 *   - the background continuation is scheduled with `after()` from `next/server`, which
 *     keeps the invocation alive until the callback resolves;
 *   - a `queued`/`running` row whose clock started more than {@link STALE_RUN_MS} ago is
 *     treated as dead — {@link reapStaleRuns} marks it `failed`, and `claimRun` ignores
 *     it when deciding whether the agent is busy.
 */
import { discoverAnthropicWorkspace, isWorkspaceScopeError, needsWorkspaceHeader } from "./anthropic-workspace";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { generateText, hasToolCall, stepCountIs, type LanguageModel } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
      // An organization-level key must name the workspace it acts in; a key created
      // inside a workspace must not (Anthropic rejects the header on those).
      // Unknown yet? One free request tells whether the key needs the header, and the
      // Admin API (which such a key may call) says which workspace; it is saved on the
      // key so this happens once.
      const workspaceId = row.workspaceId ?? (await ensureAnthropicWorkspace(row.id, apiKey));
      const headers = workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined;
      return createAnthropic({ apiKey, ...(headers ? { headers } : {}) })(modelId);
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

/**
 * A provider's error, with the one sentence that says what to do when we know it.
 * Everything else passes through untouched.
 */
export function explainProviderError(message: string): string {
  if (/anthropic-workspace-id/i.test(message)) {
    return `${message} — This Anthropic key is organization-level and Tocker could not find a workspace it may act in. Under Settings → LLM API keys, add it again with a Workspace ID (Anthropic Console → Settings → Workspaces), or create the key inside a workspace; then select it on the agent.`;
  }
  return message;
}

async function saveDiscoveredWorkspace(keyId: string, apiKey: string): Promise<string | null> {
  const found = await discoverAnthropicWorkspace(apiKey);
  if (found.kind !== "found") {
    console.warn(`[run] anthropic workspace for key ${keyId}: ${found.kind}${found.kind === "unknown" ? ` — ${found.reason}` : ""}`);
    return null;
  }
  const db = await getDb();
  await db.update(llmKeys).set({ workspaceId: found.workspaceId }).where(eq(llmKeys.id, keyId));
  return found.workspaceId;
}

/** Before the first call on a key with no saved workspace: does it need one, and which. */
async function ensureAnthropicWorkspace(keyId: string, apiKey: string): Promise<string | null> {
  if ((await needsWorkspaceHeader(apiKey)) !== true) return null;
  return saveDiscoveredWorkspace(keyId, apiKey);
}

/** After a run failed for want of the header anyway: find it, save it, report it. */
async function recoverAnthropicWorkspace(llmKeyId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select().from(llmKeys).where(eq(llmKeys.id, llmKeyId)).limit(1);
  if (!row || row.provider !== "anthropic" || row.workspaceId) return null;
  return saveDiscoveredWorkspace(llmKeyId, decryptSecret(row.encryptedKey));
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
 * How long a `queued`/`running` row may sit before it is presumed dead. The run itself
 * is capped well below this (`maxDuration` 300s on the route, a 240s abort on the model
 * call), so anything past ten minutes was killed by the platform, not by us.
 */
export const STALE_RUN_MS = 10 * 60_000;

/** What a reaped row's `error` says. Deliberately plain: an operator reads this. */
export const ABANDONED_RUN_ERROR = "abandoned: the function timed out";

/**
 * How long the model may think. Sits under the route's 300s `maxDuration` by a minute so
 * the run loop, not the platform, is the thing that gives up — and can say so on the row.
 */
export const RUN_MODEL_TIMEOUT_MS = 240_000;

/**
 * Marks every `queued`/`running` row older than {@link STALE_RUN_MS} as `failed`.
 *
 * Nothing else reads `agent_runs.status` to decide liveness, so without this a single
 * frozen invocation makes the agent permanently unrunnable: `claimRun` sees a `running`
 * row, refuses the claim, and the next run is cancelled — forever. Called from
 * `claimRun` (per agent), from both crons (globally), and from `triggerRun`.
 *
 * @param agentId Limit the sweep to one agent. Omit to reap every agent's.
 * @returns how many rows were reaped.
 */
export async function reapStaleRuns(agentId?: string, now: Date = new Date()): Promise<number> {
  const db = await getDb();
  // Bound as ISO text on purpose: a Date inside a raw `sql` template is serialised with
  // Date#toString() ("Mon Sep 21 2026 14:58:23 GMT+0000 (...)"), which Postgres rejects.
  // PGlite in the tests tolerated it; Neon in production 500'd every cron pass.
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  const reaped = await db
    .update(agentRuns)
    .set({ status: "failed", error: ABANDONED_RUN_ERROR, finishedAt: now })
    .where(
      and(
        inArray(agentRuns.status, ["queued", "running"]),
        sql`coalesce(${agentRuns.startedAt}, ${agentRuns.createdAt}) < ${cutoff.toISOString()}`,
        ...(agentId === undefined ? [] : [eq(agentRuns.agentId, agentId)]),
      ),
    )
    .returning({ id: agentRuns.id });
  return reaped.length;
}

/**
 * Atomically moves the run from `queued` to `running`, but only if no other *live* run
 * for this agent is already `running`. A `running` row that stopped moving more than
 * {@link STALE_RUN_MS} ago is not live — it is reaped first, and ignored by the guard
 * even if the reap lost a race.
 */
async function claimRun(runId: string, agentId: string, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  await reapStaleRuns(agentId, now);
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  const claimed = await db
    .update(agentRuns)
    .set({ status: "running", startedAt: now })
    .where(
      and(
        eq(agentRuns.id, runId),
        eq(agentRuns.status, "queued"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${agentRuns} AS other
          WHERE other.agent_id = ${agentId}
            AND other.status = 'running'
            AND coalesce(other.started_at, other.created_at) >= ${cutoff.toISOString()}
        )`,
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
 *
 * The continuation is handed to `after()` so the serverless invocation stays alive until
 * the tick is done: a bare `void executeRun(...)` is frozen the instant the response is
 * flushed, which is how a first live trade used to leave a `running` row that blocked
 * the agent forever. `after()` only exists inside a request scope, so scripts and tests
 * fall back to the detached promise — nothing freezes there.
 */
export async function startRun(input: RunAgentInput): Promise<{ runId: string }> {
  const runId = await createRunRow(input.agentId, input.trigger);
  if (runId === null) throw new Error("Agent not found");
  const finishInBackground = () =>
    executeRun(runId, input).catch(() => {
      // executeRun already records failures on the run row.
    });
  try {
    after(finishInBackground);
  } catch {
    void finishInBackground();
  }
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
      // The route is allowed 300s. Cut the model off at 240 so the remaining minute is
      // ours: the catch below still gets to write `failed` + the reason on the run row,
      // which is the difference between "the model stalled" and a row stuck on `running`
      // that bricks the agent until the reaper notices.
      abortSignal: AbortSignal.timeout(RUN_MODEL_TIMEOUT_MS),
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
    const raw = err instanceof Error ? err.message : String(err);
    // A multi-workspace key that still failed for want of the header: find the
    // workspace now, save it on the key, and make the agent due again so the next tick
    // simply works.
    const recovered =
      isWorkspaceScopeError(raw) && agentRow.llmKeyId
        ? await recoverAnthropicWorkspace(agentRow.llmKeyId).catch(() => null)
        : null;
    const message = recovered
      ? `${raw} — Tocker found this key's workspace (${recovered}) and saved it on the key. The agent runs again on the next tick.`
      : explainProviderError(raw);
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
      .set({ lastRunAt: finishedAt, nextRunAt: recovered ? finishedAt : nextRunAt(config, finishedAt), updatedAt: finishedAt })
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
