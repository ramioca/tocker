"use client";
import { useMemo, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { ENABLED_LOGIN_METHODS } from "@/components/auth/login-methods";
import { SessionKeepAlive } from "./session-keep-alive";

/** Set at build time; empty in local dev without a Privy app. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Where Privy's embedded-wallet UIs read the chain from.
 *
 * The confirmation modal behind `signTransaction` / `signAndSendTransaction` needs an
 * RPC for `solana:mainnet`; without one it throws while rendering, which nothing below
 * the provider catches, so the whole page is replaced by the root error screen. The
 * HTTP endpoint is Tocker's own `/api/solana/rpc`, a same-origin forwarder to
 * `SOLANA_RPC_URL`, so the provider key never ships to the browser. Subscriptions have
 * no proxy (no websockets on serverless), so they go to the public cluster endpoint,
 * or to `NEXT_PUBLIC_SOLANA_WSS_URL` when one is set.
 */
function solanaRpcHttpUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  if (typeof window !== "undefined") return `${window.location.origin}/api/solana/rpc`;
  return "https://api.mainnet-beta.solana.com";
}

function solanaRpcWssUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_WSS_URL?.trim() || "wss://api.mainnet-beta.solana.com";
}

/**
 * Wraps Privy with Tocker's embedded-wallet config: every user gets an Ethereum
 * (Base) and a Solana embedded wallet on first login, so they can fund agents
 * from either chain.
 *
 * When `NEXT_PUBLIC_PRIVY_APP_ID` is empty this renders children untouched, so
 * the app still boots without Privy credentials (see DEV_IMPERSONATE_USER_ID).
 */
export function AppPrivyProvider({ children }: { children: ReactNode }) {
  // Built once per mount: the RPC objects are lazy (nothing is fetched until a wallet UI
  // asks), and a new object on every render would re-initialise Privy's Solana layer.
  const solanaRpcs = useMemo(
    () => ({
      "solana:mainnet": {
        rpc: createSolanaRpc(solanaRpcHttpUrl()),
        rpcSubscriptions: createSolanaRpcSubscriptions(solanaRpcWssUrl()),
        blockExplorerUrl: "https://solscan.io",
      },
    }),
    [],
  );

  // Privy renders the logo inside its own modal, so it wants an absolute URL.
  const logoUrl = useMemo(
    () => (typeof window === "undefined" ? "https://tocker.xyz/icon.svg" : `${window.location.origin}/icon.svg`),
    [],
  );

  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        solana: { rpcs: solanaRpcs },
        // Privy's own surfaces are the fallback, not the product: sign-in is Tocker's
        // page (headless hooks), and signing is silent. Whatever Privy still has to show
        // itself — the external-wallet connector, MFA enrolment, recovery — wears
        // Tocker's mark and copy.
        appearance: {
          theme: "dark",
          accentColor: "#a78bfa",
          logo: logoUrl,
          walletChainType: "ethereum-and-solana",
          showWalletLoginFirst: false,
          landingHeader: "Sign in to Tocker",
          loginMessage: "New here? Signing in makes your account.",
        },
        // The same list the sign-in card draws its buttons from (NEXT_PUBLIC_LOGIN_METHODS),
        // so the modal can never offer a method the card has left out.
        loginMethods: [...ENABLED_LOGIN_METHODS],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
          // No confirmation popups from Privy on signatures: every signature in Tocker
          // sits behind an explicit action of ours — the Create button, the fund
          // drawer, a hold-to-confirm on withdraw — and a second, foreign-looking
          // modal on top of that was the thing operators asked to see gone.
          showWalletUIs: false,
        },
      }}
    >
      <SessionKeepAlive />
      {children}
    </PrivyProvider>
  );
}
