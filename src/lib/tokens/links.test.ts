import { describe, expect, it } from "vitest";
import { geckoTerminalUrl, isTrustedExplorerUrl, txExplorerUrl } from "./links";

describe("geckoTerminalUrl", () => {
  it("routes each chain to its GeckoTerminal network", () => {
    expect(geckoTerminalUrl("solana", "DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP")).toBe(
      "https://www.geckoterminal.com/solana/tokens/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP",
    );
    expect(geckoTerminalUrl("base", "0xabc")).toBe("https://www.geckoterminal.com/base/tokens/0xabc");
  });
  it("charts the wrapped native asset for a native balance", () => {
    expect(geckoTerminalUrl("base", "native")).toContain("0x4200000000000000000000000000000000000006");
    expect(geckoTerminalUrl("solana", "NATIVE")).toContain("So11111111111111111111111111111111111111112");
  });
});

describe("txExplorerUrl", () => {
  it("links each chain to its explorer", () => {
    expect(txExplorerUrl("solana", "5sig")).toBe("https://solscan.io/tx/5sig");
    expect(txExplorerUrl("base", "0xhash")).toBe("https://basescan.org/tx/0xhash");
  });
  it("encodes the hash so it cannot steer the path", () => {
    expect(txExplorerUrl("solana", "../account/x?y#z")).toBe("https://solscan.io/tx/..%2Faccount%2Fx%3Fy%23z");
  });
  it("is null without a hash", () => {
    expect(txExplorerUrl("base", null)).toBeNull();
    expect(txExplorerUrl("base", "")).toBeNull();
  });
});

describe("isTrustedExplorerUrl", () => {
  it("accepts our own explorer links", () => {
    expect(isTrustedExplorerUrl(txExplorerUrl("solana", "abc"))).toBe(true);
    expect(isTrustedExplorerUrl(txExplorerUrl("base", "0xabc"))).toBe(true);
  });
  it("refuses anything else, however it is dressed", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://solscan.io.evil.com/tx/abc",
      "http://solscan.io/tx/abc",
      "https://evil.com/?https://solscan.io/tx/",
      "",
      null,
      undefined,
    ]) {
      expect(isTrustedExplorerUrl(url)).toBe(false);
    }
  });
});
