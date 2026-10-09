"use client";

import { Component, Suspense, useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { gateDecision, type FirstRunMode, type FirstRunProfile } from "./gate-decision";
import { onboardingSuppressedOn } from "./suppress";

/*
 * Both surfaces are seen once per account, so neither's code is in the bundle every
 * page loads.
 *
 * The first-run card is not `ssr: false`: rendered on the server, its chunk is asked for
 * with the page instead of after hydration. None of it reaches the HTML, because a dialog
 * is a portal and this one opens after it mounts. `next/dynamic` puts no Suspense
 * boundary around a component it renders on the server, so the gate has its own: without
 * one, arriving from /login would hold the whole app back until the card's code landed.
 */
const FirstRun = dynamic(() => import("./first-run").then((mod) => mod.FirstRun));
const KeyPrompt = dynamic(() => import("./key-prompt").then((mod) => mod.KeyPrompt), { ssr: false });

/** Same key the key prompt writes when it is dismissed. */
const STORAGE_KEY = "tocker:onboarding-dismissed";

const noSubscribe = () => () => {};
const isForced = () => new URLSearchParams(window.location.search).get("onboarding") === "1";
const isDismissed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage unavailable (private mode, sandboxed webviews): let the prompt decide.
    return false;
  }
};

/** One first-run, kept as it was when it started. */
interface Run {
  mode: FirstRunMode;
  profile: FirstRunProfile;
}

/**
 * Mounted from the app layout, on every page. It starts at most one of two things, and
 * whichever it starts stays started until the next full page load (`gateDecision`):
 *
 * - **The first-run screens**, for an account that has never chosen its username and
 *   avatar. The server decides (`needsOnboarding` is `users.onboarded_at IS NULL`, read by
 *   the layout), so no request made here stands between a new account and the answer.
 *   The run is latched with the profile it opened with, because the refresh after a save
 *   re-renders the layout with `needsOnboarding` false while the screens after the first
 *   are still open. `?onboarding=1` previews the same screens for an account that is
 *   through them.
 *
 * - **The key prompt**, for an account that owns agents and may have no LLM key, as
 *   before: ruled out here when signed out, dismissed on this device or held back on
 *   this page (`./suppress`), and otherwise left to ask whether a key exists.
 *
 * Nothing is drawn here before the first-run card. It is a dialog over the app, and until
 * its code has arrived the page the person is on is simply the app: seen, and live. That
 * is a frame or two on a full load, where the code is asked for with the page, and one
 * request after /login's client navigation. Nothing pressed in that time is lost: the
 * gate is in the layout, so the card opens over whichever page the press led to, the
 * builder included. A like or a follow made in that moment goes out under the name the
 * account was given at sign-up. Search opened in it stays open under the card, and is
 * given none of the keys pressed in the card (`paletteTakesKey`, search-palette.tsx).
 * That is the whole cost; holding the app back for it would mean covering the page with
 * something that has to be taken away again when the code never comes.
 *
 * The URL and localStorage are the browser's, so the server snapshots say "not forced"
 * and "dismissed", and the first client render agrees; the real answers land right
 * after hydration.
 */
export function OnboardingGate({
  needsOnboarding = false,
  profile = null,
  ownedAgentCount = 0,
  payPerUseAllowed = false,
}: {
  /** The signed-in account has never been through the first-run screens. */
  needsOnboarding?: boolean;
  /** The signed-in account's public face, or null when signed out. */
  profile?: FirstRunProfile | null;
  ownedAgentCount?: number;
  /** Whether this viewer may build an agent that needs no key, which changes what the key prompt says. */
  payPerUseAllowed?: boolean;
}) {
  const { ready, session } = useSession();
  const forced = useSyncExternalStore(noSubscribe, isForced, () => false);
  const dismissed = useSyncExternalStore(noSubscribe, isDismissed, () => true);
  const pathname = usePathname();

  // Set in the first render when the server asks for it, so the server renders the card's
  // (empty) shell too and its code is asked for with the page.
  const [run, setRun] = useState<Run | null>(() => (needsOnboarding && profile ? { mode: "real", profile } : null));
  const [keyPrompt, setKeyPrompt] = useState(false);
  // The card has closed, or could not be loaded, and is out of the tree. `run` stays as
  // it was, so nothing else starts in its place before the next full page load.
  const [cardDone, setCardDone] = useState(false);

  // Worked out here, under the state above, not beside the other reads: the lint rule
  // that checks `useCallback` loses track of a setter declared between a value's first
  // line and the call that takes it, and then rejects every callback below.
  const suppressed = onboardingSuppressedOn(pathname);
  const decision = gateDecision({
    signedIn: profile !== null,
    needsOnboarding,
    ownedAgentCount,
    forced,
    started: run ? "first-run" : keyPrompt ? "key-prompt" : "nothing",
    heldBack: suppressed,
    sessionReady: ready && session !== null,
    dismissed,
  });
  // Latched while rendering, not in an effect: each of these makes `started` say so, and
  // the decision is "nothing" from then on.
  if (profile && decision === "first-run") setRun({ mode: "real", profile });
  else if (profile && decision === "preview") setRun({ mode: "preview", profile });
  else if (decision === "key-prompt") setKeyPrompt(true);

  const dropCard = useCallback(() => setCardDone(true), []);

  return (
    <>
      {run && !cardDone ? (
        <CardBoundary onError={dropCard}>
          <Suspense fallback={null}>
            <FirstRun mode={run.mode} profile={run.profile} ownsAgent={ownedAgentCount > 0} onClosed={dropCard} />
          </Suspense>
        </CardBoundary>
      ) : null}
      {/* The mount is latched, so the prompt may already be on its way from the page
          before: it is told when this page holds it back, and does not open here either. */}
      {keyPrompt ? <KeyPrompt payPerUseAllowed={payPerUseAllowed} suppressed={suppressed} /> : null}
    </>
  );
}

/**
 * Catches the first-run card failing to load or to render, and leaves the app as it is.
 * The gate is drawn by the app layout, whose errors no route boundary catches: without
 * this, a card whose code never arrives would take every page down with it. The account
 * is asked again on its next visit.
 */
class CardBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[onboarding] the first-run card did not load", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
