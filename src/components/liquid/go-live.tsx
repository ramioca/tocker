"use client";

import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** How long the demo's "Live (demo)" state lasts before it puts itself back on paper. */
const GO_LIVE_DEMO_MS = 3200;

/** Four of the real readiness checks (src/lib/security/live-readiness.ts), by their titles. */
const CHECKS = ["Real agent wallets", "Funded above the minimum", "Spend caps applied", "Trading is not paused"] as const;

/**
 * A sample of the go-live gesture. In the app, going live is its own screen
 * with a checklist and this same hold; here a completed hold only flips a
 * local badge, then both the badge and Spectrum's button reset on the same
 * clock. Nothing navigates, nothing is sent.
 */
export function GoLiveDemo() {
  const [live, setLive] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const confirm = () => {
    setLive(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLive(false);
      timer.current = null;
    }, GO_LIVE_DEMO_MS);
  };

  return (
    <div className="lp-golive lp-frame" data-live={live}>
      <div className="lp-golive-head">
        <h3 className="lp-golive-title">Go live</h3>
        <span className="lp-label lp-golive-meta">demo · nothing is sent</span>
      </div>
      <div className="lp-golive-body">
        {/* Static state text: the button's own status region announces the confirmation. */}
        <p className="lp-sr">{live ? "Mode: live (demo)" : "Mode: paper"}</p>
        <div className="lp-golive-state lp-mono" aria-hidden>
          <span className="lp-golive-mode" data-on={!live}>
            paper
          </span>
          <svg className="lp-golive-arrow" width="16" height="8" viewBox="0 0 16 8" fill="none">
            <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="lp-golive-mode" data-on={live}>
            live
          </span>
        </div>
        <ul className="lp-golive-checks" aria-label="Checklist, sample">
          {CHECKS.map((c) => (
            <li key={c}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="7.25" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" />
                <path d="M5 8.2 7 10.2 11 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {c}
            </li>
          ))}
        </ul>
        <HoldToConfirmButton
          duration={2_200}
          size="lg"
          label="Hold to go live"
          confirmedLabel="Live (demo)"
          resetDelay={GO_LIVE_DEMO_MS}
          icon={<Zap className="size-4" aria-hidden />}
          ariaLabel="Demo: hold to go live. Press and hold for 2.2 seconds. Nothing is sent."
          onConfirm={confirm}
          className="lp-golive-btn lp-btn-ghost lp-btn-lg"
        />
      </div>
      <p className="lp-golive-note">
        Every agent starts on paper. In the app, going live is its own screen: the checklist, then this hold. A tap
        can&rsquo;t do it.
      </p>
    </div>
  );
}
