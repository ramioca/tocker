"use client";

/**
 * Agents / Activity switch. A hot path, so the tabs themselves get only a 150ms
 * indicator slide — no content transition, no layout animation.
 */
import { useState } from "react";

const TABS = [
  { id: "agents", label: "Agents" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ProfileTabs({
  agentsSlot,
  activitySlot,
  agentCount,
}: {
  agentsSlot: React.ReactNode;
  activitySlot: React.ReactNode;
  agentCount: number;
}) {
  const [active, setActive] = useState<TabId>("agents");
  const index = TABS.findIndex((t) => t.id === active);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Profile sections"
        className="relative inline-flex rounded-lg border border-border/80 bg-card p-0.5"
      >
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0.5 rounded-[7px] bg-muted transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ width: `calc((100% - 4px) / ${TABS.length})`, transform: `translateX(${index * 100}%)` }}
        />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`profile-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls="profile-panel"
            onClick={() => setActive(tab.id)}
            className={`relative z-10 h-7 rounded-[7px] px-3.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              active === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.id === "agents" ? (
              <span className="ml-1.5 font-mono tabular-nums opacity-60">{agentCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Only the active panel is mounted: the activity heatmap measures its own
          width, and a chart born inside `display: none` measures zero. */}
      <div
        role="tabpanel"
        id="profile-panel"
        aria-labelledby={`profile-tab-${active}`}
        className="mt-6"
      >
        {active === "agents" ? agentsSlot : activitySlot}
      </div>
    </div>
  );
}
