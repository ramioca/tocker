"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { agentRuns, agents, getDb, llmKeys, notifications, posts } from "@/db";
import { agentConfigSchema, type AgentConfigInput } from "@/lib/agent/config";
import { getSession } from "@/lib/auth";
import { createAgentWallets } from "@/lib/wallets";
import { newId, uniqueSlug } from "@/server/queries/_shared";
import type { ActionResult, AgentMode, AgentStatus } from "@/server/types";

export interface CreateAgentInput {
  name: string;
  tagline?: string;
  avatarSeed?: string;
  isPublic: boolean;
  isForkable: boolean;
  llmKeyId: string | null;
  config: AgentConfigInput;
  paperStartingUsd?: number;
  /** Skip the draft step: go straight to `active` with a run scheduled now. */
  activate?: boolean;
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

  const name = input.name?.trim();
  if (!name || name.length < 2) return fail("Give your agent a name");
  if (name.length > 60) return fail("Name must be 60 characters or fewer");

  const parsed = agentConfigSchema.safeParse(input.config);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const config = parsed.data;

  const db = await getDb();

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
      isForkable: input.isForkable,
      llmKeyId: input.llmKeyId,
      config,
      paperStartingUsd: paperStartingUsd.toFixed(2),
      nextRunAt: activate ? new Date() : null,
    });

    await createAgentWallets({ agentId: id, userId: session.userId, name, chains: config.chains });

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
  if (input.isForkable !== undefined) patch.isForkable = input.isForkable;
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

export async function forkAgent(id: string): Promise<ActionResult<{ id: string; slug: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to fork an agent");

  const db = await getDb();
  const [source] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!source) return fail("Agent not found");
  if (!source.isPublic && source.ownerId !== session.userId) return fail("This agent is private");
  if (!source.isForkable && source.ownerId !== session.userId) return fail("This agent is not forkable");

  const name = `${source.name} (fork)`.slice(0, 60);
  const newAgentId = newId("agent");
  const slug = await uniqueSlug(name, db);

  try {
    await db.insert(agents).values({
      id: newAgentId,
      ownerId: session.userId,
      slug,
      name,
      tagline: source.tagline,
      avatarSeed: slug,
      mode: "paper",
      status: "draft",
      isPublic: true,
      isForkable: true,
      forkedFromId: source.id,
      llmKeyId: null, // never copy the original's key
      config: source.config,
      paperStartingUsd: source.paperStartingUsd,
    });

    await createAgentWallets({
      agentId: newAgentId,
      userId: session.userId,
      name,
      chains: source.config?.chains,
    });

    await db.insert(posts).values({
      id: newId("post"),
      authorId: session.userId,
      agentId: newAgentId,
      kind: "agent_created",
      body: `Forked ${source.name}.`,
    });

    if (source.ownerId !== session.userId) {
      await db.insert(notifications).values({
        id: newId("ntf"),
        userId: source.ownerId,
        kind: "fork",
        title: `@${session.handle} forked ${source.name}`,
        body: `${name} is now trading on its own.`,
        href: `/agents/${slug}`,
      });
    }
  } catch (err) {
    await db.delete(agents).where(eq(agents.id, newAgentId));
    console.error("[forkAgent]", err);
    return fail(err instanceof Error ? err.message : "Could not fork the agent");
  }

  revalidateAgent(slug, session.handle);
  revalidatePath(`/agents/${source.slug}`);
  return { ok: true, data: { id: newAgentId, slug } };
}

export async function deleteAgent(id: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  await db.delete(agents).where(eq(agents.id, id));
  revalidateAgent(agent.slug, session.handle);
  return { ok: true, data: undefined };
}

/**
 * Kick off a manual run. The run executes server-side after this action
 * returns — `runAgent` (RUNTIME) creates the `agent_runs` row itself, so there
 * is no id to hand back synchronously; poll `getAgentRuns` for the new run.
 */
export async function triggerRun(id: string): Promise<ActionResult<{ runId: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");
  if (agent.status === "draft") return fail("Activate the agent before running it");

  const [running] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, id), eq(agentRuns.status, "running")))
    .limit(1);
  if (running) return { ok: true, data: { runId: running.id } };

  try {
    // startRun inserts the run row synchronously and continues in the background,
    // so the UI gets an id to poll immediately.
    const { startRun } = await import("@/lib/agent/run");
    const { runId } = await startRun({ agentId: id, trigger: "manual" });
    revalidatePath(`/agents/${agent.slug}`);
    return { ok: true, data: { runId } };
  } catch (err) {
    console.error("[triggerRun] could not start run", err);
    return fail("The agent runtime is unavailable");
  }
}
