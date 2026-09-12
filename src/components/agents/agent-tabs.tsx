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
 */
export function AgentTabs({
  overview,
  trades,
  runs,
  config,
  configLabel = "Config",
}: {
  overview: ReactNode;
  trades: ReactNode;
  runs: ReactNode;
  config: ReactNode;
  configLabel?: string;
}) {
  const panels: Record<string, ReactNode> = { overview, trades, runs, config };
  const TABS = [
    { value: "overview", label: "Overview" },
    { value: "trades", label: "Trades" },
    { value: "runs", label: "Runs" },
    { value: "config", label: configLabel },
  ] as const;

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
          {panels[tab.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
