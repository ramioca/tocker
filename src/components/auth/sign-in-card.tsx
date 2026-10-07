"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithPasskey } from "@privy-io/react-auth";
import { cn } from "cn";
import { BrandMark } from "@/components/liquid/brand";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import {
  OTP_LENGTH,
  RESEND_DELAY_MS,
  isCompleteOtp,
  isEmailish,
  loginErrorMessage,
  normalizeOtp,
} from "./login-helpers";
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
}

/** Which of the one-shot buttons is mid-flight. The email form tracks its own state. */
type Pending = "google" | "twitter" | "passkey" | null;

/**
 * Passkeys are a dashboard-level switch on the auth vendor's side, and this app has not
 * turned them on; the button would only ever say "Passkeys aren't available here". Set
 * NEXT_PUBLIC_PRIVY_PASSKEYS=1 once they are enabled and it appears.
 */
const PASSKEYS_ENABLED = process.env.NEXT_PUBLIC_PRIVY_PASSKEYS === "1";

/**
 * Tocker's sign-in, start to finish, on Tocker's own surface.
 *
 * Everything here runs through headless auth hooks: an emailed one-time code first,
 * then the two OAuth providers and a passkey. The auth vendor's modal survives in
 * exactly one place — the quiet "Use a crypto wallet instead" at the bottom, which is
 * the external-wallet connector and genuinely is not ours to draw.
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

function PrivySignInCard({ next, returningFromOAuth = false }: SignInCardProps) {
  const { login, prepareRedirect } = useSession();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  /** Privy has authenticated; the session query and the redirect are a beat behind. */
  const [signedIn, setSignedIn] = useState(false);
  /** When the current code was sent, which is what the resend countdown runs off. */
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);
  /** The last code auto-submitted, so a six-digit value is only ever tried once. */
  const autoSubmitted = useRef<string | null>(null);

  const onComplete = useCallback(() => {
    setPending(null);
    setSignedIn(true);
  }, []);

  const onError = useCallback((err: unknown) => {
    setPending(null);
    setError(loginErrorMessage(err));
  }, []);

  // One object, memoised: the hooks subscribe in an effect keyed on the identity of
  // what they are handed, so a fresh literal every render would re-subscribe every
  // render. The three flows share one login event channel, so they share one pair of
  // callbacks — an error raised by any of them reaches `onError` either way, and the
  // `catch` blocks below are what tell the flows apart.
  const callbacks = useMemo(() => ({ onComplete, onError }), [onComplete, onError]);
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
    // Arm the post-auth redirect before anything can complete: the sync-and-redirect
    // effect behind `useSession` is what actually lands the visitor on `next`.
    prepareRedirect(next);
    try {
      await emailFlow.sendCode({ email: address });
      setCode("");
      autoSubmitted.current = null;
      setCodeSentAt(Date.now());
      setNow(Date.now());
      setStage("code");
    } catch (err) {
      setError(loginErrorMessage(err));
    }
  }, [email, emailFlow, next, prepareRedirect, sendingCode]);

  const submitCode = useCallback(
    async (value: string) => {
      if (!isCompleteOtp(value)) return;
      setError(null);
      prepareRedirect(next);
      try {
        await emailFlow.loginWithCode({ code: normalizeOtp(value) });
      } catch (err) {
        setError(loginErrorMessage(err));
      }
    },
    [emailFlow, next, prepareRedirect],
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
      prepareRedirect(next);
      try {
        // Hands off to the provider; this page unloads. `?next=` rides along in the
        // URL the provider is told to come back to.
        await oauthFlow.initOAuth({ provider });
      } catch (err) {
        setPending(null);
        setError(loginErrorMessage(err));
      }
    },
    [next, oauthFlow, prepareRedirect],
  );

  const startPasskey = useCallback(async () => {
    setError(null);
    setPending("passkey");
    prepareRedirect(next);
    try {
      await passkeyFlow.loginWithPasskey();
    } catch (err) {
      setError(loginErrorMessage(err));
      setPending(null);
    }
  }, [next, passkeyFlow, prepareRedirect]);

  const changeEmail = useCallback(() => {
    setStage("email");
    setCode("");
    setCodeSentAt(null);
    autoSubmitted.current = null;
    setError(null);
  }, []);

  /* --- render ---------------------------------------------------------------- */

  if (signedIn || finishingOAuth) {
    return (
      <Card>
        <Header title={signedIn ? "Signed in" : "Finishing sign-in"} />
        <p className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
          {signedIn ? "Taking you in…" : "One moment…"}
        </p>
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
            ? "Build agents that trade for you."
            : `We sent a ${OTP_LENGTH}-digit code to ${email.trim()}.`
        }
      />

      {/* Keyed so each step fades up on its own, instead of the fields swapping in place. */}
      <div key={stage} className="mt-6 motion-safe:animate-rise">
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
              className="mt-1.5 h-10"
              disabled={busy}
            />
            <Button type="submit" className="mt-4 h-10 w-full" disabled={!isEmailish(email) || busy}>
              {sendingCode ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                  Sending code…
                </>
              ) : (
                "Continue"
              )}
            </Button>
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
              className="mt-1.5 h-11 text-center indent-[0.3em] text-lg tracking-[0.3em] tabular-nums"
              disabled={submittingCode}
            />
            <Button type="submit" className="mt-4 h-10 w-full" disabled={!isCompleteOtp(code) || submittingCode}>
              {submittingCode ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                  Checking code…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
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

      <div className="my-5 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
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
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
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
        {PASSKEYS_ENABLED ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full text-muted-foreground hover:text-foreground"
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

      <div className="mt-5 border-t border-border/60 pt-4 text-center">
        <QuietButton
          onClick={() => {
            setError(null);
            login({ redirectTo: next });
          }}
          disabled={busy}
        >
          Use a crypto wallet instead
        </QuietButton>
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
      <Button nativeButton={false} variant="outline" className="mt-5 h-10 w-full" render={<Link href="/feed" />}>
        Browse the feed
      </Button>
    </Card>
  );
}

// Chosen once at module load, like `useSession`: without the provider mounted the auth
// hooks have no context to read, so the branch can never be a render-time condition.
const Impl = PRIVY_APP_ID ? PrivySignInCard : UnavailableSignInCard;

/* --- small parts ------------------------------------------------------------- */

function Card({ children }: { children: ReactNode }) {
  return <div className="glass-panel w-full max-w-[360px] rounded-2xl p-6">{children}</div>;
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* The way back for someone who changes their mind, without the browser's back. */}
      <Link
        href="/"
        aria-label="Tocker home"
        className="flex rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <BrandMark size={44} />
      </Link>
      <h1 className="mt-3 text-lg font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-balance text-muted-foreground">{subtitle}</p> : null}
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
        "focus-ring rounded-sm text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
