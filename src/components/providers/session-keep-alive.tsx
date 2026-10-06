"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { msUntilRenewal } from "@/hooks/token-expiry";

/**
 * Keeps the server recognising a tab that is left open.
 *
 * The server's only credential is the cookie the auth client writes, and the client
 * sets it to expire with the access token, about an hour in. It rewrites the cookie
 * when it renews the token, and it renews only when something asks it for a token. In a
 * tab nobody reloads, nothing did: an hour in, the page still looked signed in while
 * "Pause all trading", withdrawals and approvals all answered "Sign in first".
 *
 * So ask. Each call returns the current token; `msUntilRenewal` then schedules the next
 * call for just before that token runs out, which is the moment a call renews it. A
 * laptop lid or a throttled background tab can sleep straight through a timer, so the
 * same call also runs when the tab becomes visible, regains focus or comes back online.
 *
 * Nothing here writes the cookie or decides who is signed in. If the renewal is refused
 * (the session was ended elsewhere) the auth client flips to signed out, this stops,
 * and `useSession` clears the page.
 *
 * Renders nothing. Mounted once, inside the auth provider.
 */
export function SessionKeepAlive() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  // The getter is a new function whenever the auth state changes; the loop below must
  // not restart for that, only read the latest one.
  const getToken = useRef(getAccessToken);
  useEffect(() => {
    getToken.current = getAccessToken;
  }, [getAccessToken]);

  const signedIn = ready && authenticated;

  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asking = false;
    let stopped = false;

    async function renew() {
      // A wake-up often arrives as several events at once (visible, then focus).
      if (asking || stopped) return;
      asking = true;
      clearTimeout(timer);
      let token: string | null = null;
      try {
        token = await getToken.current();
      } catch {
        // Offline or the auth API is unreachable. No token means "look again in a minute".
      }
      asking = false;
      if (stopped) return;
      timer = setTimeout(() => void renew(), msUntilRenewal(token, Date.now()));
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void renew();
    };
    const onWake = () => void renew();

    void renew();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [signedIn]);

  return null;
}
