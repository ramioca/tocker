/** The agent page's tabs, in order. `?tab=` is validated against this list. */
export const AGENT_TABS = ["overview", "trades", "performance", "runs", "config"] as const;

export type AgentTab = (typeof AGENT_TABS)[number];

/** `?tab=` from the URL, or undefined for anything that is not one of the tabs. */
export function parseAgentTab(value: string | null | undefined): AgentTab | undefined {
  return value && (AGENT_TABS as readonly string[]).includes(value) ? (value as AgentTab) : undefined;
}
