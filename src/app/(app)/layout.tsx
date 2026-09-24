import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
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
  const [unreadCount, index, mine, killSwitch] = await Promise.all([
    unreadNotifications(userId),
    commandIndex(userId),
    // Only the slugs: "My agents" lights up on the viewer's own agent pages and no one else's.
    myAgents(userId),
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
      {/* Owned by UI-SOCIAL; a null-rendering stub lives at this path on ui-core. */}
      <OnboardingModal />
    </AppShell>
  );
}
