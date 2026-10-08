"use client";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { loginMethodEnabled } from "@/components/auth/login-methods";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { ME_WALLETS_QUERY_KEY } from "@/components/wallets/use-cash";
import { clearAllDrafts } from "@/components/agents/builder/use-draft";
import { clearEditStashes } from "@/components/agents/settings/use-edit-stash";
import type { Session } from "@/server/types";
import { readSession } from "./session-fetch";

export interface UseSession {
  /** false until Privy has hydrated — render skeletons, not the logged-out state */
  ready: boolean;
  session: Session | null;
  /**
   * Opens Privy's modal on its list of external wallets, and nothing else.
   *
   * Sign-in proper is `/login`, which is headless. This modal is what is left of
   * Privy's own UI: the wallet connector behind "Use a crypto wallet instead". It does
   * nothing when wallets are not one of this deploy's sign-in methods.
   *
   * `redirectTo` is accepted and ignored. Where a sign-in ends up is decided in one
   * place, `LoginFlow` on /login, which forwards as soon as the session exists.
   */
  login: (options?: { redirectTo?: string }) => void;
  /**
   * Does nothing; kept so existing callers still compile.
   *
   * It used to arm a redirect that the sync below performed once the session existed.
   * `LoginFlow` already forwards a signed-in visitor, so that made two navigations for
   * one sign-in and a Back button that needed two presses.
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
 * strategy prompt, and so do the unsaved edits an agent's settings page holds in memory
 * for an owner who leaves it and comes back.
 * `clear()` rather than invalidating keys one by one: a key added later is covered without
 * anyone remembering to list it here.
 */
function purgeSignedOutState(queryClient: QueryClient): void {
  queryClient.clear();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
  clearAllDrafts();
  clearEditStashes();
}

function askForSession(): Promise<Response> {
  return fetch("/api/me", { credentials: "include", cache: "no-store" });
}

/**
 * Ask the auth client for an access token, renewing it if it has run out.
 *
 * Renewing is what rewrites the cookie the server reads. Null when there is nobody
 * signed in, and also when the renewal could not be made (offline, or the auth client
 * is not up yet, which the standalone getter reports by throwing rather than rejecting,
 * hence the `try` around the call itself).
 */
async function renewedAccessToken(): Promise<string | null> {
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
}

/**
 * `/api/me`, with one renewal when the server answers 401 to a browser that is still
 * signed in (see `session-fetch.ts`). The query stays pending through the renewal, so
 * `ready` stays false and nothing flashes signed-out chrome at someone who is about to
 * turn out signed in. Without an auth app there is nothing to renew with.
 */
function fetchSession(): Promise<Session | null> {
  return readSession<Session>(askForSession, PRIVY_APP_ID ? renewedAccessToken : null);
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

/**
 * `${userId}:${walletCount}` of the last sync, so a new wallet re-runs it.
 *
 * Module scope, not a ref inside the hook: `useSession()` is called by half a dozen
 * components mounted at once (the top bar, the account menu, the cash chip, the tab bar,
 * the run-status provider, onboarding), and anything held per instance runs once per
 * caller. That was one wallet sync, with its round of `/api/me` refetches and a server
 * re-render, per caller on every page load, all drawn from one per-IP rate limit. Here
 * the first caller to see a new key does the work and the rest return.
 *
 * Keyed on the query client because that cache is what the sync refreshes. A provider
 * tree that is mounted again (back from the landing page, which sits outside it) starts
 * with a new client and an empty cache, and gets its own first sync.
 */
const syncedFor = new WeakMap<QueryClient, string>();

/** With Privy configured: Privy auth state + our `users` row. */
function usePrivySession(): UseSession {
  const privy = usePrivy();
  const queryClient = useQueryClient();
  const query = useSessionQuery();
  const router = useRouter();

  const userId = privy.user?.id ?? null;
  const walletCount = embeddedWalletCount(privy.user);

  useEffect(() => {
    if (!privy.ready || !privy.authenticated || !userId) return;
    // Re-sync whenever the wallet count changes, not only on the first authentication.
    const key = `${userId}:${walletCount}`;
    if (syncedFor.get(queryClient) === key) return;
    syncedFor.set(queryClient, key);
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      await syncWallets();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      // The balances query reads the rows /api/me/sync just wrote. Invalidating only
      // the session key left the wallet chip and the deposit sheet on a cached,
      // wallet-less answer for a full 30-second staleTime.
      await queryClient.invalidateQueries({ queryKey: ME_WALLETS_QUERY_KEY });
      // Server components rendered this page signed out; re-render them with the
      // session. No navigation from here: on /login, `LoginFlow` forwards the moment
      // the session query above answers, and everywhere else the visitor stays put.
      router.refresh();
    })();
  }, [privy.ready, privy.authenticated, userId, walletCount, queryClient, router]);

  useEffect(() => {
    if (privy.ready && !privy.authenticated && syncedFor.has(queryClient)) {
      // Signed out elsewhere (another tab, an expired session): drop this account's
      // cached data and re-render the server tree, which is still showing it.
      syncedFor.delete(queryClient);
      purgeSignedOutState(queryClient);
      router.refresh();
    }
  }, [privy.ready, privy.authenticated, queryClient, router]);

  const logout = useCallback(async () => {
    await privy.logout();
    // Signing in again, even as the same account, is a new sign-in and syncs again.
    syncedFor.delete(queryClient);
    purgeSignedOutState(queryClient);
    // Owner pages (settings, transcripts) are server-rendered with the old session and
    // would otherwise stay on screen after sign-out. Leave for the public landing page.
    router.replace("/");
    router.refresh();
  }, [privy, queryClient, router]);

  const prepareRedirect = useCallback(() => {}, []);

  const login = useCallback(() => {
    if (!loginMethodEnabled("wallet")) return;
    // Wallets only. With no options the modal offers every configured method, so the
    // visitor who chose "a crypto wallet instead" was shown an email field again and had
    // to pick "wallet" a second time.
    privy.login({ loginMethods: ["wallet"] });
  }, [privy]);

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
