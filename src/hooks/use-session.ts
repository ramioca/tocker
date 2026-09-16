"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import type { Session } from "@/server/types";

export interface UseSession {
  /** false until Privy has hydrated — render skeletons, not the logged-out state */
  ready: boolean;
  session: Session | null;
  /**
   * Opens Privy's login modal. Once Privy has authenticated and the user's wallets
   * are synced, server-rendered pages are refreshed and the browser is sent to
   * `redirectTo` — by default `/home` when signing in from the landing page, and
   * the current page everywhere else, which then re-renders signed in.
   */
  login: (options?: { redirectTo?: string }) => void;
  logout: () => Promise<void>;
}

/** Where a sign-in from the landing page goes: the app, with onboarding waiting there. */
export const POST_LOGIN_HOME = "/home";

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
  const router = useRouter();
  const pathname = usePathname();
  const syncedFor = useRef<string | null>(null);
  /** Set by `login()`, consumed once the session exists. */
  const pendingRedirect = useRef<string | null>(null);

  const userId = privy.user?.id ?? null;

  useEffect(() => {
    if (!privy.ready || !privy.authenticated || !userId) return;
    if (syncedFor.current === userId) return;
    syncedFor.current = userId;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      await syncWallets();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      // Server components rendered this page signed out; re-render them with the
      // session, then go where the sign-in was meant to go.
      const target = pendingRedirect.current;
      pendingRedirect.current = null;
      router.refresh();
      if (target && target !== pathname) router.push(target);
    })();
  }, [privy.ready, privy.authenticated, userId, queryClient, router, pathname]);

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

  const login = useCallback(
    (options?: { redirectTo?: string }) => {
      pendingRedirect.current = options?.redirectTo ?? (pathname === "/" ? POST_LOGIN_HOME : null);
      privy.login();
    },
    [privy, pathname],
  );

  return {
    ready: privy.ready && !query.isPending,
    session: query.data ?? null,
    login,
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
