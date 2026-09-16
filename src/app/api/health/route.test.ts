import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  /**
   * An unconfigured production deploy is the exact case this endpoint exists for, so
   * it must answer with a readable body rather than throwing on the way out.
   */
  it("reports 503 with a reason when production has no DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.database).toBe("unreachable");
    expect(body.embedded).toBe(false);
    expect(body.error).toMatch(/DATABASE_URL/);
  });

  /**
   * The readiness report is public, so the rule is: booleans only. A regression
   * that leaked a value here would be invisible in the UI and catastrophic.
   */
  it("reports live readiness as booleans and never echoes a secret", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(64));
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "wallet-auth:sensitive");

    const body = await (await GET()).json();
    const serialized = JSON.stringify(body);

    for (const value of Object.values(body.live)) {
      expect(["boolean", "object"]).toContain(typeof value);
    }
    expect(body.live.cronSecret).toBe(true);
    expect(body.live.encryptionKey).toBe(true);
    expect(body.live.walletAuthorizationKey).toBe(true);

    expect(serialized).not.toContain("sensitive");
    expect(serialized).not.toContain("s".repeat(20));
  });

  it("refuses to call a short CRON_SECRET configured", async () => {
    vi.stubEnv("CRON_SECRET", "test");
    const body = await (await GET()).json();
    expect(body.live.cronSecret).toBe(false);
    expect(body.live.blockers).toContain("cronSecret");
  });

  /** A deploy still on fixtures must never report itself ready to trade real money. */
  it("is not live-ready while the x402 and LLM mocks are on", async () => {
    vi.stubEnv("X402_MOCK", "1");
    vi.stubEnv("LLM_MOCK", "1");
    const body = await (await GET()).json();
    expect(body.live.ready).toBe(false);
    expect(body.live.blockers).toEqual(expect.arrayContaining(["dataPaid", "realModel"]));
  });

  it("treats DEV_IMPERSONATE_USER_ID as a live blocker", async () => {
    vi.stubEnv("DEV_IMPERSONATE_USER_ID", "did:privy:seed-you");
    const body = await (await GET()).json();
    expect(body.impersonation).toBe(true);
    expect(body.live.blockers).toContain("noImpersonation");
  });
});
