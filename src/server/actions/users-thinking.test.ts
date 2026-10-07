/**
 * The key actions and an agent that pays for its own thinking.
 *
 * Such an agent has no key on purpose. "Attach this key to my agents without one" must
 * leave it alone: a key put on it would sit unused, and before the mode was explicit it
 * would have sent the agent's pay-per-use model id to the wrong provider. Removing a key
 * must not report it as an agent that lost its brain either.
 *
 * `getSession` and the provider are stand-ins; the rows and the encryption are real.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { DEFAULT_PAY_PER_USE_MODEL } from "@/lib/x402/inference-types";
import type { Session } from "@/server/types";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/agent/key-probe", () => ({ probeLlmKey: async () => "ok" }));
vi.mock("@/lib/agent/anthropic-workspace", () => ({
  needsWorkspaceHeader: async () => false,
  discoverAnthropicWorkspace: async () => ({ kind: "scoped" }),
}));

const { addLlmKey, attachKeyToKeylessAgents, removeLlmKey, rotateLlmKey } = await import("./users");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
  // Outside the scripted model, where a key agent really does need its key.
  vi.stubEnv("LLM_MOCK", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A stand-in key, different every time and put together here (see `repo-secrets.test.ts`). */
const fakeKey = () => `sk-ant-api03-${nanoid(40)}${nanoid(40)}`;

const USDC_LLM = {
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc" as const,
  usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3 },
};

/** One account with three agents: a key agent with no key, one that pays per use, and a second keyless key agent. */
async function account() {
  const keyless = await seedAgent(db);
  const userId = keyless.userId;
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  const own = async (agentId: string) => db.update(schema.agents).set({ ownerId: userId }).where(eq(schema.agents.id, agentId));

  const paying = await seedAgent(db, { config: { chains: ["solana"], llm: USDC_LLM } });
  await own(paying.agentId);
  const alsoKeyless = await seedAgent(db);
  await own(alsoKeyless.agentId);
  return { userId, keyless: keyless.agentId, paying: paying.agentId, alsoKeyless: alsoKeyless.agentId };
}

async function keyRow(userId: string): Promise<string> {
  const id = `key_${nanoid(10)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider: "anthropic", encryptedKey: "not-a-real-ciphertext", last4: "0000" });
  return id;
}

async function agentRow(agentId: string) {
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!row) throw new Error("agent row missing");
  return row;
}

describe("attachKeyToKeylessAgents", () => {
  it("attaches the key to key agents without one, and never to an agent that pays per use", async () => {
    const mine = await account();
    const key = await keyRow(mine.userId);

    expect(await attachKeyToKeylessAgents(key)).toEqual({ ok: true, data: { attached: 2 } });

    expect((await agentRow(mine.keyless)).llmKeyId).toBe(key);
    expect((await agentRow(mine.alsoKeyless)).llmKeyId).toBe(key);
    const paying = await agentRow(mine.paying);
    expect(paying.llmKeyId).toBeNull();
    // Its mode and its limits are as they were.
    expect(paying.config.llm.source).toBe("usdc");
    expect(paying.config.llm.usdc).toEqual(USDC_LLM.usdc);

    // One audit row per agent that got the key, and none naming the one that did not.
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, mine.userId));
    expect(audit.map((event) => event.agentId).sort()).toEqual([mine.keyless, mine.alsoKeyless].sort());
  });

  it("treats a config that says nothing about the mode, or says key, as a key agent", async () => {
    const mine = await account();
    const key = await keyRow(mine.userId);
    // Back on a key, in as many words, with the old limits still in its config.
    await db.update(schema.agents).set({ config: { ...DEFAULT_AGENT_CONFIG, llm: { ...USDC_LLM, source: "key" } } }).where(eq(schema.agents.id, mine.paying));

    expect(await attachKeyToKeylessAgents(key)).toEqual({ ok: true, data: { attached: 3 } });
    expect((await agentRow(mine.paying)).llmKeyId).toBe(key);
  });

  it("leaves an agent that already has a key alone, as before", async () => {
    const mine = await account();
    const first = await keyRow(mine.userId);
    const second = await keyRow(mine.userId);
    await db.update(schema.agents).set({ llmKeyId: first }).where(eq(schema.agents.id, mine.keyless));

    expect(await attachKeyToKeylessAgents(second)).toEqual({ ok: true, data: { attached: 1 } });
    expect((await agentRow(mine.keyless)).llmKeyId).toBe(first);
  });
});

describe("addLlmKey", () => {
  it("offers the new key to the agents that are missing one, not to one that pays per use", async () => {
    const mine = await account();
    const added = await addLlmKey({ provider: "anthropic", key: fakeKey() });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.data.keylessAgents).toBe(2);
    // Adding a key attaches nothing by itself.
    expect((await agentRow(mine.paying)).llmKeyId).toBeNull();
    expect((await agentRow(mine.keyless)).llmKeyId).toBeNull();
  });
});

describe("removeLlmKey", () => {
  it("counts the agents it stops, and not an agent that pays per use and only carried the key's id", async () => {
    const mine = await account();
    const key = await keyRow(mine.userId);
    await db.update(schema.agents).set({ llmKeyId: key }).where(eq(schema.agents.id, mine.keyless));
    // Switched to pay-per-use after the key was attached: the id stayed on its row, unused.
    await db.update(schema.agents).set({ llmKeyId: key }).where(eq(schema.agents.id, mine.paying));

    expect(await removeLlmKey(key)).toEqual({ ok: true, data: { detachedAgents: 1 } });

    // The id is gone from both rows, and the one that pays per use is otherwise untouched.
    expect((await agentRow(mine.keyless)).llmKeyId).toBeNull();
    const paying = await agentRow(mine.paying);
    expect(paying.llmKeyId).toBeNull();
    expect(paying.config.llm.source).toBe("usdc");

    const [event] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, mine.userId));
    expect(event?.summary).toContain("1 agent lost its brain");
  });
});

describe("rotateLlmKey", () => {
  it("counts the agents that think on the key, not one that pays per use", async () => {
    const mine = await account();
    const key = await keyRow(mine.userId);
    await db.update(schema.agents).set({ llmKeyId: key }).where(eq(schema.agents.id, mine.keyless));
    await db.update(schema.agents).set({ llmKeyId: key }).where(eq(schema.agents.id, mine.paying));

    expect((await rotateLlmKey({ id: key, key: fakeKey() })).ok).toBe(true);
    const events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, mine.userId));
    expect(events.find((event) => event.kind === "llm_key_rotated")?.summary).toContain("1 agent kept running");
  });
});
