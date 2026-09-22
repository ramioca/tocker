import { describe, expect, it } from "vitest";
import { planPlatformRefuel } from "./sol";

describe("planPlatformRefuel", () => {
  it("does nothing while the wallet holds enough SOL", () => {
    const plan = planPlatformRefuel({ sol: 0.03, usdc: 7.48, solPriceUsd: 117 });
    expect(plan.refuel).toBe(false);
    expect(plan.reason).toMatch(/above/);
  });

  it("converts up to the target with a cushion, keeping the data reserve", () => {
    // 0.0015 → 0.05 SOL at $117 is $5.67 plus 2% = $5.79; the wallet can spare 7.48 − 2 = 5.48.
    const plan = planPlatformRefuel({ sol: 0.0015, usdc: 7.48, solPriceUsd: 117 });
    expect(plan.refuel).toBe(true);
    expect(plan.usdc).toBeCloseTo(5.48, 2);
  });

  it("spends only what the target needs when USDC is plentiful", () => {
    const plan = planPlatformRefuel({ sol: 0.01, usdc: 100, solPriceUsd: 100 });
    expect(plan.refuel).toBe(true);
    expect(plan.usdc).toBeCloseTo(4.08, 2); // (0.05 − 0.01) × 100 × 1.02
  });

  it("refuses when the spendable USDC is under the minimum, and says what to send", () => {
    const plan = planPlatformRefuel({ sol: 0.001, usdc: 2.5, solPriceUsd: 117 });
    expect(plan.refuel).toBe(false);
    expect(plan.reason).toMatch(/send USDC or SOL/);
  });

  it("refuses without a price or a readable balance", () => {
    expect(planPlatformRefuel({ sol: 0.001, usdc: 10, solPriceUsd: null }).refuel).toBe(false);
    expect(planPlatformRefuel({ sol: null, usdc: 10, solPriceUsd: 117 }).refuel).toBe(false);
    expect(planPlatformRefuel({ sol: 0.001, usdc: null, solPriceUsd: 117 }).refuel).toBe(false);
  });
});
