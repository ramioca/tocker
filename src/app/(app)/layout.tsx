import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import { commandIndex, unreadNotifications, viewerSession } from "@/components/common/data-access";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await viewerSession();
  const userId = session?.userId ?? null;
  const [unreadCount, index] = await Promise.all([
    unreadNotifications(userId),
    commandIndex(userId),
  ]);

  return (
    <AppShell unreadCount={unreadCount} index={index}>
      {children}
      {/* Owned by UI-SOCIAL; a null-rendering stub lives at this path on ui-core. */}
      <OnboardingModal />
    </AppShell>
  );
}
