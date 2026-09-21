import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import { Providers } from "@/components/providers";
import { commandIndex, unreadNotifications, viewerSession } from "@/components/common/data-access";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // The per-request CSP nonce, set on the request headers by `src/proxy.ts`. Next
  // stamps its own scripts with it automatically; Base UI's components (the sliders,
  // among others) render their own inline `<script>` and `<style>` tags and need to
  // be told, which is what `CSPProvider` inside `Providers` does with this.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const session = await viewerSession();
  const userId = session?.userId ?? null;
  const [unreadCount, index] = await Promise.all([
    unreadNotifications(userId),
    commandIndex(userId),
  ]);

  return (
    <Providers nonce={nonce}>
      <AppShell unreadCount={unreadCount} index={index}>
        {children}
        {/* Owned by UI-SOCIAL; a null-rendering stub lives at this path on ui-core. */}
        <OnboardingModal />
      </AppShell>
    </Providers>
  );
}
