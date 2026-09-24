import { afterEach, describe, expect, it, vi } from "vitest";
import { getMfaStatus } from "./mfa";

/**
 * `blockedReason` is printed verbatim on every tenant's security page. It used to carry
 * env var names and Privy-dashboard instructions — operator copy, shown to users.
 */
describe("getMfaStatus without Privy configured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("tells the user what it means for them, and keeps the operator detail apart", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    vi.stubEnv("PRIVY_APP_SECRET", "");
    const status = await getMfaStatus("did:privy:someone");

    expect(status.available).toBe(false);
    expect(status.blockedReason).toBe("Two-factor sign-in isn't available on Tocker yet.");
    expect(status.blockedReason).not.toMatch(/PRIVY|dashboard|NEXT_PUBLIC/);
    expect(status.operatorNote).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
  });
});
