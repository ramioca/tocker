import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EMPTY_COMMAND_INDEX } from "@/components/shell/command-index";
import { OnboardingGate } from "@/components/onboarding/onboarding-gate";
import { commandIndex, myAgents, unreadNotifications, viewerSession } from "@/components/common/data-access";
import { withMock } from "@/lib/data";
import { getKillSwitch, type KillSwitchState } from "@/lib/security/kill-switch";

const TRADING_RUNS: KillSwitchState = { paused: false, pausedAt: null };

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
  const [unreadCount, index, mine, killSwitch] = await Promise.all([
    unreadNotifications(userId).catch((error: unknown) => {
      console.error("[app-layout] unread count failed", error);
      return 0;
    }),
    commandIndex(userId).catch((error: unknown) => {
      console.error("[app-layout] command index failed", error);
      return EMPTY_COMMAND_INDEX;
    }),
    // Only the slugs: "My agents" lights up on the viewer's own agent pages and no one else's.
    myAgents(userId).catch((error: unknown) => {
      console.error("[app-layout] my agents failed", error);
      return [];
    }),
    killSwitchFor(userId),
  ]);

  return (
    <AppShell
      unreadCount={unreadCount}
      index={index}
      ownedSlugs={mine.map((agent) => agent.slug)}
      tradingPaused={killSwitch.paused}
      pausedAt={killSwitch.pausedAt}
    >
      {children}
      {/* First-run only, so the modal's code loads behind a gate rather than on every page. */}
      <OnboardingGate />
    </AppShell>
  );
}
