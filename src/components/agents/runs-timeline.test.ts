/**
 * The owner's run list, rendered to markup, for the one thing a query test cannot see:
 * what a run row says about a step that got no answer.
 *
 * A run's thinking amount and its error sentence are written when the run ends. A run
 * that stopped because a signed step got no answer is stored with "The agent paid for one
 * step …" and an amount that includes that step. Minutes later the reconciler may prove
 * the payment never landed (`not_charged`): Money then lists no such charge. Nothing
 * rewrites the stored sentence, and the stored amount is brought down only by a
 * best-effort write after that verdict. So the row must not say the step was paid, before
 * that write or after it.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describeInferenceStop } from "@/lib/x402/inference-types";
import type { Page, RunSummary } from "@/server/types";
import { NO_ANSWER_RUN_WORDS, RUN_SPEND_NOTE, RUN_SPEND_NOT_FINAL_NOTE, runThinking } from "./thinking";

// Server actions: the list is given its first page, so neither is called while rendering.
vi.mock("./agent-actions", () => ({ fetchAgentRuns: vi.fn(), fetchRunDetail: vi.fn() }));

const { RunsTimeline } = await import("./runs-timeline");

function run(overrides: Partial<RunSummary> & Record<string, unknown> = {}): RunSummary {
  return {
    id: "run_1",
    agentId: "agent_1",
    trigger: "schedule",
    status: "succeeded",
    startedAt: "2026-10-06T12:00:00.000Z",
    finishedAt: "2026-10-06T12:01:30.000Z",
    summary: "Held: nothing cleared the bar.",
    error: null,
    dataSpendUsd: 0.02,
    inputTokens: 1_000,
    outputTokens: 100,
    tradeCount: 0,
    refusedCount: 0,
    stepCount: 4,
    createdAt: "2026-10-06T12:00:00.000Z",
    ...overrides,
  } as RunSummary;
}

function render(runs: RunSummary[]): string {
  const page: Page<RunSummary> = { items: runs, nextCursor: null };
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(RunsTimeline, { agentId: "agent_1", agentSlug: "alpha", initialPage: page }),
    ),
  );
}

/** The run's own columns, as the query hands them to the owner. */
const thinkingOf = (inferenceSpendUsd: string, stopReason: string | null) =>
  runThinking({ llmSource: "usdc", model: "google/gemini-2.5-flash", inferenceSpendUsd, stopReason });

describe("a run that thought on a key", () => {
  it("renders exactly as it always has: no thinking line, its own summary", () => {
    const html = render([run()]);
    expect(html).toContain("Held: nothing cleared the bar.");
    expect(html).not.toMatch(/thinking|up to|Money has/);
  });
});

describe("a pay-per-use run", () => {
  it("shows what it was counted at, and does not call the figure paid", () => {
    const html = render([run({ thinking: thinkingOf("0.073400", null) })]);
    expect(html).toContain("$0.073");
    expect(html).toContain(`title="${RUN_SPEND_NOTE.replace(/'/g, "&#x27;")}"`);
    expect(html).not.toContain("Paid in USDC");
    expect(html).not.toContain("up to");
    // Its summary is its own.
    expect(html).toContain("Held: nothing cleared the bar.");
  });

  it("does not say a step was paid for when the run stopped because that step got no answer", () => {
    // As the run loop stores it: failed, with the contract's sentence as its error.
    const stored = describeInferenceStop("paid_no_answer").detail;
    const html = render([run({ status: "failed", summary: null, error: stored, thinking: thinkingOf("0.012000", "paid_no_answer") })]);

    // The amount may still come down, and says so.
    expect(html).toContain("up to $0.012");
    expect(html).toContain(`title="${RUN_SPEND_NOT_FINAL_NOTE.replace(/'/g, "&#x27;")}"`);
    expect(RUN_SPEND_NOT_FINAL_NOTE).toContain("for as long as the ledger counts it");
    // The row's sentence and its reason hold whether or not the payment landed.
    expect(html).toContain(NO_ANSWER_RUN_WORDS.title);
    expect(html).toContain("signed a payment for one step");
    expect(html).toContain("if the chain shows it never did, nothing was charged");
    // Not one word on the row says the money was taken.
    expect(html).not.toContain("The agent paid for one step");
    expect(html).not.toContain("paid for but not answered");
    expect(html).not.toContain("The charge is listed under Money");
    expect(html).not.toContain("Paid in USDC");
  });

  it("keeps every other stop's stored sentence and title", () => {
    const stored = describeInferenceStop("needs_funds").detail;
    const html = render([run({ status: "failed", summary: null, error: stored, thinking: thinkingOf("0.031000", "needs_funds") })]);
    expect(html).toContain("does not hold enough USDC for a run");
    expect(html).toContain(describeInferenceStop("needs_funds").title);
    expect(html).toContain("$0.031");
    expect(html).not.toContain("up to");
  });

  it("shows a visitor, who is sent no thinking and no error sentence, the same row as ever", () => {
    // What a non-owner receives for that same failed run: no `thinking`, a redacted error.
    const html = render([run({ status: "failed", summary: null, error: "Run failed" })]);
    expect(html).toContain("Run failed");
    expect(html).not.toMatch(/thinking|signed a payment/);
  });
});
