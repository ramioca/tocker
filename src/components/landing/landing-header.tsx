"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LoginButton } from "@/components/auth/login-button";
import { useSession } from "@/hooks/use-session";
import { TockerMark } from "./petri-mark";

export function LandingHeader() {
  const { session } = useSession();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <TockerMark size={22} />
          tocker
        </Link>

        <nav aria-label="Marketing" className="hidden items-center gap-1 text-sm sm:flex">
          <a
            href="#how"
            className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            How it works
          </a>
          <a
            href="#features"
            className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Features
          </a>
          <a
            href="#exits"
            className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Exits
          </a>
          <Link
            href="/discover"
            className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Leaderboard
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {/* No `ready` skeleton here: on the marketing page the logged-out CTA is the
              right default, and a pulsing placeholder in the header reads as broken. */}
          {session ? (
            <Link
              href="/home"
              className="lp-press inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-8 sm:px-3"
            >
              Open app
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <>
              <Link
                href="/feed"
                className="lp-press hidden h-8 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:inline-flex"
              >
                See the feed
              </Link>
              <LoginButton className="lp-press inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 sm:h-8 sm:px-3" />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
