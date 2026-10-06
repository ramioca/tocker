"use server";
import { MAX_AGENTS_PER_USER, MAX_NEW_AGENTS_PER_DAY, RATE_LIMITS, limiter } from "@/lib/security/rate-limit";
import { revalidatePath } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { agentRuns, agents, getDb, llmKeys, posts, wallets } from "@/db";
import { MAX_AGENT_NAME, agentConfigSchema, type AgentConfigInput } from "@/lib/agent/config";
import { isLlmMock } from "@/lib/agent/mock-model";
import { RUN_REFUSED_WHILE_PAUSED } from "@/lib/agent/run-gate";
import { getSession } from "@/lib/auth";
import { isTradingPaused } from "@/lib/security/kill-switch";
import { SECRET_IN_PUBLIC_TEXT, looksLikeSecret } from "@/lib/security/redact";
import { applyAgentBudgetPolicy, createAgentWallets, getAgentWallets } from "@/lib/wallets";
import { chainLabelFor, describeStranded } from "@/lib/wallets/funding";
import { readStrandedHoldings } from "@/lib/wallets/stranded";
import { newId, uniqueSlug } from "@/server/queries/_shared";
import type { ActionResult, AgentStatus, Chain } from "@/server/types";
import { slowDown } from "./_shared";

/** The same constant as the `maxLength` on the builder's and the settings form's inputs. */
const MAX_NAME = MAX_AGENT_NAME;
const MAX_TAGLINE = 120;
const MAX_AVATAR_SEED = 64;
/**
 * Paper money is imaginary, but the number is persisted as `numeric` and drives every
 * sizing rule; an absurd or non-finite one makes the book meaningless. Well above the
 * largest preset ($100k) and anything anyone would fund an agent with.
 */
const MAX_PAPER_STARTING_USD = 10_000_000;
/** What an owner may set by hand; `error` is only ever set by the run loop. */
const SETTABLE_STATUSES: ReadonlySet<string> = new Set(["draft", "active", "paused"]);

/**
 * Checked once, in `createAgent`, which is the only place the balance is set.
 * `updateAgent` does not take it: paper cash is the starting balance minus net buys, so
 * rewriting it on an agent that has traded rewrites its public PnL and its place on the
 * leaderboard.
 */
function checkPaperStartingUsd(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Paper starting balance must be positive";
  }
  if (value > MAX_PAPER_STARTING_USD) return "Paper starting balance must be $10,000,000 or less";
  return null;
}

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

/**
 * Plain words for the fields a save can fail on. A full sentence where zod's own
 * message ("Too small: expected number to be >=0.1") would say nothing useful; a label
 * to put in front of it otherwise.
 */
const ISSUE_SENTENCE: Record<string, string> = {
  percentOfEquity: "Share of equity must be between 0.1% and 100%",
  referenceRangePct: "Reference range must be between 1% and 500%",
};
const ISSUE_LABEL: Record<string, string> = {
  minTradeUsd: "Minimum ticket",
  maxTradeUsd: "Max per trade",
  maxDailyTrades: "Max trades per day",
  maxPositionPct: "Max position size",
  maxDataSpendUsdPerRun: "Data spend cap per run",
  slippageBps: "Slippage tolerance",
  strategyPrompt: "Strategy",
  name: "Name",
};

/** The first problem, in words: never a dotted path like `risk.sizing.percentOfEquity`. */
function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid agent configuration";
  const leaf = [...issue.path].reverse().find((p): p is string => typeof p === "string");
  if (leaf && ISSUE_SENTENCE[leaf]) return ISSUE_SENTENCE[leaf];
  if (leaf && ISSUE_LABEL[leaf]) return `${ISSUE_LABEL[leaf]}: ${issue.message}`;
  return issue.message;
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

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length < 2) return fail("Give your agent a name");
  if (name.length > MAX_NAME) return fail(`Name must be ${MAX_NAME} characters or fewer`);
  if (input.tagline !== undefined && (typeof input.tagline !== "string" || input.tagline.trim().length > MAX_TAGLINE)) {
    return fail(`Tagline must be ${MAX_TAGLINE} characters or fewer`);
  }
  // Both are printed on every public card, and the tagline becomes the first post.
  if (looksLikeSecret(name) || looksLikeSecret(input.tagline)) return fail(SECRET_IN_PUBLIC_TEXT);
  if (input.avatarSeed !== undefined && (typeof input.avatarSeed !== "string" || input.avatarSeed.trim().length > MAX_AVATAR_SEED)) {
    return fail(`Avatar seed must be ${MAX_AVATAR_SEED} characters or fewer`);
  }

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

  // The durable limit. The hourly one below lives in this process's memory and the cap
  // on agents held is reset by deleting one; this counts the wallets creations left
  // behind, which no delete removes.
  const [recent] = await db
    .select({ n: sql<number>`count(distinct ${wallets.agentId})::int` })
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, session.userId),
        eq(wallets.kind, "agent_server"),
        gte(wallets.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    );
  if ((recent?.n ?? 0) >= MAX_NEW_AGENTS_PER_DAY) {
    return fail(`You've set up ${MAX_NEW_AGENTS_PER_DAY} agents in the last 24 hours, the most Tocker creates in a day. Try again tomorrow.`);
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
  const paperStartingUsd = input.paperStartingUsd === undefined ? 10_000 : input.paperStartingUsd;
  const paperProblem = checkPaperStartingUsd(paperStartingUsd);
  if (paperProblem) return fail(paperProblem);

  // The hourly allowance, taken last: every agent gets real wallets and a USDC account
  // the platform pays rent for, so what counts is a request about to make them, not one
  // the form was always going to refuse. It is also the only thing in front of a burst:
  // the daily count above cannot see a creation whose wallet rows are not written yet.
  const hourlyKey = `agent:create:${session.userId}`;
  const hourly = limiter.consume(hourlyKey, RATE_LIMITS.agentCreate);
  if (!hourly.ok) {
    const minutes = Math.ceil(hourly.retryAfterSeconds / 60);
    return fail(
      `You've tried to create an agent ${RATE_LIMITS.agentCreate.limit} times this hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  // Once the wallets exist the attempt has cost something, and the daily count has it.
  let walletsMade = false;
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
    walletsMade = true;

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
    // The sentence below asks for another try, so an attempt that made no wallets is
    // handed back: retrying through an outage, as told, must not use up the hour.
    if (!walletsMade) limiter.refund(hourlyKey);
    await db.delete(agents).where(eq(agents.id, id));
    // The raw text is a Postgres or Privy error; it belongs in the log, not a toast.
    console.error("[createAgent]", err);
    return fail("Could not create the agent — nothing was saved. Try again in a minute.");
  }

  revalidateAgent(slug, session.handle);
  return { ok: true, data: { id, slug } };
}

/**
 * Makes the wallet for any chain a saved config names that the agent has none on.
 *
 * `createAgent` makes one wallet per chain the agent starts with, and nothing made one
 * for a chain switched on later: the live checklist then failed on "No wallet on Base"
 * with a fix link that led nowhere, and an agent already live failed every run for it.
 * It also mends an agent already in that state, the next time its settings are saved.
 *
 * Bounded three ways. A chain that has a wallet row is never given another, so an agent
 * ends with at most one per chain however often a chain is toggled. One attempt a minute
 * per agent in this process. And `existingAgent` hands Privy an idempotency key, so two
 * saves that both get past the first check are given the same wallet, not one each.
 */
async function ensureChainWallets(input: {
  agentId: string;
  userId: string;
  name: string;
  chains: Chain[];
}): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const existing = await getAgentWallets(input.agentId);
  const missing = [...new Set(input.chains)].filter((chain) => !existing.some((w) => w.chain === chain));
  if (missing.length === 0) return { ok: true, created: false };

  const refusal = `Could not create the ${missing.map(chainLabelFor).join(" and ")} wallet${missing.length === 1 ? "" : "s"}, so the change was not saved. Try again in a minute.`;
  if (!limiter.consume(`agent:wallet-add:${input.agentId}`, RATE_LIMITS.agentWalletAdd).ok) {
    return { ok: false, error: refusal };
  }
  try {
    await createAgentWallets({ ...input, chains: missing, existingAgent: true });
    return { ok: true, created: true };
  } catch (err) {
    // A Privy or Postgres error: for the log, like the one in `createAgent`.
    console.error("[updateAgent] could not create a wallet", err);
    return { ok: false, error: refusal };
  }
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
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 2) return fail("Give your agent a name");
    if (name.length > MAX_NAME) return fail(`Name must be ${MAX_NAME} characters or fewer`);
    if (looksLikeSecret(name)) return fail(SECRET_IN_PUBLIC_TEXT);
    patch.name = name;
  }
  if (input.tagline !== undefined) {
    const tagline = typeof input.tagline === "string" ? input.tagline.trim() : "";
    if (tagline.length > MAX_TAGLINE) return fail(`Tagline must be ${MAX_TAGLINE} characters or fewer`);
    if (looksLikeSecret(tagline)) return fail(SECRET_IN_PUBLIC_TEXT);
    patch.tagline = tagline || null;
  }
  if (input.avatarSeed !== undefined) {
    const seed = typeof input.avatarSeed === "string" ? input.avatarSeed.trim() : "";
    if (seed.length > MAX_AVATAR_SEED) return fail(`Avatar seed must be ${MAX_AVATAR_SEED} characters or fewer`);
    patch.avatarSeed = seed || null;
  }
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic === true;
  // `input.paperStartingUsd` is not read: see `checkPaperStartingUsd`. No form sends it.
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

  // After every check and before the save, so a chain is never on without its wallet.
  let walletAdded = false;
  if (patch.config) {
    const wallet = await ensureChainWallets({
      agentId: id,
      userId: agent.ownerId,
      name: patch.name ?? agent.name,
      chains: patch.config.chains,
    });
    if (!wallet.ok) return fail(wallet.error);
    walletAdded = wallet.created;
  }

  await db.update(agents).set(patch).where(eq(agents.id, id));

  // Keep the wallet-layer cap from drifting below the app-level trade cap when the
  // owner raises it, and put the same cap on a wallet that was just made. Best-effort:
  // the app-level risk guard still holds if Privy fails.
  if (patch.config && (walletAdded || patch.config.risk.maxTradeUsd !== agent.walletBudget?.perTxUsd)) {
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
  // The type is erased at the wire: a caller can post any string, and the enum column
  // would turn it into a 500 — or, for "error", into a state only the run loop may set.
  if (!SETTABLE_STATUSES.has(status)) return fail("Unknown status");

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

export async function deleteAgent(id: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  // Its fee rows are deleted with it, so what it owes Tocker is collected now: the
  // ordinary sweep, whatever the batch threshold. Best effort (it never throws) and
  // never a refusal: fees the sweep cannot reach are let go rather than leave an agent
  // that can be neither emptied nor deleted.
  const { collectFeesOwed } = await import("@/lib/platform/withdrawal-fees");
  await collectFeesOwed(agent);

  // Deletion is irreversible and there is no in-app path to a deleted agent's
  // wallet, so refuse while it still holds anything the owner can take out first —
  // USDC, withdrawable SOL/ETH, tokens it bought live — and refuse when the wallet
  // cannot be read at all. The rules: `strandedHoldings` in `@/lib/wallets/funding`.
  const stranded = await readStrandedHoldings(id);
  if (!stranded.ok) return fail(stranded.error);
  const blocked = describeStranded(stranded.holdings);
  if (blocked) return fail(blocked);

  // Its payment rows go with it, and the daily data ceiling is counted from them. Carry
  // what it spent today over to the audit log, which outlives it, so deleting an agent
  // is not a way to start the day's allowance again.
  const { DATA_SPEND_CARRYOVER, agentRealDataSpend24h } = await import("@/lib/x402/daily-budget");
  const spentToday = await agentRealDataSpend24h(id);
  if (spentToday > 0) {
    const { recordAudit } = await import("@/lib/security/audit");
    await recordAudit({
      userId: session.userId,
      kind: "budget_change",
      agentId: id,
      agentName: agent.name,
      summary: `Deleted ${agent.name}. The $${spentToday.toFixed(2)} of data it bought in the last 24 hours still counts toward today's data allowance.`,
      metadata: { reason: DATA_SPEND_CARRYOVER, dataSpendUsd: spentToday },
    });
  }

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
  // Same bucket size as the `/api/agents/[id]/run` route: a run spends the owner's LLM key.
  const limited = slowDown("run", session.userId, RATE_LIMITS.sensitive);
  if (limited) return fail(limited);

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");
  if (agent.status === "draft") return fail("Activate the agent before running it");
  // The kill switch covers a run started by hand too: it could place no buy, so all it
  // would do is spend the owner's model tokens. Exits do not wait for a run.
  if (await isTradingPaused(agent.ownerId)) return fail(RUN_REFUSED_WHILE_PAUSED);
  // The page disables Run now without a key, but a stale page or a direct call would
  // otherwise start a run that can only fail.
  if (!agent.llmKeyId && !isLlmMock()) return fail("Attach an LLM key before running this agent");

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
