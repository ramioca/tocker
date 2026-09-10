/**
 * PLACEHOLDER (ui-social). UI-CORE owns the app shell — its version wins at merge.
 * A minimal sidebar so the ui-social routes can be developed and reviewed in isolation.
 * The only piece meant to survive is the `<OnboardingModal />` mount, which UI-CORE
 * should carry over into the real shell.
 */
import Link from "next/link";
import { Compass, Bell, Settings, Rss, Bot, User } from "lucide-react";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";

const NAV = [
  { href: "/feed", label: "Feed", icon: Rss },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/agents/new", label: "Agents", icon: Bot },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/u/rami", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="sticky top-0 z-30 shrink-0 border-b border-border bg-background/80 backdrop-blur md:h-screen md:w-56 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:px-5 md:py-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden
              className="inline-block size-5 rounded-[6px] bg-primary shadow-[0_0_18px_-4px_var(--primary)]"
            />
            Vibe
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
      <OnboardingModal />
    </div>
  );
}
