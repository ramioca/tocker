import "server-only";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import type { AuthorizationContext } from "@privy-io/node";

let _client: PrivyClient | undefined;

/** Server-side Privy client singleton. */
export function privy(): PrivyClient {
  if (_client) return _client;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET missing (see .env.example)");
  _client = new PrivyClient({ appId, appSecret });
  return _client;
}

/** The dashboard exports authorization keys as `wallet-auth:<base64 PKCS8>`; the SDK accepts either form. */
function rawAuthorizationPrivateKey(): string {
  const key = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim();
  if (!key) throw new Error("PRIVY_AUTHORIZATION_PRIVATE_KEY missing (see .env.example)");
  return key;
}

/** Authorization context that lets the server sign with agent server wallets. */
export function authorizationContext(): AuthorizationContext {
  return { authorization_private_keys: [rawAuthorizationPrivateKey()] };
}

/**
 * The P-256 public key (base64 SPKI DER, the form the Privy dashboard shows) that
 * matches `PRIVY_AUTHORIZATION_PRIVATE_KEY`. Agent server wallets are created with
 * this key as their owner, so the server can sign for them without a user JWT.
 */
export function authorizationPublicKey(): string {
  return derivePublicKey(rawAuthorizationPrivateKey());
}

export function derivePublicKey(privateKey: string): string {
  const pkcs8 = privateKey.replace(/^wallet-auth:/, "");
  const priv = createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
  return createPublicKey(priv).export({ type: "spki", format: "der" }).toString("base64");
}

export const CAIP2 = {
  base: "eip155:8453",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
} as const;

export function isPrivyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
}
