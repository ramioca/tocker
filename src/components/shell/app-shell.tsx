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
      <TopBar unreadCount={unreadCount} onOpenSearch={() => setPaletteOpen(true)} />
      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>

      <MobileTabBar unreadCount={unreadCount} />
      <RunIsland />
      <CommandMenu open={paletteOpen} onClose={closePalette} index={index} />
    </div>
  );
}
