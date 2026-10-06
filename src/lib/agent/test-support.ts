/**
 * Test-only helpers (imported by `*.test.ts` in this workstream, never by app code).
 *
 * Spins up an in-memory PGlite, pushes the real drizzle schema into it with
 * `drizzle-kit/api`, and injects it as the process-wide database so every module that
 * calls `getDb()` sees it. No Docker, no fixtures directory, no shared state between
 * test files.
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";

interface DbGlobal {
  __tockerDb?: Db;
  __tockerDbPromise?: Promise<Db>;
}

/** Creates a fresh in-memory database with the full schema and installs it globally. */
export async function setupTestDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { pushSchema } = await import("drizzle-kit/api");

  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const { apply } = await pushSchema(schema as unknown as Record<string, unknown>, db as never);
  await apply();

  const g = globalThis as unknown as DbGlobal;
  g.__tockerDb = db;
  g.__tockerDbPromise = Promise.resolve(db);
  return db;
}

export interface SeededAgent {
  userId: string;
  agentId: string;
  slug: string;
}

/**
 * Config overrides for a seeded agent. `risk` is accepted partially — it is merged onto
 * the defaults below, which is what a test that only cares about one stop loss wants.
 */
export type SeedConfigOverrides = Partial<Omit<AgentConfig, "risk">> & {
  risk?: Partial<AgentConfig["risk"]>;
};

/** Inserts a user + paper agent + paper wallet placeholders. */
export async function seedAgent(
  db: Db,
  overrides: { config?: SeedConfigOverrides; mode?: "paper" | "live"; paperStartingUsd?: string } = {},
): Promise<SeededAgent> {
  const userId = `did:privy:${nanoid(8)}`;
  const agentId = nanoid();
  const slug = `test-${nanoid(6)}`;

  await db.insert(schema.users).values({ id: userId, handle: `t${nanoid(6)}`, displayName: "Test" });

  const config: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...overrides.config,
    risk: { ...DEFAULT_AGENT_CONFIG.risk, ...overrides.config?.risk },
    // The product default is `approve` (a new operator opts into autonomous trading),
    // but a seeded test agent trades unless the test says otherwise: most of the suite
    // exercises the fill path, and the approval tests pass `execution` explicitly.
    execution: overrides.config?.execution ?? { ...DEFAULT_AGENT_CONFIG.execution, mode: "auto" },
  };

  await db.insert(schema.agents).values({
    id: agentId,
    ownerId: userId,
    slug,
    name: "Test Agent",
    mode: overrides.mode ?? "paper",
    status: "active",
    isPublic: true,
    config,
    paperStartingUsd: overrides.paperStartingUsd ?? "10000",
  });

  for (const chain of ["solana", "base"] as const) {
    await db.insert(schema.wallets).values({
      id: `paper_${agentId}_${chain}`,
      kind: "agent_server",
      chain,
      address: chain === "solana" ? `PaperSol${agentId.slice(0, 10)}` : `0xpaper${agentId.slice(0, 10)}`,
      userId,
      agentId,
    });
  }

  return { userId, agentId, slug };
}

/**
 * Gives a seeded agent an LLM key row. Seeded agents have none, which is what most of
 * the suite wants (`LLM_MOCK=1` thinks without one); the scheduler only wakes an agent
 * that has one. The ciphertext is not a key and is never decrypted by these tests.
 */
export async function attachLlmKey(db: Db, agent: { userId: string; agentId: string }): Promise<string> {
  const keyId = `key_${nanoid(10)}`;
  await db.insert(schema.llmKeys).values({
    id: keyId,
    userId: agent.userId,
    provider: "anthropic",
    encryptedKey: "not-a-real-ciphertext",
    last4: "0000",
  });
  await db.update(schema.agents).set({ llmKeyId: keyId }).where(eq(schema.agents.id, agent.agentId));
  return keyId;
}
