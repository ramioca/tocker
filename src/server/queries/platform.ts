import "server-only";
/**
 * The operator's view of the platform's own money.
 *
 * One card under Settings answers three questions that otherwise live in a Privy
 * dashboard and two SQL queries: what are the platform wallets and what do they hold,
 * what did data cost this month, and how much of the per-fill fee has been collected
 * versus is still sitting in agents' wallets waiting for the next sweep.
 *
 * **Access.** Any signed-in user. Tocker is single-operator today — one person owns the
 * deployment, the Privy app and the authorization key — so there is no "is this person
 * an admin" question to ask yet, and inventing a half-enforced one would be worse than
 * saying so. The moment a second operator exists this needs a real role check; the page
 * says the same thing in a comment so nobody has to guess whether it was considered.
 *
 * Nothing here is per-agent and nothing here touches a strategy: it is the platform's
 * own ledger, and it is read whole.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, platformFees, x402Payments } from "@/db";
import { toNum } from "@/lib/money";
import { platformFeeUsd, settleMinUsd } from "@/lib/platform/fee";
import { listPlatformWallets, readPlatformBalances } from "@/lib/platform/wallets";
import { isMockMode } from "@/lib/x402/paidFetch";
import { chainForNetwork } from "@/lib/x402/types";
import type { Chain } from "@/server/types";

export interface PlatformWalletView {
  chain: Chain;
  walletId: string;
  address: string;
  /** USDC held, or null when Privy could not be read (the card says so rather than lying). */
  usdcBalance: number | null;
  /** Real (non-simulated) x402 spend on this chain since the 1st of the month, UTC. */
  dataSpendThisMonthUsd: number;
  /** Fees charged on this chain and not yet swept in. */
  feesAccruedUsd: number;
  /** Fees on this chain already settled into this wallet. */
  feesCollectedUsd: number;
}

export interface PlatformOverview {
  wallets: PlatformWalletView[];
  /** What each fill is charged right now. 0 means the fee is switched off. */
  feeUsd: number;
  /** What an agent has to owe before the guardian sweeps. */
  settleMinUsd: number;
  /** True when `X402_MOCK=1`: no real payment has been made, whatever the table says. */
  mockData: boolean;
  /** Total accrued (unsettled) across every chain — what is still out there. */
  accruedUsd: number;
  /** Total settled across every chain — what has actually landed. */
  collectedUsd: number;
  monthLabel: string;
}

function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Real x402 spend this month, folded from CAIP-2 networks onto our two chains. */
async function dataSpendByChain(since: Date): Promise<Map<Chain, number>> {
  const db = await getDb();
  const rows = await db
    .select({
      network: x402Payments.network,
      total: sql<string>`coalesce(sum(${x402Payments.amountUsd}), 0)`,
    })
    .from(x402Payments)
    // `simulated` rows are fixtures: they were accounted for against the run budget but
    // no wallet paid anything, so counting them here would invent a cost.
    .where(and(gte(x402Payments.createdAt, since), eq(x402Payments.simulated, false)))
    .groupBy(x402Payments.network);

  const out = new Map<Chain, number>();
  for (const row of rows) {
    const chain = chainForNetwork(row.network);
    if (!chain) continue;
    out.set(chain, (out.get(chain) ?? 0) + toNum(row.total));
  }
  return out;
}

async function feesByChain(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({
      chain: platformFees.chain,
      status: platformFees.status,
      total: sql<string>`coalesce(sum(${platformFees.amountUsd}), 0)`,
    })
    .from(platformFees)
    .groupBy(platformFees.chain, platformFees.status);
  const out = new Map<string, number>();
  for (const row of rows) out.set(`${row.chain}:${row.status}`, toNum(row.total));
  return out;
}

/**
 * Everything the Platform card renders. Never creates a wallet: the card reports what
 * exists, and a wallet appears the first time something actually needs one (a paid data
 * call, a fee sweep, or `pnpm preflight`). A settings page that silently created
 * blockchain accounts as a side effect of being looked at would be a surprise nobody
 * asked for.
 */
export async function getPlatformOverview(now: Date = new Date()): Promise<PlatformOverview> {
  const since = startOfUtcMonth(now);
  const [rows, spend, fees] = await Promise.all([listPlatformWallets(), dataSpendByChain(since), feesByChain()]);

  const balances = await Promise.all(rows.map((row) => readPlatformBalances(row)));

  const wallets: PlatformWalletView[] = rows.map((row, i) => {
    const usdc = balances[i]?.balances.filter((b) => b.asset.toLowerCase() === "usdc") ?? [];
    return {
      chain: row.chain,
      walletId: row.walletId,
      address: row.address,
      usdcBalance: usdc.length === 0 ? null : usdc.reduce((sum, b) => sum + b.amount, 0),
      dataSpendThisMonthUsd: spend.get(row.chain) ?? 0,
      feesAccruedUsd: fees.get(`${row.chain}:accrued`) ?? 0,
      feesCollectedUsd: fees.get(`${row.chain}:settled`) ?? 0,
    };
  });

  let accruedUsd = 0;
  let collectedUsd = 0;
  for (const [key, value] of fees) {
    if (key.endsWith(":accrued")) accruedUsd += value;
    else collectedUsd += value;
  }

  return {
    wallets,
    feeUsd: platformFeeUsd(),
    settleMinUsd: settleMinUsd(),
    mockData: isMockMode(),
    accruedUsd,
    collectedUsd,
    monthLabel: since.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}
