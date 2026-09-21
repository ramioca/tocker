import { describe, expect, it } from "vitest";
import { settlementOutcome } from "./settlement";

describe("settlementOutcome", () => {
  it("settles a confirmed transfer with a real signature", () => {
    expect(settlementOutcome({ txHash: "5Uc…9kP", status: "succeeded" })).toEqual({
      settle: true,
      txHash: "5Uc…9kP",
      error: null,
    });
  });

  it("refuses to settle a pending transfer — the money has not moved yet", () => {
    // This is the exact shape Privy returns the instant a transfer is created: a wallet
    // action, `pending`, with no hash. The old code marked the fees collected against it.
    const outcome = settlementOutcome({ txHash: null, status: "pending" });
    expect(outcome.settle).toBe(false);
    expect(outcome.error).toMatch(/pending/);
  });

  it("refuses to settle a failed or rejected transfer", () => {
    expect(settlementOutcome({ txHash: null, status: "failed" }).settle).toBe(false);
    expect(settlementOutcome({ txHash: null, status: "rejected" }).settle).toBe(false);
    // A rejection is what a Privy policy with no explicit `transfer` rule produces.
    expect(settlementOutcome({ txHash: null, status: "rejected" }).error).toMatch(/rejected/);
  });

  it("refuses to settle a succeeded transfer that somehow carries no signature", () => {
    const outcome = settlementOutcome({ txHash: null, status: "succeeded" });
    expect(outcome.settle).toBe(false);
    expect(outcome.error).toMatch(/no signature/);
  });

  it("trusts a caller that reports a hash and no status at all", () => {
    expect(settlementOutcome({ txHash: "0xabc" }).settle).toBe(true);
  });
});
