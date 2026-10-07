import { formatUsd } from "@/components/common/format";
import type { CostFacts } from "./contract";
import type { BuilderDraft } from "./types";

export interface CommitSentenceProps {
  draft: BuilderDraft;
  facts: CostFacts;
  /** "signing" renders only the fund-mode prefix, or nothing. Left out, it means "all". */
  part?: "all" | "signing";
}

/**
 * The cost sentence of the bottom bar, `sm` and up: what a day of this agent costs and
 * whose bill each part is. Moved word for word from `agent-builder.tsx`; the figures come
 * from `costFacts`, the same ones the agent card quotes.
 *
 * "all" starts with the signing prefix in fund mode, as the bar always has, so a caller
 * renders one part or the other, never both.
 */
export function CommitSentence({ draft, facts, part = "all" }: CommitSentenceProps) {
  const { runsPerDay, thinking, heldForLive, costPerRun, providerLabel } = facts;
  const { risk, execution } = draft.config;

  const signing =
    draft.funding.mode === "fund" ? (
      <>
        You will sign transfers of{" "}
        <span className="tnum font-mono">{formatUsd(draft.funding.amountUsd)}</span> USDC right after it is created.{" "}
      </>
    ) : null;
  if (part === "signing") return signing;

  return (
    <>
      {signing}
      {runsPerDay === 0 ? (
        <>Manual runs only — nothing is spent until you press Run now.</>
      ) : thinking && !thinking.model ? (
        // No listed model, no price: saying "$0.00 a day" would be a number nobody stands behind.
        <>Pick a model for pay-per-use thinking to see what a day of runs is expected to cost.</>
      ) : thinking ? (
        // Pay per use: the thinking is the agent's own bill, in USDC, on every run.
        <>
          {heldForLive ? "No ticks until you switch it live on the checklist. Then ~" : "~"}
          <span className="tnum font-mono">{thinking.runsPerDay}</span> runs/day. Each run pays for its own
          thinking in USDC from the agent&rsquo;s wallet (≈
          <span className="tnum font-mono">{formatUsd(thinking.runUsd)}</span>, about{" "}
          <span className="tnum font-mono">{formatUsd(thinking.dayUsd)}</span> a day); its data (≈
          <span className="tnum font-mono">{formatUsd(costPerRun)}</span>) is paid by Tocker.
          {heldForLive
            ? null
            : execution.mode === "approve"
              ? " Proposes paper trades for you to approve."
              : " Paper trades until you go live."}
        </>
      ) : heldForLive ? (
        // The Mode card promises it never trades paper, so this line cannot count
        // paper runs: nothing ticks until the hold-to-confirm on the checklist.
        <>
          No ticks until you switch it live on the checklist. Then ~
          <span className="tnum font-mono">{runsPerDay}</span> runs/day, each billing model tokens to your{" "}
          {providerLabel} key; its data (≈<span className="tnum font-mono">{formatUsd(costPerRun)}</span>) is
          paid by Tocker.
        </>
      ) : (
        // The run count used to stand next to the data estimate alone, which is the
        // part Tocker pays. The model bill is the owner's, on every run, traded or not.
        <>
          ~<span className="tnum font-mono">{runsPerDay}</span> runs/day. Each run bills model tokens to your{" "}
          {providerLabel} key; its data (≈<span className="tnum font-mono">{formatUsd(costPerRun)}</span>,
          capped at <span className="tnum font-mono">{formatUsd(risk.maxDataSpendUsdPerRun)}</span>) is paid by
          Tocker.{" "}
          {execution.mode === "approve" ? "Proposes paper trades for you to approve." : "Paper trades until you go live."}
        </>
      )}
    </>
  );
}
