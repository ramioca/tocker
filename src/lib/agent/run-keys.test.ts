/**
 * The run loop and the key it thinks on.
 *
 * Two things only the run loop can get wrong: using a key that is not the agent owner's,
 * and keeping what a provider said when it refused one. A provider's 401 echoes the key
 * (half masked), and that sentence becomes the run's error, a transcript step and a
 * notification. This fails a real run on a refused key and looks for the key in all three.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { resolveModel, runAgent } from "./run";
import { seedAgent, setupTestDb } from "./test-support";

let db: Db;
const before = { llm: process.env.LLM_MOCK, x402: process.env.X402_MOCK, key: process.env.ENCRYPTION_KEY };

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  // The real provider path: the model is built from the stored key.
  process.env.LLM_MOCK = "0";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

afterAll(() => {
  for (const [name, value] of [
    ["LLM_MOCK", before.llm],
    ["X402_MOCK", before.x402],
    ["ENCRYPTION_KEY", before.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** Stand-ins put together at run time (see `repo-secrets.test.ts`). */
const plaintext = () => `sk-proj-${nanoid(40)}${nanoid(40)}`;
const masked = (key: string) => `${key.slice(0, 12)}${"*".repeat(40)}${key.slice(-4)}`;

async function attachKey(userId: string, agentId: string, key: string): Promise<string> {
  const id = `key_${nanoid(8)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider: "openai", encryptedKey: encryptSecret(key), last4: key.slice(-4) });
  await db
    .update(schema.agents)
    .set({ llmKeyId: id, config: { ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, provider: "openai", model: "gpt-5" } } })
    .where(eq(schema.agents.id, agentId));
  return id;
}

describe("resolveModel", () => {
  it("builds the model from the owner's own key", async () => {
    const { userId, agentId } = await seedAgent(db);
    const llmKeyId = await attachKey(userId, agentId, plaintext());
    const model = await resolveModel({ ownerId: userId, llmKeyId, config: DEFAULT_AGENT_CONFIG });
    expect(typeof model === "string" ? model : model.modelId).toBe(DEFAULT_AGENT_CONFIG.llm.model);
  });

  /** Attaching a key checks whose it is. This is the same check at the moment of use. */
  it("will not think on a key that belongs to another account", async () => {
    const owner = await seedAgent(db);
    const llmKeyId = await attachKey(owner.userId, owner.agentId, plaintext());
    const other = await seedAgent(db);

    await expect(resolveModel({ ownerId: other.userId, llmKeyId, config: DEFAULT_AGENT_CONFIG })).rejects.toThrow(
      "The LLM API key attached to this agent no longer exists.",
    );
  });
});

describe("a run the provider refuses", () => {
  it("stores, shows and notifies the reason without the key the provider echoed", async () => {
    const { userId, agentId } = await seedAgent(db);
    const key = plaintext();
    await attachKey(userId, agentId, key);

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input instanceof Request ? input.url : input).includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            error: {
              message: `Incorrect API key provided: ${masked(key)}. You can find your API key at https://platform.openai.com/account/api-keys.`,
              type: "invalid_request_error",
              param: null,
              code: "invalid_api_key",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    let result;
    try {
      result = await runAgent({ agentId, trigger: "manual" });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(result.status).toBe("failed");
    // The sentence survives, so the owner knows what to fix.
    expect(result.error).toContain("Incorrect API key provided: [redacted]");

    const [runs, steps, notices] = await Promise.all([
      db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, result.runId)),
      db.select().from(schema.agentRunSteps).where(eq(schema.agentRunSteps.runId, result.runId)),
      db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
    ]);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("[redacted]");
    expect(notices.some((notice) => notice.kind === "run_failed")).toBe(true);

    const everything = JSON.stringify({ result, runs, steps, notices });
    for (const piece of [key, masked(key), key.slice(0, 12), key.slice(-12)]) {
      expect(everything).not.toContain(piece);
    }
  });
});
