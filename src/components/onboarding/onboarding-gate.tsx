"use client";

import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { FirstRunGround } from "./first-run-ground";
import { gateDecision, keptFromPage, type FirstRunMode, type FirstRunProfile } from "./gate-decision";
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

/**
 * How long the ground waits for the card's code before it gives the app back. The
 * request is made with the page, so this is only ever reached on a connection that has
 * stalled, and a black screen with nothing to press is worse than being asked next time.
 */
const CARD_PATIENCE_MS = 12_000;

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
 *   re-renders the layout with `needsOnboarding` false while the second screen is still
 *   open. `?onboarding=1` previews the same screens for an account that is through them.
 *
 * - **The key prompt**, for an account that owns agents and may have no LLM key, as
 *   before: ruled out here when signed out, dismissed on this device or held back on
 *   this page (`./suppress`), and otherwise left to ask whether a key exists.
 *
 * The ground behind the first-run card is drawn here, not by the card. It is a few lines
 * that are already loaded, so on a full load it is in the server's HTML and after
 * /login's client navigation it is in the first commit: the app is never seen first,
 * however late the card's code is.
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

  // Set in the first render when the server asks for it, so the server's HTML and the
  // first client render both carry the ground.
  const [run, setRun] = useState<Run | null>(() => (needsOnboarding && profile ? { mode: "real", profile } : null));
  const [keyPrompt, setKeyPrompt] = useState(false);
  const [ground, setGround] = useState<"up" | "leaving" | "gone">("up");
  const [cardOpen, setCardOpen] = useState(false);
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

  const cardReady = useRef(false);
  const onReady = useCallback(() => {
    cardReady.current = true;
  }, []);
  const onOpen = useCallback(() => setCardOpen(true), []);
  const onClosing = useCallback(() => setGround((now) => (now === "up" ? "leaving" : now)), []);
  const dropGround = useCallback(() => setGround("gone"), []);
  // The card's exit and the ground's fade take the same time. Whichever ends first, the
  // card's end takes both away, so a fade whose last event never arrives (a hidden tab)
  // cannot leave the ground mounted.
  const dropAll = useCallback(() => {
    setGround("gone");
    setCardDone(true);
  }, []);

  const waiting = run !== null && ground === "up";
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      if (!cardReady.current) dropAll();
    }, CARD_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, dropAll]);

  // The ground hides the app from a pointer, not from a keyboard. Until the card opens
  // and its dialog takes the keys (a frame, or as long as its code takes to arrive), none
  // reaches the app: Tab would walk links nobody can see, and ⌘K would open the palette
  // under the ground. Caught on the way down, before any listener of the app's.
  const keysHeld = waiting && !cardOpen;
  useEffect(() => {
    if (!keysHeld) return;
    const hold = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (keptFromPage(event)) event.preventDefault();
    };
    window.addEventListener("keydown", hold, true);
    window.addEventListener("keyup", hold, true);
    return () => {
      window.removeEventListener("keydown", hold, true);
      window.removeEventListener("keyup", hold, true);
    };
  }, [keysHeld]);

  return (
    <>
      {run && ground !== "gone" ? <FirstRunGround leaving={ground === "leaving"} onGone={dropGround} /> : null}
      {run && !cardDone ? (
        <CardBoundary onError={dropAll}>
          <Suspense fallback={null}>
            <FirstRun
              mode={run.mode}
              profile={run.profile}
              ownsAgent={ownedAgentCount > 0}
              onReady={onReady}
              onOpen={onOpen}
              onClosing={onClosing}
              onClosed={dropAll}
            />
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
 * Catches the first-run card failing to load or to render, and gives the app back. The
 * ground is opaque: without this, a card that never arrives leaves a new account looking
 * at a black screen. The account is asked again on its next visit.
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
