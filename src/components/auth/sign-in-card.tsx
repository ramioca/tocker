"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithPasskey, useModalStatus } from "@privy-io/react-auth";
import { cn } from "cn";
import { TockerMark } from "@/components/brand/tocker-mark";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { FOUNDER_X } from "@/lib/contact";
import {
  OTP_LENGTH,
  RESEND_DELAY_MS,
  isAllowlistRejection,
  isCompleteOtp,
  isEmailish,
  loginErrorMessage,
  normalizeOtp,
  oauthReturnMethod,
  refusalView,
  type NotInvited,
} from "./login-helpers";
import { loginMethodEnabled, type LoginMethod } from "./login-methods";
import { AUTH_PRESS, MetalSubmit } from "./metal-submit";
import { GoogleGlyph, XGlyph } from "./oauth-glyphs";

export interface SignInCardProps {
  /** Where the visitor goes once they are in. Already validated by `safeNext`. */
  next: string;
  /**
   * True when this page load is the return leg of an OAuth redirect — the URL still
   * carries the provider's authorization code. The card shows a finishing state
   * instead of the form, so nobody is offered an email field for half a second while
   * their sign-in completes behind it.
   */
  returningFromOAuth?: boolean;
  /**
   * Which provider that return leg is from, read off the URL before the auth client
   * strips it. It only decides how a refusal reads: a refused Google account and a
   * refused X account get different answers.
   */
  oauthProvider?: string | null;
}

/** Which of the one-shot buttons is mid-flight. The email form tracks its own state. */
type Pending = "google" | "twitter" | "passkey" | null;

/** The sentence under "We can't let you in yet": who was refused. */
const NOT_INVITED_SUBTITLE: Record<NotInvited, string> = {
  // Only when the address itself is somehow gone; the card normally names it.
  email: "That email isn't on the access list.",
  google: "That Google account isn't on the access list.",
  wallet: "That wallet isn't on the access list.",
  account: "That account isn't on the access list.",
};

/*
 * Which methods this deploy offers (`login-methods.ts`, from NEXT_PUBLIC_LOGIN_METHODS).
 * Each one is also a switch in the auth vendor's dashboard and fails when pressed if it
 * is off there, so one that is off here is not drawn: no button, and no "or" divider
 * when none of the buttons under it are left. Email is always on.
 */
const GOOGLE_ENABLED = loginMethodEnabled("google");
const X_ENABLED = loginMethodEnabled("twitter");
const PASSKEY_ENABLED = loginMethodEnabled("passkey");
const WALLET_ENABLED = loginMethodEnabled("wallet");
const ANY_BUTTON_ENABLED = GOOGLE_ENABLED || X_ENABLED || PASSKEY_ENABLED;

/**
 * What an X account the access list refuses is told (see `refusalView` for why it is
 * not the not-invited view). Unreachable unless X is one of the enabled methods.
 */
const X_USE_EMAIL = "X doesn't share your email, so this account can't be matched. Sign in with your email instead.";

/** How long "Taking you in…" may spin before the card admits it and offers a way on. */
const SIGNED_IN_STALL_MS = 10_000;

/**
 * Tocker's sign-in, start to finish, on Tocker's own surface.
 *
 * Everything here runs through headless auth hooks: an emailed one-time code first,
 * then whichever of the two OAuth providers and a passkey this deploy has enabled. The
 * auth vendor's modal survives in exactly one place — the quiet "Use a crypto wallet
 * instead" at the bottom, which is the external-wallet connector and genuinely is not
 * ours to draw.
 *
 * Sign-in is also sign-up: an address the auth vendor has not seen makes an account.
 * The vendor can still be set to admit only the accounts on its access list; a sign-in
 * that list refuses gets a next step (DM the founder) instead of an error under the
 * field. Nothing here can grant access.
 *
 * The shape of the flow is fixed by what the hooks give us:
 *   - email is two steps in one card (address, then code) rather than two screens,
 *     because the address has to stay visible and editable while the code is entered;
 *   - OAuth *leaves the page* and comes back to this same URL, so `?next=` has to
 *     survive in the query string rather than in a ref — see `returningFromOAuth`;
 *   - passkey resolves in place, and its failures are mostly the browser's, not ours.
 */
export function SignInCard(props: SignInCardProps) {
  return <Impl {...props} />;
}

function PrivySignInCard({ next, returningFromOAuth = false, oauthProvider = null }: SignInCardProps) {
  const { login } = useSession();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  /** Privy has authenticated; the session query and the redirect are a beat behind. */
  const [signedIn, setSignedIn] = useState(false);
  /** The access list refused this sign-in; the card shows what to do about it instead of the form. */
  const [notInvited, setNotInvited] = useState<NotInvited | null>(null);
  /** When the current code was sent, which is what the resend countdown runs off. */
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);
  const notInvitedHeading = useRef<HTMLHeadingElement>(null);
  /** The last code auto-submitted, so a six-digit value is only ever tried once. */
  const autoSubmitted = useRef<string | null>(null);
  /**
   * The method the visitor last started. Failures arrive on one shared channel that does
   * not say which method they belong to, and a refusal by the access list reads
   * differently for an email address, a Google account, an X account and a wallet.
   */
  const attempt = useRef<LoginMethod | null>(
    returningFromOAuth ? oauthReturnMethod(oauthProvider, loginMethodEnabled) : null,
  );

  const onComplete = useCallback(() => {
    setPending(null);
    setSignedIn(true);
  }, []);

  // Every failure ends here: the shared `onError` channel and each `catch` below, often
  // both for the same failure, so it has to be safe to run twice with the same error.
  const fail = useCallback((err: unknown) => {
    setPending(null);
    if (!isAllowlistRejection(err)) {
      setError(loginErrorMessage(err));
      return;
    }
    const view = refusalView(attempt.current, X_ENABLED);
    if (view === "x-use-email") {
      setError(X_USE_EMAIL);
      return;
    }
    setError(null);
    setNotInvited(view);
  }, []);

  // One object, memoised: the hooks subscribe in an effect keyed on the identity of
  // what they are handed, so a fresh literal every render would re-subscribe every
  // render. The three flows share one login event channel, so they share one pair of
  // callbacks — an error raised by any of them (or by the wallet modal) reaches `fail`
  // either way, and `attempt` is what tells the flows apart.
  const callbacks = useMemo(() => ({ onComplete, onError: fail }), [onComplete, fail]);
  const emailFlow = useLoginWithEmail(callbacks);
  const oauthFlow = useLoginWithOAuth(callbacks);
  const passkeyFlow = useLoginWithPasskey(callbacks);

  const sendingCode = emailFlow.state.status === "sending-code";
  const submittingCode = emailFlow.state.status === "submitting-code";
  /** The email flow itself rejected — a refused address, or a code that did not match. */
  const emailFlowFailed = emailFlow.state.status === "error";

  /* --- the OAuth return leg -------------------------------------------------- */

  const [oauthGaveUp, setOauthGaveUp] = useState(false);
  const oauthStatus = oauthFlow.state.status;
  /** Derived, not stored: the exchange is over the moment the flow settles either way. */
  const finishingOAuth =
    returningFromOAuth && !oauthGaveUp && oauthStatus !== "done" && oauthStatus !== "error";

  useEffect(() => {
    if (!finishingOAuth) return;
    // A code in the URL that nothing ever picks up (a stale link, a reload after the
    // exchange already happened) would otherwise leave the card stuck on "Finishing"
    // with no way out. Give it twelve seconds, then hand the form back.
    const id = setTimeout(() => {
      setOauthGaveUp(true);
      setError("That sign-in didn't come back. Try again.");
    }, 12_000);
    return () => clearTimeout(id);
  }, [finishingOAuth]);

  /* --- the resend countdown -------------------------------------------------- */

  const [now, setNow] = useState(() => Date.now());
  const secondsLeft =
    codeSentAt === null ? 0 : Math.max(0, Math.ceil((codeSentAt + RESEND_DELAY_MS - now) / 1000));

  useEffect(() => {
    if (secondsLeft <= 0) return;
    // Re-schedules itself off `now` and stops on its own once the countdown lands,
    // so there is no interval left running behind a signed-in card.
    const id = setTimeout(() => setNow(Date.now()), 500);
    return () => clearTimeout(id);
  }, [secondsLeft, now]);

  /* --- actions --------------------------------------------------------------- */

  /** Send, or re-send, a code to whatever is in the email field. */
  const sendCode = useCallback(async () => {
    const address = email.trim();
    if (!isEmailish(address) || sendingCode) return;
    setError(null);
    attempt.current = "email";
    try {
      await emailFlow.sendCode({ email: address });
      setCode("");
      autoSubmitted.current = null;
      setCodeSentAt(Date.now());
      setNow(Date.now());
      setStage("code");
    } catch (err) {
      fail(err);
    }
  }, [email, emailFlow, fail, sendingCode]);

  const submitCode = useCallback(
    async (value: string) => {
      if (!isCompleteOtp(value)) return;
      setError(null);
      attempt.current = "email";
      try {
        await emailFlow.loginWithCode({ code: normalizeOtp(value) });
      } catch (err) {
        fail(err);
      }
    },
    [emailFlow, fail],
  );

  // Six digits in the box means the person is done typing — submitting for them saves
  // a deliberate press at the one moment they have nothing left to decide. Guarded so
  // the same value is never sent twice; editing the code re-arms it.
  useEffect(() => {
    if (stage !== "code" || signedIn) return;
    if (!isCompleteOtp(code)) {
      autoSubmitted.current = null;
      return;
    }
    if (autoSubmitted.current === code || submittingCode) return;
    autoSubmitted.current = code;
    void submitCode(code);
  }, [stage, code, signedIn, submittingCode, submitCode]);

  // The code field is the only thing on the card at that point; put the caret in it.
  useEffect(() => {
    if (stage === "code") codeRef.current?.focus();
  }, [stage, codeSentAt]);

  const startOAuth = useCallback(
    async (provider: "google" | "twitter") => {
      setError(null);
      setPending(provider);
      attempt.current = provider;
      try {
        // Hands off to the provider; this page unloads. `?next=` rides along in the
        // URL the provider is told to come back to.
        await oauthFlow.initOAuth({ provider });
      } catch (err) {
        fail(err);
      }
    },
    [fail, oauthFlow],
  );

  const startPasskey = useCallback(async () => {
    setError(null);
    setPending("passkey");
    attempt.current = "passkey";
    try {
      await passkeyFlow.loginWithPasskey();
    } catch (err) {
      fail(err);
    }
  }, [fail, passkeyFlow]);

  const changeEmail = useCallback(() => {
    setStage("email");
    setCode("");
    setCodeSentAt(null);
    autoSubmitted.current = null;
    setError(null);
  }, []);

  /** Out of the not-invited view, back to an empty email field (it takes focus as it mounts). */
  const tryAnotherEmail = useCallback(() => {
    setNotInvited(null);
    setEmail("");
    changeEmail();
  }, [changeEmail]);

  // The form that had focus is gone when the not-invited view replaces it. Move focus to
  // the new heading, so a keyboard is not left on <body> and a screen reader reads the
  // answer instead of nothing. Not while the vendor's modal is up, though: a refused
  // wallet arrives here while that modal is still showing its own answer, and it is a
  // focus-trapped dialog. The heading takes focus when it closes.
  const { isOpen: vendorModalOpen } = useModalStatus();
  useEffect(() => {
    if (notInvited && !vendorModalOpen) notInvitedHeading.current?.focus();
  }, [notInvited, vendorModalOpen]);

  // Back from the provider's page, a browser may restore this one from its back/forward
  // cache exactly as it was left: "Opening Google…" spinning and every button disabled,
  // with nothing coming to clear it. `persisted` is that restore, and only that.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // "Signed in" is the auth client's word for it; the app is only in once the session
  // query answers and /login forwards. If that never comes (offline, the request failed)
  // this card would spin for good, so after a while it says so and offers a full reload.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    const id = setTimeout(() => setStalled(true), SIGNED_IN_STALL_MS);
    return () => clearTimeout(id);
  }, [signedIn]);

  /* --- render ---------------------------------------------------------------- */

  if (signedIn || finishingOAuth) {
    const stuck = signedIn && stalled;
    return (
      <Card variant="status">
        <Header title={signedIn ? "Signed in" : "Finishing sign-in"} />
        {/* One element whose text changes, so the change is announced. */}
        <p
          role="status"
          className="auth-status mt-5 flex items-center justify-center gap-2 text-center text-sm text-balance text-muted-foreground"
        >
          {stuck ? null : <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />}
          {stuck
            ? "You're signed in, but your account didn't load."
            : signedIn
              ? "Taking you in…"
              : "One moment…"}
        </p>
        {stuck ? (
          // A full page load, not the router: whatever the client is stuck on goes with
          // it. `next` is the path `safeNext` already vetted, never a URL built here.
          <Button
            type="button"
            className={cn("mt-4", PRIMARY_BUTTON)}
            onClick={() => window.location.replace(next)}
          >
            Try again
          </Button>
        ) : null}
      </Card>
    );
  }

  if (notInvited) {
    const address = email.trim();
    return (
      <Card>
        <Header
          titleRef={notInvitedHeading}
          title="We can't let you in yet"
          subtitle={
            notInvited === "email" && address
              ? `${address} isn't on the access list.`
              : NOT_INVITED_SUBTITLE[notInvited]
          }
        />
        {/* Keyed like the steps below, so it fades up in place of the form it replaces. */}
        <div key="not-invited" className="mt-5 motion-safe:animate-rise sm:mt-6">
          <p className="text-center text-sm text-balance text-muted-foreground">
            {"Tocker is opening up in stages. DM us on X and we'll add you."}
          </p>
          <div className="mt-5 grid gap-2">
            <Button
              nativeButton={false}
              className={PRIMARY_BUTTON}
              render={<a href={FOUNDER_X.href} target="_blank" rel="noreferrer" />}
            >
              <XGlyph className="size-3.5" />
              DM @{FOUNDER_X.handle} on X
            </Button>
          </div>
          <div className="mt-4 text-center">
            {/* Either way it lands on the empty email field. */}
            <QuietButton onClick={tryAnotherEmail}>
              {notInvited === "email" || notInvited === "google" ? "Try a different email" : "Back to sign-in"}
            </QuietButton>
          </div>
        </div>
      </Card>
    );
  }

  const busy = pending !== null || sendingCode || submittingCode;

  return (
    <Card>
      <Header
        title="Sign in to Tocker"
        subtitle={
          stage === "email"
            ? "Enter your email and we'll send you a code. New here? That makes your account."
            : `We sent a ${OTP_LENGTH}-digit code to ${email.trim()}.`
        }
      />

      {/* Keyed so each step fades up on its own, instead of the fields swapping in place. */}
      <div key={stage} className="mt-5 motion-safe:animate-rise sm:mt-6">
        {stage === "email" ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <Label htmlFor="signin-email" className="text-xs text-muted-foreground">
              Email
            </Label>
            <Input
              id="signin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              placeholder="you@domain.com"
              value={email}
              aria-invalid={(error !== null && emailFlowFailed) || undefined}
              aria-describedby={error ? "signin-error" : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              className={cn("mt-1.5 h-11 px-3", FIELD)}
              disabled={busy}
            />
            <MetalSubmit disabled={!isEmailish(email) || busy}>
              {sendingCode ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                  Sending code…
                </>
              ) : (
                "Continue"
              )}
            </MetalSubmit>
          </form>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submitCode(code);
            }}
          >
            <Label htmlFor="signin-code" className="sr-only">
              {OTP_LENGTH}-digit code
            </Label>
            <Input
              id="signin-code"
              ref={codeRef}
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              placeholder="000000"
              value={code}
              aria-invalid={(error !== null && emailFlowFailed) || undefined}
              aria-describedby={error ? "signin-error" : undefined}
              onChange={(event) => {
                setCode(normalizeOtp(event.target.value));
                if (error) setError(null);
              }}
              // `indent` cancels the trailing letter-space, which would otherwise pull
              // the digits half a space left of centre.
              // `md:text-xl` because the input's own `md:text-sm` would otherwise win there.
              className={cn("mt-1.5 h-12 text-center indent-[0.3em] text-xl tracking-[0.3em] tabular-nums md:text-xl", FIELD)}
              disabled={submittingCode}
            />
            <MetalSubmit disabled={!isCompleteOtp(code) || submittingCode}>
              {submittingCode ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                  Checking code…
                </>
              ) : (
                "Sign in"
              )}
            </MetalSubmit>
            <div className="mt-3 flex items-center justify-between text-xs">
              <QuietButton onClick={() => void sendCode()} disabled={secondsLeft > 0 || busy}>
                {secondsLeft > 0 ? (
                  <>
                    Resend in <span className="tabular-nums">{secondsLeft}s</span>
                  </>
                ) : sendingCode ? (
                  "Sending…"
                ) : (
                  "Resend code"
                )}
              </QuietButton>
              <QuietButton onClick={changeEmail} disabled={submittingCode}>
                Use a different email
              </QuietButton>
            </div>
          </form>
        )}
      </div>

      <ErrorLine message={error} />

      {ANY_BUTTON_ENABLED ? (
        <>
          <div className="my-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="grid gap-2">
            {GOOGLE_ENABLED ? (
              <Button
                type="button"
                variant="outline"
                className={QUIET_BUTTON}
                disabled={busy}
                onClick={() => void startOAuth("google")}
              >
                {pending === "google" ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <GoogleGlyph className="size-4" />
                )}
                {pending === "google" ? "Opening Google…" : "Continue with Google"}
              </Button>
            ) : null}
            {X_ENABLED ? (
              <Button
                type="button"
                variant="outline"
                className={QUIET_BUTTON}
                disabled={busy}
                onClick={() => void startOAuth("twitter")}
              >
                {pending === "twitter" ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <XGlyph className="size-3.5" />
                )}
                {pending === "twitter" ? "Opening X…" : "Continue with X"}
              </Button>
            ) : null}
            {PASSKEY_ENABLED ? (
              <Button
                type="button"
                variant="ghost"
                className={cn(QUIET_BUTTON, "text-muted-foreground hover:text-foreground")}
                disabled={busy}
                onClick={() => void startPasskey()}
              >
                {pending === "passkey" ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="size-4" aria-hidden />
                )}
                {pending === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="mt-6 border-t border-white/[0.08] pt-4 text-center">
        {WALLET_ENABLED ? (
          <QuietButton
            onClick={() => {
              setError(null);
              attempt.current = "wallet";
              login();
            }}
            disabled={busy}
          >
            Use a crypto wallet instead
          </QuietButton>
        ) : null}
        {/* Somewhere to go when sign-in will not let someone through. `mt-5` keeps this
            link's enlarged hit area clear of the wallet button's above it. */}
        <p className={cn("text-xs text-muted-foreground", WALLET_ENABLED && "mt-5")}>
          Trouble signing in?{" "}
          <a
            href={FOUNDER_X.href}
            target="_blank"
            rel="noreferrer"
            className="focus-ring relative inline-block rounded-sm underline underline-offset-2 transition-colors duration-150 after:absolute after:-inset-x-2 after:-top-1 after:-bottom-5 after:content-[''] hover:text-foreground"
          >
            DM @{FOUNDER_X.handle} on X
          </a>
        </p>
      </div>
    </Card>
  );
}

/**
 * Without an auth app configured there is nothing to sign in to — local dev runs on
 * `DEV_IMPERSONATE_USER_ID` instead, and a visitor who lands here in that state should
 * be told, not left pressing a dead Continue button.
 */
function UnavailableSignInCard() {
  return (
    <Card>
      <Header
        title="Sign in to Tocker"
        subtitle="Sign-in is temporarily unavailable."
      />
      <p className="mt-5 text-center text-sm text-muted-foreground">Please try again shortly.</p>
      {/* The setup hint is for whoever runs the build, never for a visitor to a live deploy. */}
      {process.env.NODE_ENV !== "production" ? (
        <p className="mt-2 text-center text-xs text-muted-foreground/80">
          There is no auth app behind this build. The console says which setting is missing.
        </p>
      ) : null}
      {/* Somewhere to go meanwhile: the feed is public, so the visit is not a dead end. */}
      <Button nativeButton={false} variant="outline" className={cn("mt-5", QUIET_BUTTON)} render={<Link href="/feed" />}>
        Browse the feed
      </Button>
    </Card>
  );
}

// Chosen once at module load, like `useSession`: without the provider mounted the auth
// hooks have no context to read, so the branch can never be a render-time condition.
const Impl = PRIVY_APP_ID ? PrivySignInCard : UnavailableSignInCard;

/**
 * The card with one line on it, for the moments either side of the form: /login working
 * out whether the visitor is already signed in, and forwarding them once it knows.
 *
 * Same card, logo and title as the form and as the "Signed in" state above. From 640px
 * the status card is held at the form's height (`--auth-card-h` in auth.css), and every
 * card is anchored by its top edge, so the title does not move when one replaces another. No auth hooks, so it
 * renders with or without an auth app behind the build.
 */
export function SignInStatus({ message }: { message: string }) {
  return (
    <Card variant="status">
      <Header title="Sign in to Tocker" />
      <p
        role="status"
        className="auth-status mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
        {message}
      </p>
    </Card>
  );
}

/* --- small parts ------------------------------------------------------------- */

/** The shared look of the card's buttons; sizes and type from the landing's primary. */
const QUIET_BUTTON = `h-11 w-full rounded-[12px] ${AUTH_PRESS}`;
const PRIMARY_BUTTON = `${QUIET_BUTTON} text-[15px] font-[550] tracking-[-0.01em]`;
/** A field on the glass. Twice, because the input's own fill is a `dark:` class. */
const FIELD = "rounded-[12px] bg-white/[0.04] dark:bg-white/[0.04]";

/**
 * The glass card (auth.css). Width, padding, radius and material all live in the
 * stylesheet, which is unlayered: a Tailwind utility for any of them here would lose.
 * `status` is the one-line variant, held at the form's height from 640px.
 */
function Card({ children, variant }: { children: ReactNode; variant?: "status" }) {
  return <div className={cn("auth-card", variant === "status" && "auth-card-status")}>{children}</div>;
}

function Header({
  title,
  subtitle,
  titleRef,
}: {
  title: string;
  subtitle?: string;
  /** Set when the heading is given focus as it appears; it is made focusable for that only. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Decorative: the way home is the lockup in the page's top bar (login-shell.tsx),
          which on a phone sits just above the card, so the mark is not repeated there. */}
      <TockerMark height={40} className="hidden sm:block" />
      <h1
        ref={titleRef}
        tabIndex={titleRef ? -1 : undefined}
        className="mt-0 text-[22px] leading-7 font-semibold tracking-[-0.025em] outline-none sm:mt-4"
      >
        {title}
      </h1>
      {/* `break-words`: the subtitle can carry an email address, which has no spaces to wrap at. */}
      {subtitle ? (
        <p className="mt-1.5 text-sm leading-5 text-balance break-words text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

/** One sentence, in the one place errors are allowed to appear. */
function ErrorLine({ message }: { message: string | null }) {
  return (
    <p
      id="signin-error"
      // `role="alert"` is already an assertive live region: the sentence is announced
      // when it appears without the visitor having to go looking for it.
      role="alert"
      className={cn("mt-2 text-sm text-destructive", !message && "sr-only")}
    >
      {message}
    </p>
  );
}

function QuietButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // The text is 16px tall; the pseudo-element makes the target 44px without moving
        // anything. 12px up and 16px down, not centred: 12px is the gap to the button
        // above the resend row, so the target stops at that button's edge instead of
        // taking taps meant for it.
        "focus-ring relative rounded-sm text-xs text-muted-foreground transition-colors duration-150 after:absolute after:-inset-x-2 after:-top-3 after:-bottom-4 after:content-[''] hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
