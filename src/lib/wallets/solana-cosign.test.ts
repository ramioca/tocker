import { describe, expect, it } from "vitest";
import { platformOutflowLamports } from "./solana-cosign";

describe("platformOutflowLamports", () => {
  it("is what the platform loses, never negative", () => {
    expect(platformOutflowLamports(10_000_000, 7_955_720)).toBe(2_044_280);
    expect(platformOutflowLamports(10_000_000, 12_000_000)).toBe(0);
  });
  it("is unknown when the simulation says nothing about the account", () => {
    expect(platformOutflowLamports(10_000_000, null)).toBeNull();
    expect(platformOutflowLamports(Number.NaN, 1)).toBeNull();
  });
});
