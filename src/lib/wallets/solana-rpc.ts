/**
 * The small slice of Solana JSON-RPC the money path needs, server-side.
 *
 * Deliberately `fetch` rather than `@solana/web3.js`'s `Connection`: these three calls
 * are one POST each, they have to be mockable in a vitest without a network, and the
 * run loop should not pay for a websocket-capable client to ask for a balance.
 *
 * `SOLANA_RPC_URL` is the operator's paid endpoint (Helius in production). The public
 * endpoint is the fallback and is rate-limited — good enough for one balance read, not
 * good enough to rely on.
 */

export function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

async function rpc<T>(method: string, params: unknown[], timeoutMs = 10_000): Promise<T> {
  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed (HTTP ${res.status})`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`Solana RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
  if (body.result === undefined) throw new Error(`Solana RPC ${method} returned no result`);
  return body.result;
}

/** Lamports held by an address. Throws when the RPC is unreachable — callers decide. */
export async function getLamports(address: string): Promise<number> {
  const result = await rpc<{ value?: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return Number(result?.value ?? 0);
}

/** SOL (whole units) held by an address. */
export async function getSolBalance(address: string): Promise<number> {
  return (await getLamports(address)) / LAMPORTS_PER_SOL;
}

/** True when the account exists on chain (used to skip a redundant ATA creation). */
export async function accountExists(address: string): Promise<boolean> {
  const result = await rpc<{ value?: unknown }>("getAccountInfo", [
    address,
    { commitment: "confirmed", encoding: "base64" },
  ]);
  return result?.value !== null && result?.value !== undefined;
}

/** The SPL token balance of a token account, in base units. `null` when it has none. */
export async function getTokenAccountBalance(address: string): Promise<bigint | null> {
  try {
    const result = await rpc<{ value?: { amount?: string } }>("getTokenAccountBalance", [
      address,
      { commitment: "confirmed" },
    ]);
    const amount = result?.value?.amount;
    return amount === undefined ? null : BigInt(amount);
  } catch {
    // A token account that does not exist yet is a 'could not find account' error, which
    // is a zero balance, not a failure the caller should abort on.
    return null;
  }
}

export type SignatureConfirmation = "confirmed" | "pending" | "failed";

/** One `getSignatureStatuses` poll. `pending` means not seen yet, not "never landing". */
export async function signatureStatus(signature: string): Promise<SignatureConfirmation> {
  const result = await rpc<{ value?: Array<{ confirmationStatus?: string; err?: unknown } | null> }>(
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
  );
  const entry = result?.value?.[0];
  if (!entry) return "pending";
  if (entry.err) return "failed";
  return entry.confirmationStatus === "confirmed" || entry.confirmationStatus === "finalized"
    ? "confirmed"
    : "pending";
}

/**
 * Poll until a signature is confirmed, or the deadline passes. Returns the last status
 * seen — a `pending` answer after the deadline is "we do not know", which the caller
 * must not read as success.
 */
export async function confirmSignature(
  signature: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SignatureConfirmation> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  let last: SignatureConfirmation = "pending";
  for (;;) {
    try {
      last = await signatureStatus(signature);
      if (last !== "pending") return last;
    } catch {
      // transient RPC error — keep polling until the deadline
    }
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
