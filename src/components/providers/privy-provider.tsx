"use client";
import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

/** Set at build time; empty in local dev without a Privy app. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Wraps Privy with Tocker's embedded-wallet config: every user gets an Ethereum
 * (Base) and a Solana embedded wallet on first login, so they can fund agents
 * from either chain.
 *
 * When `NEXT_PUBLIC_PRIVY_APP_ID` is empty this renders children untouched, so
 * the app still boots without Privy credentials (see DEV_IMPERSONATE_USER_ID).
 */
export function AppPrivyProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#a78bfa",
          walletChainType: "ethereum-and-solana",
          landingHeader: "Sign in to Tocker",
          loginMessage: "Build agents that trade for you.",
        },
        loginMethods: ["email", "google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
