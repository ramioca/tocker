"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CommandMenu } from "./command-menu";
import { MobileTabBar } from "./mobile-tab-bar";
import { RunIsland } from "./run-island";
import { TopBar } from "./top-bar";
import type { CommandIndex } from "./command-index";

export function AppShell({
  unreadCount,
  index,
  children,
}: {
  unreadCount: number;
  index: CommandIndex;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-dvh w-full flex-col">
      {/*
        The first thing a keyboard reaches on every page. Hidden until focused,
        then it lands in the glass so it reads as chrome rather than an artefact.
      */}
      <a
        href="#main"
        className="glass-heavy focus-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60]"
      >
        Skip to content
      </a>

      <TopBar unreadCount={unreadCount} onOpenSearch={() => setPaletteOpen(true)} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 pb-24 outline-none md:pb-0">
        {children}
      </main>

      <MobileTabBar unreadCount={unreadCount} />
      <RunIsland />
      <CommandMenu open={paletteOpen} onClose={closePalette} index={index} />
    </div>
  );
}
