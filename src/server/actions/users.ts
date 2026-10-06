"use server";
import { discoverAnthropicWorkspace, needsWorkspaceHeader } from "@/lib/agent/anthropic-workspace";
import { listModelsForKey } from "@/lib/agent/key-models";
import { probeLlmKey } from "@/lib/agent/key-probe";
import { providerLabel, type ModelOption } from "@/lib/agent/models";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { agents, getDb, llmKeys, notifications, users } from "@/db";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { DISPLAY_NAME_RESERVED, HANDLE_RESERVED, isReservedHandle, isStaffLikeName } from "@/lib/reserved-handles";
import { decryptSecret, encryptSecret, last4 } from "@/lib/crypto";
import { recordAudit } from "@/lib/security/audit";
import { SECRET_IN_PUBLIC_TEXT, dbErrorForLog, looksLikeSecret } from "@/lib/security/redact";
import { newId } from "@/server/queries/_shared";
import { countKeylessAgents } from "@/server/queries/users";
import { mismatchedProvider, wrongProviderOnAdd, wrongProviderOnRotate } from "@/lib/agent/key-prefix";
import { sanitizePrefs, type NotificationPrefs } from "@/lib/notifications/prefs";
import type { ActionResult } from "@/server/types";
import { slowDown } from "./_shared";

/** "an OpenAI", "a Groq": the audit log is read, so it gets the article right. */
function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Said under the key field when the provider answered 401 to it. */
function rejectedBy(provider: string): string {
  return `${providerLabel(provider)} rejected this key — check you copied all of it`;
}

const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

/** No provider issues a key this long; the forms stop at the same length. */
const MAX_KEY_CHARS = 512;
/** Anthropic's own shape for a workspace id. Anything else in that field is a mistake. */
const WORKSPACE_ID_RE = /^wrkspc_[A-Za-z0-9]{1,72}$/;
/** Adding or replacing a key asks its provider about it, so it is paced like any outbound call. */
const KEY_WRITE_LIMIT = { limit: 10, windowMs: 60_000 } as const;
const LABEL_IS_A_KEY = "Label looks like an API key. A label is only a name; the key itself goes in the key field.";

export async function updateProfile(input: {
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

  if (input.handle !== undefined) {
    const handle = input.handle.trim().toLowerCase();
    if (!HANDLE_RE.test(handle)) return fail("Handles are 2–20 characters: letters, numbers and underscores");
    // Only a change is refused: the form always sends the handle, so without this an
    // account that already holds one of these names could never save its profile again.
    if (handle !== session.handle && isReservedHandle(handle)) return fail(HANDLE_RESERVED);
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handle, handle), ne(users.id, session.userId)))
      .limit(1);
    if (taken) return fail("That handle is taken");
    patch.handle = handle;
  }
  if (input.displayName !== undefined) {
    const name = input.displayName.trim();
    if (name.length > 60) return fail("Display name must be 60 characters or fewer");
    // "Tocker Support" beside any handle reads as staff. A change only, like the handle
    // above; the people in ADMIN_EMAILS are the staff, so the words are theirs to use.
    if (name !== (session.displayName ?? "") && isStaffLikeName(name) && !isAdminEmail(session.email)) {
      return fail(DISPLAY_NAME_RESERVED);
    }
    if (looksLikeSecret(name)) return fail(SECRET_IN_PUBLIC_TEXT);
    patch.displayName = name || null;
  }
  if (input.bio !== undefined) {
    const bio = input.bio.trim();
    if (bio.length > 280) return fail("Bio must be 280 characters or fewer");
    if (looksLikeSecret(bio)) return fail(SECRET_IN_PUBLIC_TEXT);
    patch.bio = bio || null;
  }
  if (input.avatarUrl !== undefined) {
    const url = typeof input.avatarUrl === "string" ? input.avatarUrl.trim() : "";
    if (url && !/^https?:\/\//i.test(url)) return fail("Avatar URL must start with http(s)://");
    // Rendered on every post and profile; the practical browser limit is about this.
    if (url.length > 2048) return fail("Avatar URL must be 2048 characters or fewer");
    patch.avatarUrl = url || null;
  }

  await db.update(users).set(patch).where(eq(users.id, session.userId));

  revalidatePath("/settings");
  revalidatePath(`/u/${patch.handle ?? session.handle}`);
  revalidatePath("/feed");
  return { ok: true, data: undefined };
}

export async function addLlmKey(input: {
  provider: "anthropic" | "openai" | "openrouter";
  key: string;
  label?: string;
  /** Anthropic only: the workspace an organization-level key should act in. */
  workspaceId?: string;
}): Promise<ActionResult<{ id: string; last4: string; unverified?: boolean; keylessAgents?: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (key.length < 16 || key.length > MAX_KEY_CHARS || /\s/.test(key)) return fail("That does not look like an API key");
  if (!["anthropic", "openai", "openrouter"].includes(input.provider)) return fail("Unknown provider");
  if (input.label !== undefined && (typeof input.label !== "string" || input.label.trim().length > 60)) {
    return fail("Label must be 60 characters or fewer");
  }
  // The label and the workspace id are stored as they are typed and shown back in
  // Settings and the audit log. The key is the only field that is encrypted, so a key
  // pasted into either of the others is refused rather than kept in the clear.
  const label = input.label?.trim() ?? "";
  if (label && (looksLikeSecret(label) || (label.length >= 12 && key.includes(label)))) {
    return fail(LABEL_IS_A_KEY);
  }
  if (input.workspaceId !== undefined && typeof input.workspaceId !== "string") return fail("Unknown Workspace ID");
  if (input.provider === "anthropic" && input.workspaceId?.trim() && !WORKSPACE_ID_RE.test(input.workspaceId.trim())) {
    return fail("That does not look like a Workspace ID. It starts with wrkspc_ (Anthropic Console, Settings, Workspaces).");
  }
  const limited = slowDown("llm-key", session.userId, KEY_WRITE_LIMIT);
  if (limited) return fail(limited);
  // The form refuses this before calling; this covers a direct call. A key saved under
  // the wrong provider passes when that provider can't be probed and fails on the next run.
  const otherProvider = mismatchedProvider(key, input.provider);
  if (otherProvider) return fail(wrongProviderOnAdd(otherProvider, input.provider));

  // An Anthropic key made at the organization level must name a workspace on every
  // request. Nobody should have to know that: one free request says whether this key
  // needs one, and the Admin API says which — the id is saved with the key.
  let workspaceId = input.provider === "anthropic" && input.workspaceId?.trim() ? input.workspaceId.trim() : null;
  if (input.provider === "anthropic" && !workspaceId && (await needsWorkspaceHeader(key)) === true) {
    const found = await discoverAnthropicWorkspace(key);
    if (found.kind === "found") workspaceId = found.workspaceId;
    else if (found.kind === "unknown") {
      return fail(
        "This is an organization-level Anthropic key and Tocker could not find a workspace it may act in. Paste a Workspace ID (Anthropic Console → Settings → Workspaces), or create the key inside a workspace.",
      );
    }
  }

  // Ask the provider before saving: a key it refuses would otherwise be "Added" here and
  // surface only as a failed run hours later. When it cannot be asked (down, slow, a
  // network in the way) the key is saved and comes back `unverified`, for the form to say.
  const probe = await probeLlmKey(input.provider, key, workspaceId);
  if (probe === "rejected") return fail(rejectedBy(input.provider));

  const db = await getDb();
  const id = newId("key");
  try {
    await db.insert(llmKeys).values({
      id,
      userId: session.userId,
      provider: input.provider,
      label: label || null,
      encryptedKey: encryptSecret(key),
      last4: last4(key),
      workspaceId,
    });
  } catch (err) {
    // Never the error itself or its message: the driver's message is the statement and
    // every bound parameter, the encrypted key among them.
    console.error("[addLlmKey]", dbErrorForLog(err));
    return fail("Could not save the key");
  }

  // Audited because a key added to this account can spend money on the owner's
  // provider bill. The audit row carries the last four characters, never more.
  await recordAudit({
    userId: session.userId,
    kind: "llm_key_added",
    summary: `Added ${withArticle(providerLabel(input.provider))} API key ending ${last4(key)}${label ? ` (${label})` : ""}.`,
    metadata: { provider: input.provider, last4: last4(key) },
  });

  revalidatePath("/settings");
  revalidatePath("/settings/security");
  // A key removed and re-added (rather than rotated) leaves every agent it served with
  // none. Saying how many lets the form offer to attach this one in the same breath.
  const keylessAgents = await countKeylessAgents(session.userId);
  return {
    ok: true,
    data: { id, last4: last4(key), keylessAgents, ...(probe === "unreachable" ? { unverified: true } : {}) },
  };
}

/**
 * Attach one of the caller's keys to every one of their agents that has none.
 *
 * The other half of `removeLlmKey`: removing a key detaches every agent it served, and
 * adding a new one attached nothing, so an operator who swapped keys by remove-then-add
 * ended with a working key and every agent stopped — fixable only agent by agent. Only
 * agents with no key at all are touched; one already pointed at another key keeps it.
 */
/** How often one account may ask a provider for a model list. The picker caches it too. */
const KEY_MODELS_LIMIT = { limit: 20, windowMs: 60_000 } as const;
/** How long one key's list is served before its provider is asked again. */
const KEY_MODELS_TTL_MS = 10 * 60_000;
const KEY_MODELS_CACHE_MAX = 500;
/** Model lists only, by key id and its last four (so a rotated key is asked afresh). Never a key. */
const keyModelsCache = new Map<string, { at: number; models: ModelOption[] }>();

/**
 * The models one of the caller's own keys can use, asked of Anthropic or OpenAI.
 *
 * This is the one place outside the run loop where a stored key is decrypted. The
 * plaintext lives for the length of the provider request inside this function; what
 * goes back to the browser is model ids, names and list prices. The key is looked up by
 * id *and* owner, so nobody learns anything through a key that is not theirs, including
 * whether it exists.
 */
export async function listKeyModels(
  keyId: string,
): Promise<ActionResult<{ provider: "anthropic" | "openai"; models: ModelOption[] }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  // A public endpoint: the argument is whatever the caller sent.
  if (typeof keyId !== "string" || keyId.length === 0 || keyId.length > 64) return fail("Key not found");
  const limited = slowDown("key-models", session.userId, KEY_MODELS_LIMIT);
  if (limited) return fail(limited);

  const db = await getDb();
  const [row] = await db
    .select()
    .from(llmKeys)
    .where(and(eq(llmKeys.id, keyId), eq(llmKeys.userId, session.userId)))
    .limit(1);
  if (!row) return fail("Key not found");
  if (row.provider === "openrouter") return fail("OpenRouter's list does not depend on the key");

  const cacheKey = `${row.id}:${row.last4}`;
  const cached = keyModelsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < KEY_MODELS_TTL_MS) {
    return { ok: true, data: { provider: row.provider, models: cached.models } };
  }

  let result;
  try {
    result = await listModelsForKey(row.provider, decryptSecret(row.encryptedKey), row.workspaceId);
  } catch (err) {
    // Decryption failed (a missing or changed ENCRYPTION_KEY). Message only, never the blob.
    console.error("[listKeyModels]", err instanceof Error ? err.message : String(err));
    return fail("Could not read this key. The built-in list is shown instead.");
  }
  if (!result.ok) {
    return fail(
      result.reason === "rejected"
        ? `${providerLabel(row.provider)} no longer accepts this key. Replace it under Settings, LLM API keys.`
        : `Couldn't get the model list from ${providerLabel(row.provider)} just now.`,
    );
  }

  if (keyModelsCache.size >= KEY_MODELS_CACHE_MAX) {
    const oldest = keyModelsCache.keys().next().value;
    if (oldest !== undefined) keyModelsCache.delete(oldest);
  }
  keyModelsCache.set(cacheKey, { at: Date.now(), models: result.models });
  return { ok: true, data: { provider: row.provider, models: result.models } };
}

export async function attachKeyToKeylessAgents(keyId: string): Promise<ActionResult<{ attached: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [key] = await db
    .select({ id: llmKeys.id, provider: llmKeys.provider, last4: llmKeys.last4 })
    .from(llmKeys)
    .where(and(eq(llmKeys.id, keyId), eq(llmKeys.userId, session.userId)))
    .limit(1);
  if (!key) return fail("Key not found");

  const attached = await db
    .update(agents)
    .set({ llmKeyId: key.id, updatedAt: new Date() })
    .where(and(eq(agents.ownerId, session.userId), isNull(agents.llmKeyId)))
    .returning({ id: agents.id, name: agents.name, slug: agents.slug });

  // One row per agent, so each agent's own history says when it got its brain back.
  // `llm_key_added` is the honest existing kind: a key was added to this agent.
  for (const agent of attached) {
    await recordAudit({
      userId: session.userId,
      kind: "llm_key_added",
      agentId: agent.id,
      agentName: agent.name,
      summary: `Attached the ${providerLabel(key.provider)} key ending ${key.last4} to ${agent.name}, which had no key.`,
      metadata: { provider: key.provider, last4: key.last4, attachedTo: agent.id },
    });
  }

  revalidatePath("/settings");
  revalidatePath("/settings/security");
  for (const agent of attached) revalidatePath(`/agents/${agent.slug}`);
  return { ok: true, data: { attached: attached.length } };
}

export async function removeLlmKey(id: string): Promise<ActionResult<{ detachedAgents: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [key] = await db
    .select({ id: llmKeys.id, provider: llmKeys.provider, last4: llmKeys.last4, label: llmKeys.label })
    .from(llmKeys)
    .where(and(eq(llmKeys.id, id), eq(llmKeys.userId, session.userId)))
    .limit(1);
  if (!key) return fail("Key not found");

  // agents keep running without a key only in paper mode — detach first
  const detached = await db
    .update(agents)
    .set({ llmKeyId: null })
    .where(eq(agents.llmKeyId, id))
    .returning({ id: agents.id });
  await db.delete(llmKeys).where(eq(llmKeys.id, id));

  await recordAudit({
    userId: session.userId,
    kind: "llm_key_removed",
    summary: `Revoked the ${providerLabel(key.provider)} key ending ${key.last4}. ${
      detached.length === 0
        ? "No agent was using it."
        : detached.length === 1
          ? "1 agent lost its brain and cannot run until another key is attached."
          : `${detached.length} agents lost their brains and cannot run until another key is attached.`
    }`,
    metadata: { provider: key.provider, last4: key.last4, detachedAgents: detached.length },
  });

  revalidatePath("/settings");
  revalidatePath("/settings/security");
  return { ok: true, data: { detachedAgents: detached.length } };
}

/**
 * Replace the secret behind an existing key, keeping its id.
 *
 * Rotation rather than remove-and-re-add on purpose: every agent pointed at this
 * key keeps working across the swap, so rotating a leaked key costs nothing and
 * there is no window where a live agent has no brain. The old ciphertext is
 * overwritten in place — we never keep a previous secret "just in case".
 */
export async function rotateLlmKey(input: {
  id: string;
  key: string;
}): Promise<ActionResult<{ last4: string; unverified?: boolean }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (key.length < 16 || key.length > MAX_KEY_CHARS || /\s/.test(key)) return fail("That does not look like an API key");
  const limited = slowDown("llm-key", session.userId, KEY_WRITE_LIMIT);
  if (limited) return fail(limited);

  const db = await getDb();
  const [existing] = await db
    .select({ id: llmKeys.id, provider: llmKeys.provider, last4: llmKeys.last4, workspaceId: llmKeys.workspaceId })
    .from(llmKeys)
    .where(and(eq(llmKeys.id, input.id), eq(llmKeys.userId, session.userId)))
    .limit(1);
  if (!existing) return fail("Key not found");
  // A rotation replaces the secret, never the provider; the inventory refuses this first.
  const otherProvider = mismatchedProvider(key, existing.provider);
  if (otherProvider) return fail(wrongProviderOnRotate(otherProvider, existing.provider));

  // Every agent on this key picks up the new secret on its next run, so a refused one
  // would take all of them down at once. Checked against the saved workspace: rotation
  // replaces the secret, not where it acts.
  const probe = await probeLlmKey(existing.provider, key, existing.workspaceId);
  if (probe === "rejected") return fail(rejectedBy(existing.provider));

  const [{ n: agentCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(eq(agents.llmKeyId, input.id));

  try {
    await db
      .update(llmKeys)
      .set({ encryptedKey: encryptSecret(key), last4: last4(key) })
      .where(eq(llmKeys.id, input.id));
  } catch (err) {
    console.error("[rotateLlmKey]", dbErrorForLog(err));
    return fail("Could not rotate the key");
  }

  await recordAudit({
    userId: session.userId,
    kind: "llm_key_rotated",
    summary: `Rotated the ${existing.provider} key: ${existing.last4} → ${last4(key)}. ${Number(agentCount)} agent${
      Number(agentCount) === 1 ? "" : "s"
    } kept running.`,
    metadata: { provider: existing.provider, from: existing.last4, to: last4(key), agents: Number(agentCount) },
  });

  revalidatePath("/settings");
  revalidatePath("/settings/security");
  return { ok: true, data: { last4: last4(key), ...(probe === "unreachable" ? { unverified: true } : {}) } };
}

export async function markNotificationsRead(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.userId), isNull(notifications.readAt)));

  revalidatePath("/feed");
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

/** Mark one of the viewer's notifications read, when they open it. Idempotent. */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, session.userId), isNull(notifications.readAt)));

  revalidatePath("/notifications");
  return { ok: true, data: undefined };
}

/**
 * Store which notification kinds the viewer wants. Only muteable kinds with boolean
 * values are kept (see `sanitizePrefs`), so a crafted request cannot mute a proposal.
 */
export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<ActionResult<NotificationPrefs>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const clean = sanitizePrefs(prefs);
  const db = await getDb();
  await db
    .update(users)
    .set({ notificationPrefs: clean, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  revalidatePath("/settings");
  revalidatePath("/notifications");
  // The unread badge lives in the app layout.
  revalidatePath("/", "layout");
  return { ok: true, data: clean };
}
