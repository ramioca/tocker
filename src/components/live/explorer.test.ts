import { describe, expect, it } from "vitest";
import { explorerName, explorerTxUrl } from "./explorer";

const SOL_SIG =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const EVM_HASH = `0x${"a".repeat(64)}`;

describe("explorerTxUrl", () => {
  it("links a real Solana signature to Solscan", () => {
    expect(explorerTxUrl("solana", SOL_SIG)).toBe(`https://solscan.io/tx/${SOL_SIG}`);
  });

  it("links a real EVM hash to Basescan", () => {
    expect(explorerTxUrl("base", EVM_HASH)).toBe(`https://basescan.org/tx/${EVM_HASH}`);
  });

  /**
   * A paper fill or a Privy action id is not a chain transaction. Dressing one up
   * as a link sends the operator to a 404 and teaches them to distrust the real one.
   */
  it("refuses anything that is not a chain hash", () => {
    expect(explorerTxUrl("base", null)).toBeNull();
    expect(explorerTxUrl("base", "")).toBeNull();
    expect(explorerTxUrl("base", "0xmocked000withdrawal000hash")).toBeNull();
    expect(explorerTxUrl("solana", "paper_fill_1234")).toBeNull();
    expect(explorerTxUrl("base", "not-a-hash")).toBeNull();
  });

  /** Cross-chain confusion is the expensive kind: a Base hash is not a Solana signature. */
  it("does not accept one chain's hash format for the other", () => {
    expect(explorerTxUrl("solana", EVM_HASH)).toBeNull();
    expect(explorerTxUrl("base", SOL_SIG)).toBeNull();
  });

  it("names the right explorer", () => {
    expect(explorerName("solana")).toBe("Solscan");
    expect(explorerName("base")).toBe("Basescan");
  });
});
