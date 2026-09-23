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

/**
 * A blockhash to build a transaction against, from the *server's* endpoint.
 *
 * `solana-transfer.ts` has its own version for the browser, which goes through
 * `/api/solana/blockhash` so a provider key never leaves the server. This one is for
 * transactions the server builds itself — the sponsored funding transfer, above all.
 */
export async function getLatestBlockhash(): Promise<string> {
  const result = await rpc<{ value?: { blockhash?: string } }>("getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  const blockhash = result?.value?.blockhash;
  if (!blockhash) throw new Error("Solana RPC getLatestBlockhash returned no blockhash");
  return blockhash;
}

export interface SimulatedAccount {
  address: string;
  /** Lamports after the transaction, or null when the account would not exist. */
  lamportsAfter: number | null;
}

export interface SimulationResult {
  /** The program error, when the transaction would fail. Null when it would succeed. */
  err: unknown;
  logs: string[];
  accounts: SimulatedAccount[];
  unitsConsumed: number | null;
}

/**
 * Run a transaction against current state without sending it, and report the lamports
 * of `watch` afterwards. Signatures are not verified (a partially signed transaction is
 * fine) and the blockhash is replaced, so this answers "what would this do to these
 * accounts" — the question a co-signer has to ask before it adds its signature.
 */
export async function simulateTransaction(base64: string, watch: readonly string[]): Promise<SimulationResult> {
  const result = await rpc<{
    value?: {
      err?: unknown;
      logs?: string[] | null;
      unitsConsumed?: number;
      accounts?: Array<{ lamports?: number } | null> | null;
    };
  }>(
    "simulateTransaction",
    [
      base64,
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [...watch] },
      },
    ],
    15_000,
  );
  const value = result?.value ?? {};
  const accounts = (value.accounts ?? []).map((account, i) => ({
    address: watch[i] ?? "",
    lamportsAfter: account && typeof account.lamports === "number" ? account.lamports : null,
  }));
  return {
    err: value.err ?? null,
    logs: value.logs ?? [],
    accounts,
    unitsConsumed: typeof value.unitsConsumed === "number" ? value.unitsConsumed : null,
  };
}

/**
 * Broadcast an already-signed transaction and return its signature.
 *
 * Deliberately *not* routed through {@link rpc}: when a send is rejected, the RPC's own
 * sentence ("Attempt to debit an account but found no record of a prior credit",
 * "Blockhash not found", a program's custom error) is the only thing that says what
 * actually went wrong, and wrapping it in our own prose buries it. The last simulation
 * log line is appended when the node returns one, because that is where a program error
 * names itself.
 */
export async function sendRawTransaction(base64: string): Promise<string> {
  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [base64, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Solana RPC sendTransaction failed (HTTP ${res.status})`);
  const body = (await res.json()) as {
    result?: string;
    error?: { message?: string; data?: { logs?: string[] } };
  };
  if (body.error) {
    const logs = body.error.data?.logs;
    const tail = Array.isArray(logs) && logs.length > 0 ? ` — ${logs[logs.length - 1]}` : "";
    throw new Error(`${body.error.message ?? "the RPC rejected the transaction"}${tail}`);
  }
  if (!body.result) throw new Error("The RPC accepted the transaction but returned no signature.");
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
