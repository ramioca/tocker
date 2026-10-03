"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { ME_WALLETS_QUERY_KEY } from "@/components/wallets/use-cash";
import { clearAllDrafts } from "@/components/agents/builder/use-draft";
import type { Session } from "@/server/types";

export interface UseSession {
  /** false until Privy has hydrated — render skeletons, not the logged-out state */
  ready: boolean;
  session: Session | null;
  /**
   * Opens Privy's login modal. Once Privy has authenticated and the user's wallets
   * are synced, server-rendered pages are refreshed and the browser is sent to
   * `redirectTo` when one is given; otherwise it stays on the current page, which
   * then re-renders signed in.
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
   * Omit `target` to stay on the current page.
   */
  prepareRedirect: (target?: string) => void;
  logout: () => Promise<void>;
}

/** Where /login sends a visitor who arrived without `?next=`: the app, with onboarding waiting there. */
export const POST_LOGIN_HOME = "/home";

export const SESSION_QUERY_KEY = ["session"] as const;

/**
 * Forget everything the previous account left in this tab. The query cache holds owner-only
 * data — run transcripts, unredacted trade errors, balances, proposals — and a shared device
 * must not replay it to whoever signs in (or just looks) next. The builder draft holds a
 * strategy prompt. `clear()` rather than invalidating keys one by one: a key added later is
 * covered without anyone remembering to list it here.
 */
function purgeSignedOutState(queryClient: QueryClient): void {
  queryClient.clear();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
  clearAllDrafts();
}

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
      // Signed out elsewhere (another tab, an expired session): drop this account's
      // cached data and re-render the server tree, which is still showing it.
      syncedFor.current = null;
      purgeSignedOutState(queryClient);
      router.refresh();
    }
  }, [privy.ready, privy.authenticated, queryClient, router]);

  const logout = useCallback(async () => {
    await privy.logout();
    purgeSignedOutState(queryClient);
    // Owner pages (settings, transcripts) are server-rendered with the old session and
    // would otherwise stay on screen after sign-out. Leave for the public landing page.
    router.replace("/");
    router.refresh();
  }, [privy, queryClient, router]);

  const prepareRedirect = useCallback((target?: string) => {
    pendingRedirect.current = target ?? null;
  }, []);

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
    purgeSignedOutState(queryClient);
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
