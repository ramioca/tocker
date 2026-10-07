"use client";

import { useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { onboardingSuppressedOn } from "./suppress";

/*
 * The modal, its three steps and the key form behind them are a first-run surface:
 * a user sees them once. Every other page view would download them for nothing, so
 * they load only once the gate below has decided this visit might show them.
 */
const OnboardingModal = dynamic(() => import("./onboarding-modal").then((mod) => mod.OnboardingModal), {
  ssr: false,
});

/** Same key the modal writes when it is dismissed. */
const STORAGE_KEY = "tocker:onboarding-dismissed";

const noSubscribe = () => () => {};
const isForced = () => new URLSearchParams(window.location.search).get("onboarding") === "1";
const isDismissed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage unavailable (private mode, sandboxed webviews): let the modal decide.
    return false;
  }
};

/**
 * Mounted from the app layout in place of the modal. It rules out what can be ruled
 * out without a request — signed out, or dismissed on this device — and hands the
 * rest (does this account have a key yet?) to the modal, which still decides for
 * itself. `?onboarding=1` forces it, as it always has. On the builder it stays closed
 * unless forced (`./suppress`): that page asks for the key itself, on its Brain step.
 * Nothing is written when it is held back, so it still opens on the next page that is not
 * the builder. `ownedAgentCount` comes from the server layout so an owner is asked only
 * for the missing key, not walked through setup.
 * `payPerUseAllowed` comes from there too: whether this viewer may build an agent that
 * needs no key, which changes what the modal says a key is for.
 *
 * The URL and localStorage are the browser's, so the server snapshots say "no" and
 * the first client render agrees; the real answer lands right after hydration.
 */
export function OnboardingGate({
  ownedAgentCount = 0,
  payPerUseAllowed = false,
}: {
  ownedAgentCount?: number;
  payPerUseAllowed?: boolean;
}) {
  const { ready, session } = useSession();
  const forced = useSyncExternalStore(noSubscribe, isForced, () => false);
  const dismissed = useSyncExternalStore(noSubscribe, isDismissed, () => true);
  const suppressed = onboardingSuppressedOn(usePathname());
  const candidate = forced || (!suppressed && ready && session !== null && !dismissed);

  // Latched: dismissing writes the flag this reads, and unmounting the modal then
  // would cut its exit transition off mid-way.
  const [mounted, setMounted] = useState(false);
  if (candidate && !mounted) setMounted(true);

  // The mount is latched, so the modal may already be on its way from the page before:
  // it is told when this page holds it back, and does not open here either.
  return mounted ? (
    <OnboardingModal
      ownedAgentCount={ownedAgentCount}
      payPerUseAllowed={payPerUseAllowed}
      suppressed={suppressed && !forced}
    />
  ) : null;
}
