/**
 * Server-side data access for the UI-CORE surfaces.
 *
 * Every read goes through `withMock`, so a page written against these helpers
 * works today (mock) and after the foundation workstream lands (real) without
 * a single edit. Only this module knows the mock exists.
 */
import "server-only";
import { withMock } from "@/lib/data";
import { getSession } from "@/lib/auth";
import {
  getAgentBySlug,
  getAgentRuns,
  getAgentTrades,
  getEquitySeries,
  getRun,
  listDataSources,
  listMyAgents,
  listPublicAgents,
} from "@/server/queries/agents";
import { getComments, getFeed } from "@/server/queries/feed";
import { getMyLlmKeys, getUnreadNotificationCount } from "@/server/queries/users";
import { getAgentWalletBalances } from "@/server/actions/wallets";
import {
  MOCK_VIEWER_ID,
  POPULAR_TOKENS,
  mockAgentCards,
  mockAgentDetail,
  mockAgentRuns,
  mockAgentTrades,
  mockComments,
  mockDataSources,
  mockEquitySeries,
  mockFeed,
  mockLlmKeys,
  mockMyAgents,
  mockPublicAgents,
  mockRun,
  mockSession,
  mockUnreadNotificationCount,
  mockUsers,
  mockWalletBalances,
} from "@/mocks/core";
import type {
  AgentCard,
  AgentDetail,
  Chain,
  CommentRow,
  DataSourceInfo,
  EquityPoint,
  FeedItem,
  LeaderboardWindow,
  LlmKeyRow,
  Page,
  RunDetail,
  RunSummary,
  Session,
  TradeRow,
  WalletBalance,
} from "@/server/types";
import type { CommandIndex } from "@/components/shell/command-index";

export function viewerSession(): Promise<Session | null> {
  return withMock(() => getSession(), () => mockSession);
}

export function unreadNotifications(userId: string | null): Promise<number> {
  if (!userId) return Promise.resolve(0);
  return withMock(() => getUnreadNotificationCount(userId), () => mockUnreadNotificationCount());
}

export function myAgents(userId: string | null): Promise<AgentCard[]> {
  if (!userId) return Promise.resolve([]);
  return withMock(() => listMyAgents(userId), () => mockMyAgents());
}

export function publicAgents(): Promise<Page<AgentCard>> {
  return withMock(() => listPublicAgents({ limit: 24 }), () => mockPublicAgents(24));
}

export function agentBySlug(slug: string, viewerId: string | null): Promise<AgentDetail | null> {
  return withMock(() => getAgentBySlug(slug, viewerId), () => mockAgentDetail(slug));
}

export function agentRuns(agentId: string, cursor?: string | null): Promise<Page<RunSummary>> {
  return withMock(() => getAgentRuns(agentId, cursor), () => mockAgentRuns(agentId, cursor));
}

export function runDetail(runId: string, viewerId: string | null): Promise<RunDetail | null> {
  return withMock(() => getRun(runId, viewerId), () => mockRun(runId));
}

export function agentTrades(agentId: string, cursor?: string | null): Promise<Page<TradeRow>> {
  return withMock(() => getAgentTrades(agentId, cursor), () => mockAgentTrades(agentId, cursor));
}

export function equitySeries(agentId: string, window: LeaderboardWindow): Promise<EquityPoint[]> {
  return withMock(() => getEquitySeries(agentId, window), () => mockEquitySeries(agentId, window));
}

export function dataSources(query?: string): Promise<DataSourceInfo[]> {
  return withMock(
    () => listDataSources(query),
    () =>
      query
        ? mockDataSources.filter((source) =>
            `${source.name} ${source.description} ${source.category}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
        : mockDataSources,
  );
}

/**
 * KNOWN GAP: there is no `listTokens()` query yet, so the builder's quick-add
 * chips come from the seed registry. Swap the source when one exists.
 */
export async function popularTokens(): Promise<
  Array<{ chain: Chain; address: string; symbol: string; name: string | null }>
> {
  return POPULAR_TOKENS.map((token) => ({
    chain: token.chain,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
  }));
}

export function llmKeys(userId: string | null): Promise<LlmKeyRow[]> {
  if (!userId) return Promise.resolve([]);
  return withMock(() => getMyLlmKeys(userId), () => mockLlmKeys());
}

export function feedPage(opts: {
  scope: "global" | "following";
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
}): Promise<Page<FeedItem>> {
  return withMock(() => getFeed(opts), () => mockFeed(opts));
}

export function commentsPage(postId: string, cursor?: string | null): Promise<Page<CommentRow>> {
  return withMock(() => getComments(postId, cursor), () => mockComments(postId, cursor));
}

export async function walletBalances(agentId: string): Promise<WalletBalance[]> {
  return withMock(
    async () => {
      const result = await getAgentWalletBalances(agentId);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    () => mockWalletBalances(agentId),
  );
}

/** Everything ⌘K can jump to, flattened for the client. */
export async function commandIndex(userId: string | null): Promise<CommandIndex> {
  const [mine, publics] = await Promise.all([myAgents(userId), publicAgents()]);
  const bySlug = new Map<string, AgentCard>();
  for (const agent of [...mine, ...publics.items]) bySlug.set(agent.slug, agent);
  const agents = [...bySlug.values()];

  // KNOWN GAP: no query exposes the token universe yet, so the palette seeds
  // itself from the registry list. Swap for a `listTokens()` query when one exists.
  const tokens = new Map<string, CommandIndex["tokens"][number]>();
  for (const token of POPULAR_TOKENS) {
    tokens.set(token.id, {
      symbol: token.symbol,
      name: token.name,
      chain: token.chain,
      address: token.address,
    });
  }

  const users = new Map<string, CommandIndex["users"][number]>();
  for (const agent of agents) {
    users.set(agent.owner.handle, {
      handle: agent.owner.handle,
      displayName: agent.owner.displayName,
    });
  }

  return {
    agents: agents.map((agent) => ({
      slug: agent.slug,
      name: agent.name,
      tagline: agent.tagline,
      mode: agent.mode,
    })),
    tokens: [...tokens.values()],
    users: [...users.values()],
  };
}

export { MOCK_VIEWER_ID, mockAgentCards, mockUsers };
