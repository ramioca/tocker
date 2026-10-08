/**
 * The banner's whole value is that it is right, so the classification and the
 * derivation are tested against the sentences that actually reach them: Anthropic's own
 * billing and workspace errors, `resolveModel`'s missing-key error, and the shape of a
 * tick that proposed nothing.
 *
 * The one end-to-end case is the gate — `getAgentStatus` must answer `[]` for anyone
 * who is not the owner, because a blocker quotes the agent's thresholds.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { holdUntil } from "@/lib/x402/inference-budget";
import { INFERENCE_STOPS, describeInferenceStop, type InferenceStopReason } from "@/lib/x402/inference-types";
import { stopFix } from "@/components/agents/thinking";
import type { Portfolio } from "@/lib/agent/portfolio";
import type { NoRoom } from "@/lib/agent/skip-full";
import { tokenId } from "@/lib/trading/tokens";
import {
  classifyRunError,
  deriveStatus,
  describeWindow,
  firstSentence,
  getAgentStatus,
  getSkippingRunsLine,
  holdItem,
  humanDuration,
  skippedRunsFor,
  type StatusInputs,
  type StatusThinking,
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
    provider: "anthropic",
    maxDailyTrades: 10,
    maxTradeUsd: 2,
    maxAgeHours: null,
    proposals: [],
    portfolio: { cashUsd: 100, tradesToday: 0, cashReadFailed: false },
    lastRun: null,
    recentSucceeded: [],
    platformSolana: null,
    viewerIsAdmin: false,
    ...overrides,
  };
}

function quietRun(
  id: string,
  digest: string | null,
  tradeCount = 0,
  refusals: Array<{ label: string; count: number }> = [],
) {
  return { id, digest, tradeCount, refusals };
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
      "anthropic",
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
        "anthropic",
      )?.kind,
    ).toBe("anthropic_workspace");
    expect(
      classifyRunError(
        "anthropic-workspace-id is required when authenticating with an identity-linked API key",
        "anthropic",
      )?.kind,
    ).toBe("anthropic_workspace");
    // `explainProviderError` appends a paragraph of advice; the diagnosis must survive it.
    const explained = classifyRunError(
      "anthropic-workspace-id is required when authenticating with an identity-linked API key — This Anthropic key is organization-level and Tocker could not find a workspace it may act in. Under Settings → LLM API keys, add it again with a Workspace ID (Anthropic Console → Settings → Workspaces), or create the key inside a workspace; then select it on the agent.",
      "anthropic",
    );
    expect(explained?.kind).toBe("anthropic_workspace");
    expect(explained?.title).toBe("This Anthropic key needs a workspace");
  });

  it("recognises both ways a key goes missing", () => {
    expect(
      classifyRunError(
        "This agent has no LLM API key attached. Add one in Settings and re-select it on the agent.",
        "anthropic",
      ),
    ).toEqual({
      kind: "no_llm_key",
      title: "No LLM key on this agent",
      detail: "This agent has no LLM API key attached.",
    });
    expect(classifyRunError("The LLM API key attached to this agent no longer exists.", "anthropic")?.kind).toBe(
      "no_llm_key",
    );
    // A missing key is nobody's billing problem: it is named on every provider.
    expect(classifyRunError("The LLM API key attached to this agent no longer exists.", "groq")?.kind).toBe(
      "no_llm_key",
    );
  });

  it("does not tell an agent on another provider about Anthropic", () => {
    // The sentences these providers send for an empty balance carry the same two words.
    const openai = classifyRunError(
      "Your credit balance is too low. Add credits on the billing page to keep using the API.",
      "openai",
    );
    expect(openai).toEqual({
      kind: "unknown",
      title: "The last run failed",
      detail: "Your credit balance is too low.",
    });
    expect(classifyRunError("Insufficient credit balance. Please top up.", "deepseek")?.kind).toBe("unknown");
    // Nor about a workspace, which only Anthropic keys have.
    expect(
      classifyRunError(
        "anthropic-workspace-id is required when authenticating with an identity-linked API key",
        "openrouter",
      )?.kind,
    ).toBe("unknown");
    // No provider at all (an agent that pays per use) is not Anthropic either.
    expect(classifyRunError("Your credit balance is too low.", null)?.kind).toBe("unknown");
  });

  it("does not guess at anything else — it quotes it", () => {
    const result = classifyRunError("Jupiter Ultra returned 429. Rate limited, try again later.", "anthropic");
    expect(result).toEqual({
      kind: "unknown",
      title: "The last run failed",
      detail: "Jupiter Ultra returned 429.",
    });
  });

  it("is null when there is no error text", () => {
    expect(classifyRunError(null, "anthropic")).toBeNull();
    expect(classifyRunError("", "anthropic")).toBeNull();
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
    expect(item.action).toEqual({ label: "Raise the limit", href: "/agents/fresh-hunter/settings?step=limits#risk" });
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

    // The same sentence on an agent set to another provider: its own words, and its run.
    for (const provider of ["openai", "deepseek"]) {
      const other = deriveStatus(
        inputs({
          provider,
          lastRun: { id: "run_9", status: "failed", error: "Your credit balance is too low.", summary: null },
        }),
      )[0];
      expect(other.kind).toBe("run_failed");
      expect(other.title).toBe("The last run failed");
      expect(other.detail).toBe("Your credit balance is too low.");
      expect(other.action).toEqual({ label: "Open the run", href: "/agents/fresh-hunter/runs/run_9" });
      expect(JSON.stringify(other)).not.toMatch(/anthropic/i);
    }

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
    expect(items[0].action).toEqual({ label: "Attach a key", href: "/agents/fresh-hunter/settings?step=brain#brain" });
  });

  it("sends a run that failed on its key to where the key is chosen", () => {
    const failedOn = (error: string) =>
      deriveStatus(inputs({ lastRun: { id: "run_5", status: "failed", error, summary: null } }))[0];

    const workspace = failedOn("anthropic-workspace-id is required when authenticating with an identity-linked API key");
    expect(workspace.action).toEqual({ label: "Fix the key", href: "/agents/fresh-hunter/settings?step=brain#brain" });

    // A key is attached and the run still found none, so the failed-run row carries the fix.
    const noKey = failedOn("The key attached to this agent no longer exists.");
    expect(noKey.kind).toBe("run_failed");
    expect(noKey.action).toEqual({ label: "Attach a key", href: "/agents/fresh-hunter/settings?step=brain#brain" });
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
    expect(paused.action).toEqual({ label: "Resume", href: "/agents/fresh-hunter/settings?step=name#status" });

    const draft = deriveStatus(inputs({ status: "draft" }))[0];
    expect(draft.severity).toBe("info");
    expect(draft.kind).toBe("draft");
    expect(draft.action).toEqual({ label: "Activate", href: "/agents/fresh-hunter/settings?step=name#status" });
  });

  it("warns when a live book cannot cover its own clip", () => {
    const item = deriveStatus(
      inputs({ mode: "live", portfolio: { cashUsd: 0.7, tradesToday: 1, cashReadFailed: false } }),
    )[0];
    expect(item.kind).toBe("low_cash");
    expect(item.title).toBe("Cash $0.70 is under the $2 clip");
    expect(item.action).toEqual({ label: "Add funds", href: "/agents/fresh-hunter/settings?step=manage#wallets" });
  });

  /**
   * With a cash reserve, buying stops at the reserve. Compared with all of its cash, an
   * agent whose reserve is as large as its clip could never show this row: it ran, bought
   * nothing, and the only thing said was that nothing had cleared the bar.
   */
  it("measures a live book with a cash reserve by the cash above the reserve", () => {
    // The owner's agent after three $5 buys from $20: $5.005 left, all of it the reserve.
    const [item] = deriveStatus(
      inputs({ mode: "live", maxTradeUsd: 5, portfolio: { cashUsd: 5.005, tradesToday: 3, cashReadFailed: false, reserveUsd: 5 } }),
    );
    expect(item).toEqual({
      kind: "low_cash",
      severity: "warn",
      title: "Cash to trade $0.01 (after the $5 reserve) is under the $5 clip",
      detail: "A buy that size is refused until you add funds or lower Cash reserve in Settings. Exits still work.",
      action: { label: "Add funds", href: "/agents/fresh-hunter/settings?step=manage#wallets" },
    });
    // Cash under the reserve is nothing to trade, never a negative figure.
    const under = deriveStatus(
      inputs({ mode: "live", maxTradeUsd: 5, portfolio: { cashUsd: 3.2, tradesToday: 0, cashReadFailed: false, reserveUsd: 5 } }),
    )[0];
    expect(under.title).toBe("Cash to trade $0 (after the $5 reserve) is under the $5 clip");
    // A clip's worth above the reserve, and nothing is said.
    expect(
      deriveStatus(inputs({ mode: "live", maxTradeUsd: 5, portfolio: { cashUsd: 10, tradesToday: 0, cashReadFailed: false, reserveUsd: 5 } })),
    ).toEqual([]);
  });

  it("is the row it always was for an agent with no reserve, absent or written as zero", () => {
    const plain = deriveStatus(inputs({ mode: "live", portfolio: { cashUsd: 0.7, tradesToday: 1, cashReadFailed: false } }));
    const zero = deriveStatus(
      inputs({ mode: "live", portfolio: { cashUsd: 0.7, tradesToday: 1, cashReadFailed: false, reserveUsd: 0 } }),
    );
    expect(zero).toEqual(plain);
    expect(plain[0]).toMatchObject({
      title: "Cash $0.70 is under the $2 clip",
      detail: "Every buy is refused for want of cash until the wallet is topped up. Exits still work.",
    });
    // Cash that covers the clip says nothing, with or without the field.
    expect(deriveStatus(inputs({ mode: "live", portfolio: { cashUsd: 5.005, tradesToday: 3, cashReadFailed: false } }))).toEqual([]);
  });

  it("says nothing about a reserve on paper, or when the wallet was unreadable", () => {
    expect(deriveStatus(inputs({ portfolio: { cashUsd: 5.005, tradesToday: 0, cashReadFailed: false, reserveUsd: 5 } }))).toEqual([]);
    expect(
      deriveStatus(inputs({ mode: "live", portfolio: { cashUsd: 0, tradesToday: 0, cashReadFailed: true, reserveUsd: 5 } })),
    ).toEqual([]);
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

  it("warns an admin about the platform's Solana wallet, with the address to top up", () => {
    const item = deriveStatus(
      inputs({ viewerIsAdmin: true, platformSolana: { address: "7xKXtg2C", sol: 0.004, usdc: 12 } }),
    )[0];
    expect(item.kind).toBe("platform_gas");
    expect(item.severity).toBe("warn");
    expect(item.title).toBe("Tocker's Solana fee wallet is running low");
    expect(item.detail).toContain("Admin only");
    expect(item.detail).toContain("7xKXtg2C");
    expect(item.detail).toContain("0.004 SOL");
    expect(item.action).toEqual({ label: "Platform wallets", href: "/settings/admin#platform" });
  });

  it("warns an admin on an empty platform USDC balance even when the SOL is fine", () => {
    const item = deriveStatus(
      inputs({ viewerIsAdmin: true, platformSolana: { address: "7xKXtg2C", sol: 1, usdc: 0.12 } }),
    )[0];
    expect(item.kind).toBe("platform_gas");
    expect(item.detail).toContain("$0.12 USDC");
  });

  it("never shows an owner who is not an admin a row about Tocker's wallet, however empty", () => {
    expect(deriveStatus(inputs({ platformSolana: { address: "7xKXtg2C", sol: 0, usdc: 0 } }))).toEqual([]);
    expect(
      deriveStatus(inputs({ viewerIsAdmin: false, platformSolana: { address: "7xKXtg2C", sol: 0.0001, usdc: 12 } })),
    ).toEqual([]);
  });

  it("says nothing, even to an admin, about a platform wallet it could not read, or one that is funded", () => {
    expect(
      deriveStatus(inputs({ viewerIsAdmin: true, platformSolana: { address: "7xKXtg2C", sol: null, usdc: null } })),
    ).toEqual([]);
    expect(
      deriveStatus(inputs({ viewerIsAdmin: true, platformSolana: { address: "7xKXtg2C", sol: 1.2, usdc: 40 } })),
    ).toEqual([]);
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

  it("says the buys were refused, not that nothing cleared the bar, when the risk guard said no", () => {
    const items = deriveStatus(
      inputs({
        maxAgeHours: null,
        recentSucceeded: [
          quietRun("run_c", "Scored 1 token — BONK 86. Made no trade and 1 refusal (chain not enabled).", 0, [
            { label: "chain not enabled", count: 1 },
          ]),
          quietRun("run_b", null, 0, [{ label: "chain not enabled", count: 1 }]),
          quietRun("run_a", null, 0, [{ label: "already proposed", count: 4 }]),
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      kind: "buys_refused",
      severity: "warn",
      title: "Its buys were refused",
      detail: "The token's chain is not enabled for this agent. 2 orders were turned down in the last three ticks.",
      action: { label: "Settings", href: "/agents/fresh-hunter/settings?step=hunts#universe" },
    });
  });

  it("sends a refusal no setting fixes to the run, and ignores the approval flow's own refusals", () => {
    const refusedByQuote = deriveStatus(
      inputs({
        maxAgeHours: null,
        recentSucceeded: [
          quietRun("run_c", null),
          quietRun("run_b", null, 0, [{ label: "bad quote", count: 1 }]),
          quietRun("run_a", null),
        ],
      }),
    )[0];
    expect(refusedByQuote.kind).toBe("buys_refused");
    expect(refusedByQuote.action).toEqual({ label: "Open the run", href: "/agents/fresh-hunter/runs/run_b" });

    const onlyProposals = deriveStatus(
      inputs({
        maxAgeHours: null,
        recentSucceeded: [quietRun("c", null, 0, [{ label: "already proposed", count: 2 }]), quietRun("b", null), quietRun("a", null)],
      }),
    )[0];
    expect(onlyProposals.kind).toBe("quiet_window");
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

// --------------------------------------------------------------- pay per use

/**
 * An agent that pays for its own thinking has no key on purpose, and what stops it is a
 * hold, not a failure. Every reason a hold can carry is rendered here, because the row
 * is the only place its owner is told what to do about it.
 */
describe("deriveStatus for an agent that pays for its own thinking", () => {
  const REASONS = Object.keys(INFERENCE_STOPS) as InferenceStopReason[];
  const CONTEXT = { runCapUsd: 0.15, dayCapUsd: 3, model: "Gemini 2.5 Flash" };
  /** The settings step each fix opens on, written out so a fix with no step fails here. */
  const STEP_OF_HASH: Record<string, string> = {
    "#wallets": "manage",
    "#budget": "manage",
    "#thinking": "brain",
    "#universe": "hunts",
    "#risk": "limits",
  };

  function thinking(hold: StatusThinking["hold"] = null): StatusThinking {
    return { ...CONTEXT, hold };
  }

  it("is not sent to Anthropic's billing, though its config still names Anthropic", () => {
    // The default config names Anthropic; a pay-per-use agent never used that account.
    const [row] = deriveStatus(
      inputs({
        hasLlmKey: false,
        provider: "anthropic",
        thinking: thinking(),
        lastRun: { id: "run_4", status: "failed", error: "Your credit balance is too low.", summary: null },
      }),
    );
    expect(row.title).toBe("The last run failed");
    expect(row.action).toEqual({ label: "Open the run", href: "/agents/fresh-hunter/runs/run_4" });
  });

  it("never says a key is missing, held or not", () => {
    expect(deriveStatus(inputs({ hasLlmKey: false, thinking: thinking() }))).toEqual([]);
    const held = deriveStatus(
      inputs({ hasLlmKey: false, thinking: thinking({ reason: "needs_funds", until: new Date(NOW.getTime() + 15 * MINUTE) }) }),
    );
    expect(held.map((item) => item.kind)).toEqual(["thinking_hold"]);
  });

  it("renders every hold reason in describeInferenceStop's words, with the fix and the owner's own key", () => {
    for (const reason of REASONS) {
      const until = holdUntil(reason, 1, NOW);
      const items = deriveStatus(inputs({ hasLlmKey: false, thinking: thinking({ reason, until }) }));
      expect(items, reason).toHaveLength(1);
      const [item] = items;
      const words = describeInferenceStop(reason, CONTEXT);
      const fix = stopFix(reason);

      expect(item.kind).toBe("thinking_hold");
      expect(item.severity).toBe("block");
      expect(item.title).toBe(words.title);
      expect(item.detail.startsWith(words.detail), reason).toBe(true);
      expect(item.detail).toContain("Tocker checks again");
      expect(item.action).toEqual({
        label: fix.label,
        href: "hash" in fix ? `/agents/fresh-hunter/settings?step=${STEP_OF_HASH[fix.hash]}${fix.hash}` : fix.path,
      });
      expect(item.secondaryAction).toEqual({ label: "Use my own key", href: "/agents/fresh-hunter/settings?step=brain#brain" });
    }
  });

  it("says when it is looked at again: the back-off, the day's end, or the next pass", () => {
    const at = (reason: InferenceStopReason, until: Date | null) =>
      deriveStatus(inputs({ hasLlmKey: false, thinking: thinking({ reason, until }) }))[0].detail;

    expect(at("needs_funds", holdUntil("needs_funds", 1, NOW))).toContain("Tocker checks again in 15 minutes.");
    expect(at("needs_funds", holdUntil("needs_funds", 3, NOW))).toContain("Tocker checks again in 1 hour.");
    // A day limit waits for 00:00 UTC, 6h 12m after the test's clock.
    expect(at("agent_day_cap", holdUntil("agent_day_cap", 1, NOW))).toContain("Tocker checks again in 6h 12m.");
    expect(at("paused", holdUntil("paused", 1, NOW))).toContain("Tocker checks again in 15 minutes.");
    // Past its time, or stored without one: the cron's next pass, not "in now".
    expect(at("needs_funds", new Date(NOW.getTime() - MINUTE))).toContain("on its next pass, within five minutes.");
    expect(at("needs_funds", null)).toContain("on its next pass, within five minutes.");
  });

  it("quotes the owner's own limit in the daily-limit row", () => {
    const [item] = deriveStatus(
      inputs({ hasLlmKey: false, thinking: thinking({ reason: "agent_day_cap", until: holdUntil("agent_day_cap", 1, NOW) }) }),
    );
    expect(item.title).toBe("Daily thinking limit reached");
    expect(item.detail).toContain("$3.00");
    expect(item.action).toEqual({ label: "Raise the limit", href: "/agents/fresh-hunter/settings?step=brain#thinking" });
  });

  it("offers Run now only for a reason the owner can clear themselves", () => {
    const detail = (reason: InferenceStopReason) =>
      deriveStatus(inputs({ hasLlmKey: false, thinking: thinking({ reason, until: holdUntil(reason, 1, NOW) }) }))[0].detail;
    for (const reason of ["needs_funds", "agent_day_cap", "no_wallet", "no_policy", "wallet_limit_low", "model_unavailable"] as const) {
      expect(detail(reason), reason).toContain("Once it is fixed, Run now starts it straight away.");
    }
    for (const reason of ["owner_day_cap", "request_limit", "platform_day_cap", "halted", "paused", "paid_no_answer"] as const) {
      expect(detail(reason), reason).not.toContain("Run now");
    }
  });

  it("still shows a hold whose stored reason this build does not know, without printing it", () => {
    const [item] = deriveStatus(
      inputs({ hasLlmKey: false, thinking: thinking({ reason: "a_reason_from_the_future", until: null }) }),
    );
    expect(item.kind).toBe("thinking_hold");
    expect(item.title).toBe("Pay-per-use thinking is on hold");
    expect(`${item.title} ${item.detail}`).not.toContain("a_reason_from_the_future");
    expect(item.action).toEqual({ label: "Open settings", href: "/agents/fresh-hunter/settings?step=brain#thinking" });
    expect(item.secondaryAction?.label).toBe("Use my own key");
  });

  it("says a stop once: the hold row, not a failed-run row beside it", () => {
    const lastRun = {
      id: "run_7",
      status: "failed" as const,
      error: describeInferenceStop("needs_funds").detail,
      summary: null,
      stopReason: "needs_funds",
    };
    const held = deriveStatus(
      inputs({ hasLlmKey: false, lastRun, thinking: thinking({ reason: "needs_funds", until: holdUntil("needs_funds", 1, NOW) }) }),
    );
    expect(held.map((item) => item.kind)).toEqual(["thinking_hold"]);
  });

  it("names a stopped run in the same words once the hold has cleared", () => {
    const [item, ...rest] = deriveStatus(
      inputs({
        hasLlmKey: false,
        thinking: thinking(),
        lastRun: { id: "run_8", status: "failed", error: "anything", summary: null, stopReason: "paid_no_answer" },
      }),
    );
    expect(rest).toEqual([]);
    expect(item.kind).toBe("run_failed");
    expect(item.title).toBe(describeInferenceStop("paid_no_answer").title);
    expect(item.detail).toBe(describeInferenceStop("paid_no_answer", CONTEXT).detail);
    expect(item.action).toEqual({ label: "Open the run", href: "/agents/fresh-hunter/runs/run_8" });
    expect(item.secondaryAction).toBeUndefined();
  });

  it("says nothing about a run that stopped at one of its own limits and succeeded", () => {
    expect(
      deriveStatus(
        inputs({
          hasLlmKey: false,
          thinking: thinking(),
          lastRun: { id: "run_9", status: "succeeded", error: null, summary: "Stopped at its limit.", stopReason: "run_cap" },
        }),
      ),
    ).toEqual([]);
  });

  it("still reports a failure that had nothing to do with paying", () => {
    const [item] = deriveStatus(
      inputs({
        hasLlmKey: false,
        thinking: thinking(),
        lastRun: { id: "run_2", status: "failed", error: "Privy refused to sign.", summary: null, stopReason: null },
      }),
    );
    expect(item.title).toBe("The last run failed");
    expect(item.detail).toBe("Privy refused to sign.");
  });

  it("keeps its place among the other blocks: after a proposal on the clock, before the day's buys", () => {
    const items = deriveStatus(
      inputs({
        hasLlmKey: false,
        proposals: [{ expiresAt: new Date(NOW.getTime() + 9 * MINUTE) }],
        portfolio: { cashUsd: 100, tradesToday: 10, cashReadFailed: false },
        thinking: thinking({ reason: "needs_funds", until: holdUntil("needs_funds", 1, NOW) }),
      }),
    );
    expect(items.map((item) => item.kind)).toEqual(["pending_proposals", "thinking_hold", "daily_limit"]);
  });

  it("builds the same row on its own as inside the derivation", () => {
    const hold = { reason: "needs_funds", until: holdUntil("needs_funds", 1, NOW) };
    const [item] = deriveStatus(inputs({ hasLlmKey: false, thinking: thinking(hold) }));
    expect(holdItem(thinking(hold), hold, "fresh-hunter", NOW)).toEqual(item);
  });
});

/**
 * The feature ships switched off, so what matters most is what does NOT change: a key
 * agent's rows are the ones it had before `thinking` existed, including when its row
 * carries pay-per-use leftovers.
 */
describe("deriveStatus for a key agent is unchanged by pay per use", () => {
  const cases: Array<Partial<StatusInputs>> = [
    {},
    { hasLlmKey: false },
    { status: "paused" },
    { lastRun: { id: "run_1", status: "failed", error: "Your credit balance is too low to access the Anthropic API.", summary: null } },
    {
      hasLlmKey: false,
      lastRun: {
        id: "run_3",
        status: "failed",
        error: "This agent has no LLM API key attached. Add one in Settings and re-select it on the agent.",
        summary: null,
      },
    },
    { mode: "live", portfolio: { cashUsd: 0.7, tradesToday: 12, cashReadFailed: false } },
  ];

  it("gives the same rows with no thinking, with null, and with a stop reason left on its last run", () => {
    for (const overrides of cases) {
      const before = deriveStatus(inputs(overrides));
      expect(deriveStatus(inputs({ ...overrides, thinking: null }))).toEqual(before);
      expect(deriveStatus(inputs({ ...overrides, thinking: undefined }))).toEqual(before);
      // A key agent that once paid per use can have a stop reason on an old run row.
      const lastRun = overrides.lastRun ? { ...overrides.lastRun, stopReason: "needs_funds" } : undefined;
      if (lastRun) expect(deriveStatus(inputs({ ...overrides, lastRun }))).toEqual(before);
      for (const item of before) expect(item.secondaryAction).toBeUndefined();
    }
  });

  it("still tells a key agent with no key to attach one", () => {
    const [item] = deriveStatus(inputs({ hasLlmKey: false }));
    expect(item).toEqual({
      kind: "no_llm_key",
      severity: "block",
      title: "No LLM key attached",
      detail: "The agent cannot think without one, so every tick fails before it starts.",
      action: { label: "Attach a key", href: "/agents/fresh-hunter/settings?step=brain#brain" },
    });
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

  const PAY_PER_USE_LLM = {
    ...DEFAULT_AGENT_CONFIG.llm,
    source: "usdc" as const,
    usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.15, maxUsdPerDay: 3 },
  };

  it("does not ask a pay-per-use agent for a key", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { llm: PAY_PER_USE_LLM } });
    const items = await getAgentStatus(agentId, userId);
    expect(items.map((i) => i.kind)).not.toContain("no_llm_key");
    expect(items.map((i) => i.kind)).not.toContain("thinking_hold");
  });

  it("shows a held pay-per-use agent's hold to its owner, and to nobody else", async () => {
    const { agentId, userId, slug } = await seedAgent(db, { config: { llm: PAY_PER_USE_LLM } });
    await db
      .update(schema.agents)
      .set({
        inferenceHold: "agent_day_cap",
        inferenceHoldSince: new Date(),
        inferenceHoldUntil: new Date(Date.now() + 90 * MINUTE),
        inferenceStrikes: 1,
      })
      .where(eq(schema.agents.id, agentId));

    const mine = await getAgentStatus(agentId, userId);
    const hold = mine.find((i) => i.kind === "thinking_hold");
    expect(hold?.title).toBe("Daily thinking limit reached");
    // The owner's own limit, read from the config.
    expect(hold?.detail).toContain("$3.00");
    expect(hold?.action).toEqual({ label: "Raise the limit", href: `/agents/${slug}/settings?step=brain#thinking` });
    expect(hold?.secondaryAction).toEqual({ label: "Use my own key", href: `/agents/${slug}/settings?step=brain#brain` });
    expect(mine.map((i) => i.kind)).not.toContain("no_llm_key");

    expect(await getAgentStatus(agentId, "did:privy:someone-else")).toEqual([]);
  });

  it("ignores a hold left on an agent that has gone back to a key", async () => {
    const { agentId, userId } = await seedAgent(db);
    await db
      .update(schema.agents)
      .set({ inferenceHold: "needs_funds", inferenceHoldUntil: new Date(Date.now() + 15 * MINUTE) })
      .where(eq(schema.agents.id, agentId));

    const items = await getAgentStatus(agentId, userId);
    expect(items.map((i) => i.kind)).not.toContain("thinking_hold");
    // Seeded with no key, and a key agent again: the key row is the one that applies.
    expect(items.map((i) => i.kind)).toContain("no_llm_key");
  });
});

/**
 * An agent set to skip scheduled runs while it has no room to buy starts nothing, fails
 * nothing and says nothing in its run list. This row is how its owner sees why.
 */
describe("the row for an agent whose scheduled runs are being skipped", () => {
  const FULL: NoRoom = { ok: false, code: "position_limit", positions: { limit: 3, open: 3, held: 3, waiting: 0, full: true } };

  it("says that runs are being skipped, why, and what still happens", () => {
    const [item] = deriveStatus(inputs({ skipping: FULL }));
    expect(item).toEqual({
      kind: "skipping_runs",
      severity: "warn",
      title: "Skipping scheduled runs: no room to buy (3 of 3 positions)",
      detail: "Automatic exits still run. It is looked at again at each scheduled time, and Run now still starts a run.",
      action: { label: "Schedule", href: "/agents/fresh-hunter/settings?step=schedule#execution" },
    });
  });

  it("does not say that exits still run for an agent with every exit rule off", () => {
    const [item] = deriveStatus(inputs({ skipping: FULL, exitRulesOn: false }));
    expect(item.detail).toBe("It is looked at again at each scheduled time, and Run now still starts a run.");
    // Said, as before, when a rule is on or the caller does not say.
    expect(deriveStatus(inputs({ skipping: FULL, exitRulesOn: true }))[0].detail).toContain("Automatic exits still run. ");
  });

  it("names each of the three reasons in the owner's own figures", () => {
    const title = (skipping: NoRoom) => deriveStatus(inputs({ skipping })).find((item) => item.kind === "skipping_runs")?.title;
    expect(title({ ok: false, code: "ticket", ticketUsd: 1.28, bound: "cash", smallestUsd: 2, reserveUsd: 5 })).toBe(
      "Skipping scheduled runs: no room to buy ($1.28 to spend after its $5.00 reserve, under the $2.00 smallest order)",
    );
    expect(title({ ok: false, code: "daily_limit", tradesToday: 10, maxDailyTrades: 10 })).toBe(
      "Skipping scheduled runs: no room to buy (10 of 10 buys used today)",
    );
    expect(title(FULL)).toBe("Skipping scheduled runs: no room to buy (3 of 3 positions)");
  });

  it("is not there for an agent that is not skipping, or is not running at all", () => {
    const kinds = (overrides: Partial<StatusInputs>) => deriveStatus(inputs(overrides)).map((item) => item.kind);
    expect(kinds({})).toEqual([]);
    expect(kinds({ skipping: null })).toEqual([]);
    // A paused agent is told it is paused, which is the whole of why nothing runs.
    expect(kinds({ skipping: FULL, status: "paused" })).toEqual(["paused"]);
    expect(kinds({ skipping: FULL, status: "draft" })).toEqual(["draft"]);
  });

  describe("skippedRunsFor", () => {
    const config = (overrides: Partial<typeof DEFAULT_AGENT_CONFIG> = {}) => ({
      ...DEFAULT_AGENT_CONFIG,
      schedule: { intervalMinutes: 15, skipWhenFull: true },
      ...overrides,
      risk: { ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions: 1, ...overrides.risk },
    });
    const book = (overrides: Partial<Portfolio> = {}): Portfolio => ({
      agentId: "a1",
      mode: "paper",
      cashUsd: 100,
      equityUsd: 150,
      positions: [
        {
          token: { id: "solana:AAA", chain: "solana", address: "AAA", symbol: "AAA", name: "A", logoUrl: null, decimals: 6, lastPriceUsd: 1 },
          amountToken: 50,
          avgCostUsd: 1,
          markPriceUsd: 1,
          valueUsd: 50,
          unrealizedPnlUsd: 0,
          unrealizedPnlPct: 0,
          realizedPnlUsd: 0,
          openedAt: null,
          peakPriceUsd: null,
          entryScore: null,
          entryLiquidityUsd: null,
          currentScore: null,
          stopDistancePct: null,
          takeProfitDistancePct: null,
        },
      ],
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      tradesToday: 0,
      startingUsd: 100,
      cashReadFailed: false,
      pendingBuyTokenIds: [],
      ...overrides,
    });
    const agent = (overrides: Partial<Parameters<typeof skippedRunsFor>[0]> = {}) => ({
      status: "active" as const,
      mode: "paper" as const,
      config: config(),
      ...overrides,
    });

    it("is the run loop's own answer for an active agent on a schedule", () => {
      expect(skippedRunsFor(agent(), book())).toMatchObject({ code: "position_limit", positions: { open: 1, limit: 1 } });
    });

    it("is nothing while the switch is off, which is how every agent starts", () => {
      expect(skippedRunsFor(agent({ config: config({ schedule: { intervalMinutes: 15 } }) }), book())).toBeNull();
      expect(skippedRunsFor(agent({ config: config({ schedule: { intervalMinutes: 15, skipWhenFull: false } }) }), book())).toBeNull();
    });

    it("is nothing for an agent no schedule would start: paused, a draft, or manual", () => {
      expect(skippedRunsFor(agent({ status: "paused" }), book())).toBeNull();
      expect(skippedRunsFor(agent({ status: "draft" }), book())).toBeNull();
      expect(skippedRunsFor(agent({ config: config({ schedule: { intervalMinutes: 0, skipWhenFull: true } }) }), book())).toBeNull();
    });

    it("says nothing on a book that could not be read", () => {
      expect(skippedRunsFor(agent(), null)).toBeNull();
      expect(skippedRunsFor(agent(), book({ cashReadFailed: true }))).toBeNull();
    });

    it("is nothing for an agent with room", () => {
      expect(skippedRunsFor(agent({ config: config({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions: 2 } }) }), book())).toBeNull();
    });
  });

  describe("read from the database", () => {
    let db: Db;
    const WIF = tokenId("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");

    beforeAll(async () => {
      db = await setupTestDb();
      await db
        .insert(schema.tokens)
        // Priced from the row itself, so the position has a value with no network.
        .values({ id: WIF, chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", decimals: 6, lastPriceUsd: "0.5" })
        .onConflictDoNothing();
    }, 120_000);

    // A held position is marked from the price feeds first. Kept offline: with no answer
    // from them the mark is the price on the token's own row.
    beforeEach(() => {
      vi.stubGlobal("fetch", async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    });
    afterEach(() => vi.unstubAllGlobals());

    async function fullAgent(schedule: { intervalMinutes: number; skipWhenFull?: boolean }) {
      const seeded = await seedAgent(db, { config: { chains: ["solana"], schedule, risk: { maxOpenPositions: 1 } } });
      await db.insert(schema.positions).values({ agentId: seeded.agentId, tokenId: WIF, amountToken: "40", avgCostUsd: "0.5", openedAt: new Date() });
      return seeded;
    }

    it("is on the owner's banner and the settings bar, in the same words, and on nobody else's", async () => {
      const { agentId, userId } = await fullAgent({ intervalMinutes: 15, skipWhenFull: true });
      const row = (await getAgentStatus(agentId, userId)).find((item) => item.kind === "skipping_runs");
      expect(row?.title).toBe("Skipping scheduled runs: no room to buy (1 of 1 position)");
      expect(await getSkippingRunsLine(agentId, userId)).toBe(
        "Skipping scheduled runs: no room to buy (1 of 1 position). Automatic exits still run.",
      );
      // The sentence quotes the owner's limit, so it is the owner's alone.
      expect(await getSkippingRunsLine(agentId, "did:privy:someone-else")).toBeNull();
      expect(await getSkippingRunsLine(agentId, null)).toBeNull();
      expect(await getSkippingRunsLine("no-such-agent", userId)).toBeNull();
    });

    it("does not promise exits on the bar of an agent with every exit rule off", async () => {
      // Flat and out of cash after its reserve, with no exit rule on: skipped, since a
      // run could only buy, and told nothing about exits, since none would fire.
      const seeded = await seedAgent(db, {
        paperStartingUsd: "5",
        config: {
          chains: ["solana"],
          schedule: { intervalMinutes: 15, skipWhenFull: true },
          risk: {
            cashReserveUsd: 5,
            stopLossPct: null,
            takeProfitPct: null,
            trailingStopPct: null,
            maxHoldHours: null,
            exitScoreBelow: null,
            exitOnLiquidityDropPct: null,
          },
        },
      });
      expect(await getSkippingRunsLine(seeded.agentId, seeded.userId)).toBe(
        "Skipping scheduled runs: no room to buy ($0.00 to spend after its $5.00 reserve, under the $0.25 smallest order).",
      );
      const row = (await getAgentStatus(seeded.agentId, seeded.userId)).find((item) => item.kind === "skipping_runs");
      expect(row?.detail).toBe("It is looked at again at each scheduled time, and Run now still starts a run.");
      // Holding a position, the same agent is not skipped at all: only a run can sell it.
      await db.insert(schema.positions).values({ agentId: seeded.agentId, tokenId: WIF, amountToken: "40", avgCostUsd: "0.5", openedAt: new Date() });
      expect(await getSkippingRunsLine(seeded.agentId, seeded.userId)).toBeNull();
      expect((await getAgentStatus(seeded.agentId, seeded.userId)).map((item) => item.kind)).not.toContain("skipping_runs");
    });

    it("hands the banner the owner's cash reserve, so a live book is measured by the cash above it", async () => {
      // A live agent whose only wallets are stand-ins reads as holding no cash.
      const withReserve = await seedAgent(db, { mode: "live", config: { chains: ["solana"], risk: { maxTradeUsd: 5, cashReserveUsd: 5 } } });
      const reserved = (await getAgentStatus(withReserve.agentId, withReserve.userId)).find((item) => item.kind === "low_cash");
      expect(reserved?.title).toBe("Cash to trade $0 (after the $5 reserve) is under the $5 clip");
      const without = await seedAgent(db, { mode: "live", config: { chains: ["solana"], risk: { maxTradeUsd: 5 } } });
      const plain = (await getAgentStatus(without.agentId, without.userId)).find((item) => item.kind === "low_cash");
      expect(plain?.title).toBe("Cash $0 is under the $5 clip");
    });

    it("is absent while the switch is off, and once the agent is paused", async () => {
      const off = await fullAgent({ intervalMinutes: 15 });
      expect((await getAgentStatus(off.agentId, off.userId)).map((item) => item.kind)).not.toContain("skipping_runs");
      expect(await getSkippingRunsLine(off.agentId, off.userId)).toBeNull();

      const paused = await fullAgent({ intervalMinutes: 15, skipWhenFull: true });
      await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, paused.agentId));
      expect((await getAgentStatus(paused.agentId, paused.userId)).map((item) => item.kind)).not.toContain("skipping_runs");
      expect(await getSkippingRunsLine(paused.agentId, paused.userId)).toBeNull();
    });
  });
});

describe("the two refusals an owner's limits add, on the row for buys that were refused", () => {
  const refusedFor = (label: string) =>
    deriveStatus(
      inputs({
        recentSucceeded: [quietRun("r3", null, 0, [{ label, count: 2 }]), quietRun("r2", null), quietRun("r1", null)],
      }),
    ).find((item) => item.kind === "buys_refused");

  it("says the position limit was in the way, and sends the owner to the risk limits", () => {
    expect(refusedFor("position limit")).toMatchObject({
      detail: "It already held as many positions as it may. 2 orders were turned down in the last three ticks.",
      action: { label: "Settings", href: "/agents/fresh-hunter/settings?step=limits#risk" },
    });
  });

  it("says the cash reserve was in the way", () => {
    expect(refusedFor("cash reserve")).toMatchObject({
      detail: "Each order would have taken its cash under the reserve. 2 orders were turned down in the last three ticks.",
      action: { label: "Settings", href: "/agents/fresh-hunter/settings?step=limits#risk" },
    });
  });
});
