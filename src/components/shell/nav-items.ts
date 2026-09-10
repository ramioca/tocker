import { Bell, Bot, Compass, Home, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile tab bar (space for five at most). */
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/feed", label: "Feed", icon: Home, mobile: true },
  { href: "/discover", label: "Discover", icon: Compass, mobile: true },
  { href: "/agents", label: "My agents", icon: Bot, mobile: true },
  { href: "/notifications", label: "Notifications", icon: Bell, mobile: true },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/feed") return pathname === "/feed" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
