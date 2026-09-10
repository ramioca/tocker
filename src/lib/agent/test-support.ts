/**
 * Test-only helpers (imported by `*.test.ts` in this workstream, never by app code).
 *
 * Spins up an in-memory PGlite, pushes the real drizzle schema into it with
 * `drizzle-kit/api`, and injects it as the process-wide database so every module that
 * calls `getDb()` sees it. No Docker, no fixtures directory, no shared state between
 * test files.
 */
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";

interface DbGlobal {
  __vibeDb?: Db;
  __vibeDbPromise?: Promise<Db>;
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
  g.__vibeDb = db;
  g.__vibeDbPromise = Promise.resolve(db);
  return db;
}

export interface SeededAgent {
  userId: string;
  agentId: string;
  slug: string;
}

/** Inserts a user + paper agent + paper wallet placeholders. */
export async function seedAgent(
  db: Db,
  overrides: { config?: Partial<AgentConfig>; mode?: "paper" | "live"; paperStartingUsd?: string } = {},
): Promise<SeededAgent> {
  const userId = `did:privy:${nanoid(8)}`;
  const agentId = nanoid();
  const slug = `test-${nanoid(6)}`;

  await db.insert(schema.users).values({ id: userId, handle: `t${nanoid(6)}`, displayName: "Test" });

  const config: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...overrides.config,
    risk: { ...DEFAULT_AGENT_CONFIG.risk, ...overrides.config?.risk },
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
