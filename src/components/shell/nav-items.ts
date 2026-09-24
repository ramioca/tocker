import { Banknote, Bell, Bot, Compass, LayoutGrid, Radio, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile tab bar (space for five at most). */
  mobile?: boolean;
}

/**
 * Home is first and is where login lands: your money, your agents, your
 * decisions. The feed is the room next door — it is everyone else's activity,
 * which is worth reading but is not what you opened the app to check.
 *
 * Money sits straight after the agents that make it: Home is "what do I own",
 * Money is "is it working" — equity against every fee, data payment and token
 * the operation spent to earn it.
 *
 * Only five of these fit the phone's tab bar, so Notifications gives up its
 * slot: it is the one primary destination already reachable from every screen,
 * with its unread count, through the bell in the top bar.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: LayoutGrid, mobile: true },
  { href: "/feed", label: "Feed", icon: Radio, mobile: true },
  { href: "/discover", label: "Discover", icon: Compass, mobile: true },
  { href: "/agents", label: "My agents", icon: Bot, mobile: true },
  { href: "/money", label: "Money", icon: Banknote, mobile: true },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Whether `href`'s nav entry should read as the current page.
 *
 * "My agents" means mine: the list, the builder, and agent pages this viewer owns.
 * Someone else's agent is reached from Discover or the feed, and lighting "My agents"
 * there would claim it as yours — so when the caller knows the viewer's slugs, any
 * other `/agents/<slug>` lights nothing. Without them it falls back to the prefix.
 */
export function isActivePath(pathname: string, href: string, ownedSlugs?: ReadonlySet<string>): boolean {
  if (href === "/home") return pathname === "/home" || pathname === "/";
  if (href === "/agents" && ownedSlugs) {
    if (pathname === "/agents") return true;
    const [, root, slug] = pathname.split("/");
    return root === "agents" && slug !== undefined && (slug === "new" || ownedSlugs.has(slug));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
