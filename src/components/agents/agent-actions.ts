"use server";

/**
 * Server-action bridge for the agent surfaces (builder, header, settings).
 * Same seam as `feed-actions`: client components call these, these call the
 * real actions through `withMock` so the UI works before the backend lands.
 */
import { revalidatePath } from "next/cache";
import { withMock } from "@/lib/data";
import {
  agentRuns,
  agentTrades,
  dataSources as readDataSources,
  runDetail,
  llmKeys as readLlmKeys,
  viewerSession,
  walletBalances as readWalletBalances,
} from "@/components/common/data-access";
import {
  createAgent,
  deleteAgent,
  setAgentStatus,
  triggerRun,
  updateAgent,
  type CreateAgentInput,
} from "@/server/actions/agents";
import { addLlmKey } from "@/server/actions/users";
import { isProvider, keyProblem, type LlmProvider } from "@/lib/agent/providers";
import { MOCK_AGENT_SLUG, MOCK_RUN_ID } from "@/mocks/core";
import type {
  ActionResult,
  AgentStatus,
  DataSourceInfo,
  LlmKeyRow,
  Page,
  RunDetail,
  RunSummary,
  TradeRow,
  WalletBalance,
} from "@/server/types";

// ------------------------------------------------------------------- reads

// These two are reachable by anyone who can guess an agent id — they are server actions,
// not page props — so each resolves the viewer itself and hands it to the query. The query
// is what drops a private agent's history and redacts a provider error; passing `null`
// here would only widen what a stranger sees.
export async function fetchAgentTrades(
  agentId: string,
  cursor?: string | null,
): Promise<Page<TradeRow>> {
  const session = await viewerSession();
  return agentTrades(agentId, cursor, session?.userId ?? null);
}

export async function fetchAgentRuns(
  agentId: string,
  cursor?: string | null,
): Promise<Page<RunSummary>> {
  const session = await viewerSession();
  return agentRuns(agentId, cursor, session?.userId ?? null);
}

export async function fetchRunDetail(runId: string): Promise<RunDetail | null> {
  const session = await viewerSession();
  return runDetail(runId, session?.userId ?? null);
}

export async function fetchDataSources(query?: string): Promise<DataSourceInfo[]> {
  return readDataSources(query);
}

export async function fetchLlmKeys(): Promise<LlmKeyRow[]> {
  const session = await viewerSession();
  return readLlmKeys(session?.userId ?? null);
}

export async function fetchWalletBalances(agentId: string): Promise<WalletBalance[]> {
  return readWalletBalances(agentId);
}

// ------------------------------------------------------------------ writes

export interface CreateAgentPayload extends CreateAgentInput {
  /** Foundation is adding this optional flag; it activates the agent on create. */
  activate?: boolean;
}

export async function createAgentAction(
  input: CreateAgentPayload,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const result = await withMock(
    () => createAgent(input as CreateAgentInput),
    () => ({ ok: true as const, data: { id: `agent_${MOCK_AGENT_SLUG}`, slug: MOCK_AGENT_SLUG } }),
  );
  if (result.ok) revalidatePath("/agents");
  return result;
}

export async function updateAgentAction(
  id: string,
  input: Partial<CreateAgentInput>,
): Promise<ActionResult> {
  const result = await withMock(
    () => updateAgent(id, input),
    () => ({ ok: true as const, data: undefined }),
  );
  if (result.ok) revalidatePath("/agents");
  return result;
}

export async function setAgentStatusAction(
  id: string,
  status: Exclude<AgentStatus, "error">,
): Promise<ActionResult> {
  const result = await withMock(
    () => setAgentStatus(id, status),
    () => ({ ok: true as const, data: undefined }),
  );
  if (result.ok) revalidatePath("/agents");
  return result;
}

export async function deleteAgentAction(id: string): Promise<ActionResult> {
  const result = await withMock(
    () => deleteAgent(id),
    () => ({ ok: true as const, data: undefined }),
  );
  if (result.ok) revalidatePath("/agents");
  return result;
}

export async function triggerRunAction(id: string): Promise<ActionResult<{ runId: string }>> {
  return withMock(
    () => triggerRun(id),
    () => ({ ok: true as const, data: { runId: MOCK_RUN_ID } }),
  );
}

export async function addLlmKeyAction(input: {
  provider: LlmProvider;
  key: string;
  label?: string;
  workspaceId?: string;
}): Promise<ActionResult<{ id: string; last4: string }>> {
  // A server action: the argument is whatever the caller sent, whatever its type says.
  if (typeof input?.key !== "string" || input.key.trim().length < 12) {
    return { ok: false, error: "That does not look like an API key." };
  }
  // The real action makes both of these refusals itself, before the key goes anywhere.
  // They are made here as well so that the mock, which stores nothing and asks nobody,
  // answers a wrong-provider key the way the real one does.
  if (!isProvider(input.provider)) return { ok: false, error: "Unknown provider" };
  const problem = keyProblem(input.provider, input.key);
  if (problem) return { ok: false, error: problem };
  return withMock(
    () => addLlmKey(input),
    () => ({
      ok: true as const,
      data: { id: `key_local_${Date.now()}`, last4: input.key.trim().slice(-4) },
    }),
  );
}

// No withdraw bridge here on purpose. An agent's money leaves through
// `secureWithdrawAction` (src/server/actions/security.ts) and nothing else: the wrapper
// that used to sit here called an older action with fewer checks and no audit row on
// Base, and its mock answered with an invented transaction hash.
