"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, LogOut, Settings, UserCircle, Wallet } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useSession } from "@/hooks/use-session";
import { AccountModal } from "./account-modal";

/**
 * The top-right account entry, fomo-style: everything about "me" hangs off the
 * avatar. Navigation destinations are plain links; "Manage account" is a modal
 * because it is a reference card (email, handle), not a place.
 */
export function AccountMenu() {
  const { ready, session, logout } = useSession();
  const [accountOpen, setAccountOpen] = useState(false);

  // Privy not hydrated yet: hold the space so the bar doesn't reflow on login.
  if (!ready) return <div className="size-8 rounded-full bg-muted/40" aria-hidden />;

  if (!session) {
    return (
      <LoginButton className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60" />
    );
  }

  const name = session.displayName ?? session.handle;
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-full transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.95] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            {session.avatarUrl ? <AvatarImage src={session.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
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
          <DropdownMenuItem onClick={() => setAccountOpen(true)}>
            <Wallet aria-hidden className="size-4" />
            Manage account
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings aria-hidden className="size-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
            <LogOut aria-hidden className="size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} session={session} />
    </>
  );
}
