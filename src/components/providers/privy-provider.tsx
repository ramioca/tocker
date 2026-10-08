"use client";
import { useMemo, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { ENABLED_LOGIN_METHODS } from "@/components/auth/login-methods";
import { TOCKER_MARK_LG_SRC } from "@/components/brand/tocker-mark";
import { SessionKeepAlive } from "./session-keep-alive";
import "./privy-theme.css";

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
 * (Base) and a Solana embedded wallet on login, so they can fund agents from either
 * chain.
 *
 * `createOnLogin` is "all-users", not "users-without-wallets". The narrower mode skips
 * a chain as soon as the account has any wallet of that chain type linked, and the
 * wallet somebody signs in with is exactly that: a Phantom sign-in got no Solana
 * wallet and a MetaMask sign-in no Base one, so Deposit had no address to show and
 * funding had nothing to send from. The server records embedded wallets only
 * (`syncUserEmbeddedWallets`), so the wallet used to sign in never stands in for one.
 * An account made under the old mode gets its missing wallet the next time it signs in.
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

  // Privy renders the logo inside its own modal, so it wants an absolute URL. The modal
  // draws it as a plain <img> on this page, 180 x 90 at most, so it takes the same WebP
  // the page does. Keep the file small: Privy also mounts a hidden copy under this
  // provider to have it ready, so every page here fetches it whether or not the modal
  // ever opens.
  const logoUrl = useMemo(
    () => `${typeof window === "undefined" ? "https://tocker.xyz" : window.location.origin}${TOCKER_MARK_LG_SRC}`,
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
          // A hex sets the modal's surface and the vendor derives the rest from it: the
          // sign-in card's near-black, and the app's violet accent.
          theme: "#0a0a0b",
          accentColor: "#8b6cff",
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
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "all-users" },
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
