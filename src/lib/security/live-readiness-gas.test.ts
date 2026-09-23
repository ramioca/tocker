/**
 * The "Network fees" row of the live checklist.
 *
 * The rule under test: network fees are Tocker's, so the person going live sees
 * "Covered by Tocker" — and at worst an amber "topping up" row when the fee wallet is
 * empty and its refuel has not landed. Never red, never an address, never SOL. Admins
 * get the diagnostics and the link.
 */
import { describe, expect, it } from "vitest";
import { MIN_PLATFORM_SOL } from "@/lib/wallets/gas";
import { FEE_WALLET_EMPTY_SOL, gasStep, type GasStepInput } from "./live-readiness";

const ADDRESS = "8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza";

function input(overrides: Partial<GasStepInput> = {}): GasStepInput {
  return {
    chains: ["solana"],
    platform: { sol: 0.05, address: ADDRESS, error: null },
    refuel: { kind: "not-needed" },
    viewerIsAdmin: false,
    ...overrides,
  };
}

/** Nothing a non-admin reads may mention SOL, an address, or send them to the admin page. */
function expectNothingAboutSol(step: ReturnType<typeof gasStep>) {
  expect(step.detail).not.toMatch(/\bSOL\b|lamport/);
  expect(step.detail).not.toContain(ADDRESS);
  expect(step.fix).toBeNull();
  expect(step.state).not.toBe("fail");
}

describe("gasStep", () => {
  it("is 'Covered by Tocker' for a funded fee wallet", () => {
    const step = gasStep(input());
    expect(step.id).toBe("gas");
    expect(step.title).toBe("Network fees");
    expect(step.state).toBe("pass");
    expect(step.detail.startsWith("Covered by Tocker.")).toBe(true);
    expectNothingAboutSol(step);
  });

  it("is 'Covered by Tocker' on a Base-only agent, without reading anything", () => {
    const step = gasStep(input({ chains: ["base"], platform: { sol: null, address: null, error: null } }));
    expect(step.state).toBe("pass");
    expect(step.detail.startsWith("Covered by Tocker.")).toBe(true);
    expect(step.detail).not.toMatch(/\bETH\b/);
  });

  it("stays a pass for the user while the wallet is merely under its refuel floor", () => {
    const sol = (FEE_WALLET_EMPTY_SOL + MIN_PLATFORM_SOL) / 2;
    const step = gasStep(input({ platform: { sol, address: ADDRESS, error: null }, refuel: { kind: "failed", reason: "no price" } }));
    expect(step.state).toBe("pass");
    expectNothingAboutSol(step);
  });

  it("stays a pass for the user when the balance could not be read", () => {
    const step = gasStep(input({ platform: { sol: null, address: ADDRESS, error: "Privy 503" } }));
    expect(step.state).toBe("pass");
    expectNothingAboutSol(step);
    expect(step.detail).not.toContain("Privy");
  });

  it("warns — never fails — when the wallet is empty and its refuel did not land", () => {
    for (const refuel of [{ kind: "failed", reason: "holds 1.00 USDC" }, { kind: "in-flight" }] as const) {
      const step = gasStep(input({ platform: { sol: 0.0001, address: ADDRESS, error: null }, refuel }));
      expect(step.state).toBe("warn");
      expect(step.detail).toBe("Tocker is topping up its fee wallet; trading resumes on its own.");
      expectNothingAboutSol(step);
    }
  });

  it("is a pass again once the refuel has landed", () => {
    const step = gasStep(
      input({ platform: { sol: 0.0001, address: ADDRESS, error: null }, refuel: { kind: "refueled", usdc: 7.5 } }),
    );
    expect(step.state).toBe("pass");
  });

  it("gives an admin the balance, address, refuel status and a link", () => {
    const step = gasStep(
      input({
        viewerIsAdmin: true,
        platform: { sol: 0.0001, address: ADDRESS, error: null },
        refuel: { kind: "failed", reason: "holds 1.00 USDC" },
      }),
    );
    expect(step.state).toBe("warn");
    expect(step.detail).toContain("Tocker is topping up its fee wallet");
    expect(step.detail).toContain("Admin only");
    expect(step.detail).toContain(ADDRESS);
    expect(step.detail).toContain("0.0001 SOL");
    expect(step.detail).toContain("holds 1.00 USDC");
    expect(step.fix).toEqual({ label: "Settings → Admin → Platform wallets", href: "/settings/admin#platform" });
  });

  it("warns an admin early — under the refuel floor, or unreadable — while the user still sees a pass", () => {
    const low = { sol: MIN_PLATFORM_SOL / 2, address: ADDRESS, error: null };
    expect(gasStep(input({ viewerIsAdmin: true, platform: low, refuel: { kind: "failed", reason: "x" } })).state).toBe(
      "warn",
    );
    expect(gasStep(input({ viewerIsAdmin: false, platform: low, refuel: { kind: "failed", reason: "x" } })).state).toBe(
      "pass",
    );
    const unread = gasStep(input({ viewerIsAdmin: true, platform: { sol: null, address: ADDRESS, error: "Privy 503" } }));
    expect(unread.state).toBe("warn");
    expect(unread.detail).toContain("Privy 503");
  });

  it("never fails, for anyone, whatever the wallet holds", () => {
    for (const viewerIsAdmin of [true, false]) {
      for (const sol of [null, 0, 0.0001, FEE_WALLET_EMPTY_SOL, MIN_PLATFORM_SOL, 1]) {
        for (const refuel of [
          { kind: "not-needed" },
          { kind: "in-flight" },
          { kind: "failed", reason: "x" },
          { kind: "refueled", usdc: 1 },
        ] as const) {
          const step = gasStep(input({ viewerIsAdmin, platform: { sol, address: ADDRESS, error: null }, refuel }));
          expect(step.state).not.toBe("fail");
        }
      }
    }
  });

  it("defines 'empty' as unable to sponsor one first funding transfer", () => {
    expect(FEE_WALLET_EMPTY_SOL).toBeGreaterThan(0.002);
    expect(FEE_WALLET_EMPTY_SOL).toBeLessThan(MIN_PLATFORM_SOL);
  });
});
