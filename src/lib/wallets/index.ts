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

export interface WithdrawInput {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  /** human units (e.g. 12.5 USDC) */
  amount: number;
  toAddress: string;
}

/**
 * Send funds out of an agent server wallet, signed server-side with the app's
 * authorization key. Callers must have already checked ownership.
 */
export async function withdrawFromAgent(input: WithdrawInput): Promise<{ txHash: string }> {
  if (!isPrivyConfigured()) throw new Error("Privy is not configured — withdrawals are unavailable");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");

  const [wallet] = (await getAgentWallets(input.agentId)).filter((w) => w.chain === input.chain);
  if (!wallet) throw new Error(`No ${input.chain} wallet for this agent`);
  if (isPaperWallet(wallet.id)) throw new Error("Paper wallets hold no real funds");

  const asset = input.asset === "usdc" ? "usdc" : NATIVE_ASSET[input.chain];
  const action = await privy()
    .wallets()
    .transfer(wallet.id, {
      source: { asset, chain: CHAIN_NAME[input.chain] },
      destination: { address: input.toAddress },
      amount: String(input.amount),
      authorization_context: authorizationContext(),
    });

  const hash =
    action.steps?.map((s) => (s as { transaction_hash?: string | null }).transaction_hash).find(Boolean) ?? action.id;
  return { txHash: String(hash) };
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
 */
function budgetRules(chain: Chain, capBaseUnits: string): PolicyCreateParams["rules"] {
  const noExports: PolicyCreateParams["rules"] = [
    { name: "No private key export", method: "exportPrivateKey", action: "DENY", conditions: [] },
    { name: "No seed export", method: "exportSeedPhrase", action: "DENY", conditions: [] },
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
