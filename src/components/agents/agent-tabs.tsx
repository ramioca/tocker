"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const TABS = [
    { value: "overview", label: "Overview", panel: overview },
    { value: "trades", label: "Trades", panel: trades },
    ...(performance ? [{ value: "performance", label: "Performance", panel: performance }] : []),
    { value: "runs", label: "Runs", panel: runs },
    { value: "config", label: configLabel, panel: config },
  ];

  return (
    <Tabs defaultValue="overview" className="gap-4">
      <TabsList variant="line" className="h-9">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="px-3">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.panel}
        </TabsContent>
      ))}
    </Tabs>
  );
}
