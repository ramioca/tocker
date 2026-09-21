import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, wallets } from "@/db";
import { authorizationContext, authorizationPublicKey, isPrivyConfigured, privy } from "@/lib/privy";
import type { Chain, WalletBalance } from "@/server/types";

export interface AgentWalletRow {
  id: string;
  chain: Chain;
  address: string;
}

/** Privy `chain_type` for each of our chains. Base is an EVM chain. */
const CHAIN_TYPE: Record<Chain, "ethereum" | "solana"> = { base: "ethereum", solana: "solana" };
/** Privy balance/transfer chain names. */
const CHAIN_NAME: Record<Chain, "base" | "solana"> = { base: "base", solana: "solana" };
/** Native asset per chain (Privy balance asset ids). */
export const NATIVE_ASSET: Record<Chain, "eth" | "sol"> = { base: "eth", solana: "sol" };

export const USDC_ADDRESS: Record<Chain, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

let warnedPaperWallets = false;

function paperWallet(agentId: string, chain: Chain): AgentWalletRow {
  const digest = createHash("sha256").update(`${agentId}:${chain}`).digest("hex");
  const address = chain === "base" ? `0xPAPER${digest.slice(0, 34)}` : `PAPER${digest.slice(0, 39)}`;
  return { id: `paper_${chain}_${digest.slice(0, 24)}`, chain, address };
}

/** True when this wallet is a dev/paper placeholder rather than a real Privy wallet. */
export function isPaperWallet(walletId: string): boolean {
  return walletId.startsWith("paper_");
}

/**
 * Create one Privy server wallet per chain for an agent and record them in `wallets`.
 *
 * Without Privy credentials (local dev) it falls back to deterministic fake
 * addresses so paper-mode agents still work end to end. Never in production —
 * `createAgentWallets` throws there if Privy is not configured.
 */
export async function createAgentWallets(input: {
  agentId: string;
  userId: string;
  name: string;
  chains?: Chain[];
}): Promise<AgentWalletRow[]> {
  const db = await getDb();
  const chains: Chain[] = input.chains?.length ? input.chains : ["base", "solana"];
  const configured = isPrivyConfigured();

  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("Privy is not configured — cannot create agent wallets in production");
  }
  if (!configured && !warnedPaperWallets) {
    warnedPaperWallets = true;
    console.warn(
      "[wallets] Privy not configured — creating deterministic paper wallets. Paper-mode only; set NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET for real wallets.",
    );
  }

  const rows: AgentWalletRow[] = [];
  for (const chain of chains) {
    if (configured) {
      const created = await privy()
        .wallets()
        .create({
          chain_type: CHAIN_TYPE[chain],
          // Owned by the app's authorization key, not the user: the agent trades and pays
          // for data while its owner is asleep, so the server must be able to sign alone.
          // The user↔agent association lives in our `wallets` table.
          owner: { public_key: authorizationPublicKey() },
          display_name: `${input.name} · ${chain}`.slice(0, 64),
        });
      rows.push({ id: created.id, chain, address: created.address });
    } else {
      rows.push(paperWallet(input.agentId, chain));
    }
  }

  await db
    .insert(wallets)
    .values(
      rows.map((w) => ({
        id: w.id,
        kind: "agent_server" as const,
        chain: w.chain,
        address: w.address,
        userId: input.userId,
        agentId: input.agentId,
      })),
    )
    .onConflictDoNothing();

  // The platform pays the ~0.00204 SOL rent for the agent's USDC account, so the person
  // funding it never has to hold SOL (W7 B1). Best effort by design: a failure here
  // costs the funder the rent, it does not cost them the agent.
  // Awaited rather than fired and forgotten: on Vercel the function freezes when the
  // response is sent, and a dropped promise here is a user paying rent they were told
  // they would not.
  const solana = rows.find((w) => w.chain === "solana");
  if (solana && configured) {
    const { ensureAgentUsdcAta } = await import("./gas");
    await ensureAgentUsdcAta({ agentId: input.agentId, address: solana.address });
  }

  return rows;
}

/** Agent server wallets from the db. */
export async function getAgentWallets(agentId: string): Promise<AgentWalletRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: wallets.id, chain: wallets.chain, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.agentId, agentId), eq(wallets.kind, "agent_server")));
  return rows.map((r) => ({ id: r.id, chain: r.chain as Chain, address: r.address }));
}

/**
 * Live balances for one known wallet row. Paper wallets and Privy errors resolve to zeros.
 *
 * Exported for the admin dashboard, which reads hundreds of wallets and needs to own
 * the concurrency and the caching itself rather than fanning out one `Promise.all` per
 * agent. Everything else should go through `getAgentWalletBalances`.
 */
export async function readWalletBalances(w: AgentWalletRow): Promise<WalletBalance> {
  const assets = ["usdc", NATIVE_ASSET[w.chain]] as const;
  const empty = assets.map((asset) => ({ asset, amount: 0, usd: null as number | null }));
  if (!isPrivyConfigured() || isPaperWallet(w.id)) {
    return { chain: w.chain, address: w.address, walletId: w.id, balances: empty };
  }
  try {
    // One call per asset. The SDK's types accept an `asset` array, but it serialises
    // one as a single comma-joined query value ("usdc,sol") and the API rejects that
    // with a 400 — every balance read in the app was failing. Found by `pnpm preflight`.
    const results = await Promise.all(
      assets.map((asset) => privy().wallets().balance.get(w.id, { chain: CHAIN_NAME[w.chain], asset })),
    );
    const balances = results.flatMap((res) => res.balances ?? []).map((b) => {
      const decimals = b.raw_value_decimals ?? 0;
      const amount = Number(b.raw_value ?? "0") / 10 ** decimals;
      const usdRaw = b.display_values?.usd ?? b.display_values?.USD;
      const usd = usdRaw === undefined ? null : Number(usdRaw);
      return {
        asset: String(b.asset),
        amount: Number.isFinite(amount) ? amount : 0,
        usd: usd !== null && Number.isFinite(usd) ? usd : null,
      };
    });
    return { chain: w.chain, address: w.address, walletId: w.id, balances: balances.length ? balances : empty };
  } catch (err) {
    console.warn(`[wallets] balance lookup failed for ${w.id}:`, err instanceof Error ? err.message : err);
    return { chain: w.chain, address: w.address, walletId: w.id, balances: empty };
  }
}

/**
 * Live balances (USDC + native) for every agent wallet. Paper wallets and Privy
 * errors resolve to zeroed balances rather than throwing — the wallet card
 * should always render.
 */
export async function getAgentWalletBalances(agentId: string): Promise<WalletBalance[]> {
  const rows = await getAgentWallets(agentId);
  return Promise.all(rows.map(readWalletBalances));
}

/**
 * Live balances for the user's own Privy *embedded* wallets (kind `user_embedded`,
 * recorded by /api/me/sync at login). This is the "cash" the top-bar wallet chip
 * shows — spendable by the user, distinct from any agent's trading balance.
 */
export async function getUserWalletBalances(userId: string): Promise<WalletBalance[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: wallets.id, chain: wallets.chain, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.kind, "user_embedded")));
  return Promise.all(
    rows.map((r) => readWalletBalances({ id: r.id, chain: r.chain as Chain, address: r.address })),
  );
}

/**
 * Record the user's Privy **embedded** wallets in `wallets` (kind `user_embedded`) and
 * return what is on record afterwards.
 *
 * The list is read from Privy server-side, never from a request body, so nobody can
 * register an address they do not control. Idempotent, and it never throws: a Privy
 * outage means the funding UI does not learn about a wallet this second, not that the
 * page 500s.
 *
 * Shared by `POST /api/me/sync` (called at login) and by `GET /api/me/wallets`, which
 * calls it to self-heal when a chain is missing — Privy creates the two embedded
 * wallets asynchronously after authentication, so the login-time sync can genuinely be
 * too early (W7 M5).
 */
export async function syncUserEmbeddedWallets(
  userId: string,
): Promise<Array<{ id: string; chain: Chain; address: string }>> {
  if (!isPrivyConfigured()) return [];
  const db = await getDb();

  const stored = async () => {
    const rows = await db
      .select({ id: wallets.id, chain: wallets.chain, address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.kind, "user_embedded")));
    return rows.map((r) => ({ id: r.id, chain: r.chain as Chain, address: r.address }));
  };

  try {
    const user = await privy().users()._get(userId);
    const found: Array<{ id: string; chain: Chain; address: string }> = [];
    for (const account of user.linked_accounts ?? []) {
      if (account.type !== "wallet") continue;
      if (!("connector_type" in account) || account.connector_type !== "embedded") continue;
      const chain: Chain | null =
        account.chain_type === "solana" ? "solana" : account.chain_type === "ethereum" ? "base" : null;
      if (!chain) continue;
      const id = ("id" in account ? account.id : null) ?? `${chain}:${account.address}`;
      found.push({ id, chain, address: account.address });
    }

    if (found.length > 0) {
      await db
        .insert(wallets)
        .values(
          found.map((w) => ({
            id: w.id,
            kind: "user_embedded" as const,
            chain: w.chain,
            address: w.address,
            userId,
            agentId: null,
          })),
        )
        .onConflictDoNothing();
    }
    // An address can only belong to one user — report what the table actually holds.
    return stored();
  } catch (err) {
    console.error("[wallets] embedded wallet sync failed:", err instanceof Error ? err.message : err);
    return stored().catch(() => []);
  }
}

export interface WithdrawInput {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  /** human units (e.g. 12.5 USDC) */
  amount: number;
  toAddress: string;
}

export interface WithdrawResult {
  /** The real on-chain hash/signature. `null` while the action is still pending. */
  txHash: string | null;
  /** Privy's wallet-action id — an audit handle, never a block explorer link. */
  actionId: string;
  /** `succeeded` is the only status that means the money moved. */
  status: "pending" | "succeeded" | "rejected" | "failed";
}

/** A step of a wallet action, on either chain. Privy names the hash differently per VM. */
function stepHash(step: unknown): string | null {
  if (!step || typeof step !== "object") return null;
  const s = step as { transaction_hash?: string | null; transaction_signature?: string | null };
  return s.transaction_signature ?? s.transaction_hash ?? null;
}

/** The first failure reason on the action or any of its steps, as one sentence. */
function failureText(action: {
  failure_reason?: { message?: string };
  steps?: Array<{ failure_reason?: { message?: string } }>;
}): string | null {
  const own = action.failure_reason?.message;
  if (own) return own;
  for (const step of action.steps ?? []) {
    const message = step.failure_reason?.message;
    if (message) return message;
  }
  return null;
}

/**
 * Send funds out of an agent server wallet, signed server-side with the app's
 * authorization key. Callers must have already checked ownership.
 *
 * W7 H12: a `transfer` returns a **wallet action**, not a transaction. It comes back
 * `pending` with no hash, and its `id` is not a signature — reporting it as one put a
 * string in the UI that no explorer has ever heard of, and let `settlement.ts` mark
 * platform fees collected against a transfer that had not happened yet. So: poll the
 * action with `?include=steps` until it reaches a terminal status, throw on
 * `rejected`/`failed` with Privy's own reason, and return the step's real signature.
 */
export async function withdrawFromAgent(input: WithdrawInput): Promise<WithdrawResult> {
  if (!isPrivyConfigured()) throw new Error("Privy is not configured — withdrawals are unavailable");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");

  const [wallet] = (await getAgentWallets(input.agentId)).filter((w) => w.chain === input.chain);
  if (!wallet) throw new Error(`No ${input.chain} wallet for this agent`);
  if (isPaperWallet(wallet.id)) throw new Error("Paper wallets hold no real funds");

  const asset = input.asset === "usdc" ? "usdc" : NATIVE_ASSET[input.chain];
  const created = await privy()
    .wallets()
    .transfer(wallet.id, {
      source: { asset, chain: CHAIN_NAME[input.chain] },
      destination: { address: input.toAddress },
      amount: String(input.amount),
      authorization_context: authorizationContext(),
    });

  return pollWithdrawal(wallet.id, created.id, created);
}

/** Poll one wallet action to a terminal status. Exported for the fee-settlement path. */
export async function pollWithdrawal(
  walletId: string,
  actionId: string,
  first?: { status?: string; steps?: unknown[]; failure_reason?: { message?: string } },
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<WithdrawResult> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;

  let action = first as
    | { status?: string; steps?: unknown[]; failure_reason?: { message?: string } }
    | undefined;
  for (;;) {
    const status = action?.status;
    if (status === "rejected" || status === "failed") {
      const reason =
        failureText(action as Parameters<typeof failureText>[0]) ??
        "Privy gave no reason. The wallet policy is the usual cause — a policy with no explicit `transfer` rule denies this call.";
      throw new Error(`The withdrawal was ${status}: ${reason}`);
    }
    const hash = (action?.steps ?? []).map(stepHash).find(Boolean) ?? null;
    if (status === "succeeded") {
      return { txHash: hash, actionId, status: "succeeded" };
    }
    if (Date.now() >= deadline) {
      // Not an error: a pending transfer is money in flight, and a thrown error here
      // would tell the operator it failed when it may be about to land.
      return { txHash: hash, actionId, status: "pending" };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      action = (await privy()
        .wallets()
        .actions.get(actionId, { wallet_id: walletId, include: "steps" })) as typeof action;
    } catch (err) {
      console.warn(`[wallets] could not read wallet action ${actionId}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ---------- wallet-layer budget (Privy policies) ----------

import type { WalletBudget } from "@/db/schema";
import type { PolicyCreateParams } from "@privy-io/node/resources";

/** The ERC20 `transfer` ABI entry the Base budget rule decodes calldata with. */
const ERC20_TRANSFER_ABI_SCHEMA = [
  {
    name: "transfer",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

/**
 * The budget rules for one chain. Order matters — first match wins:
 * over-cap USDC transfers and key exports are denied, everything else
 * (swaps, approvals, x402 payments under the cap) passes through.
 *
 * ## What this cap does and does not reach (W7 H9)
 *
 * The signing rules below decode **instructions and calldata**, so they fire on a plain
 * USDC transfer out of the wallet: a withdrawal, or the platform's fee sweep. They do
 * **not** fire on a swap: a Jupiter Ultra route is ComputeBudget ×2 plus one `JUP6…`
 * instruction (probe-confirmed), with the token movement happening in inner
 * instructions the policy engine does not decode. Anything that calls this a hard floor
 * under the risk config for *trades* is wrong, and the UI copy has been corrected.
 *
 * The `transfer` ALLOW below is not decoration. Privy's docs are explicit: *"wallets
 * that call the transfer endpoint need an explicit `transfer` rule"* — it is evaluated
 * against `action_request_body` before the transaction is even prepared, so a policy
 * whose only catch-all is `*` leaves `wallets().transfer()` denied. That is the call
 * behind both `withdrawFromAgent` and platform-fee settlement.
 *
 * No amount condition rides along with it on purpose: the transfer endpoint's `amount`
 * is a **decimal string in standard units** (`"12.5"`, per `NamedTokenTransferSource`
 * in `@privy-io/node`), not the base units this cap is expressed in, and a string
 * comparison against the wrong scale can deny a withdrawal that is well under the cap.
 * A layer that fails closed on a legitimate withdrawal is worse than one that does not
 * reach that path at all — the app-level owner check does.
 */
function budgetRules(chain: Chain, capBaseUnits: string): PolicyCreateParams["rules"] {
  const noExports: PolicyCreateParams["rules"] = [
    { name: "No private key export", method: "exportPrivateKey", action: "DENY", conditions: [] },
    { name: "No seed export", method: "exportSeedPhrase", action: "DENY", conditions: [] },
  ];
  const allowTransfers: PolicyCreateParams["rules"] = [
    { name: "Allow wallet transfers", method: "transfer", action: "ALLOW", conditions: [] },
  ];
  const allowRest: PolicyCreateParams["rules"] = [
    { name: "Allow everything else", method: "*", action: "ALLOW", conditions: [] },
  ];

  if (chain === "base") {
    return [
      {
        name: "Cap USDC per transaction",
        method: "eth_sendTransaction",
        action: "DENY",
        conditions: [
          {
            field_source: "ethereum_calldata",
            abi: ERC20_TRANSFER_ABI_SCHEMA,
            field: "amount",
            operator: "gt",
            value: capBaseUnits,
          },
        ],
      },
      ...noExports,
      ...allowTransfers,
      ...allowRest,
    ];
  }

  // Solana: a transfer can be signed via either method and encoded as either
  // instruction, so all four combinations get the cap.
  const solanaMethods = ["signTransaction", "signAndSendTransaction"] as const;
  const amountFields = ["Transfer.amount", "TransferChecked.amount"] as const;
  return [
    ...solanaMethods.flatMap((method) =>
      amountFields.map(
        (field): PolicyCreateParams["rules"][number] => ({
          name: `Cap ${field.split(".")[0]} per ${method}`,
          method,
          action: "DENY",
          conditions: [
            { field_source: "solana_token_program_instruction", field, operator: "gt", value: capBaseUnits },
          ],
        }),
      ),
    ),
    ...noExports,
    ...allowTransfers,
    ...allowRest,
  ];
}

/**
 * Create or update the per-chain Privy policies that enforce an agent's wallet
 * budget, and attach them to the agent's server wallets. Paper wallets and
 * unconfigured Privy resolve to null — the budget is then app-level only.
 */
export async function applyAgentBudgetPolicy(input: {
  agentId: string;
  agentName: string;
  perTxUsd: number;
  existing?: WalletBudget | null;
}): Promise<WalletBudget | null> {
  if (!isPrivyConfigured()) return null;
  const rows = (await getAgentWallets(input.agentId)).filter((w) => !isPaperWallet(w.id));
  if (rows.length === 0) return null;

  // USDC has 6 decimals on both chains.
  const capBaseUnits = String(Math.round(input.perTxUsd * 1_000_000));
  const policyIds: WalletBudget["policyIds"] = { ...(input.existing?.policyIds ?? {}) };

  for (const wallet of rows) {
    const rules = budgetRules(wallet.chain, capBaseUnits);
    const name = `tocker budget · ${input.agentName} · ${wallet.chain}`.slice(0, 64);
    const existingId = policyIds[wallet.chain];

    if (existingId) {
      await privy()
        .policies()
        .update(existingId, { rules, name, authorization_context: authorizationContext() });
    } else {
      const created = await privy()
        .policies()
        .create({
          chain_type: CHAIN_TYPE[wallet.chain],
          name,
          rules,
          version: "1.0",
          owner: { public_key: authorizationPublicKey() },
        });
      policyIds[wallet.chain] = created.id;
      await privy()
        .wallets()
        .update(wallet.id, { policy_ids: [created.id], authorization_context: authorizationContext() });
    }
  }

  return { perTxUsd: input.perTxUsd, policyIds };
}
