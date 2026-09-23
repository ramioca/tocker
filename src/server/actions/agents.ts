"use server";
import { MAX_AGENTS_PER_USER, RATE_LIMITS, limiter } from "@/lib/security/rate-limit";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { agentRuns, agents, getDb, llmKeys, posts } from "@/db";
import { agentConfigSchema, type AgentConfigInput } from "@/lib/agent/config";
import { getSession } from "@/lib/auth";
import { applyAgentBudgetPolicy, createAgentWallets } from "@/lib/wallets";
import { describeStranded } from "@/lib/wallets/funding";
import { readStrandedHoldings } from "@/lib/wallets/stranded";
import { newId, uniqueSlug } from "@/server/queries/_shared";
import type { ActionResult, AgentMode, AgentStatus } from "@/server/types";

/**
 * Note the absence of any "forkable" flag. Copying someone's agent is not a setting the
 * operator can turn on — it does not exist. A strategy is the operator's IP; the track
 * record is what gets published.
 */
export interface CreateAgentInput {
  name: string;
  tagline?: string;
  avatarSeed?: string;
  isPublic: boolean;
  llmKeyId: string | null;
  config: AgentConfigInput;
  paperStartingUsd?: number;
  /** Skip the draft step: go straight to `active` with a run scheduled now. */
  activate?: boolean;
  /**
   * Active, but with no run scheduled until the agent goes live (W7). A funded agent
   * on its way to the live checklist must not take paper ticks in the meantime;
   * `goLiveAction` starts the schedule when the switch is thrown.
   */
  holdSchedule?: boolean;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid agent configuration";
  const path = issue.path.filter((p) => typeof p === "string").join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function revalidateAgent(slug?: string, handle?: string) {
  revalidatePath("/feed");
  revalidatePath("/discover");
  revalidatePath("/agents");
  if (slug) {
    revalidatePath(`/agents/${slug}`);
    revalidatePath(`/agents/${slug}/settings`);
  }
  if (handle) revalidatePath(`/u/${handle}`);
}

export async function createAgent(input: CreateAgentInput): Promise<ActionResult<{ id: string; slug: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to create an agent");
  // Every agent gets real wallets and a USDC account the platform pays rent for.
  if (!limiter.consume(`agent:create:${session.userId}`, RATE_LIMITS.agentCreate).ok) {
    return fail("That's a lot of new agents in an hour — try again in a little while.");
  }

  const name = input.name?.trim();
  if (!name || name.length < 2) return fail("Give your agent a name");
  if (name.length > 60) return fail("Name must be 60 characters or fewer");

  const parsed = agentConfigSchema.safeParse(input.config);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const config = parsed.data;

  const db = await getDb();

  const [owned] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(eq(agents.ownerId, session.userId));
  if ((owned?.n ?? 0) >= MAX_AGENTS_PER_USER) {
    return fail(`You have ${MAX_AGENTS_PER_USER} agents, the most one account can hold. Delete one to make room.`);
  }

  if (input.llmKeyId) {
    const [key] = await db
      .select({ id: llmKeys.id })
      .from(llmKeys)
      .where(and(eq(llmKeys.id, input.llmKeyId), eq(llmKeys.userId, session.userId)))
      .limit(1);
    if (!key) return fail("That LLM key does not belong to you");
  }

  const id = newId("agent");
  const slug = await uniqueSlug(name, db);
  const activate = input.activate === true;
  const paperStartingUsd = Number.isFinite(input.paperStartingUsd) ? Number(input.paperStartingUsd) : 10_000;
  if (paperStartingUsd <= 0) return fail("Paper starting balance must be positive");

  try {
    await db.insert(agents).values({
      id,
      ownerId: session.userId,
      slug,
      name,
      tagline: input.tagline?.trim() || null,
      avatarSeed: input.avatarSeed?.trim() || slug,
      mode: "paper",
      status: activate ? "active" : "draft",
      isPublic: input.isPublic,
      llmKeyId: input.llmKeyId,
      config,
      paperStartingUsd: paperStartingUsd.toFixed(2),
      nextRunAt: activate && input.holdSchedule !== true ? new Date() : null,
    });

    await createAgentWallets({ agentId: id, userId: session.userId, name, chains: config.chains });

    // Wallet-layer budget, defaulted to the app-level trade cap: even a compromised
    // run loop cannot move more USDC per transaction than the policy allows. Failure
    // is non-fatal — the app-level risk guard still stands, and the owner can apply
    // the policy later from settings.
    try {
      const walletBudget = await applyAgentBudgetPolicy({
        agentId: id,
        agentName: name,
        perTxUsd: config.risk.maxTradeUsd,
      });
      if (walletBudget) await db.update(agents).set({ walletBudget }).where(eq(agents.id, id));
    } catch (err) {
      console.warn("[createAgent] budget policy not applied:", err instanceof Error ? err.message : err);
    }

    await db.insert(posts).values({
      id: newId("post"),
      authorId: session.userId,
      agentId: id,
      kind: "agent_created",
      body: input.tagline?.trim() || `Deployed ${name}.`,
    });
  } catch (err) {
    await db.delete(agents).where(eq(agents.id, id));
    console.error("[createAgent]", err);
    return fail(err instanceof Error ? err.message : "Could not create the agent");
  }

  revalidateAgent(slug, session.handle);
  return { ok: true, data: { id, slug } };
}

export async function updateAgent(id: string, input: Partial<CreateAgentInput>): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const patch: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) return fail("Give your agent a name");
    patch.name = name;
  }
  if (input.tagline !== undefined) patch.tagline = input.tagline.trim() || null;
  if (input.avatarSeed !== undefined) patch.avatarSeed = input.avatarSeed.trim() || null;
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic;
  if (input.paperStartingUsd !== undefined) {
    if (!(input.paperStartingUsd > 0)) return fail("Paper starting balance must be positive");
    patch.paperStartingUsd = input.paperStartingUsd.toFixed(2);
  }
  if (input.llmKeyId !== undefined) {
    if (input.llmKeyId) {
      const [key] = await db
        .select({ id: llmKeys.id })
        .from(llmKeys)
        .where(and(eq(llmKeys.id, input.llmKeyId), eq(llmKeys.userId, session.userId)))
        .limit(1);
      if (!key) return fail("That LLM key does not belong to you");
    }
    patch.llmKeyId = input.llmKeyId;
  }
  if (input.config !== undefined) {
    const parsed = agentConfigSchema.safeParse(input.config);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    patch.config = parsed.data;
    // reschedule against the new interval
    if (agent.status === "active") {
      const minutes = parsed.data.schedule.intervalMinutes;
      patch.nextRunAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
    }
  }

  await db.update(agents).set(patch).where(eq(agents.id, id));

  // Keep the wallet-layer cap from drifting below the app-level trade cap when the
  // owner raises it. Best-effort: the app-level risk guard still holds if Privy fails.
  if (patch.config && patch.config.risk.maxTradeUsd !== agent.walletBudget?.perTxUsd) {
    try {
      const walletBudget = await applyAgentBudgetPolicy({
        agentId: id,
        agentName: patch.name ?? agent.name,
        perTxUsd: patch.config.risk.maxTradeUsd,
        existing: agent.walletBudget,
      });
      if (walletBudget) await db.update(agents).set({ walletBudget }).where(eq(agents.id, id));
    } catch (err) {
      console.warn("[updateAgent] budget policy not re-applied:", err instanceof Error ? err.message : err);
    }
  }

  revalidateAgent(agent.slug, session.handle);
  return { ok: true, data: undefined };
}

export async function setAgentStatus(id: string, status: Exclude<AgentStatus, "error">): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const interval = agent.config?.schedule?.intervalMinutes ?? 0;
  const nextRunAt = status === "active" ? (interval > 0 ? new Date() : null) : null;

  await db.update(agents).set({ status, nextRunAt, updatedAt: new Date() }).where(eq(agents.id, id));
  revalidateAgent(agent.slug, session.handle);
  return { ok: true, data: undefined };
}

export async function setAgentMode(id: string, mode: AgentMode): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");
  if (mode === "live" && !agent.llmKeyId) return fail("Add an LLM API key before going live");

  await db.update(agents).set({ mode, updatedAt: new Date() }).where(eq(agents.id, id));
  revalidateAgent(agent.slug, session.handle);
  return { ok: true, data: undefined };
}

export async function deleteAgent(id: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  // Deletion is irreversible and there is no in-app path to a deleted agent's
  // wallet, so refuse while it still holds anything the owner can take out first —
  // USDC, withdrawable SOL/ETH, tokens it bought live — and refuse when the wallet
  // cannot be read at all. The rules: `strandedHoldings` in `@/lib/wallets/funding`.
  const stranded = await readStrandedHoldings(id);
  if (!stranded.ok) return fail(stranded.error);
  const blocked = describeStranded(stranded.holdings);
  if (blocked) return fail(blocked);

  await db.delete(agents).where(eq(agents.id, id));
  revalidateAgent(agent.slug, session.handle);
  return { ok: true, data: undefined };
}

/**
 * Kick off a manual run. `startRun` inserts the `agent_runs` row synchronously and
 * schedules the tick itself with `after()`, so the id comes back immediately and the
 * work still finishes after this action's response — poll
 * `/api/agents/[id]/runs/[runId]` for the transcript.
 */
export async function triggerRun(id: string): Promise<ActionResult<{ runId: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");
  if (agent.status === "draft") return fail("Activate the agent before running it");

  // A run that stopped moving more than ten minutes ago was killed by the platform, not
  // by us. Reap it before looking for a live one: returning `{ok: true}` pointing at a
  // frozen row is how "Run one tick now" used to spin for five minutes and then say
  // nothing, every time, forever.
  const { reapStaleRuns, startRun, STALE_RUN_MS } = await import("@/lib/agent/run");
  await reapStaleRuns(id);

  const [running] = await db
    .select({ id: agentRuns.id, startedAt: agentRuns.startedAt, createdAt: agentRuns.createdAt })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, id), eq(agentRuns.status, "running")))
    .limit(1);
  if (running) {
    const since = (running.startedAt ?? running.createdAt).getTime();
    if (Date.now() - since < STALE_RUN_MS) return { ok: true, data: { runId: running.id } };
    // Still `running` after the reap: another writer is racing us. Say so rather than
    // hand back an id that will never finish.
    return fail("A previous run for this agent is stuck. Try again in a minute.");
  }

  try {
    // startRun inserts the run row synchronously and hands the continuation to
    // `after()`, so the UI gets an id to poll immediately and the tick still completes.
    const { runId } = await startRun({ agentId: id, trigger: "manual" });
    revalidatePath(`/agents/${agent.slug}`);
    return { ok: true, data: { runId } };
  } catch (err) {
    console.error("[triggerRun] could not start run", err);
    return fail("The agent runtime is unavailable");
  }
}
