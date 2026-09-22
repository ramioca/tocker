/**
 * The banner's whole value is that it is right, so the classification and the
 * derivation are tested against the sentences that actually reach them: Anthropic's own
 * billing and workspace errors, `resolveModel`'s missing-key error, and the shape of a
 * tick that proposed nothing.
 *
 * The one end-to-end case is the gate — `getAgentStatus` must answer `[]` for anyone
 * who is not the owner, because a blocker quotes the agent's thresholds.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import {
  classifyRunError,
  deriveStatus,
  describeWindow,
  firstSentence,
  getAgentStatus,
  humanDuration,
  type StatusInputs,
} from "./agent-status";

const NOW = new Date("2026-09-22T17:48:00.000Z");
const MINUTE = 60_000;

function inputs(overrides: Partial<StatusInputs> = {}): StatusInputs {
  return {
    now: NOW,
    slug: "fresh-hunter",
    status: "active",
    mode: "paper",
    hasLlmKey: true,
    maxDailyTrades: 10,
    maxTradeUsd: 2,
    maxAgeHours: null,
    proposals: [],
    portfolio: { cashUsd: 100, tradesToday: 0, cashReadFailed: false },
    lastRun: null,
    recentSucceeded: [],
    platformSolana: null,
    ...overrides,
  };
}

function quietRun(id: string, summary: string | null, tradeCount = 0) {
  return { id, summary, tradeCount };
}

// ------------------------------------------------------------------ formatting

describe("humanDuration", () => {
  it("never says zero, and coarsens as it grows", () => {
    expect(humanDuration(-5)).toBe("now");
    expect(humanDuration(20_000)).toBe("under a minute");
    expect(humanDuration(MINUTE)).toBe("1 minute");
    expect(humanDuration(3 * MINUTE)).toBe("3 minutes");
    expect(humanDuration(60 * MINUTE)).toBe("1 hour");
    expect(humanDuration(372 * MINUTE)).toBe("6h 12m");
    expect(humanDuration(48 * 60 * MINUTE)).toBe("2 days");
  });
});

describe("describeWindow", () => {
  it("names the agent's age ceiling the way an operator would", () => {
    expect(describeWindow(0.25)).toBe("15-minute");
    expect(describeWindow(1)).toBe("1-hour");
    expect(describeWindow(6)).toBe("6-hour");
    expect(describeWindow(168)).toBe("7-day");
  });

  it("is null when there is no ceiling to name", () => {
    expect(describeWindow(null)).toBeNull();
    expect(describeWindow(0)).toBeNull();
  });
});

describe("firstSentence", () => {
  it("takes the finding and leaves the paragraph", () => {
    expect(
      firstSentence(
        "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      ),
    ).toBe("Your credit balance is too low to access the Anthropic API.");
  });

  it("keeps a sentence that has no full stop, and truncates a long one", () => {
    expect(firstSentence("swept 214 candidates, proposed nothing")).toBe(
      "swept 214 candidates, proposed nothing",
    );
    const long = `${"a".repeat(400)}.`;
    expect(firstSentence(long)?.endsWith("…")).toBe(true);
    expect(firstSentence(long)!.length).toBeLessThanOrEqual(180);
  });

  it("is null for nothing at all", () => {
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence("   ")).toBeNull();
  });
});

// ------------------------------------------------------------- classification

describe("classifyRunError", () => {
  it("names an empty Anthropic balance", () => {
    const result = classifyRunError(
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    );
    expect(result).toEqual({
      kind: "anthropic_credits",
      title: "Anthropic credits are out",
      detail: "Your credit balance is too low to access the Anthropic API.",
    });
  });

  it("recognises both workspace phrasings, including the one run.ts has already explained", () => {
    expect(
      classifyRunError(
        "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.",
      )?.kind,
    ).toBe("anthropic_workspace");
    expect(
      classifyRunError(
        "anthropic-workspace-id is required when authenticating with an identity-linked API key",
      )?.kind,
    ).toBe("anthropic_workspace");
    // `explainProviderError` appends a paragraph of advice; the diagnosis must survive it.
    const explained = classifyRunError(
      "anthropic-workspace-id is required when authenticating with an identity-linked API key — This Anthropic key is organization-level and Tocker could not find a workspace it may act in. Under Settings → LLM API keys, add it again with a Workspace ID (Anthropic Console → Settings → Workspaces), or create the key inside a workspace; then select it on the agent.",
    );
    expect(explained?.kind).toBe("anthropic_workspace");
    expect(explained?.title).toBe("This Anthropic key needs a workspace");
  });

  it("recognises both ways a key goes missing", () => {
    expect(
      classifyRunError(
        "This agent has no LLM API key attached. Add one in Settings and re-select it on the agent.",
      ),
    ).toEqual({
      kind: "no_llm_key",
      title: "No LLM key on this agent",
      detail: "This agent has no LLM API key attached.",
    });
    expect(classifyRunError("The LLM API key attached to this agent no longer exists.")?.kind).toBe(
      "no_llm_key",
    );
  });

  it("does not guess at anything else — it quotes it", () => {
    const result = classifyRunError("Jupiter Ultra returned 429. Rate limited, try again later.");
    expect(result).toEqual({
      kind: "unknown",
      title: "The last run failed",
      detail: "Jupiter Ultra returned 429.",
    });
  });

  it("is null when there is no error text", () => {
    expect(classifyRunError(null)).toBeNull();
    expect(classifyRunError("")).toBeNull();
  });
});

// ---------------------------------------------------------------- derivation

describe("deriveStatus", () => {
  it("says nothing about a healthy agent", () => {
    expect(deriveStatus(inputs())).toEqual([]);
  });

  it("is the answer to the fourteen quiet runs: the daily buy limit, with the fix", () => {
    const [item, ...rest] = deriveStatus(
      inputs({ portfolio: { cashUsd: 812.4, tradesToday: 10, cashReadFailed: false } }),
    );
    expect(rest).toEqual([]);
    expect(item.kind).toBe("daily_limit");
    expect(item.severity).toBe("block");
    expect(item.title).toBe("Daily buy limit reached (10 of 10)");
    expect(item.detail).toContain("Resets at 00:00 UTC");
    expect(item.detail).toContain("6h 12m");
    expect(item.action).toEqual({ label: "Raise the limit", href: "/agents/fresh-hunter/settings#risk" });
  });

  it("counts only proposals that are still alive, and leads with the one on the clock", () => {
    const items = deriveStatus(
      inputs({
        proposals: [
          { expiresAt: new Date(NOW.getTime() + 41 * MINUTE) },
          { expiresAt: new Date(NOW.getTime() + 3 * MINUTE) },
          { expiresAt: new Date(NOW.getTime() - MINUTE) }, // already expired: not waiting on anyone
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Waiting on you: 2 proposals, the oldest expires in 3 minutes");
    expect(items[0].severity).toBe("block");
    expect(items[0].action).toEqual({ label: "Review", href: "/notifications" });
  });

  it("counts one proposal as one", () => {
    const items = deriveStatus(
      inputs({ proposals: [{ expiresAt: new Date(NOW.getTime() + 3 * MINUTE) }] }),
    );
    expect(items[0].title).toBe("Waiting on you: 1 proposal, it expires in 3 minutes");
  });

  it("sends an out-of-credit agent to Anthropic and a mystery failure to its run", () => {
    const credits = deriveStatus(
      inputs({
        lastRun: {
          id: "run_1",
          status: "failed",
          error: "Your credit balance is too low to access the Anthropic API.",
          summary: null,
        },
      }),
    )[0];
    expect(credits.kind).toBe("run_failed");
    expect(credits.title).toBe("Anthropic credits are out");
    expect(credits.action).toEqual({
      label: "Top up Anthropic",
      href: "https://platform.claude.com/settings/billing",
    });

    const unknown = deriveStatus(
      inputs({
        lastRun: { id: "run_2", status: "failed", error: "Privy refused to sign.", summary: null },
      }),
    )[0];
    expect(unknown.title).toBe("The last run failed");
    expect(unknown.detail).toBe("Privy refused to sign.");
    expect(unknown.action).toEqual({ label: "Open the run", href: "/agents/fresh-hunter/runs/run_2" });
  });

  it("does not say the same thing twice when the key is the reason the run failed", () => {
    const items = deriveStatus(
      inputs({
        hasLlmKey: false,
        lastRun: {
          id: "run_3",
          status: "failed",
          error: "This agent has no LLM API key attached. Add one in Settings and re-select it on the agent.",
          summary: null,
        },
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["no_llm_key"]);
    expect(items[0].action).toEqual({ label: "Attach a key", href: "/agents/fresh-hunter/settings#brain" });
  });

  it("says nothing about a run that succeeded, or one still going", () => {
    expect(
      deriveStatus(inputs({ lastRun: { id: "r", status: "succeeded", error: null, summary: "Bought WIF." } })),
    ).toEqual([]);
    expect(deriveStatus(inputs({ lastRun: { id: "r", status: "running", error: null, summary: null } }))).toEqual(
      [],
    );
  });

  it("warns that a paused agent is not running, and notes a draft has never run", () => {
    const paused = deriveStatus(inputs({ status: "paused" }))[0];
    expect(paused.severity).toBe("warn");
    expect(paused.title).toBe("Paused — runs are off");
    expect(paused.action).toEqual({ label: "Resume", href: "/agents/fresh-hunter/settings" });

    const draft = deriveStatus(inputs({ status: "draft" }))[0];
    expect(draft.severity).toBe("info");
    expect(draft.kind).toBe("draft");
  });

  it("warns when a live book cannot cover its own clip", () => {
    const item = deriveStatus(
      inputs({ mode: "live", portfolio: { cashUsd: 0.7, tradesToday: 1, cashReadFailed: false } }),
    )[0];
    expect(item.kind).toBe("low_cash");
    expect(item.title).toBe("Cash $0.70 is under the $2 clip");
    expect(item.action).toEqual({ label: "Add funds", href: "/agents/fresh-hunter/settings#wallets" });
  });

  it("floors the clip at a dollar, so a sub-dollar maxTradeUsd still reads sensibly", () => {
    const item = deriveStatus(
      inputs({ mode: "live", maxTradeUsd: 0.5, portfolio: { cashUsd: 0.2, tradesToday: 0, cashReadFailed: false } }),
    )[0];
    expect(item.title).toBe("Cash $0.20 is under the $1 clip");
  });

  it("never claims a paper agent is short of cash, nor guesses when the wallet was unreadable", () => {
    expect(deriveStatus(inputs({ portfolio: { cashUsd: 0.7, tradesToday: 0, cashReadFailed: false } }))).toEqual(
      [],
    );
    expect(
      deriveStatus(inputs({ mode: "live", portfolio: { cashUsd: 0.7, tradesToday: 0, cashReadFailed: true } })),
    ).toEqual([]);
  });

  it("warns on the platform's Solana wallet, with the address to top up", () => {
    const item = deriveStatus(
      inputs({ platformSolana: { address: "7xKXtg2C", sol: 0.004, usdc: 12 } }),
    )[0];
    expect(item.kind).toBe("platform_gas");
    expect(item.severity).toBe("warn");
    expect(item.title).toBe("Tocker's Solana data wallet is nearly empty");
    expect(item.detail).toContain("7xKXtg2C");
    expect(item.detail).toContain("0.004 SOL");
    expect(item.action).toEqual({ label: "Platform wallets", href: "/settings/admin" });
  });

  it("warns on an empty platform USDC balance even when the SOL is fine", () => {
    const item = deriveStatus(inputs({ platformSolana: { address: "7xKXtg2C", sol: 1, usdc: 0.12 } }))[0];
    expect(item.kind).toBe("platform_gas");
    expect(item.detail).toContain("$0.12 USDC");
  });

  it("says nothing about a platform wallet it could not read, or one that is funded", () => {
    expect(deriveStatus(inputs({ platformSolana: { address: "7xKXtg2C", sol: null, usdc: null } }))).toEqual([]);
    expect(deriveStatus(inputs({ platformSolana: { address: "7xKXtg2C", sol: 1.2, usdc: 40 } }))).toEqual([]);
  });

  it("explains three quiet ticks by naming the window that emptied them", () => {
    const item = deriveStatus(
      inputs({
        maxAgeHours: 0.25,
        recentSucceeded: [
          quietRun("run_c", "No launch cleared the 15-minute window. Swept 212 candidates, all older."),
          quietRun("run_b", "Nothing fresh enough."),
          quietRun("run_a", "Nothing fresh enough."),
        ],
      }),
    )[0];
    expect(item.kind).toBe("quiet_window");
    expect(item.severity).toBe("info");
    expect(item.title).toBe("No launch passed the 15-minute window in the last three ticks");
    expect(item.detail).toBe("No launch cleared the 15-minute window.");
    expect(item.action).toEqual({ label: "Open the run", href: "/agents/fresh-hunter/runs/run_c" });
  });

  it("uses the agent's actual window when it is wider, and drops the window when there is none", () => {
    const quiet = [quietRun("run_c", null), quietRun("run_b", null), quietRun("run_a", null)];
    expect(deriveStatus(inputs({ maxAgeHours: 6, recentSucceeded: quiet }))[0].title).toBe(
      "No launch passed the 6-hour window in the last three ticks",
    );
    expect(deriveStatus(inputs({ maxAgeHours: null, recentSucceeded: quiet }))[0].title).toBe(
      "Nothing cleared the bar in the last three ticks",
    );
  });

  it("is not quiet when a tick did something, or when there are not three ticks to judge", () => {
    expect(
      deriveStatus(
        inputs({
          maxAgeHours: 0.25,
          recentSucceeded: [quietRun("c", null), quietRun("b", null, 1), quietRun("a", null)],
        }),
      ),
    ).toEqual([]);
    expect(
      deriveStatus(inputs({ maxAgeHours: 0.25, recentSucceeded: [quietRun("c", null), quietRun("b", null)] })),
    ).toEqual([]);
  });

  it("claims nothing about cash or the limit when the book could not be read", () => {
    const items = deriveStatus(inputs({ mode: "live", portfolio: null, status: "paused" }));
    expect(items.map((i) => i.kind)).toEqual(["paused"]);
  });

  it("orders blocks before warnings before notes, and stops at four", () => {
    const items = deriveStatus(
      inputs({
        status: "paused",
        hasLlmKey: false,
        proposals: [{ expiresAt: new Date(NOW.getTime() + 9 * MINUTE) }],
        portfolio: { cashUsd: 0.4, tradesToday: 12, cashReadFailed: false },
        mode: "live",
        lastRun: { id: "run_9", status: "failed", error: "Privy refused to sign.", summary: null },
        platformSolana: { address: "7xKXtg2C", sol: 0, usdc: 0 },
      }),
    );
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.severity)).toEqual(["block", "block", "block", "block"]);
    expect(items.map((i) => i.kind)).toEqual([
      "pending_proposals",
      "run_failed",
      "no_llm_key",
      "daily_limit",
    ]);
  });
});

// ------------------------------------------------------------------- the gate

describe("getAgentStatus", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 120_000);

  it("tells the owner what is blocking, and tells nobody else anything", async () => {
    const { agentId, userId } = await seedAgent(db);
    // Seeded with no key attached, which is a block the owner should see.
    const mine = await getAgentStatus(agentId, userId);
    expect(mine.map((i) => i.kind)).toContain("no_llm_key");

    expect(await getAgentStatus(agentId, "did:privy:someone-else")).toEqual([]);
    expect(await getAgentStatus(agentId, null)).toEqual([]);
    expect(await getAgentStatus("no-such-agent", userId)).toEqual([]);
  });

  it("reads the agent's own status and limits", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { risk: { maxDailyTrades: 4 } } });
    await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, agentId));

    const items = await getAgentStatus(agentId, userId);
    expect(items.map((i) => i.kind)).toContain("paused");
  });
});
