"use client";

/** OWNER: foundation. Opens the Privy login modal; shows avatar menu when logged in. */
export function LoginButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} disabled>
      Sign in
    </button>
  );
}
