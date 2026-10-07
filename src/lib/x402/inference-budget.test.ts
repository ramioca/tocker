import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";
import {
  BREAKER_RULES,
  HOLD_BACKOFF_MINUTES,
  breakerDecision,
  breakerTrips,
  capsFor,
  controlStop,
  dayCapStop,
  holdUntil,
  nextUtcMidnight,
  stopAccounts,
  type BreakerEvidence,
  type InferenceDayUsage,
} from "./inference-budget";
import {
  AGENT_DAY_REQUESTS,
  DEFAULT_OWNER_DAY_USD,
  DEFAULT_PLATFORM_DAY_USD,
  HARD_STEP_CAP_USD,
  INFERENCE_STOPS,
  MAX_PAID_STEPS,
  USDC_DAY_CAP,
  USDC_RUN_CAP,
  inferenceFlags,
  type InferenceCaps,
  type InferenceStopReason,
} from "./inference-types";

const MINUTE = 60_000;
const NOW = new Date("2026-10-06T14:20:00.000Z");

function configWith(llm: Partial<AgentConfig["llm"]>): Pick<AgentConfig, "llm"> {
  return { llm: { ...DEFAULT_AGENT_CONFIG.llm, ...llm } };
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

describe("capsFor", () => {
  const flags = inferenceFlags({ INFERENCE_USDC: "on" });

  it("takes the owner's two limits from the config and the rest from the switches and constants", () => {
    const caps = capsFor(configWith({ maxSteps: 12, source: "usdc", usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.4, maxUsdPerDay: 6 } }), flags);
    expect(caps).toEqual({
      stepUsd: HARD_STEP_CAP_USD,
      runUsd: 0.4,
      agentDayUsd: 6,
      ownerDayUsd: DEFAULT_OWNER_DAY_USD,
      platformDayUsd: DEFAULT_PLATFORM_DAY_USD,
      agentDayRequests: AGENT_DAY_REQUESTS,
      maxRequestsPerRun: 13,
    });
  });

  it("reads the account and platform limits the environment sets", () => {
    const caps = capsFor(
      configWith({ usdc: { model: "openai/gpt-4o-mini", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } }),
      inferenceFlags({ INFERENCE_USDC: "owner", INFERENCE_MAX_STEP_USD: "0.05", INFERENCE_OWNER_DAILY_USD: "7", INFERENCE_PLATFORM_DAILY_USD: "0" }),
    );
    expect(caps.stepUsd).toBe(0.05);
    expect(caps.ownerDayUsd).toBe(7);
    expect(caps.platformDayUsd).toBe(0);
  });

  it("never allows more requests than the product's ceiling, plus the one that wraps up", () => {
    const caps = capsFor(configWith({ maxSteps: 40, usdc: { model: "openai/gpt-4o-mini", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } }), flags);
    expect(caps.maxRequestsPerRun).toBe(MAX_PAID_STEPS + 1);
  });

  it("gives a config with no limits nothing to spend, rather than a default", () => {
    const caps = capsFor(configWith({ source: "usdc" }), flags);
    expect(caps.runUsd).toBe(0);
    expect(caps.agentDayUsd).toBe(0);
  });

  it("reads a limit that is not a positive number as zero and holds one above the range to the range", () => {
    const odd = capsFor(configWith({ usdc: { model: "m", maxUsdPerRun: Number.NaN, maxUsdPerDay: -4 } }), flags);
    expect(odd.runUsd).toBe(0);
    expect(odd.agentDayUsd).toBe(0);
    const large = capsFor(configWith({ usdc: { model: "m", maxUsdPerRun: 500, maxUsdPerDay: 5000 } }), flags);
    expect(large.runUsd).toBe(USDC_RUN_CAP.max);
    expect(large.agentDayUsd).toBe(USDC_DAY_CAP.max);
  });

  it("is unchanged for a key agent whatever the switches say: the limits are zero and nothing reads them", () => {
    // A key agent has no `usdc` block. Its caps pay for nothing, and with the feature
    // switched off no code path asks for them at all.
    const caps = capsFor({ llm: DEFAULT_AGENT_CONFIG.llm }, inferenceFlags({}));
    expect(caps.runUsd).toBe(0);
    expect(caps.agentDayUsd).toBe(0);
  });
});

describe("dayCapStop", () => {
  const caps: InferenceCaps = {
    stepUsd: 0.25,
    runUsd: 0.3,
    agentDayUsd: 3,
    ownerDayUsd: 25,
    platformDayUsd: 100,
    agentDayRequests: 600,
    maxRequestsPerRun: 21,
  };
  const empty: InferenceDayUsage = {
    day: "2026-10-06",
    platform: { usd: 0, requests: 0 },
    owner: { usd: 0, requests: 0, manualRuns: 0 },
    agent: { usd: 0, requests: 0 },
  };

  it("has room on an empty day, and exactly at a limit", () => {
    expect(dayCapStop(empty, caps, 0.01)).toBeNull();
    expect(dayCapStop({ ...empty, agent: { usd: 2.99, requests: 5 } }, caps, 0.01)).toBeNull();
  });

  it("names each limit when it alone is reached", () => {
    expect(dayCapStop({ ...empty, platform: { usd: 100, requests: 1 } }, caps, 0.01)).toBe("platform_day_cap");
    expect(dayCapStop({ ...empty, owner: { usd: 25, requests: 1, manualRuns: 0 } }, caps, 0.01)).toBe("owner_day_cap");
    expect(dayCapStop({ ...empty, agent: { usd: 3, requests: 1 } }, caps, 0.01)).toBe("agent_day_cap");
    expect(dayCapStop({ ...empty, agent: { usd: 0.5, requests: 600 } }, caps, 0.01)).toBe("request_limit");
  });

  it("names them in the order the ledger checks them", () => {
    const full: InferenceDayUsage = {
      day: empty.day,
      platform: { usd: 100, requests: 9 },
      owner: { usd: 25, requests: 9, manualRuns: 0 },
      agent: { usd: 3, requests: 600 },
    };
    expect(dayCapStop(full, caps, 0.01)).toBe("platform_day_cap");
    expect(dayCapStop({ ...full, platform: empty.platform }, caps, 0.01)).toBe("owner_day_cap");
    expect(dayCapStop({ ...full, platform: empty.platform, owner: empty.owner }, caps, 0.01)).toBe("request_limit");
  });

  it("treats a platform limit of zero as the off switch", () => {
    expect(dayCapStop(empty, { ...caps, platformDayUsd: 0 }, 0)).toBe("platform_day_cap");
  });
});

describe("controlStop", () => {
  it("is clear with no halt and no pause, or a pause that has ended", () => {
    expect(controlStop({ halted: false, pausedUntil: null }, NOW)).toBeNull();
    expect(controlStop({ halted: false, pausedUntil: minutesAgo(1) }, NOW)).toBeNull();
    expect(controlStop({ halted: false, pausedUntil: NOW }, NOW)).toBeNull();
  });

  it("names a pause still running, and the halt above it", () => {
    const later = new Date(NOW.getTime() + MINUTE);
    expect(controlStop({ halted: false, pausedUntil: later }, NOW)).toBe("paused");
    expect(controlStop({ halted: true, pausedUntil: later }, NOW)).toBe("halted");
    expect(controlStop({ halted: true, pausedUntil: null }, NOW)).toBe("halted");
  });
});

describe("holdUntil", () => {
  const minutesFromNow = (reason: InferenceStopReason, strikes: number) => (holdUntil(reason, strikes, NOW).getTime() - NOW.getTime()) / MINUTE;

  it("backs off 15, 30, 60, 120, then 360 minutes for what the owner or the gateway must fix", () => {
    const backoff: InferenceStopReason[] = [
      "needs_funds",
      "no_wallet",
      "no_policy",
      "model_unavailable",
      "flag_off",
      "quote_failed",
      "gateway_error",
      "signature_failed",
      "paid_no_answer",
      "rerouted",
      "pin_mismatch",
      "step_cap",
      "bad_request",
      "no_rpc",
    ];
    for (const reason of backoff) {
      expect([1, 2, 3, 4, 5, 6, 40].map((strikes) => minutesFromNow(reason, strikes))).toEqual([15, 30, 60, 120, 360, 360, 360]);
    }
    expect(HOLD_BACKOFF_MINUTES).toEqual([15, 30, 60, 120, 360]);
  });

  it("reads a strike count of zero, a negative or a non-number as the first hold", () => {
    expect(minutesFromNow("needs_funds", 0)).toBe(15);
    expect(minutesFromNow("needs_funds", -3)).toBe(15);
    expect(minutesFromNow("needs_funds", Number.NaN)).toBe(15);
  });

  it("waits for 00:00 UTC on every daily limit, whatever the strikes", () => {
    for (const reason of ["agent_day_cap", "owner_day_cap", "request_limit", "platform_day_cap", "manual_limit"] as const) {
      expect(holdUntil(reason, 1, NOW).toISOString()).toBe("2026-10-07T00:00:00.000Z");
      expect(holdUntil(reason, 9, NOW).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    }
  });

  it("puts the next midnight a full day on when asked exactly at midnight, and a second on just before it", () => {
    expect(nextUtcMidnight(new Date("2026-10-06T00:00:00.000Z")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-10-06T23:59:59.000Z")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:59.999Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("looks at a halt or a pause again in 15 minutes, whatever the strikes", () => {
    expect(minutesFromNow("halted", 1)).toBe(15);
    expect(minutesFromNow("paused", 7)).toBe(15);
  });

  it("does not hold an agent for a limit that only ends the run in hand", () => {
    for (const reason of ["run_cap", "deadline", "step_limit"] as const) {
      expect(holdUntil(reason, 4, NOW).getTime()).toBe(NOW.getTime());
    }
  });

  it("answers for every reason there is, never in the past", () => {
    for (const reason of Object.keys(INFERENCE_STOPS) as InferenceStopReason[]) {
      expect(holdUntil(reason, 2, NOW).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    }
  });
});

describe("breakers", () => {
  const none: BreakerEvidence = { payments: [], stops: [] };

  it("trips nothing on no evidence", () => {
    expect(breakerTrips(none, NOW)).toEqual([]);
    expect(breakerDecision(none, NOW)).toBeNull();
  });

  it("pauses 30 minutes when 3 paid steps from 2 accounts got no answer within 15 minutes", () => {
    const evidence: BreakerEvidence = {
      payments: [
        { status: "paid_no_answer", agentId: "a", ownerId: "one", at: minutesAgo(14) },
        { status: "unconfirmed", agentId: "a", ownerId: "one", at: minutesAgo(9) },
        { status: "unconfirmed", agentId: "b", ownerId: "two", at: minutesAgo(2) },
      ],
      stops: [],
    };
    const trip = breakerDecision(evidence, NOW);
    expect(trip?.rule).toBe("unanswered");
    expect(trip?.reason).toBe("3 paid steps from 2 accounts got no answer within 15 minutes");
    // Thirty minutes from the last of the three, not from the moment it was noticed.
    expect(trip?.pauseUntil.getTime()).toBe(minutesAgo(2).getTime() + 30 * MINUTE);
  });

  it("counts accounts, not agents: one owner's several agents cannot pause everyone", () => {
    const oneOwner: BreakerEvidence = {
      payments: [
        { status: "unconfirmed", agentId: "a", ownerId: "one", at: minutesAgo(9) },
        { status: "unconfirmed", agentId: "b", ownerId: "one", at: minutesAgo(6) },
        { status: "paid_no_answer", agentId: "c", ownerId: "one", at: minutesAgo(3) },
        { status: "unconfirmed", agentId: "d", ownerId: "one", at: minutesAgo(1) },
      ],
      stops: [],
    };
    expect(breakerTrips(oneOwner, NOW)).toEqual([]);
    // One agent id under two owners is two accounts (ids are not shared, but the rule reads the owner).
    const twoOwners: BreakerEvidence = { payments: oneOwner.payments.map((payment, n) => ({ ...payment, agentId: "a", ownerId: n === 0 ? "two" : "one" })), stops: [] };
    expect(breakerDecision(twoOwners, NOW)?.rule).toBe("unanswered");
  });

  it("falls back to the agent for a row that names no owner, and treats rows that name neither as one", () => {
    // A reader of this type written before the owner was added: counted as it used to be.
    const byAgent: BreakerEvidence = {
      payments: [
        { status: "unconfirmed", agentId: "a", at: minutesAgo(9) },
        { status: "unconfirmed", agentId: "a", at: minutesAgo(6) },
        { status: "unconfirmed", agentId: "b", at: minutesAgo(3) },
      ],
      stops: [],
    };
    expect(breakerDecision(byAgent, NOW)?.rule).toBe("unanswered");
    const nameless: BreakerEvidence = { payments: [1, 2, 3, 4].map((n) => ({ status: "unconfirmed", agentId: null, ownerId: null, at: minutesAgo(n) })), stops: [] };
    expect(breakerDecision(nameless, NOW)).toBeNull();
  });

  it("does not pause for one agent's bad luck, for two rows, or for rows outside the window", () => {
    const oneAgent: BreakerEvidence = {
      payments: [1, 2, 3, 4].map((n) => ({ status: "unconfirmed", agentId: "a", ownerId: "one", at: minutesAgo(n) })),
      stops: [],
    };
    expect(breakerDecision(oneAgent, NOW)).toBeNull();
    const twoRows: BreakerEvidence = {
      payments: [
        { status: "unconfirmed", agentId: "a", ownerId: "one", at: minutesAgo(1) },
        { status: "paid_no_answer", agentId: "b", ownerId: "two", at: minutesAgo(2) },
      ],
      stops: [],
    };
    expect(breakerDecision(twoRows, NOW)).toBeNull();
    const old: BreakerEvidence = {
      payments: [
        { status: "unconfirmed", agentId: "a", ownerId: "one", at: minutesAgo(16) },
        { status: "unconfirmed", agentId: "b", ownerId: "two", at: minutesAgo(3) },
        { status: "unconfirmed", agentId: "b", ownerId: "two", at: minutesAgo(2) },
      ],
      stops: [],
    };
    expect(breakerDecision(old, NOW)).toBeNull();
  });

  it("counts only the two unanswered statuses", () => {
    const answered: BreakerEvidence = {
      payments: [
        { status: "settled", agentId: "a", ownerId: "one", at: minutesAgo(1) },
        { status: "not_charged", agentId: "b", ownerId: "two", at: minutesAgo(2) },
        { status: "released", agentId: "c", ownerId: "three", at: minutesAgo(3) },
        { status: "simulated", agentId: "d", ownerId: "four", at: minutesAgo(3) },
      ],
      stops: [],
    };
    expect(breakerDecision(answered, NOW)).toBeNull();
  });

  it("pauses 15 minutes on 5 gateway failures from 2 accounts within 10 minutes, counting both reasons together", () => {
    const stops = [
      { reason: "quote_failed", ownerId: "one", at: minutesAgo(9) },
      { reason: "gateway_error", ownerId: "one", at: minutesAgo(7) },
      { reason: "quote_failed", ownerId: "two", at: minutesAgo(5) },
      { reason: "gateway_error", ownerId: "one", at: minutesAgo(4) },
    ];
    expect(breakerDecision({ payments: [], stops }, NOW)).toBeNull();
    const trip = breakerDecision({ payments: [], stops: [...stops, { reason: "quote_failed", ownerId: "one", at: minutesAgo(1) }] }, NOW);
    expect(trip?.rule).toBe("gateway");
    expect(trip?.reason).toBe("5 runs from 2 accounts stopped because the gateway did not answer within 10 minutes");
    expect(trip?.pauseUntil.getTime()).toBe(minutesAgo(1).getTime() + 15 * MINUTE);
  });

  it("pauses 15 minutes on 5 signature failures from 2 accounts within 10 minutes, and not on 4, nor on older ones", () => {
    const recent = [1, 2, 3, 4].map((n) => ({ reason: "signature_failed", ownerId: n === 4 ? "two" : "one", at: minutesAgo(n) }));
    expect(breakerDecision({ payments: [], stops: recent }, NOW)).toBeNull();
    expect(breakerDecision({ payments: [], stops: [...recent, { reason: "signature_failed", ownerId: "one", at: minutesAgo(11) }] }, NOW)).toBeNull();
    const trip = breakerDecision({ payments: [], stops: [...recent, { reason: "signature_failed", ownerId: "one", at: minutesAgo(6) }] }, NOW);
    expect(trip?.rule).toBe("signature");
    expect(trip?.reason).toBe("5 runs from 2 accounts stopped because the wallet did not sign within 10 minutes");
    expect(trip?.pauseUntil.getTime()).toBe(minutesAgo(1).getTime() + 15 * MINUTE);
  });

  describe("one account cannot pause everyone", () => {
    // An owner can make their own runs stop before any payment as often as they like (a
    // wallet limit too low to sign under, say), with as many agents as they like, and at
    // no cost. That holds their agents. It must not stop anybody else's.
    it("through the signature rule, however many of its runs the wallet refused to sign", () => {
      const oneAccount = Array.from({ length: 40 }, (_, n) => ({ reason: "signature_failed", ownerId: "one", at: new Date(NOW.getTime() - n * 10_000) }));
      expect(breakerTrips({ payments: [], stops: oneAccount }, NOW)).toEqual([]);
      expect(breakerDecision({ payments: [], stops: oneAccount }, NOW)).toBeNull();
      // The same failures from a second account as well are what the rule is for.
      const second = { reason: "signature_failed", ownerId: "two", at: minutesAgo(1) };
      expect(breakerDecision({ payments: [], stops: [...oneAccount, second] }, NOW)?.rule).toBe("signature");
    });

    it("through the gateway rule", () => {
      const oneAccount = [1, 2, 3, 4, 5, 6].map((n) => ({ reason: n % 2 ? "quote_failed" : "gateway_error", ownerId: "one", at: minutesAgo(n) }));
      expect(breakerDecision({ payments: [], stops: oneAccount }, NOW)).toBeNull();
      expect(breakerDecision({ payments: [], stops: [...oneAccount, { reason: "gateway_error", ownerId: "two", at: minutesAgo(2) }] }, NOW)?.rule).toBe("gateway");
    });

    it("and the second account has to be inside the window too", () => {
      const stops = [
        ...[1, 2, 3, 4, 5].map((n) => ({ reason: "signature_failed", ownerId: "one", at: minutesAgo(n) })),
        { reason: "signature_failed", ownerId: "two", at: minutesAgo(11) },
      ];
      expect(breakerDecision({ payments: [], stops }, NOW)).toBeNull();
    });

    it("stops that name no owner are one account between them, never several", () => {
      // A reader of the evidence that does not say whose run it was cannot pause anyone with it.
      const nameless: BreakerEvidence["stops"] = [1, 2, 3, 4, 5, 6].map((n) => ({ reason: "signature_failed", at: minutesAgo(n) }));
      expect(breakerDecision({ payments: [], stops: nameless }, NOW)).toBeNull();
      expect(breakerDecision({ payments: [], stops: nameless.map((stop) => ({ ...stop, ownerId: null })) }, NOW)).toBeNull();
      // With one named account beside them there are two.
      expect(breakerDecision({ payments: [], stops: [...nameless, { reason: "signature_failed", ownerId: "one", at: minutesAgo(1) }] }, NOW)?.rule).toBe("signature");
      expect(stopAccounts(nameless)).toBe(1);
      expect(stopAccounts([{ ownerId: "one" }, { ownerId: "one" }, { ownerId: "two" }, {}])).toBe(3);
      expect(stopAccounts([])).toBe(0);
    });

    it("a pin mismatch still needs only one: what the gateway asks for is not an owner's to choose", () => {
      expect(breakerDecision({ payments: [], stops: [{ reason: "pin_mismatch", ownerId: "one", at: minutesAgo(4) }] }, NOW)?.rule).toBe("pin_mismatch");
    });
  });

  it("does not add gateway failures and signature failures together", () => {
    const mixed = [
      { reason: "quote_failed", ownerId: "one", at: minutesAgo(1) },
      { reason: "gateway_error", ownerId: "two", at: minutesAgo(2) },
      { reason: "signature_failed", ownerId: "one", at: minutesAgo(3) },
      { reason: "signature_failed", ownerId: "two", at: minutesAgo(4) },
      { reason: "signature_failed", ownerId: "three", at: minutesAgo(5) },
    ];
    expect(breakerDecision({ payments: [], stops: mixed }, NOW)).toBeNull();
  });

  it("pauses 30 minutes on a single pin mismatch", () => {
    const trip = breakerDecision({ payments: [], stops: [{ reason: "pin_mismatch", at: minutesAgo(4) }] }, NOW);
    expect(trip?.rule).toBe("pin_mismatch");
    expect(trip?.pauseUntil.getTime()).toBe(minutesAgo(4).getTime() + 30 * MINUTE);
  });

  it("ignores stops for reasons that are the owner's or the run's own, and runs with no reason", () => {
    const stops = [
      ...["needs_funds", "run_cap", "agent_day_cap", "paid_no_answer", "rerouted", "step_cap"].flatMap((reason) =>
        [1, 2, 3, 4, 5, 6].map((n) => ({ reason, at: minutesAgo(n) })),
      ),
      { reason: null, at: minutesAgo(1) },
    ];
    expect(breakerDecision({ payments: [], stops }, NOW)).toBeNull();
  });

  it("names the same end however often it is asked, and nothing once that end has passed", () => {
    const stops = [{ reason: "pin_mismatch", at: minutesAgo(4) }];
    const first = breakerDecision({ payments: [], stops }, NOW);
    const fiveMinutesOn = new Date(NOW.getTime() + 5 * MINUTE);
    expect(breakerDecision({ payments: [], stops }, fiveMinutesOn)?.pauseUntil.getTime()).toBe(first?.pauseUntil.getTime());
    // 27 minutes on, the mismatch is 31 minutes old: outside the window, and its pause is over.
    expect(breakerDecision({ payments: [], stops }, new Date(NOW.getTime() + 27 * MINUTE))).toBeNull();
  });

  it("takes the pause that ends last when several rules trip", () => {
    const evidence: BreakerEvidence = {
      payments: [],
      stops: [
        ...[1, 2, 3, 4, 5].map((n) => ({ reason: "quote_failed", ownerId: n === 5 ? "two" : "one", at: minutesAgo(n) })),
        { reason: "pin_mismatch", ownerId: "one", at: minutesAgo(8) },
      ],
    };
    expect(breakerTrips(evidence, NOW).map((trip) => trip.rule).sort()).toEqual(["gateway", "pin_mismatch"]);
    // Gateway: 1 minute ago + 15 = 14 minutes on. Pin mismatch: 8 minutes ago + 30 = 22 minutes on.
    expect(breakerDecision(evidence, NOW)?.rule).toBe("pin_mismatch");
  });

  it("keeps the numbers the brief names, with two accounts behind every rule but the pin mismatch", () => {
    expect(BREAKER_RULES).toEqual({
      unanswered: { rows: 3, owners: 2, windowMinutes: 15, pauseMinutes: 30 },
      gateway: { failures: 5, owners: 2, windowMinutes: 10, pauseMinutes: 15 },
      signature: { failures: 5, owners: 2, windowMinutes: 10, pauseMinutes: 15 },
      pin_mismatch: { failures: 1, windowMinutes: 30, pauseMinutes: 30 },
    });
  });
});
