/**
 * What the browser may ask a Solana RPC through Tocker's same-origin proxy.
 *
 * Privy's embedded-wallet UIs (the confirmation modal behind `signTransaction` and
 * `signAndSendTransaction`) need an RPC for the chain they sign on, or they throw
 * during render and take the whole document down with them. The real endpoint
 * carries a provider key in its URL and must not ship to visitors, so the provider
 * is pointed at `/api/solana/rpc`, which forwards JSON-RPC to `SOLANA_RPC_URL`.
 *
 * Pure: the allowlist and the request check are here so the route stays a thin
 * forwarder and the rule can be unit-tested.
 */

/** Read-only queries plus the two calls that move a signed transaction. */
export const ALLOWED_SOLANA_RPC_METHODS: ReadonlySet<string> = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

/** A generous ceiling: a full transaction plus its params is a few kilobytes. */
export const MAX_SOLANA_RPC_BODY_BYTES = 64 * 1024;

export type RpcCheck = { ok: true } | { ok: false; reason: string };

/**
 * Is this a JSON-RPC request (or batch) made only of allowed methods?
 *
 * Batches are checked element by element; one disallowed method rejects the whole
 * batch, because forwarding half a batch would return a response the client cannot
 * correlate.
 */
export function checkSolanaRpcRequest(body: unknown): RpcCheck {
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) return { ok: false, reason: "empty batch" };
  if (items.length > 20) return { ok: false, reason: `batch of ${items.length} is too large` };
  for (const item of items) {
    if (!item || typeof item !== "object") return { ok: false, reason: "not a JSON-RPC request" };
    const method = (item as { method?: unknown }).method;
    if (typeof method !== "string") return { ok: false, reason: "request has no method" };
    if (!ALLOWED_SOLANA_RPC_METHODS.has(method)) return { ok: false, reason: `method ${method} is not allowed` };
  }
  return { ok: true };
}
