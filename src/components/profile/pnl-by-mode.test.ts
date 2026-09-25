import { describe, expect, it } from "vitest";
import { pnlByMode } from "./pnl-by-mode";

describe("pnlByMode", () => {
  it("never adds paper PnL to live PnL", () => {
    const split = pnlByMode([
      { mode: "live", pnlUsd: 120 },
      { mode: "paper", pnlUsd: 297.14 },
      { mode: "live", pnlUsd: -20 },
    ]);
    expect(split).toEqual({ live: 100, paper: 297.14, liveAgents: 2, paperAgents: 1 });
  });

  it("keeps an agent with no PnL yet as null, not zero", () => {
    expect(pnlByMode([{ mode: "live", pnlUsd: null }])).toEqual({
      live: null,
      paper: null,
      liveAgents: 1,
      paperAgents: 0,
    });
  });

  it("is empty for a profile with no agents", () => {
    expect(pnlByMode([])).toEqual({ live: null, paper: null, liveAgents: 0, paperAgents: 0 });
  });
});
