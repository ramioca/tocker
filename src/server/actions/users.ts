"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { agents, getDb, llmKeys, notifications, users } from "@/db";
import { getSession } from "@/lib/auth";
import { encryptSecret, last4 } from "@/lib/crypto";
import { newId } from "@/server/queries/_shared";
import type { ActionResult } from "@/server/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

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
    patch.displayName = name || null;
  }
  if (input.bio !== undefined) {
    const bio = input.bio.trim();
    if (bio.length > 280) return fail("Bio must be 280 characters or fewer");
    patch.bio = bio || null;
  }
  if (input.avatarUrl !== undefined) {
    const url = input.avatarUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) return fail("Avatar URL must start with http(s)://");
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
}): Promise<ActionResult<{ id: string; last4: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const key = input.key?.trim();
  if (!key || key.length < 16) return fail("That does not look like an API key");
  if (!["anthropic", "openai", "openrouter"].includes(input.provider)) return fail("Unknown provider");

  const db = await getDb();
  const id = newId("key");
  try {
    await db.insert(llmKeys).values({
      id,
      userId: session.userId,
      provider: input.provider,
      label: input.label?.trim() || null,
      encryptedKey: encryptSecret(key),
      last4: last4(key),
    });
  } catch (err) {
    // Message only: the raw error can echo bound query params near the encrypted
    // key blob into logs.
    console.error("[addLlmKey]", err instanceof Error ? err.message : String(err));
    return fail("Could not save the key");
  }

  revalidatePath("/settings");
  return { ok: true, data: { id, last4: last4(key) } };
}

export async function removeLlmKey(id: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [key] = await db
    .select({ id: llmKeys.id })
    .from(llmKeys)
    .where(and(eq(llmKeys.id, id), eq(llmKeys.userId, session.userId)))
    .limit(1);
  if (!key) return fail("Key not found");

  // agents keep running without a key only in paper mode — detach first
  await db.update(agents).set({ llmKeyId: null }).where(eq(agents.llmKeyId, id));
  await db.delete(llmKeys).where(eq(llmKeys.id, id));

  revalidatePath("/settings");
  return { ok: true, data: undefined };
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
