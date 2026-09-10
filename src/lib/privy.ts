import "server-only";
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

/** Authorization context that lets the server sign with agent server wallets. */
export function authorizationContext(): AuthorizationContext {
  const key = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
  if (!key) throw new Error("PRIVY_AUTHORIZATION_PRIVATE_KEY missing (see .env.example)");
  return { authorization_private_keys: [key] };
}

export const CAIP2 = {
  base: "eip155:8453",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
} as const;

export function isPrivyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
}
