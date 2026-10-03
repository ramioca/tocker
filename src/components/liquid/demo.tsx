"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApprovalCard, type ApprovalDecision } from "@/components/spectrumui/blocks/ai-assistants/approval-card";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";
import { TokenIcon } from "@/components/common/token-icon";
import { COINS } from "./coins";
import { SAMPLE_PROPOSAL_TTL_MIN } from "./console-run";
import { SAMPLE_AGENT, SAMPLE_FLOOR, SAMPLE_ROWS, SAMPLE_STOP_PCT, SAMPLE_TAKE_PROFIT_PCT, SAMPLE_TRADE_USD } from "./sample";

/**
 * The end of the console's run: the first of its two proposals, waiting on the
 * owner. A local demo: Approve, Skip and the switch only change this card;
 * nothing is sent anywhere. The request never claims a gate result for the
 * real token it names.
 */

const TIBBIR = SAMPLE_ROWS.find((r) => r.coin === "TIBBIR")!;

const RESULT: Record<ApprovalDecision | "auto", { title: string; note: string }> = {
  approved: {
    title: `Approved · $${SAMPLE_TRADE_USD} of TIBBIR on paper`,
    note: "In the app it fills on paper and posts to the feed. This demo sends nothing.",
  },
  rejected: {
    title: "Skipped TIBBIR · no position opened",
    note: "The agent moves on. SOL is still waiting for your OK.",
  },
  auto: {
    title: "Approvals off · it buys on its own",
    note: "Your floor, your budget, your stop and the hard gates still apply to every entry.",
  },
};

export function ApprovalDemo() {
  const labelId = useId();
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [ask, setAsk] = useState(true);
  const outcome = !ask ? "auto" : decision;
  const result = outcome ? RESULT[outcome] : null;
  const waiting = !ask ? "none waiting" : decision ? "1 waiting · SOL" : "1 of 2 waiting";

  // The pressed button is hidden when the card turns over; move focus to
  // whatever replaces it so keyboard users keep their place.
  const stageRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const decide = (d: ApprovalDecision | null) => {
    moveFocus.current = true;
    setDecision(d);
  };
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const stage = stageRef.current;
    const target = outcome
      ? (stage?.querySelector<HTMLElement>(".lp-ap-replay") ?? stage?.querySelector<HTMLElement>(".lp-ap-result"))
      : stage?.querySelector<HTMLElement>(".lp-ap-req button");
    target?.focus();
  }, [outcome]);

  return (
    <div className="lp-ap" role="group" aria-labelledby={labelId}>
      <p className="lp-cx-label lp-label">
        <span id={labelId}>Waiting on you</span>
        <span className="lp-ap-count">{waiting}</span>
      </p>

      {/* One persistent live region: a region mounted already full is often not read. */}
      <p className="lp-sr" role="status">
        {result ? result.title : ""}
      </p>

      {/* Both faces share one grid cell, so the card never changes height when it turns over. */}
      <div ref={stageRef} className="lp-ap-stage" data-face={result ? "result" : "request"}>
        <div className="lp-ap-req" inert={result ? true : undefined}>
          <ApprovalCard
            className="lp-ap-card max-w-none"
            title={`${SAMPLE_AGENT} wants to buy TIBBIR`}
            description={`$${SAMPLE_TRADE_USD} on paper at a score of ${TIBBIR.score}, against your floor of ${SAMPLE_FLOOR}. Stop ${SAMPLE_STOP_PCT}%, take profit ${SAMPLE_TAKE_PROFIT_PCT}%.`}
            meta={`${TIBBIR.chain} · place_trade · expires in ${SAMPLE_PROPOSAL_TTL_MIN} min`}
            approveLabel="Approve buy"
            rejectLabel="Skip"
            decision={null}
            onDecide={decide}
          />
          <TokenIcon token={COINS.TIBBIR} size="md" className="lp-ap-coin" />
        </div>

        <div
          className="lp-ap-result"
          data-outcome={outcome ?? undefined}
          tabIndex={-1}
          inert={result ? undefined : true}
        >
          <span className="lp-ap-result-icon" aria-hidden>
            {outcome === "rejected" ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="lp-ap-result-body">
            <span className="lp-ap-result-title">{result?.title ?? RESULT.approved.title}</span>
            <span className="lp-ap-result-note">{result?.note ?? RESULT.approved.note}</span>
            {ask ? (
              <button type="button" className="lp-ap-replay lp-btn-ghost" onClick={() => decide(null)}>
                Show the request again
              </button>
            ) : null}
          </span>
        </div>
      </div>

      <div className="lp-ap-foot">
        <span className="lp-ap-foot-text">
          <span className="lp-ap-foot-title">Ask before entries</span>
          <span className="lp-ap-foot-note">
            {ask ? "On by default: it proposes, you decide." : "Off: it enters on its own."}
          </span>
        </span>
        <AnimatedSwitch
          label="Ask before entries"
          checked={ask}
          onCheckedChange={(on) => {
            setAsk(on);
            if (on) setDecision(null);
          }}
          className="lp-ap-switch"
        />
      </div>
    </div>
  );
}
