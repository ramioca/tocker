import type { ReactNode } from "react";
import Link from "next/link";
import { LoginSilk } from "./login-silk";
import "./auth.css";

const MARK_SRC = "/brand/tocker/v2/tocker-mark-neon-sm.svg";

/**
 * Everything on /login that is not the card: the black ground, the silk's poster, the
 * silk itself, a scrim, and the lockup in the top bar.
 *
 * A server component, and the page puts its Suspense boundary inside it, so the ground
 * and the lockup are in the first bytes of the response and never wait on the client.
 * The lockup sits where the landing's does and is the way home; the card has no link
 * of its own.
 */
export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <LoginBackdrop />
      <header className="auth-top">
        <Link href="/" aria-label="Tocker home" className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 2KB vector; next/image adds nothing here */}
          <img className="auth-brand-mark" src={MARK_SRC} alt="" width={29} height={24} draggable={false} />
          <span className="auth-brand-word">tocker</span>
        </Link>
      </header>
      {children}
    </div>
  );
}

/** Back to front: poster, silk (when it loads), scrim. The grain is a pseudo-element. */
function LoginBackdrop() {
  return (
    <div className="auth-bg" aria-hidden>
      <div className="auth-bg-poster" />
      <LoginSilk />
      <div className="auth-bg-scrim" />
    </div>
  );
}
