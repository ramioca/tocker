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
import { PROVIDER_UNSUPPORTED } from "@/lib/agent/providers";
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
const { countAgentsKeyFits } = await import("@/server/queries/users");

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

async function keyRow(userId: string, provider: schema.AgentConfig["llm"]["provider"] = "anthropic"): Promise<string> {
  const id = `key_${nanoid(10)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider, encryptedKey: "not-a-real-ciphertext", last4: "0000" });
  return id;
}

/** Sets an agent to think on another provider, as its settings form would. */
async function setProvider(agentId: string, provider: schema.AgentConfig["llm"]["provider"], model: string): Promise<void> {
  const row = await agentRow(agentId);
  await db
    .update(schema.agents)
    .set({ config: { ...row.config, llm: { ...row.config.llm, provider, model } } })
    .where(eq(schema.agents.id, agentId));
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

  /**
   * A run goes to the provider of the key, with the model the agent's config names. An
   * OpenAI key on an agent set to Anthropic would ask OpenAI for a Claude model on every
   * run, so the key is attached only where the agent is set to the key's own provider.
   */
  /** The Security tab's button quotes this count, so it has to be the number the attach then makes true. */
  it("is offered for exactly the agents it will then attach to", async () => {
    const mine = await account();
    await setProvider(mine.alsoKeyless, "openai", "gpt-5");
    const openai = await keyRow(mine.userId, "openai");

    // Three agents: one set to OpenAI with no key, one set to Anthropic, one that pays per use.
    expect(await countAgentsKeyFits(mine.userId, "openai")).toBe(1);
    expect(await countAgentsKeyFits(mine.userId, "anthropic")).toBe(1);
    expect(await countAgentsKeyFits(mine.userId, "openrouter")).toBe(0);
    // A provider that is not offered fits nothing: the attach refuses its keys.
    expect(await countAgentsKeyFits(mine.userId, "not-a-provider")).toBe(0);
    // Someone else's agents are never counted.
    expect(await countAgentsKeyFits("did:privy:nobody", "openai")).toBe(0);

    expect(await attachKeyToKeylessAgents(openai)).toEqual({ ok: true, data: { attached: 1 } });
    expect(await countAgentsKeyFits(mine.userId, "openai")).toBe(0);

    // Under the scripted model nobody is missing a key, so nothing is offered.
    vi.stubEnv("LLM_MOCK", "1");
    expect(await countAgentsKeyFits(mine.userId, "anthropic")).toBe(0);
  });

  it("attaches a key only to agents set to that key's provider", async () => {
    const mine = await account();
    await setProvider(mine.alsoKeyless, "openai", "gpt-5");
    const openai = await keyRow(mine.userId, "openai");

    expect(await attachKeyToKeylessAgents(openai)).toEqual({ ok: true, data: { attached: 1 } });

    expect((await agentRow(mine.alsoKeyless)).llmKeyId).toBe(openai);
    // Set to Anthropic: left without a key rather than given one it could not think on.
    expect((await agentRow(mine.keyless)).llmKeyId).toBeNull();
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, mine.userId));
    expect(audit.map((event) => event.agentId)).toEqual([mine.alsoKeyless]);
    expect(audit[0]?.summary).toContain("Attached the OpenAI key ending 0000");
  });

  it("says why, in words, when none of the agents without a key is set to the key's provider", async () => {
    const mine = await account();
    const openrouter = await keyRow(mine.userId, "openrouter");

    expect(await attachKeyToKeylessAgents(openrouter)).toEqual({
      ok: false,
      error: "None of your agents without a key are set to OpenRouter. Open each one's settings and choose its provider, model and key there.",
    });
    expect((await agentRow(mine.keyless)).llmKeyId).toBeNull();
    expect((await agentRow(mine.alsoKeyless)).llmKeyId).toBeNull();
  });

  it("still answers that it attached nothing when there is no agent without a key at all", async () => {
    const mine = await account();
    const first = await keyRow(mine.userId);
    expect(await attachKeyToKeylessAgents(first)).toEqual({ ok: true, data: { attached: 2 } });
    expect(await attachKeyToKeylessAgents(await keyRow(mine.userId, "openai"))).toEqual({ ok: true, data: { attached: 0 } });
  });

  /** The column is plain text now, so a row can name a provider that has since been dropped. */
  it("refuses a key whose provider is no longer one, and attaches it to nothing", async () => {
    const mine = await account();
    const stale = await keyRow(mine.userId, "cohere" as never);
    expect(await attachKeyToKeylessAgents(stale)).toEqual({ ok: false, error: PROVIDER_UNSUPPORTED });
    expect((await agentRow(mine.keyless)).llmKeyId).toBeNull();
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

  /** The offer is the number the attach would attach: agents set to the new key's provider. */
  it("offers the new key only to agents set to its provider", async () => {
    const mine = await account();
    await setProvider(mine.alsoKeyless, "openai", "gpt-5");

    const openai = await addLlmKey({ provider: "openai", key: `sk-proj-${nanoid(40)}${nanoid(40)}` });
    expect(openai.ok && openai.data.keylessAgents).toBe(1);
    const anthropic = await addLlmKey({ provider: "anthropic", key: fakeKey() });
    expect(anthropic.ok && anthropic.data.keylessAgents).toBe(1);
    const openrouter = await addLlmKey({ provider: "openrouter", key: `sk-or-v1-${nanoid(40)}${nanoid(40)}` });
    expect(openrouter.ok && openrouter.data.keylessAgents).toBe(0);
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
