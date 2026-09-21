import { describe, expect, it } from "vitest";
import { geckoTerminalUrl } from "./links";

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
