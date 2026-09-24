import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const SECRET = "s".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

function anonymous(): Promise<Response> {
  return GET(new Request("http://localhost/api/health"));
}

/** The operator's view: the same bearer the cron routes take. */
function operator(secret = SECRET): Promise<Response> {
  vi.stubEnv("CRON_SECRET", SECRET);
  return GET(new Request("http://localhost/api/health", { headers: { authorization: `Bearer ${secret}` } }));
}

describe("GET /api/health", () => {
  /**
   * An unconfigured production deploy is the exact case this endpoint exists for, so
   * it must answer with a readable body rather than throwing on the way out.
   */
  it("reports 503 with a reason when production has no DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    const res = await anonymous();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.database).toBe("unreachable");
    expect(body.embedded).toBe(false);
    // Fixed text in public: the driver's own message can name hosts and users.
    expect(body.error).toBe("database unreachable");
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL/);
  });

  it("gives the operator the database's own error text", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const body = await (await operator()).json();
    expect(body.error).toBe("database unreachable");
    expect(body.detail).toMatch(/DATABASE_URL/);
  });

  /** Which protections are off on this deploy is reconnaissance, not health. */
  it("shows only liveness to an anonymous or wrongly-authorized caller", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const res of [await anonymous(), await operator("x".repeat(64))]) {
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(
        expect.arrayContaining(["database", "embedded", "ms", "ok"]),
      );
      expect(body).not.toHaveProperty("live");
      expect(body).not.toHaveProperty("mocks");
      expect(body).not.toHaveProperty("impersonation");
      expect(body).not.toHaveProperty("privyConfigured");
    }
  });

  /**
   * The readiness report is public, so the rule is: booleans only. A regression
   * that leaked a value here would be invisible in the UI and catastrophic.
   */
  it("reports live readiness as booleans and never echoes a secret", async () => {
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "wallet-auth:sensitive");

    const body = await (await operator()).json();
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

  /** A short secret cannot authorize the operator view, so the report is never reachable with one. */
  it("refuses the operator view when CRON_SECRET is too short", async () => {
    vi.stubEnv("CRON_SECRET", "test");
    const body = await (
      await GET(new Request("http://localhost/api/health", { headers: { authorization: "Bearer test" } }))
    ).json();
    expect(body).not.toHaveProperty("live");
  });

  /** A deploy still on fixtures must never report itself ready to trade real money. */
  it("is not live-ready while the x402 and LLM mocks are on", async () => {
    vi.stubEnv("X402_MOCK", "1");
    vi.stubEnv("LLM_MOCK", "1");
    const body = await (await operator()).json();
    expect(body.live.ready).toBe(false);
    expect(body.live.blockers).toEqual(expect.arrayContaining(["dataPaid", "realModel"]));
  });

  it("treats DEV_IMPERSONATE_USER_ID as a live blocker", async () => {
    vi.stubEnv("DEV_IMPERSONATE_USER_ID", "did:privy:seed-you");
    const body = await (await operator()).json();
    expect(body.impersonation).toBe(true);
    expect(body.live.blockers).toContain("noImpersonation");
  });
});
