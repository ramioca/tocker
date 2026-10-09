import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EMPTY_COMMAND_INDEX } from "@/components/shell/command-index";
import { OnboardingGate } from "@/components/onboarding/onboarding-gate";
import { commandIndex, myAgents, unreadNotifications, viewerSession } from "@/components/common/data-access";
import { withMock } from "@/lib/data";
import { getKillSwitch, type KillSwitchState } from "@/lib/security/kill-switch";
import { payPerUseAllowedFor } from "@/server/queries/agents";

const TRADING_RUNS: KillSwitchState = { paused: false, pausedAt: null };

/**
 * Keyboard focus and anchor jumps must not land under the chrome: the sticky top bar
 * (3.5rem) and, on phones, the fixed tab bar (the bar is md:hidden, so the bottom value
 * is too). Rendered by this layout rather than written in globals.css so it exists
 * exactly while the shell does — server-rendered, so from the first paint (a deep link's
 * initial scroll included), and gone on a client navigation out to the landing page or
 * sign-in. A sticky sub-nav or action bar adds to it from globals.css; those selectors
 * carry an attribute, so they outrank this one in any order.
 */
const SHELL_SCROLL_PADDING =
  "html{scroll-padding-top:4rem}@media (max-width:767px){html{scroll-padding-bottom:calc(4.25rem + env(safe-area-inset-bottom))}}";

/**
 * The account-wide pause has to be visible from every page, not just the Security tab —
 * a user who pauses and forgets would otherwise see agents that look active and never
 * trade. It is a banner, so a failed read hides it rather than taking the app down.
 */
function killSwitchFor(userId: string | null): Promise<KillSwitchState> {
  if (!userId) return Promise.resolve(TRADING_RUNS);
  return withMock(() => getKillSwitch(userId), () => TRADING_RUNS).catch((error: unknown) => {
    console.error("[app-layout] kill switch read failed", error);
    return TRADING_RUNS;
  });
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await viewerSession();
  const userId = session?.userId ?? null;
  // Everything below only decorates the chrome — a badge, the ⌘K index, which nav item
  // is lit. The route's error boundary cannot catch this layout's own errors, so a throw
  // here would replace every page, top bar and tab bar included, with the root error
  // screen. Each read degrades to its empty answer instead, as the kill switch does.
  const [unreadCount, index, mine, killSwitch, payPerUseAllowed] = await Promise.all([
    unreadNotifications(userId).catch((error: unknown) => {
      console.error("[app-layout] unread count failed", error);
      return 0;
    }),
    commandIndex(userId).catch((error: unknown) => {
      console.error("[app-layout] command index failed", error);
      return EMPTY_COMMAND_INDEX;
    }),
    // Only the slugs and the count: "My agents" lights up on the viewer's own agent pages
    // and no one else's, and the first-run screens skip "build your first agent" for an owner.
    myAgents(userId).catch((error: unknown) => {
      console.error("[app-layout] my agents failed", error);
      return [];
    }),
    killSwitchFor(userId),
    // For the key prompt's wording only. It never throws, and answers "no" when in doubt.
    payPerUseAllowedFor(session),
  ]);

  // The client providers (auth, the query cache, run status, tooltips) come from the
  // parent `src/app/(client)/layout.tsx`, which /login shares, so signing in and moving
  // into the app keeps one Privy instance and one query cache.
  return (
    <>
      <style>{SHELL_SCROLL_PADDING}</style>
      <AppShell
        unreadCount={unreadCount}
        index={index}
        ownedSlugs={mine.map((agent) => agent.slug)}
        tradingPaused={killSwitch.paused}
        pausedAt={killSwitch.pausedAt}
      >
        {children}
        {/* Who sees the first-run screens is decided here, on the server, once per account:
            an account whose `onboarded_at` is null. Strictly null, so a session without the
            field (a mock) never opens them. The gate opens the card over whichever page
            this is, and loads its code only for an account that will see it. */}
        <OnboardingGate
          needsOnboarding={session?.onboardedAt === null}
          profile={
            session
              ? { handle: session.handle, avatarUrl: session.avatarUrl, avatarSeed: session.avatarSeed ?? null }
              : null
          }
          ownedAgentCount={mine.length}
          payPerUseAllowed={payPerUseAllowed}
        />
      </AppShell>
    </>
  );
}
