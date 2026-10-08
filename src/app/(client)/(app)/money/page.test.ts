/**
 * The Money page itself, rendered to markup, for what only the page decides: the sentence
 * under the Costs heading, and whether there is a Costs section at all.
 *
 * Two promises are pinned at the route, because a helper being right is no use if the
 * page stops asking it:
 *
 *  - An owner who has never paid for a step (every owner while pay-per-use is switched
 *    off) reads the Costs hint word for word as it was before the feature existed. The
 *    two sentences below are copied from the page as it stands on the main branch.
 *  - An owner who has deleted every agent, and whose deleted agents paid for their own
 *    thinking, is still shown what they paid. An owner with no agent and no such record
 *    sees the empty page exactly as before.
 *
 * `getMoney` is stubbed: the subject is what the page does with a summary, and the query
 * that makes one has its own tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MoneyAgentRow, MoneySummary, MoneyTotals, ThinkingSummary } from "@/server/queries/money";
import type { Session } from "@/server/types";

const getSession = vi.fn<() => Promise<Session | null>>();
vi.mock("@/lib/auth", () => ({ getSession: () => getSession() }));

const getMoney = vi.fn<(userId: string) => Promise<MoneySummary>>();
vi.mock("@/server/queries/money", async (importOriginal) => ({
  // The components under the page read the query module's pure helpers; only the read is replaced.
  ...(await importOriginal<typeof import("@/server/queries/money")>()),
  getMoney: (userId: string) => getMoney(userId),
}));

// A chart draws nothing these tests read, and needs a browser to measure itself.
vi.mock("@/components/charts/equity-chart", () => ({ EquityChart: () => null }));

// The page reads the viewer's zone for the chart from the `tz` cookie; outside a request
// there is none, which is a viewer whose zone is not known yet (the chart prints UTC).
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { default: MoneyPage } = await import("./page");
const { EMPTY_MONEY } = await import("@/server/queries/money");

const OWNER: Session = { userId: "did:privy:owner", handle: "owner", displayName: null, avatarUrl: null, email: "owner@example.com" };

/** The two hints exactly as the page printed them before pay-per-use existed. */
const HINT_LIVE = "Three different bills, only one of which we collect.";
const HINT_PAPER = "What your paper agents have cost so far. The fee is simulated; the model tokens are a real bill on your own key.";

function row(overrides: Partial<MoneyAgentRow> = {}): MoneyAgentRow {
  return {
    id: "a",
    slug: "alpha",
    name: "Alpha",
    avatarSeed: null,
    mode: "live",
    status: "active",
    model: "claude-sonnet-5-5",
    equityUsd: 100,
    cashUsd: 100,
    positionsUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    pnlUsd: 0,
    feesUsd: 0.2,
    feesAccruedUsd: 0,
    dataSpendUsd: 0.3,
    dataSpendSimulatedUsd: 0,
    modelSpendUsd: 1.5,
    inputTokens: 500_000,
    outputTokens: 50_000,
    thinkSource: "key",
    thinkingModel: null,
    thinkingUsd: 0,
    thinkingSteps: 0,
    thinkingUnansweredUsd: 0,
    thinkingCheckingUsd: 0,
    thinkingUncheckedUsd: 0,
    thinkingSimulatedUsd: 0,
    runCount: 4,
    tradeCount: 2,
    winRate: null,
    firstFundedAt: null,
    stale: false,
    ...overrides,
  };
}

function totalsOf(live: MoneyAgentRow[]): MoneyTotals {
  const sum = (pick: (agent: MoneyAgentRow) => number) => live.reduce((total, agent) => total + pick(agent), 0);
  const costsUsd = sum((a) => a.feesUsd + a.dataSpendUsd + (a.modelSpendUsd ?? 0) + a.thinkingUsd);
  return {
    ...EMPTY_MONEY.totals,
    equityUsd: sum((a) => a.equityUsd ?? 0),
    cashUsd: sum((a) => a.cashUsd ?? 0),
    feesUsd: sum((a) => a.feesUsd),
    dataSpendUsd: sum((a) => a.dataSpendUsd),
    modelSpendUsd: sum((a) => a.modelSpendUsd ?? 0),
    thinkingUsd: sum((a) => a.thinkingUsd),
    costsUsd,
    netUsd: -costsUsd,
    agentCount: live.length,
    pricedAgents: live.length,
    fundedUsd: live.length > 0 ? 100 : 0,
  };
}

function summary(live: MoneyAgentRow[], paper: MoneyAgentRow[], thinking: ThinkingSummary | null): MoneySummary {
  return { ...EMPTY_MONEY, live, paper, totals: totalsOf(live), basisUsd: 100, thinking };
}

/** A pay-per-use summary with one proven payment in it and nothing else. */
function paidThinking(overrides: Partial<ThinkingSummary> = {}): ThinkingSummary {
  return {
    paidUsd: 0.6,
    steps: 31,
    liveUsd: 0.6,
    paperUsd: 0,
    formerAgentsUsd: 0,
    unansweredUsd: 0,
    unansweredSteps: 0,
    checkingUsd: 0,
    checkingSteps: 0,
    checkingAnsweredUsd: 0,
    checkingAnsweredSteps: 0,
    uncheckedUsd: 0,
    uncheckedSteps: 0,
    uncheckedAnsweredUsd: 0,
    uncheckedAnsweredSteps: 0,
    simulatedUsd: 0,
    unanswered: [],
    ownKey: null,
    ...overrides,
  };
}

async function render(money: MoneySummary): Promise<string> {
  getSession.mockResolvedValue(OWNER);
  getMoney.mockResolvedValue(money);
  return renderToStaticMarkup(await MoneyPage());
}

/** The sentence under the Costs heading, or null when the page has no Costs section. */
function costsHint(html: string): string | null {
  const match = /<h2 id="money-costs-heading"[^>]*>Costs<\/h2><p[^>]*>([^<]*)<\/p>/.exec(html);
  return match ? match[1].replace(/&#x27;|&rsquo;|’/g, "'") : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the Costs hint for an owner who has never paid for a step", () => {
  it("is word for word what it always was, with live agents", async () => {
    const html = await render(summary([row()], [], null));
    expect(getMoney).toHaveBeenCalledWith(OWNER.userId);
    expect(costsHint(html)).toBe(HINT_LIVE);
    // And nothing else about pay-per-use is on the page.
    expect(html).not.toMatch(/pay per use|BlockRun|Four different bills/i);
  });

  it("is word for word what it always was, with paper agents only", async () => {
    const html = await render(summary([], [row({ mode: "paper" })], null));
    expect(costsHint(html)).toBe(HINT_PAPER);
    expect(html).not.toMatch(/pay per use|BlockRun/i);
  });
});

describe("the Costs hint for an owner whose agents have paid for their own thinking", () => {
  it("counts four bills, which is what the card under it then shows", async () => {
    const payer = row({ id: "b", slug: "beta", name: "Beta", thinkSource: "usdc", thinkingModel: "google/gemini-2.5-flash", thinkingUsd: 0.6, thinkingSteps: 31 });
    const html = await render(summary([payer], [], paidThinking()));
    expect(costsHint(html)).toBe("Four different bills, only one of which we collect.");
    expect(html).toContain("Thinking (pay per use)");
    expect(html).not.toContain(HINT_LIVE);
  });

  it("keeps every word of the paper sentence and adds the one thing that is new", async () => {
    const payer = row({ id: "p", mode: "paper", thinkSource: "usdc", thinkingUsd: 0.6, thinkingSteps: 31 });
    const hint = costsHint(await render(summary([], [payer], paidThinking({ liveUsd: 0, paperUsd: 0.6 }))));
    expect(hint).toContain(HINT_PAPER);
    expect(hint).toContain("real USDC from the agent's own wallet");
  });
});

describe("an owner with no agent", () => {
  it("sees the empty page exactly as before when nothing was ever paid per use", async () => {
    const html = await render(EMPTY_MONEY);
    expect(html).toContain("No agents yet");
    expect(costsHint(html)).toBeNull();
    expect(html).not.toMatch(/pay per use|BlockRun|Costs/i);
  });

  it("is still shown what the agents they deleted paid for their own thinking", async () => {
    const former = paidThinking({
      liveUsd: 0,
      formerAgentsUsd: 0.6,
      unansweredUsd: 0.15,
      unansweredSteps: 1,
      unanswered: [
        { id: "f1", agentName: null, agentSlug: null, model: "google/gemini-2.5-flash", usd: 0.15, state: "unanswered", at: "2026-10-04T10:00:00.000Z", httpStatus: 502, txHash: null },
      ],
    });
    const html = await render({ ...EMPTY_MONEY, thinking: former });
    // The page is still the empty one, and under it the record the ledger kept.
    expect(html).toContain("No agents yet");
    expect(costsHint(html)).toContain("You have no agents now");
    expect(html).toContain("Thinking (pay per use)");
    expect(html).toContain("What the agents you have since deleted paid");
    expect(html).toContain("$0.60");
    expect(html).toContain("$0.15 of what was paid bought 1 step that got no answer");
    // One line, about thinking: not three ordinary bills at zero.
    expect(html).not.toMatch(/Tocker fee|Market data|Model tokens/);
  });
});
