import "server-only";
import type { LeaderboardRow, LeaderboardWindow, TrendingToken, DataSourceInfo } from "@/server/types";

export async function getLeaderboard(_window: LeaderboardWindow, _limit?: number): Promise<LeaderboardRow[]> { throw new Error("not implemented: foundation workstream"); }
export async function getTrendingTokens(_limit?: number): Promise<TrendingToken[]> { throw new Error("not implemented: foundation workstream"); }
export async function getTopDataSources(_limit?: number): Promise<Array<DataSourceInfo & { agentCount: number; spendUsd: number }>> { throw new Error("not implemented: foundation workstream"); }
