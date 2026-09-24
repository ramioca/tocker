"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unifiedCash, type UnifiedCash } from "@/lib/wallets/funding";
import type { WalletBalance } from "@/server/types";

export interface MeWallets {
  wallets: WalletBalance[];
  cash: UnifiedCash;
  /** The same number as `cash.totalUsd`, kept flat for older callers. */
  cashUsd: number;
}

export const ME_WALLETS_QUERY_KEY = ["me-wallets"] as const;

async function fetchWallets(): Promise<MeWallets> {
  const res = await fetch("/api/me/wallets", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`/api/me/wallets failed: ${res.status}`);
  const body = (await res.json()) as Partial<MeWallets>;
  const wallets = body.wallets ?? [];
  // Recompute rather than trust: one derivation, so the chip and the funding
  // step can never disagree about what the user's cash is.
  const cash = body.cash ?? unifiedCash(wallets);
  return { wallets, cash, cashUsd: cash.totalUsd };
}

/**
 * The user's cash. One query key, so a deposit, a withdrawal or an agent funding
 * all refresh the same number everywhere it is shown.
 */
export function useUserWallets(enabled: boolean) {
  return useQuery({
    queryKey: ME_WALLETS_QUERY_KEY,
    queryFn: fetchWallets,
    enabled,
    // Short: the number now includes agents' positions at live marks, and a chip that
    // says $14.56 above a page that says $14.36 reads as a bug, not as a memecoin
    // moving between two fetches. Route changes refetch it too (see WalletChip).
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Refetch the balance after money moved. Onramps and chain confirmations are
 * not instant, so callers usually schedule a second call a few seconds later —
 * `delayMs` exists for exactly that, and resolves once the refetch is done.
 */
export function useRefreshCash() {
  const queryClient = useQueryClient();
  return useCallback(
    async (delayMs = 0) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await queryClient.invalidateQueries({ queryKey: ME_WALLETS_QUERY_KEY });
    },
    [queryClient],
  );
}

/** What `POST /api/me/sync` answers. `note` explains an empty `wallets`, e.g. "privy not configured". */
export interface SyncResult {
  ok: boolean;
  wallets: unknown[];
  note?: string;
}

/**
 * Record the user's embedded wallets server-side, then refresh. Resolves with what the
 * server found, so the caller can say so when it found nothing; rejects when the
 * request itself failed.
 */
export function useSyncWallets() {
  const refresh = useRefreshCash();
  return useCallback(async (): Promise<SyncResult> => {
    const res = await fetch("/api/me/sync", { method: "POST", credentials: "include" });
    if (!res.ok) throw new Error(`/api/me/sync failed: ${res.status}`);
    const body = (await res.json()) as Partial<SyncResult>;
    await refresh();
    return { ok: body.ok ?? true, wallets: body.wallets ?? [], note: body.note };
  }, [refresh]);
}
