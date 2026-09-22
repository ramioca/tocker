"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { ME_WALLETS_QUERY_KEY } from "@/components/wallets/use-cash";
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
   *
   * Sign-in proper is `/login`, which is headless. This modal is what is left of
   * Privy's own UI: the external-wallet connector behind "Use a crypto wallet
   * instead".
   */
  login: (options?: { redirectTo?: string }) => void;
  /**
   * Arm the same post-auth redirect `login()` arms, for a sign-in that does not go
   * through the modal. Call it immediately before starting a headless flow (send an
   * email code, hand off to an OAuth provider, prompt for a passkey): whichever of
   * them completes, the effect below still syncs the wallets, refreshes the
   * server-rendered tree and sends the browser to `target`.
   *
   * Omit `target` for the default: `/home` from the landing page, and stay put
   * everywhere else.
   */
  prepareRedirect: (target?: string) => void;
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

/**
 * How many Privy embedded wallets this user has right now.
 *
 * Privy creates the Ethereum and Solana embedded wallets *after* authentication
 * resolves, one at a time. Keying the sync on `authenticated` alone therefore ran it
 * against a user with zero or one wallet and never again — which is how a signed-in
 * person ended up with a Deposit sheet that had no Solana address in it (W7 M5).
 */
function embeddedWalletCount(user: ReturnType<typeof usePrivy>["user"]): number {
  return (user?.linkedAccounts ?? []).filter(
    (account) => account.type === "wallet" && account.connectorType === "embedded",
  ).length;
}

/** With Privy configured: Privy auth state + our `users` row. */
function usePrivySession(): UseSession {
  const privy = usePrivy();
  const queryClient = useQueryClient();
  const query = useSessionQuery();
  const router = useRouter();
  const pathname = usePathname();
  /** `${userId}:${walletCount}` of the last sync, so a new wallet re-runs it. */
  const syncedFor = useRef<string | null>(null);
  /** Set by `login()` / `prepareRedirect()`, consumed once the session exists. */
  const pendingRedirect = useRef<string | null>(null);

  const userId = privy.user?.id ?? null;
  const walletCount = embeddedWalletCount(privy.user);

  useEffect(() => {
    if (!privy.ready || !privy.authenticated || !userId) return;
    // Re-sync whenever the wallet count changes, not only on the first authentication.
    const key = `${userId}:${walletCount}`;
    if (syncedFor.current === key) return;
    const firstSync = syncedFor.current === null;
    syncedFor.current = key;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      await syncWallets();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      // The balances query reads the rows /api/me/sync just wrote. Invalidating only
      // the session key left the wallet chip and the deposit sheet on a cached,
      // wallet-less answer for a full 30-second staleTime.
      await queryClient.invalidateQueries({ queryKey: ME_WALLETS_QUERY_KEY });
      // Server components rendered this page signed out; re-render them with the
      // session, then go where the sign-in was meant to go. Only on the first pass:
      // a wallet appearing later must not yank the user off the page they are on.
      const target = pendingRedirect.current;
      pendingRedirect.current = null;
      router.refresh();
      if (firstSync && target && target !== pathname) router.push(target);
    })();
  }, [privy.ready, privy.authenticated, userId, walletCount, queryClient, router, pathname]);

  useEffect(() => {
    if (privy.ready && !privy.authenticated && syncedFor.current) {
      syncedFor.current = null;
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.setQueryData(ME_WALLETS_QUERY_KEY, undefined);
    }
  }, [privy.ready, privy.authenticated, queryClient]);

  const logout = useCallback(async () => {
    await privy.logout();
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [privy, queryClient]);

  const prepareRedirect = useCallback(
    (target?: string) => {
      pendingRedirect.current = target ?? (pathname === "/" ? POST_LOGIN_HOME : null);
    },
    [pathname],
  );

  const login = useCallback(
    (options?: { redirectTo?: string }) => {
      prepareRedirect(options?.redirectTo);
      privy.login();
    },
    [privy, prepareRedirect],
  );

  return {
    ready: privy.ready && !query.isPending,
    session: query.data ?? null,
    login,
    prepareRedirect,
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

  // Nothing to arm: there is no authentication event coming, so there is nothing
  // for a post-auth redirect to hang off.
  const prepareRedirect = useCallback(() => {}, []);

  return { ready: !query.isPending, session: query.data ?? null, login, prepareRedirect, logout };
}

// Chosen once at module load: the env var cannot change at runtime, so the hook
// call order stays stable.
const useSessionImpl: () => UseSession = PRIVY_APP_ID ? usePrivySession : useFallbackSession;

/** Privy auth state + the `users` row behind it. */
export function useSession(): UseSession {
  return useSessionImpl();
}
