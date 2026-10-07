"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInCard, SignInStatus } from "@/components/auth/sign-in-card";
import { POST_LOGIN_HOME, useSession } from "@/hooks/use-session";
import { HARD_REDIRECT_AFTER_MS, claimHardRedirect } from "./redirect-guard";
import { safeNext } from "./safe-next";

/** The auth client's "a session can be renewed" marker; see `page.tsx`. */
const RENEWABLE_COOKIE = "privy-session=";
/** How long "Checking your session…" may stand before the form is offered instead. */
const CHECKING_CAP_MS = 10_000;
/** Longer than the card's 280 ms entrance (auth.css), which must not be cut short. */
const INTRO_MS = 400;

const noSubscribe = () => () => {};

/** `sessionStorage` throws on access, not just on use, where storage is blocked. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Work out where the visitor was heading, forward them there when they turn out to
 * be signed in already, and otherwise show the sign-in card.
 *
 * `sessionCookie` is the server's read of the auth cookies. It is a hint, not a
 * session: it only decides what shows while the client is still finding out, so a
 * signed-in visitor sees a neutral line instead of an email form that is about to
 * vanish, and a signed-out one (no cookie) gets the form straight away.
 */
export function LoginFlow({ sessionCookie }: { sessionCookie: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session } = useSession();
  const raw = params.get("next");
  // Resolved against this page's own origin — see safe-next.ts. `window` is undefined on
  // the server pass, which falls back to the home path; the effect below runs on the
  // client, where the real origin is available.
  const next = useMemo(
    () => safeNext(raw, typeof window === "undefined" ? null : window.location.origin, POST_LOGIN_HOME),
    [raw],
  );

  // An OAuth provider sends the visitor back to this exact URL with its authorization
  // code on the query string, which is why `?next=` has to travel in the URL: a ref
  // would not survive the round trip. The card reads this to show a finishing state
  // rather than the form while the code is exchanged.
  const returningFromOAuth = params.has("privy_oauth_code");
  // Which provider, read once: the auth client strips these parameters from the URL as
  // soon as the exchange settles, and the card needs it after that, to word a refusal.
  const [oauthProvider] = useState(() => params.get("privy_oauth_provider"));

  // The server's hint misses one arrival: a link followed from another site. The auth
  // cookies are SameSite=Strict, so that first request carries neither, though the
  // browser holds both. Script on this page can see them, so ask again here. The server
  // snapshot is the server's own answer, which keeps hydration in agreement.
  const mayBeSignedIn = useSyncExternalStore(
    noSubscribe,
    () => sessionCookie || document.cookie.includes(RENEWABLE_COOKIE),
    () => sessionCookie,
  );

  const signedIn = ready && session !== null;

  // A hint that never resolves must not hide the way in: if the client has not answered
  // in ten seconds (it cannot reach the auth API, say), show the form. Should the answer
  // arrive after that and be "signed in", the forward below still happens.
  const [gaveUp, setGaveUp] = useState(false);
  const checking = !ready && mayBeSignedIn && !gaveUp;
  useEffect(() => {
    if (!checking) return;
    const id = setTimeout(() => setGaveUp(true), CHECKING_CAP_MS);
    return () => clearTimeout(id);
  }, [checking]);

  useEffect(() => {
    if (!signedIn) return;
    router.replace(next);
    // This component unmounts when that navigation lands, which cancels the timer. Still
    // here? Then it did not land: load the page outright, at most once a minute (see
    // redirect-guard.ts). `next` is the path `safeNext` returned, never a URL built here.
    const id = setTimeout(() => {
      if (claimHardRedirect(tabStorage(), Date.now())) window.location.replace(next);
    }, HARD_REDIRECT_AFTER_MS);
    return () => clearTimeout(id);
  }, [signedIn, next, router]);

  // Already in: the effect above is a tick behind the render, so say what is happening
  // rather than flashing a sign-in form at someone who is signed in.
  const status = signedIn ? "Signed in. Taking you back…" : checking ? "Checking your session…" : null;

  // Presentation only: the card's entrance (auth.css) plays while `data-intro` is on the
  // wrapper, and this takes it off once the entrance is over, so a card that mounts
  // later (the form replacing "Checking your session…") appears in place instead of
  // fading in a second time. A timer, not `animationend`: the entrance starts with the
  // server's HTML and has usually finished before this component hydrates.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <main className="auth-main" data-intro={intro ? "" : undefined}>
      {status ? (
        <SignInStatus message={status} />
      ) : (
        <SignInCard next={next} returningFromOAuth={returningFromOAuth} oauthProvider={oauthProvider} />
      )}
    </main>
  );
}
