/**
 * `listKeyModels`: the one action that uses a stored LLM key outside an agent run.
 *
 * What matters is who can make it happen and what comes back: only the key's owner,
 * only model ids and names, and the provider is not asked again for ten minutes.
 * `getSession`, the provider call and decryption are stand-ins; the key rows are real,
 * against in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import type { Session } from "@/server/types";

let session: Session | null = null;
const listModelsForKey = vi.fn();
const decryptSecret = vi.fn((blob: string) => `plain:${blob}`);

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/agent/key-models", () => ({
  listModelsForKey: (...args: unknown[]) => listModelsForKey(...args),
}));
vi.mock("@/lib/crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto")>()),
  decryptSecret: (blob: string) => decryptSecret(blob),
}));

const { listKeyModels } = await import("./users");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
  listModelsForKey.mockReset();
  listModelsForKey.mockResolvedValue({ ok: true, models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }] });
  decryptSecret.mockClear();
});

async function user(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `u${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`, displayName: null });
  return userId;
}

function signIn(userId: string): void {
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
}

async function key(userId: string, over: Partial<typeof schema.llmKeys.$inferInsert> = {}): Promise<string> {
  const id = `key_${nanoid(8)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider: "anthropic", encryptedKey: `blob-${id}`, last4: "abcd", ...over });
  return id;
}

describe("listKeyModels", () => {
  it("asks the provider with the owner's key and workspace, and returns only the models", async () => {
    const owner = await user();
    signIn(owner);
    const id = await key(owner, { workspaceId: "wrkspc_9" });

    const result = await listKeyModels(id);

    expect(result).toEqual({
      ok: true,
      data: { provider: "anthropic", models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }] },
    });
    expect(listModelsForKey).toHaveBeenCalledWith("anthropic", `plain:blob-${id}`, "wrkspc_9");
    // Neither the key nor its stored form is in what goes back to the browser.
    expect(JSON.stringify(result)).not.toContain("blob-");
    expect(JSON.stringify(result)).not.toContain("plain:");
  });

  it("refuses a signed-out caller and anything that is not a key id, without touching a key", async () => {
    const owner = await user();
    const id = await key(owner);

    expect(await listKeyModels(id)).toEqual({ ok: false, error: "Sign in first" });

    signIn(owner);
    for (const bad of ["", "x".repeat(65), null, 7, { id }] as unknown[]) {
      expect(await listKeyModels(bad as string)).toEqual({ ok: false, error: "Key not found" });
    }
    expect(decryptSecret).not.toHaveBeenCalled();
    expect(listModelsForKey).not.toHaveBeenCalled();
  });

  /** Another account's key id gets the same answer as an id that does not exist. */
  it("never uses a key that belongs to someone else", async () => {
    const owner = await user();
    const stranger = await user();
    const id = await key(owner);
    signIn(stranger);

    expect(await listKeyModels(id)).toEqual({ ok: false, error: "Key not found" });
    expect(await listKeyModels("key_does_not_exist")).toEqual({ ok: false, error: "Key not found" });
    expect(decryptSecret).not.toHaveBeenCalled();
    expect(listModelsForKey).not.toHaveBeenCalled();
  });

  it("does not ask by key for OpenRouter, whose list is public", async () => {
    const owner = await user();
    signIn(owner);
    const id = await key(owner, { provider: "openrouter" });

    const result = await listKeyModels(id);

    expect(result.ok).toBe(false);
    expect(decryptSecret).not.toHaveBeenCalled();
  });

  it("serves the same list for ten minutes without decrypting again, and asks afresh for a rotated key", async () => {
    const owner = await user();
    signIn(owner);
    const id = await key(owner, { provider: "openai" });

    await listKeyModels(id);
    await listKeyModels(id);
    expect(listModelsForKey).toHaveBeenCalledTimes(1);
    expect(decryptSecret).toHaveBeenCalledTimes(1);

    // Rotation keeps the id and changes the last four.
    const { eq } = await import("drizzle-orm");
    await db.update(schema.llmKeys).set({ last4: "wxyz" }).where(eq(schema.llmKeys.id, id));
    await listKeyModels(id);
    expect(listModelsForKey).toHaveBeenCalledTimes(2);
  });

  it("says which of the two things went wrong, and caches neither", async () => {
    const owner = await user();
    signIn(owner);
    const id = await key(owner);

    listModelsForKey.mockResolvedValue({ ok: false, reason: "rejected" });
    expect(await listKeyModels(id)).toEqual({
      ok: false,
      error: "Anthropic no longer accepts this key. Replace it under Settings, LLM API keys.",
    });

    listModelsForKey.mockResolvedValue({ ok: false, reason: "unreachable" });
    expect(await listKeyModels(id)).toEqual({ ok: false, error: "Couldn't get the model list from Anthropic just now." });

    listModelsForKey.mockResolvedValue({ ok: true, models: [] });
    expect((await listKeyModels(id)).ok).toBe(true);
    expect(listModelsForKey).toHaveBeenCalledTimes(3);
  });

  it("answers plainly when the key cannot be decrypted, with nothing of it in the answer", async () => {
    const owner = await user();
    signIn(owner);
    const id = await key(owner);
    decryptSecret.mockImplementationOnce(() => {
      throw new Error("bad auth tag");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await listKeyModels(id);

    expect(result).toEqual({ ok: false, error: "Could not read this key. The built-in list is shown instead." });
    expect(listModelsForKey).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("slows a caller who asks twenty times in a minute", async () => {
    const owner = await user();
    signIn(owner);
    const id = await key(owner);

    let refused = 0;
    for (let i = 0; i < 25; i += 1) {
      const result = await listKeyModels(id);
      if (!result.ok) refused += 1;
    }
    expect(refused).toBe(5);
  });
});
