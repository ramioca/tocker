/**
 * Every `/api/me/*` answer depends on the cookie, so every one of them says
 * `private, no-store`, signed in or not. A handler that sets nothing goes out with the
 * host's default (`public, max-age=0, must-revalidate`); nothing caches that today, but
 * "today" is not what an owner's wallet addresses and balances should rest on.
 *
 * The session and everything that would leave the process (Privy, the chain reads) are
 * mocked; the handlers and their database reads are real, against in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import type { Session } from "@/server/types";

let session: Session | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/wallets", () => ({
  getUserWalletBalances: async () => [],
  syncUserEmbeddedWallets: async () => [],
}));

const me = await import("./route");
const wallets = await import("./wallets/route");
const sync = await import("./sync/route");
const llmKeys = await import("./llm-keys/route");
const proposals = await import("./proposals/route");

let db: Db;
let signedIn: Session;

beforeAll(async () => {
  db = await setupTestDb();
  const userId = `did:privy:${nanoid(8)}`;
  const handle = `u${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await db.insert(schema.users).values({ id: userId, handle });
  signedIn = { userId, handle, displayName: null, avatarUrl: null, email: null };
}, 120_000);

beforeEach(() => {
  session = null;
  vi.unstubAllEnvs();
  // No Privy here, so `/api/me/sync` answers from its "not configured" branch.
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
  vi.stubEnv("PRIVY_APP_SECRET", "");
  vi.stubEnv("MOCK_DATA", "");
});

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ["GET /api/me", () => me.GET()],
  ["GET /api/me/wallets", () => wallets.GET()],
  ["POST /api/me/sync", () => sync.POST()],
  ["GET /api/me/llm-keys", () => llmKeys.GET()],
  ["GET /api/me/proposals", () => proposals.GET()],
];

describe("cache-control on /api/me/*", () => {
  it.each(ROUTES)("%s is private, no-store for a signed-in owner", async (_name, call) => {
    session = signedIn;
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(ROUTES)("%s is private, no-store with no session", async (_name, call) => {
    const res = await call();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
