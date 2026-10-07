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
/** What the card handed its controls, each time it was drawn. The controls themselves are the real ones. */
const handedToControls: Array<{ halted: boolean; haltReason: string | null }> = [];
vi.mock("./inference-controls", async (original) => {
  const real = await original<typeof import("./inference-controls")>();
  return {
    ...real,
    InferenceControls: (props: Parameters<typeof real.InferenceControls>[0]) => {
      handedToControls.push({ halted: props.halted, haltReason: props.haltReason });
      return real.InferenceControls(props);
    },
  };
});
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
      rpcPublic: false,
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
    openCounts: { reserved: 0, signed: 0, unconfirmed: 0, answered_unproven: 0 },
    noVerdictInTime: 0,
    checkedForHours: 6,
    lateLookDays: 7,
    control: { halted: false, haltReason: null, haltClearedAt: null, pausedUntil: null, pauseReason: null, updatedBy: null, updatedAt: null, stops: null },
    breakers: [
      { rule: "unanswered", count: 1, accounts: 1, accountsThreshold: 2, threshold: 3, windowMinutes: 15, tripped: false },
      { rule: "gateway", count: 0, accounts: 0, accountsThreshold: 2, threshold: 5, windowMinutes: 10, tripped: false },
      { rule: "signature", count: 0, accounts: 0, accountsThreshold: 2, threshold: 5, windowMinutes: 10, tripped: false },
      { rule: "pin_mismatch", count: 0, accounts: null, accountsThreshold: null, threshold: 1, windowMinutes: 30, tripped: false },
    ],
    holds: [],
    wallets: [{ walletId: "pw_1", address: "PayerSolanaAddress1111111111111111111111111", agentName: "Alpha", agentSlug: "alpha", payPerUse: true }],
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

  it("warns, without refusing, when the RPC is the public endpoint: a payment would still be signed", () => {
    const html = render(withSwitches({ rpcPublic: true }));
    // Not a refusal, because the pay path does not refuse it. The caution is the point.
    expect(html).toContain("Allowed for admins and invited accounts, within every cap. But SOLANA_RPC_URL is the public Solana endpoint");
    expect(html).toContain("a payment would still be signed");
    expect(html).not.toContain("Refused");
    // And nothing of the kind for an operator's own provider.
    expect(render(data())).not.toContain("public Solana endpoint");
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
        breakers: [{ rule: "unanswered", count: 3, accounts: 2, accountsThreshold: 2, threshold: 3, windowMinutes: 15, tripped: true }, ...data().breakers.slice(1)],
        holds: [{ reason: "needs_funds", agents: 4 }],
      }),
    );
    expect(html).toContain("3 from 2 accounts in 15 min · pauses at 3 from 2 accounts · tripped");
    // The gateway and signature rules need two accounts as well, and the card says so.
    expect(html).toContain("0 from 0 accounts in 10 min · pauses at 5 from 2 accounts<");
    // The one rule that needs only a count says nothing about accounts.
    expect(html).toContain("0 in 30 min · pauses at 1<");
    expect(html).toContain("4 · Add USDC to keep thinking");
  });

  it("shows one account's signature failures as what they are: many runs, one account, nothing tripped", () => {
    const html = render(
      data({
        breakers: data().breakers.map((breaker) =>
          breaker.rule === "signature" ? { ...breaker, count: 12, accounts: 1, tripped: false } : breaker,
        ),
      }),
    );
    expect(html).toContain("12 from 1 account in 10 min · pauses at 5 from 2 accounts<");
    expect(html).not.toContain("· tripped");
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
            noVerdictInTime: false,
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
          { id: "p2", status: "reserved", noVerdictInTime: false, agentName: null, agentSlug: null, ownerHandle: null, model: "openai/gpt-4o-mini", quotedUsd: 0.02, createdAt: "2026-10-06T12:01:00.000Z", signedAt: null, httpStatus: null, detail: null },
        ],
        openCounts: { reserved: 1, signed: 0, unconfirmed: 1, answered_unproven: 0 },
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain('href="/agents/alpha"');
    expect(html).toContain("@rami");
    expect(html).toContain("deleted agent");
    expect(html).toContain("1 reserved · 0 signed · 1 unconfirmed");
    // Nothing answered-and-unproven and nothing stuck: neither is named in the tile.
    expect(html).not.toContain("0 answered, unproven");
    expect(html).not.toMatch(/\d with no verdict in time/);
  });

  it("names an answered step whose payment is unproven, and a row no verdict was reached on in time", () => {
    const html = render(
      data({
        open: [
          { id: "p3", status: "unconfirmed", noVerdictInTime: true, agentName: "Alpha", agentSlug: "alpha", ownerHandle: "rami", model: "google/gemini-2.5-flash", quotedUsd: 0.2, createdAt: "2026-10-06T02:00:00.000Z", signedAt: "2026-10-06T02:00:01.000Z", httpStatus: 503, detail: null },
          { id: "p4", status: "answered_unproven", noVerdictInTime: false, agentName: "Alpha", agentSlug: "alpha", ownerHandle: "rami", model: "google/gemini-2.5-flash", quotedUsd: 0.09, createdAt: "2026-10-06T12:00:00.000Z", signedAt: "2026-10-06T12:00:01.000Z", httpStatus: 200, detail: null },
        ],
        openCounts: { reserved: 0, signed: 0, unconfirmed: 1, answered_unproven: 1 },
        noVerdictInTime: 1,
      }),
    );
    expect(html).toContain("0 reserved · 0 signed · 1 unconfirmed · 1 answered, unproven · 1 with no verdict in time");
    expect(html).toContain(">answered, unproven<");
    expect(html).toContain(">no verdict in time<");
    // What the fourth kind means, how long a row is checked for, and what to do past it.
    expect(html).toContain("kept out of the owner’s Money total and out of every P&amp;L");
    expect(html).toContain("for 6 hours from when a row was written");
    expect(html).toContain("looked at again only now and then, until 7 days old, and after that not at all");
    expect(html).toContain("scripts/inference-audit.ts");
  });
});

describe("what a clear of the halt is told the page showed", () => {
  const last = () => handedToControls[handedToControls.length - 1];

  it("is the reason the card prints, character for character", () => {
    const reason = "[2 findings] USDC went from an agent wallet to the gateway with no ledger row. Transaction 5h…k, wallet 9x…Q.\n | also (reconciler): a second finding";
    const html = render(withControl({ halted: true, stops: "halted", haltReason: reason, updatedBy: "reconciler", updatedAt: "2026-10-06T12:00:00.000Z" }));
    expect(last()).toEqual({ halted: true, haltReason: reason });
    // And it is on the page for the admin to read, whole.
    expect(html).toContain("a second finding");
    expect(html).toContain("If something has been added to the reason since this page was drawn, the clear");
  });

  it("is none when the card prints that no reason was recorded, and none when no halt is on", () => {
    const html = render(withControl({ halted: true, stops: "halted", haltReason: null }));
    expect(html).toContain("No reason was recorded.");
    expect(last()).toEqual({ halted: true, haltReason: null });

    // Off: nothing is shown as a reason, whatever the row still holds.
    render(withControl({ halted: false, haltReason: "left over from before" }));
    expect(last()).toEqual({ halted: false, haltReason: null });
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
    // The admin's own agents only, and the card says so; no other account is named.
    expect(html).toContain("Alpha · Paye…1111 · pays per use");
    expect(html).toContain("Only the wallets of your own agents are offered");
    // Not paused, so there is no pause to end.
    expect(html).not.toContain("End the pause now");
  });

  it("say so, truthfully, when none of the admin's own agents has a wallet that could sign", () => {
    const html = render(data({ wallets: [] }));
    // Other accounts may well have real Solana wallets; what is true is that this admin has none.
    expect(html).toContain("None of your own agents has a real Solana wallet yet.");
    expect(html).not.toContain("No real Solana agent wallet exists yet");
  });
});
