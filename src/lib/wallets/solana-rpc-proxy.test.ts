import { describe, expect, it } from "vitest";
import { ALLOWED_SOLANA_RPC_METHODS, checkSolanaRpcRequest } from "./solana-rpc-proxy";

describe("checkSolanaRpcRequest", () => {
  it("accepts a single allowed request", () => {
    expect(checkSolanaRpcRequest({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [] })).toEqual({
      ok: true,
    });
  });

  it("accepts a batch made only of allowed methods", () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "getBalance", params: ["x"] },
      { jsonrpc: "2.0", id: 2, method: "sendTransaction", params: ["y"] },
    ];
    expect(checkSolanaRpcRequest(batch)).toEqual({ ok: true });
  });

  it("rejects a method that is not on the list, even inside an otherwise fine batch", () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
      { jsonrpc: "2.0", id: 2, method: "requestAirdrop", params: [] },
    ];
    const check = checkSolanaRpcRequest(batch);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("requestAirdrop");
  });

  it("rejects shapes that are not requests", () => {
    expect(checkSolanaRpcRequest(null).ok).toBe(false);
    expect(checkSolanaRpcRequest("getBalance").ok).toBe(false);
    expect(checkSolanaRpcRequest({ jsonrpc: "2.0", id: 1 }).ok).toBe(false);
    expect(checkSolanaRpcRequest([]).ok).toBe(false);
  });

  it("rejects an oversized batch", () => {
    const batch = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "getSlot" }));
    expect(checkSolanaRpcRequest(batch).ok).toBe(false);
  });

  it("never allows the write-ish methods a public proxy must not expose", () => {
    for (const method of ["requestAirdrop", "getProgramAccounts", "getBlock", "getBlocks", "getSupply"]) {
      expect(ALLOWED_SOLANA_RPC_METHODS.has(method)).toBe(false);
    }
  });
});
