/**
 * Adding and replacing an LLM key: where the plaintext is allowed to end up.
 *
 * The answer is one place, encrypted. These tests add a key and then look for its
 * plaintext everywhere the action writes or answers: the key row, the audit log, and the
 * result that goes back to the browser. They also cover the two fields beside the key
 * that are stored as typed (the label, the workspace id), where a key pasted by mistake
 * must be refused rather than kept in the clear.
 *
 * `getSession` and the provider are stand-ins; the rows and the encryption are real.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { KEY_UNSENDABLE } from "@/lib/agent/providers";
import { setupTestDb } from "@/lib/agent/test-support";
import type { Session } from "@/server/types";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

let session: Session | null = null;
const probeLlmKey = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/agent/key-probe", () => ({ probeLlmKey: (...args: unknown[]) => probeLlmKey(...args) }));
vi.mock("@/lib/agent/anthropic-workspace", () => ({
  needsWorkspaceHeader: async () => false,
  discoverAnthropicWorkspace: async () => ({ kind: "scoped" }),
}));

const { addLlmKey, rotateLlmKey } = await import("./users");
const { decryptSecret } = await import("@/lib/crypto");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
  probeLlmKey.mockReset();
  probeLlmKey.mockResolvedValue("ok");
});

/** A stand-in key, different every time and put together here (see `repo-secrets.test.ts`). */
function fakeKey(prefix = "sk-ant-api03-"): string {
  return `${prefix}${nanoid(40)}${nanoid(40)}`;
}

async function signedInUser(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `u${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`, displayName: null });
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return userId;
}

async function everythingStoredFor(userId: string): Promise<string> {
  const [keys, audit] = await Promise.all([
    db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId)),
    db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, userId)),
  ]);
  return JSON.stringify({ keys, audit });
}

describe("addLlmKey", () => {
  it("keeps the plaintext nowhere: not in a row, not in the audit log, not in its answer", async () => {
    const userId = await signedInUser();
    const key = fakeKey();

    const result = await addLlmKey({ provider: "anthropic", key, label: "main" });

    expect(result.ok).toBe(true);
    // What goes back to the browser: an id and four characters.
    expect(JSON.stringify(result)).not.toContain(key);
    expect(result.ok ? result.data.last4 : null).toBe(key.slice(-4));

    const stored = await everythingStoredFor(userId);
    expect(stored).not.toContain(key);
    // Not a long piece of it either.
    expect(stored).not.toContain(key.slice(0, 24));
    expect(stored).not.toContain(key.slice(-24));

    // And it is there, encrypted, for the run loop to read.
    const [row] = await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId));
    expect(row.last4).toBe(key.slice(-4));
    expect(decryptSecret(row.encryptedKey)).toBe(key);
  });

  it("encrypts the same key differently each time, so two rows cannot be compared", async () => {
    const userId = await signedInUser();
    const key = fakeKey();
    await addLlmKey({ provider: "anthropic", key });
    await addLlmKey({ provider: "anthropic", key });
    const rows = await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows[0].encryptedKey).not.toBe(rows[1].encryptedKey);
  });

  /** The label is stored as typed and shown in Settings and the audit log. */
  it("refuses a key pasted into the label, whole or in part", async () => {
    const userId = await signedInUser();
    const key = fakeKey();

    for (const label of [fakeKey().slice(0, 58), key.slice(0, 40), key.slice(20, 50)]) {
      const result = await addLlmKey({ provider: "anthropic", key, label });
      expect(result).toEqual({
        ok: false,
        error: "Label looks like an API key. A label is only a name; the key itself goes in the key field.",
      });
    }
    expect(await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId))).toEqual([]);
    expect(probeLlmKey).not.toHaveBeenCalled();
  });

  it("takes an ordinary label, even one that happens to sit inside the key", async () => {
    await signedInUser();
    const key = fakeKey();
    for (const label of ["main", "Trading bot (prod)", key.slice(30, 34)]) {
      expect((await addLlmKey({ provider: "anthropic", key, label })).ok, label).toBe(true);
    }
  });

  /** The workspace id is stored as typed and sent as a header on every request. */
  it("refuses anything in the workspace field that is not a workspace id", async () => {
    const userId = await signedInUser();
    const key = fakeKey();

    for (const workspaceId of [fakeKey(), "my workspace", "wrkspc_", "x".repeat(200)]) {
      const result = await addLlmKey({ provider: "anthropic", key, workspaceId });
      expect(result.ok, workspaceId.slice(0, 12)).toBe(false);
      expect(result.ok ? "" : result.error).toMatch(/Workspace ID/);
    }
    expect(await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId))).toEqual([]);

    const good = await addLlmKey({ provider: "anthropic", key, workspaceId: "wrkspc_01AbCdEf" });
    expect(good.ok).toBe(true);
    const [row] = await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId));
    expect(row.workspaceId).toBe("wrkspc_01AbCdEf");
  });

  it("refuses what could not be a key: too long, or with a space or a line break in it", async () => {
    await signedInUser();
    for (const key of ["sk-" + "a1".repeat(300), 12345 as unknown as string]) {
      expect(await addLlmKey({ provider: "anthropic", key })).toEqual({ ok: false, error: "That does not look like an API key" });
    }
    for (const key of [`${fakeKey()} ${fakeKey()}`, `${fakeKey()}\nlabel`]) {
      expect(await addLlmKey({ provider: "anthropic", key })).toEqual({ ok: false, error: KEY_UNSENDABLE });
    }
    expect(probeLlmKey).not.toHaveBeenCalled();
  });

  /** Each add asks the provider about a key the caller supplies; it is not a free checker. */
  it("stops asking providers about keys after ten in a minute", async () => {
    await signedInUser();
    for (let i = 0; i < 10; i += 1) expect((await addLlmKey({ provider: "anthropic", key: fakeKey() })).ok).toBe(true);
    const eleventh = await addLlmKey({ provider: "anthropic", key: fakeKey() });
    expect(eleventh.ok ? "" : eleventh.error).toMatch(/^Slow down/);
    expect(probeLlmKey).toHaveBeenCalledTimes(10);
  });

  it("does nothing for a visitor", async () => {
    expect(await addLlmKey({ provider: "anthropic", key: fakeKey() })).toEqual({ ok: false, error: "Sign in first" });
    expect(probeLlmKey).not.toHaveBeenCalled();
  });
});

describe("rotateLlmKey", () => {
  it("overwrites the old secret and records only the last four of each", async () => {
    const userId = await signedInUser();
    const before = fakeKey();
    const after = fakeKey();
    const added = await addLlmKey({ provider: "anthropic", key: before });
    const id = added.ok ? added.data.id : "";

    const result = await rotateLlmKey({ id, key: after });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(after);
    const stored = await everythingStoredFor(userId);
    for (const secret of [before, after]) {
      expect(stored).not.toContain(secret);
      expect(stored).not.toContain(secret.slice(0, 24));
    }
    const [row] = await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.id, id));
    // No copy of the old one is kept "just in case".
    expect(decryptSecret(row.encryptedKey)).toBe(after);
    expect(row.last4).toBe(after.slice(-4));
  });

  it("will not replace a key that belongs to somebody else", async () => {
    const owner = await signedInUser();
    const original = fakeKey();
    const added = await addLlmKey({ provider: "anthropic", key: original });
    const id = added.ok ? added.data.id : "";

    await signedInUser();
    expect(await rotateLlmKey({ id, key: fakeKey() })).toEqual({ ok: false, error: "Key not found" });

    const [row] = await db.select().from(schema.llmKeys).where(eq(schema.llmKeys.id, id));
    expect(row.userId).toBe(owner);
    expect(decryptSecret(row.encryptedKey)).toBe(original);
  });
});
