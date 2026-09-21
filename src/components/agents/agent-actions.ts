"use server";

/**
 * Server-action bridge for the agent surfaces (builder, header, settings).
 * Same seam as `feed-actions`: client components call these, these call the
 * real actions through `withMock` so the UI works before the backend lands.
 */
import { revalidatePath } from "next/cache";
import { withMock } from "@/lib/data";
import { isValidAddressForChain, addressHintForChain } from "@/lib/wallet-address";
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
  setAgentMode,
  setAgentStatus,
  triggerRun,
  updateAgent,
  type CreateAgentInput,
} from "@/server/actions/agents";
import { addLlmKey } from "@/server/actions/users";
import { withdrawFromAgent } from "@/server/actions/wallets";
import type { WithdrawResult } from "@/lib/wallets";
import { MOCK_AGENT_SLUG, MOCK_RUN_ID } from "@/mocks/core";
import type {
  ActionResult,
  AgentMode,
  AgentStatus,
  Chain,
  DataSourceInfo,
  LlmKeyRow,
  Page,
  RunDetail,
  RunSummary,
  TradeRow,
  WalletBalance,
} from "@/server/types";

// ------------------------------------------------------------------- reads

export async function fetchAgentTrades(
  agentId: string,
  cursor?: string | null,
): Promise<Page<TradeRow>> {
  return agentTrades(agentId, cursor);
}

export async function fetchAgentRuns(
  agentId: string,
  cursor?: string | null,
): Promise<Page<RunSummary>> {
  return agentRuns(agentId, cursor);
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

export async function setAgentModeAction(id: string, mode: AgentMode): Promise<ActionResult> {
  const result = await withMock(
    () => setAgentMode(id, mode),
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
  provider: "anthropic" | "openai" | "openrouter";
  key: string;
  label?: string;
}): Promise<ActionResult<{ id: string; last4: string }>> {
  if (input.key.trim().length < 12) {
    return { ok: false, error: "That does not look like an API key." };
  }
  return withMock(
    () => addLlmKey(input),
    () => ({
      ok: true as const,
      data: { id: `key_local_${Date.now()}`, last4: input.key.trim().slice(-4) },
    }),
  );
}

export async function withdrawAction(input: {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
  // W7 H12 (workstream A): a Privy transfer is a wallet action — it can be `pending`
  // with no hash yet, so the result carries the status and the action id too.
}): Promise<ActionResult<WithdrawResult>> {
  if (!(input.amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (!isValidAddressForChain(input.chain, input.toAddress)) {
    return { ok: false, error: addressHintForChain(input.chain) };
  }
  return withMock(
    () => withdrawFromAgent(input),
    () => ({
      ok: true as const,
      data: {
        txHash: "0xmocked000withdrawal000hash",
        actionId: "action_mocked",
        status: "succeeded" as const,
      },
    }),
  );
}
