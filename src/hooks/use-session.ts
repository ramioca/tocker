"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import type { Session } from "@/server/types";

export interface UseSession {
  /** false until Privy has hydrated — render skeletons, not the logged-out state */
  ready: boolean;
  session: Session | null;
  login: () => void;
  logout: () => Promise<void>;
}

export const SESSION_QUERY_KEY = ["session"] as const;

async function fetchSession(): Promise<Session | null> {
  const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`);
  return (await res.json()) as Session;
}

/** Record the user's embedded wallets server-side. Safe to call more than once. */
async function syncWallets(): Promise<void> {
  try {
    await fetch("/api/me/sync", { method: "POST", credentials: "include" });
  } catch {
    // non-fatal: the funding UI just won't know about the embedded wallets yet
  }
}

function useSessionQuery() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** With Privy configured: Privy auth state + our `users` row. */
function usePrivySession(): UseSession {
  const privy = usePrivy();
  const queryClient = useQueryClient();
  const query = useSessionQuery();
  const syncedFor = useRef<string | null>(null);

  const userId = privy.user?.id ?? null;

  useEffect(() => {
    if (!privy.ready || !privy.authenticated || !userId) return;
    if (syncedFor.current === userId) return;
    syncedFor.current = userId;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      await syncWallets();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    })();
  }, [privy.ready, privy.authenticated, userId, queryClient]);

  useEffect(() => {
    if (privy.ready && !privy.authenticated && syncedFor.current) {
      syncedFor.current = null;
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    }
  }, [privy.ready, privy.authenticated, queryClient]);

  const logout = useCallback(async () => {
    await privy.logout();
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [privy, queryClient]);

  return {
    ready: privy.ready && !query.isPending,
    session: query.data ?? null,
    login: privy.login,
    logout,
  };
}

/**
 * Without Privy (local dev): `/api/me` alone, which honours
 * `DEV_IMPERSONATE_USER_ID`. `login()` is a no-op there.
 */
function useFallbackSession(): UseSession {
  const queryClient = useQueryClient();
  const query = useSessionQuery();

  const logout = useCallback(async () => {
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
  }, [queryClient]);

  const login = useCallback(() => {
    console.warn("[useSession] NEXT_PUBLIC_PRIVY_APP_ID is not set — login is unavailable in this environment.");
  }, []);

  return { ready: !query.isPending, session: query.data ?? null, login, logout };
}

// Chosen once at module load: the env var cannot change at runtime, so the hook
// call order stays stable.
const useSessionImpl: () => UseSession = PRIVY_APP_ID ? usePrivySession : useFallbackSession;

/** Privy auth state + the `users` row behind it. */
export function useSession(): UseSession {
  return useSessionImpl();
}
