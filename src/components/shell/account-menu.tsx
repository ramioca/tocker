"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Bot, IdCard, LogOut, Settings, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginButton } from "@/components/auth/login-button";
import { UserAvatar } from "@/components/common/user-avatar";
import { useSession } from "@/hooks/use-session";

// Opened a handful of times ever; loaded on the first click rather than with every page.
const AccountModal = dynamic(() => import("./account-modal").then((mod) => mod.AccountModal), {
  ssr: false,
});

/**
 * The top-right account entry, fomo-style: everything about "me" hangs off the
 * avatar. Navigation destinations are plain links; "Account details" is a modal
 * because it is a reference card (email, handle), not a place.
 */
export function AccountMenu() {
  const { ready, session, logout } = useSession();
  const [accountOpen, setAccountOpen] = useState(false);
  // Latches on the first open, so the modal stays mounted for its close transition.
  const [accountWanted, setAccountWanted] = useState(false);

  // Privy not hydrated yet: hold the space so the bar doesn't reflow on login.
  if (!ready) return <div className="size-8 rounded-full bg-muted/40" aria-hidden />;

  if (!session) {
    return (
      <LoginButton className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60" />
    );
  }

  const name = session.displayName ?? session.handle;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          // A grid, so the avatar is laid out as a box and the button is exactly its size.
          className="grid rounded-full transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.95] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Account menu"
        >
          <UserAvatar user={session} px={32} className="size-8" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* Base UI: a Label is a GroupLabel and throws outside a Group. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {session.email ?? `@${session.handle}`}
              </p>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href={`/u/${session.handle}`} />}>
            <UserCircle aria-hidden className="size-4" />
            Your profile
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/agents" />}>
            <Bot aria-hidden className="size-4" />
            My agents
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setAccountWanted(true);
              setAccountOpen(true);
            }}
          >
            <IdCard aria-hidden className="size-4" />
            Account details
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings aria-hidden className="size-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
            <LogOut aria-hidden className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {accountWanted ? <AccountModal open={accountOpen} onOpenChange={setAccountOpen} session={session} /> : null}
    </>
  );
}
