/**
 * The admin's pay-per-use card, rendered to markup.
 *
 * The first line of the card is a verdict: what a payment asked for this second would be
 * told. An operator acts on that line, so each state it can be in is pinned, in the order
 * the ledger itself would refuse. The rest checks that what came from outside is drawn
 * as text and never as markup, and that the controls offer the safe direction first.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminInference } from "@/server/queries/admin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
// The real module is a set of server actions; the card only needs their names to exist.
vi.mock("@/server/actions/admin", () => ({
  setInferenceHaltAction: vi.fn(),
  clearInferencePauseAction: vi.fn(),
  testInferenceSignatureAction: vi.fn(),
}));

const { InferenceCard } = await import("./inference-card");

function data(overrides: Partial<AdminInference> = {}): AdminInference {
  return {
    switches: {
      stage: "owner",
      invitedUsers: 2,
      stepUsd: 0.25,
      ownerDayUsd: 25,
      platformDayUsd: 2,
      agentDayRequests: 600,
      rpcConfigured: true,
      mock: false,
    },
    day: "2026-10-06",
    today: {
      platformUsd: 1.25,
      platformRequests: 41,
      owners: 2,
      agents: 3,
      largestOwnerUsd: 1,
      manualRuns: 3,
      byStatus: [
        { status: "paid_no_answer", count: 1, usd: 0.03 },
        { status: "settled", count: 38, usd: 1.1 },
      ],
    },
    open: [],
    openCounts: { reserved: 0, signed: 0, unconfirmed: 0 },
    control: { halted: false, haltReason: null, haltClearedAt: null, pausedUntil: null, pauseReason: null, updatedBy: null, updatedAt: null, stops: null },
    breakers: [
      { rule: "unanswered", count: 1, agents: 1, threshold: 3, windowMinutes: 15, tripped: false },
      { rule: "gateway", count: 0, agents: null, threshold: 5, windowMinutes: 10, tripped: false },
      { rule: "signature", count: 0, agents: null, threshold: 5, windowMinutes: 10, tripped: false },
      { rule: "pin_mismatch", count: 0, agents: null, threshold: 1, windowMinutes: 30, tripped: false },
    ],
    holds: [],
    wallets: [{ walletId: "pw_1", address: "PayerSolanaAddress1111111111111111111111111", agentName: "Alpha", agentSlug: "alpha", ownerHandle: "rami", payPerUse: true }],
    ...overrides,
  };
}

const render = (value: AdminInference) => renderToStaticMarkup(createElement(InferenceCard, { data: value }));
const withSwitches = (switches: Partial<AdminInference["switches"]>) => data({ switches: { ...data().switches, ...switches } });
const withControl = (control: Partial<AdminInference["control"]>) => data({ control: { ...data().control, ...control } });

describe("what a payment asked for right now would be told", () => {
  it("is refused while the feature is switched off, whatever else is true", () => {
    const html = render(withSwitches({ stage: "off" }));
    expect(html).toContain("Refused: pay-per-use is switched off (INFERENCE_USDC).");
    expect(html).toContain("Switched off");
  });

  it("is refused under an admin halt, and the halt's reason and author are shown", () => {
    const html = render(withControl({ halted: true, stops: "halted", haltReason: "ledger and chain disagree", updatedBy: "@boss", updatedAt: "2026-10-06T12:00:00.000Z" }));
    expect(html).toContain("Refused: an admin has halted pay-per-use.");
    expect(html).toContain("ledger and chain disagree");
    expect(html).toContain("Set by @boss");
    // Halted: the control offered is the one that clears it, in two presses.
    expect(html).toContain("Clear the halt");
    expect(html).not.toContain("Halt pay-per-use</button>");
  });

  it("is refused under a breaker's pause, with the way to end it early", () => {
    const html = render(withControl({ stops: "paused", pausedUntil: "2026-10-06T12:30:00.000Z", pauseReason: "3 paid steps from 2 agents got no answer within 15 minutes" }));
    expect(html).toContain("Refused: a breaker has paused pay-per-use.");
    expect(html).toContain("3 paid steps from 2 agents got no answer within 15 minutes");
    expect(html).toContain("End the pause now");
  });

  it("is refused without an RPC of our own, at a zero limit, and at a limit that is reached", () => {
    expect(render(withSwitches({ rpcConfigured: false }))).toContain("Refused: SOLANA_RPC_URL is not set");
    expect(render(withSwitches({ platformDayUsd: 0 }))).toContain("Refused: the platform&#x27;s daily limit is zero.");
    expect(render(data({ today: { ...data().today, platformUsd: 2 } }))).toContain("Refused: the platform&#x27;s daily limit is reached.");
  });

  it("says who is allowed when nothing refuses, and that mock mode pays nothing", () => {
    expect(render(data())).toContain("Allowed for admins and invited accounts, within every cap.");
    expect(render(withSwitches({ stage: "on" }))).toContain("Allowed for every account, within every cap.");
    expect(render(withSwitches({ mock: true }))).toContain("Mock mode: nothing is paid");
  });
});

describe("the figures", () => {
  it("sets today's counters against their caps", () => {
    const html = render(data());
    expect(html).toContain("$1.25 of $2.00");
    expect(html).toContain("41 requests");
    expect(html).toContain("$1.00 of $25.00");
    expect(html).toContain("2 accounts · 3 agents · 3 by hand");
    expect(html).toContain("38 settled ($1.10)");
    expect(html).toContain("1 paid no answer ($0.03)");
  });

  it("names a tripped breaker and the agents that are held", () => {
    const html = render(
      data({
        breakers: [{ rule: "unanswered", count: 3, agents: 2, threshold: 3, windowMinutes: 15, tripped: true }, ...data().breakers.slice(1)],
        holds: [{ reason: "needs_funds", agents: 4 }],
      }),
    );
    expect(html).toContain("3 from 2 agents in 15 min · pauses at 3 from 2 agents · tripped");
    expect(html).toContain("4 · Add USDC to keep thinking");
  });
});

describe("rows still open", () => {
  it("says so when there are none", () => {
    expect(render(data())).toContain("Nothing is open.");
  });

  it("draws a provider's words as text, never as markup", () => {
    const html = render(
      data({
        open: [
          {
            id: "p1",
            status: "unconfirmed",
            agentName: "Alpha",
            agentSlug: "alpha",
            ownerHandle: "rami",
            model: "google/gemini-2.5-flash",
            quotedUsd: 0.07,
            createdAt: "2026-10-06T12:00:00.000Z",
            signedAt: "2026-10-06T12:00:01.000Z",
            httpStatus: 502,
            detail: '<img src=x onerror="alert(1)"> upstream [redacted]',
          },
          { id: "p2", status: "reserved", agentName: null, agentSlug: null, ownerHandle: null, model: "openai/gpt-4o-mini", quotedUsd: 0.02, createdAt: "2026-10-06T12:01:00.000Z", signedAt: null, httpStatus: null, detail: null },
        ],
        openCounts: { reserved: 1, signed: 0, unconfirmed: 1 },
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain('href="/agents/alpha"');
    expect(html).toContain("@rami");
    expect(html).toContain("deleted agent");
    expect(html).toContain("1 reserved · 0 signed · 1 unconfirmed");
  });
});

describe("the controls", () => {
  it("offer the halt with a required reason, and the signature test for the listed wallets", () => {
    const html = render(data());
    expect(html).toContain("Halt pay-per-use for every agent");
    expect(html).toContain("Why (required)");
    // No reason typed yet: the halt button cannot be pressed.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?Halt pay-per-use<\/button>/);
    expect(html).toContain("Test a signature (nothing is sent)");
    expect(html).toContain("Alpha · @rami · Paye…1111 · pays per use");
    // Not paused, so there is no pause to end.
    expect(html).not.toContain("End the pause now");
  });

  it("say so when there is no wallet that could sign", () => {
    expect(render(data({ wallets: [] }))).toContain("No real Solana agent wallet exists yet.");
  });
});
