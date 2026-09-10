import "server-only";
import type { AgentCard, AgentDetail, Page, RunSummary, RunDetail, TradeRow, EquityPoint, LeaderboardWindow, DataSourceInfo } from "@/server/types";

export async function getAgentBySlug(_slug: string, _viewerId?: string | null): Promise<AgentDetail | null> { throw new Error("not implemented: foundation workstream"); }
export async function getAgentById(_id: string, _viewerId?: string | null): Promise<AgentDetail | null> { throw new Error("not implemented: foundation workstream"); }
export async function listMyAgents(_userId: string): Promise<AgentCard[]> { throw new Error("not implemented: foundation workstream"); }
export async function listPublicAgents(_opts?: { cursor?: string | null; limit?: number; sort?: "new" | "pnl" | "followers" }): Promise<Page<AgentCard>> { throw new Error("not implemented: foundation workstream"); }
export async function getAgentRuns(_agentId: string, _cursor?: string | null): Promise<Page<RunSummary>> { throw new Error("not implemented: foundation workstream"); }
export async function getRun(_runId: string, _viewerId?: string | null): Promise<RunDetail | null> { throw new Error("not implemented: foundation workstream"); }
export async function getAgentTrades(_agentId: string, _cursor?: string | null): Promise<Page<TradeRow>> { throw new Error("not implemented: foundation workstream"); }
export async function getEquitySeries(_agentId: string, _window: LeaderboardWindow): Promise<EquityPoint[]> { throw new Error("not implemented: foundation workstream"); }
/** Static registry + (optionally) Bazaar search results. OWNER: runtime provides registry; foundation exposes it here. */
export async function listDataSources(_query?: string): Promise<DataSourceInfo[]> { throw new Error("not implemented: foundation workstream"); }
