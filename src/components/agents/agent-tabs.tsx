"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseAgentTab, type AgentTab } from "./agent-tab";

/** How far the edge fade reaches into the strip, and the room left beside a revealed tab. */
const FADE_PX = 24;

/**
 * Server-rendered panels handed to a client tab strip. Switching tabs is a
 * frequent action, so it is a plain content swap with no transition.
 *
 * `configLabel` exists because the last tab means different things to different viewers:
 * the owner is looking at their own config, everyone else is looking at the reason they
 * cannot. The page decides which panel goes in it.
 *
 * `performance` sits between Trades and Runs: it is the reading of the trades, so
 * it belongs next to them rather than at the end. It is public like the rest of
 * the record — omit it (pass nothing) and the tab disappears.
 *
 * The selected tab lives in `?tab=`, so the way back from a run lands on Runs and a
 * link can point at someone's Performance tab. It is read with `useSearchParams`
 * rather than handed down by the page: Back restores the page from the router cache,
 * rendered for whatever URL it was first fetched at, while the hook follows the entry.
 */
export function AgentTabs({
  overview,
  trades,
  performance,
  runs,
  config,
  configLabel = "Config",
}: {
  overview: ReactNode;
  trades: ReactNode;
  performance?: ReactNode;
  runs: ReactNode;
  config: ReactNode;
  configLabel?: string;
}) {
  const searchParams = useSearchParams();
  const TABS: Array<{ value: AgentTab; label: string; panel: ReactNode }> = [
    { value: "overview", label: "Overview", panel: overview },
    { value: "trades", label: "Trades", panel: trades },
    ...(performance ? [{ value: "performance" as const, label: "Performance", panel: performance }] : []),
    { value: "runs", label: "Runs", panel: runs },
    { value: "config", label: configLabel, panel: config },
  ];

  // A `?tab=performance` link to an agent whose analytics did not load lands on Overview.
  const [tab, setTab] = useState<AgentTab>(() => {
    const wanted = parseAgentTab(searchParams.get("tab"));
    return TABS.some((t) => t.value === wanted) ? wanted! : "overview";
  });

  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  // Which edges still hide a tab. Only a phone-width strip overflows, and nothing
  // else on it says it scrolls.
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const start = list.scrollLeft > 1;
    const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    setFade((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Fires once on observe, which is the initial measurement. The tabs are observed
    // too: a web font landing widens them without resizing the list itself.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const tab of list.querySelectorAll('[role="tab"]')) observer.observe(tab);
    list.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", measure);
    };
  }, [measure]);

  // Keep the selected tab clear of the fade — a `?tab=config` link on a phone would
  // otherwise open with its own tab off the end of the strip. `scrollLeft` rather than
  // `scrollIntoView`, which would also scroll the page to reach a strip below the fold.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !active) return;
    const outer = list.getBoundingClientRect();
    const inner = active.getBoundingClientRect();
    if (inner.left < outer.left + FADE_PX) list.scrollLeft -= outer.left + FADE_PX - inner.left;
    else if (inner.right > outer.right - FADE_PX) list.scrollLeft += inner.right - (outer.right - FADE_PX);
  }, [tab]);

  function select(value: AgentTab) {
    setTab(value);
    // Native `replaceState` is synced into the Next router without a server round trip,
    // and replacing rather than pushing keeps Back meaning "the page before this one".
    const url = new URL(window.location.href);
    if (value === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  }

  const mask =
    fade.start || fade.end
      ? `linear-gradient(to right, ${fade.start ? `transparent, #000 ${FADE_PX}px` : "#000"}, ${
          fade.end ? `#000 calc(100% - ${FADE_PX}px), transparent` : "#000"
        })`
      : undefined;

  return (
    <Tabs value={tab} onValueChange={(value) => select(value as AgentTab)} className="gap-4">
      {/*
        `justify-center-safe`: a centred strip that overflows spills past its *left*
        edge, where no scroll position can reach it, and "Overview" loses its first
        letter at 390px. Safe centring falls back to start alignment only then.
      */}
      {/* Taller on a phone: this strip is the page's navigation, and a 25px trigger
          is a miss waiting to happen under a thumb. Group-scoped, because the list's own
          `group-data-horizontal/tabs:h-8` outranks a plain `h-*`. Only the list grows —
          the triggers already fill it (`h-[calc(100%-1px)]`), so the underline keeps
          its offset from the bottom edge rather than being pushed past it. */}
      <TabsList
        ref={listRef}
        variant="line"
        className="h-9 justify-center-safe max-sm:group-data-horizontal/tabs:h-11"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="px-3">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.panel}
        </TabsContent>
      ))}
    </Tabs>
  );
}
