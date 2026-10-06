import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queryKeysStaleAfterRun } from "./run-settled";

const components = join(process.cwd(), "src", "components");

describe("queryKeysStaleAfterRun", () => {
  it("names the agent's runs, trades and balance, and the user's cash", () => {
    expect(queryKeysStaleAfterRun("agent_1")).toEqual([
      ["agent-runs", "agent_1"],
      ["agent-trades", "agent_1"],
      ["wallet-balances", "agent_1"],
      ["me-wallets"],
    ]);
  });

  it("uses the keys the Runs and Trades tabs actually query under", () => {
    // Read from the components: a key renamed there would otherwise leave "Run now"
    // finishing over a stale tab again, with every check still green.
    const runs = readFileSync(join(components, "agents", "runs-timeline.tsx"), "utf8");
    const trades = readFileSync(join(components, "agents", "trades-table.tsx"), "utf8");
    expect(runs).toContain('queryKey: ["agent-runs", agentId]');
    expect(trades).toContain('queryKey: ["agent-trades", agentId]');
  });

  it("is what the run provider invalidates when a watched run settles", () => {
    const provider = readFileSync(join(components, "providers", "run-status.tsx"), "utf8");
    expect(provider).toContain("queryKeysStaleAfterRun(");
    // The server-rendered half of the page: last run, counts, equity, positions.
    expect(provider).toContain("router.refresh()");
  });
});
