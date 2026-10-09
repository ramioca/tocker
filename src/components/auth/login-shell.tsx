import type { ReactNode } from "react";
import Link from "next/link";
import { TockerMark } from "@/components/brand/tocker-mark";
import { LoginBackdrop } from "./login-backdrop";
import "./auth.css";

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
          <TockerMark height={24} className="auth-brand-mark" />
          <span className="auth-brand-word">tocker</span>
        </Link>
      </header>
      {children}
    </div>
  );
}
