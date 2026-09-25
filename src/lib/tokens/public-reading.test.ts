import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { isPublicReading } from "./index";

const universe = DEFAULT_AGENT_CONFIG.universe;
const maxTradeUsd = DEFAULT_AGENT_CONFIG.risk.maxTradeUsd;

/**
 * Only a public reading may replace the score a token page shows. An agent whose gates
 * match the default still sizes liquidity against its own clip and may fold in paid
 * signals, and either moves the total.
 */
describe("isPublicReading", () => {
  it("accepts the default universe at the default clip with nothing paid", () => {
    expect(isPublicReading({ universe, maxTradeUsd })).toBe(true);
  });

  it("refuses another universe, another clip size, or a paid reading", () => {
    expect(isPublicReading({ universe: { ...universe, minLiquidityUsd: universe.minLiquidityUsd + 1 }, maxTradeUsd })).toBe(false);
    expect(isPublicReading({ universe, maxTradeUsd: maxTradeUsd * 2 })).toBe(false);
    expect(isPublicReading({ universe })).toBe(false);
    expect(isPublicReading({ universe, maxTradeUsd, x402: {} as never })).toBe(false);
  });
});
