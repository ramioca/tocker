/**
 * What the Money page draws about pay-per-use thinking, rendered to markup.
 *
 * Two promises are pinned here that no query test can see. An owner who has never paid
 * for a step sees the page exactly as it was: no line, no column, no word about it. And
 * an owner who has sees the amount once in each place, the steps that got no answer
 * with their transaction, and never a sentence a provider wrote.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MoneyAgentRow, MoneySummary, MoneyTotals, ThinkingSummary } from "@/server/queries/money";
import { AgentMoneyTable } from "./agent-money-table";
import { sumCosts } from "./cost-totals";
import { CostsNote } from "./costs-note";
import { MoneyHeadline } from "./money-headline";

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
    thinkingSimulatedUsd: 0,
    runCount: 4,
    tradeCount: 2,
    winRate: null,
    firstFundedAt: null,
    stale: false,
    ...overrides,
  };
}

function totalsOf(rows: MoneyAgentRow[]): MoneyTotals {
  const costs = sumCosts(rows);
  const costsUsd = costs.feesUsd + costs.dataSpendUsd + costs.modelSpendUsd + costs.thinkingUsd;
  return {
    equityUsd: 100,
    cashUsd: 100,
    positionsUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    pnlUsd: 0,
    feesUsd: costs.feesUsd,
    dataSpendUsd: costs.dataSpendUsd,
    modelSpendUsd: costs.modelSpendUsd,
    thinkingUsd: costs.thinkingUsd,
    costsUsd,
    netUsd: -costsUsd,
    tradeCount: 2,
    agentCount: rows.length,
    pricedAgents: rows.length,
    unpricedAgents: 0,
    fundedUsd: 100,
  };
}

function summary(live: MoneyAgentRow[], thinking: ThinkingSummary | null, paper: MoneyAgentRow[] = []): MoneySummary {
  return {
    live,
    paper,
    totals: totalsOf(live),
    equity: [],
    basisUsd: 100,
    days: [],
    today: { pnlUsd: 0, pnlPct: 0, flowUsd: 0, thinkingUsd: thinking ? 0.12 : 0 },
    stale: false,
    thinking,
  };
}

const TX = "4".repeat(88);

const THINKING: ThinkingSummary = {
  paidUsd: 2.5,
  steps: 310,
  liveUsd: 1.75,
  paperUsd: 0.5,
  formerAgentsUsd: 0.25,
  unansweredUsd: 0.03,
  unansweredSteps: 2,
  checkingUsd: 0.01,
  checkingSteps: 1,
  simulatedUsd: 0,
  unanswered: [
    { id: "p1", agentName: "Beta", agentSlug: "beta", model: "google/gemini-2.5-flash", usd: 0.02, state: "unanswered", at: "2026-10-06T14:02:00.000Z", httpStatus: 502, txHash: TX },
    { id: "p2", agentName: null, agentSlug: null, model: "openai/gpt-4o-mini", usd: 0.01, state: "unanswered", at: "2026-10-05T09:30:00.000Z", httpStatus: null, txHash: null },
    { id: "p3", agentName: "Beta", agentSlug: "beta", model: "google/gemini-2.5-flash", usd: 0.01, state: "checking", at: "2026-10-06T15:00:00.000Z", httpStatus: null, txHash: null },
  ],
  ownKey: { ownKeyUsd: 0.84, paidUsd: 2.1, steps: 300, inputTokens: 2_400_000, outputTokens: 48_000, unpricedSteps: 3 },
};

const payer = row({
  id: "b",
  slug: "beta",
  name: "Beta",
  thinkSource: "usdc",
  thinkingModel: "google/gemini-2.5-flash",
  thinkingUsd: 1.75,
  thinkingSteps: 220,
  thinkingUnansweredUsd: 0.03,
  thinkingCheckingUsd: 0.01,
  modelSpendUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
});

const note = (s: MoneySummary, scope: "live" | "paper" = "live") =>
  renderToStaticMarkup(
    createElement(CostsNote, {
      summary: s,
      scope,
      totals: scope === "paper" ? sumCosts(s.paper) : undefined,
      feeUsd: 0.1,
      settleMinUsd: 1,
    }),
  );

describe("an owner who has never paid for a step", () => {
  const plain = summary([row()], null);

  it("sees the three costs and the same sentence about their own key, and nothing else", () => {
    const html = note(plain);
    expect(html).toContain("Tocker fee");
    expect(html).toContain("Market data");
    expect(html).toContain("Model tokens (estimate)");
    expect(html).toContain("You bring your own key, so this charge lands on your own Anthropic or OpenAI account");
    expect(html).not.toMatch(/pay per use|Thinking|BlockRun/i);
  });

  it("sees the table and the headline without a thinking column or figure", () => {
    const table = renderToStaticMarkup(createElement(AgentMoneyTable, { rows: plain.live, totals: plain.totals, label: "Live agent" }));
    expect(table).not.toContain("Thinking");
    // Eight columns, as before.
    expect(table.match(/<th /g)).toHaveLength(8);

    const headline = renderToStaticMarkup(createElement(MoneyHeadline, { summary: plain }));
    expect(headline).not.toMatch(/thinking/i);
    expect(headline).toContain("$0.20 fees · $0.30 data · $1.50 model");
  });
});

describe("an owner whose agents pay for their own thinking", () => {
  const paying = summary([row(), payer], THINKING);

  it("gets the line, with the live agents' exact amount, beside the other three", () => {
    const html = note(paying);
    expect(html).toContain("Thinking (pay per use)");
    // The scope's figure, so the four lines add up to the headline's Costs.
    expect(html).toContain("$1.75");
    expect(html).toContain("straight to BlockRun");
    expect(html).toContain("Tocker does not collect it");
    // The key sentence now speaks of the runs that used a key, not of every run.
    expect(html).toContain("For the runs that used your own key");
    expect(html).not.toContain("You bring your own key, so");
  });

  it("lists the steps that were paid for and not answered, with the transaction where there is one", () => {
    const html = note(paying);
    expect(html).toContain("Steps that were paid for and not answered");
    expect(html).toContain("Oct 6, 14:02 UTC");
    expect(html).toContain("paid, no answer (the provider returned 502)");
    expect(html).toContain(`href="https://solscan.io/tx/${TX}"`);
    expect(html).toContain("a deleted agent");
    expect(html).toContain("being checked against the chain");
    expect(html).toContain("got no answer");
    expect(html).toContain("not refunded");
    // One link out, for the one step that has a transaction.
    expect(html.match(/solscan\.io/g)).toHaveLength(1);
  });

  it("says what the rest of the account paid in a sentence, not in the total", () => {
    const html = note(paying);
    expect(html).toContain("Your paper agents paid $0.50 more");
    expect(html).toContain("Agents you have since deleted paid $0.25 more");
  });

  it("sets the list-price figure beside the paid one as a comparison, with what it leaves out", () => {
    const html = note(paying);
    expect(html).toContain("For comparison");
    expect(html).toContain("about $0.84");
    expect(html).toContain("the same steps cost $2.10");
    expect(html).toContain("3 more steps ran on a model with no list price");
    expect(html).not.toMatch(/save|cheaper|switch now/i);
  });

  it("adds the column to the table and the figure to the headline, once each", () => {
    const table = renderToStaticMarkup(createElement(AgentMoneyTable, { rows: paying.live, totals: paying.totals, label: "Live agent" }));
    expect(table.match(/<th /g)).toHaveLength(9);
    expect(table).toContain(">Thinking<");
    expect(table).toContain("220 paid steps · google/gemini-2.5-flash");
    // The agent on a key has paid nothing per use, and its row says so.
    expect(table.match(/\$1\.75/g)).toHaveLength(2); // the row and the total

    const headline = renderToStaticMarkup(createElement(MoneyHeadline, { summary: paying }));
    expect(headline).toContain("$1.75 thinking");
    expect(headline).toContain("and what your agents paid for their own thinking");
    expect(headline).toContain("excl. $0.12 thinking");
  });

  it("in a paper-only account, says the amount is real money though the book is not", () => {
    const paperPayer = { ...payer, mode: "paper" as const };
    const html = note(summary([], { ...THINKING, liveUsd: 0, paperUsd: 2.25 }, [paperPayer]), "paper");
    expect(html).toContain("Thinking (pay per use)");
    expect(html).toContain("this is real USDC from its real wallet");
    // Nothing is "elsewhere" when the note is about the paper agents themselves.
    expect(html).not.toContain("Your paper agents paid");
  });

  it("shows simulated spend as simulated, and a zero where no money moved", () => {
    const simulated: ThinkingSummary = { ...THINKING, paidUsd: 0, steps: 0, liveUsd: 0, paperUsd: 0, formerAgentsUsd: 0, unansweredUsd: 0, unansweredSteps: 0, checkingUsd: 0, checkingSteps: 0, simulatedUsd: 1.8, unanswered: [], ownKey: null };
    const mock = row({ id: "m", thinkSource: "usdc", thinkingSimulatedUsd: 1.8 });
    const html = note(summary([mock], simulated));
    expect(html).toContain("$1.80 more was simulated and moved no money");
    expect(html).not.toContain("Steps that were paid for and not answered");
    expect(html).not.toContain("For comparison");
    const table = renderToStaticMarkup(createElement(AgentMoneyTable, { rows: [mock], label: "Live agent" }));
    expect(table).toContain("$1.80 simulated, no money moved");
  });
});
