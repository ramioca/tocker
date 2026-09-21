/**
 * The platform's own wallets — one app-owned Privy server wallet per chain.
 *
 * These are the wallets the *business* spends from, as opposed to the agent wallets an
 * operator funds. Today they do two jobs:
 *
 *  - **They pay for data.** Every x402 402 is settled by the platform wallet on the
 *    resource's network — Base for most sources, Solana for `deepnets-token-safety` and
 *    `solenrich-launches`. Both wallets are load-bearing; see `src/lib/x402/paidFetch.ts`
 *    and `dataChainsFor` in `src/lib/data-sources/registry.ts`.
 *  - **They collect the fee.** A live agent's accrued `platform_fees` are swept into
 *    them by the guardian. See `./settlement.ts`.
 *
 * Created lazily on first use, with the same `owner: { public_key }` pattern
 * `createAgentWallets` uses: the app's authorization key owns them so the server can
 * sign alone, at 3am, with nobody logged in. Never a `paper_` placeholder — a platform
 * wallet is real or it does not exist, because a fake one would turn "we cannot pay"
 * into "we paid, apparently".
 *
 * Two things stop a race from creating two wallets for one chain:
 *  1. a process-level promise cache, so concurrent callers in this process share one
 *     creation;
 *  2. `platform_wallets_chain_idx`, a unique index on `chain`, so concurrent callers in
 *     *different* processes (a cron lambda and a request, say) still end up with one row
 *     — the loser discards its Privy wallet and adopts the winner's.
 *
 * Deliberately no `import "server-only"`: `pnpm preflight` is a plain tsx script and has
 * to be able to report (and create) these wallets before a first deploy. Privy is
 * imported dynamically for the same reason, exactly as `agent/portfolio.ts` does.
 */
import { eq } from "drizzle-orm";
import { getDb, platformWallets } from "@/db";
import type { Chain } from "@/server/types";

export interface PlatformWalletRow {
  /** Privy wallet id. */
  walletId: string;
  chain: Chain;
  address: string;
}

/** Privy `chain_type` per chain. Base is an EVM chain. */
const CHAIN_TYPE: Record<Chain, "ethereum" | "solana"> = { base: "ethereum", solana: "solana" };
/** Privy balance/transfer chain names. */
const CHAIN_NAME: Record<Chain, "base" | "solana"> = { base: "base", solana: "solana" };
const NATIVE_ASSET: Record<Chain, "eth" | "sol"> = { base: "eth", solana: "sol" };

/**
 * The chain most paid sources price on, and the one a deployment with no Solana source
 * configured can get away with funding alone.
 *
 * It is **not** the only chain that pays: `deepnets-token-safety` and
 * `solenrich-launches` price on Solana, and `plexa-pretrade`, `otto-pulse` and
 * `nansen-smart-money` offer Solana alongside Base. Which wallets an *agent* actually
 * needs comes from `dataChainsFor(config.dataSources)` in
 * `src/lib/data-sources/registry.ts` — this constant is a default for copy and for the
 * scripts, never a check.
 */
export const DATA_CHAIN: Chain = "base";

/** What each platform wallet is for, in the operator's words. */
export function platformWalletPurpose(chain: Chain): string {
  return chain === "base"
    ? "Pays every 402 priced on Base (eip155:8453), and receives Base fee sweeps."
    : "Pays every 402 priced on Solana, and receives Solana fee sweeps.";
}

/** What these wallets are called in the UI and in every error an operator will read. */
export function platformWalletLabel(chain: Chain): string {
  return `Tocker platform wallet · ${chain}`;
}

/**
 * Thrown when the platform cannot pay. The message always names the wallet and, when we
 * have one, its address — so a run log says "top up the platform data wallet at 0x…",
 * not "402".
 */
export class PlatformWalletError extends Error {
  readonly chain: Chain;
  readonly address: string | null;
  constructor(message: string, chain: Chain, address: string | null = null) {
    super(message);
    this.name = "PlatformWalletError";
    this.chain = chain;
    this.address = address;
  }
}

const cache = new Map<Chain, PlatformWalletRow>();
const inflight = new Map<Chain, Promise<PlatformWalletRow>>();

/** Test seam, and what a `platform_wallets` row edit needs to take effect in a live process. */
export function resetPlatformWalletCache(): void {
  cache.clear();
  inflight.clear();
}

async function readRow(chain: Chain): Promise<PlatformWalletRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(platformWallets).where(eq(platformWallets.chain, chain)).limit(1);
  if (!row) return null;
  return { walletId: row.id, chain: row.chain, address: row.address };
}

/** The platform wallet for a chain, or null when one has not been created yet. Never creates. */
export async function getPlatformWallet(chain: Chain): Promise<PlatformWalletRow | null> {
  const cached = cache.get(chain);
  if (cached) return cached;
  const row = await readRow(chain);
  if (row) cache.set(chain, row);
  return row;
}

/** Every platform wallet on record, in a stable order. Never creates. */
export async function listPlatformWallets(): Promise<PlatformWalletRow[]> {
  const db = await getDb();
  const rows = await db.select().from(platformWallets);
  const out = rows.map((r) => ({ walletId: r.id, chain: r.chain as Chain, address: r.address }));
  for (const row of out) cache.set(row.chain, row);
  return out.sort((a, b) => a.chain.localeCompare(b.chain));
}

async function create(chain: Chain): Promise<PlatformWalletRow> {
  const existing = await getPlatformWallet(chain);
  if (existing) return existing;

  const { privy, authorizationPublicKey, isPrivyConfigured } = await import("@/lib/privy");
  if (!isPrivyConfigured()) {
    throw new PlatformWalletError(
      `The platform ${chain} wallet does not exist and cannot be created: Privy is not configured (NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET).`,
      chain,
    );
  }

  let created: { id: string; address: string };
  try {
    created = await privy()
      .wallets()
      .create({
        chain_type: CHAIN_TYPE[chain],
        // Owned by the app's authorization key: the platform pays for data and collects
        // fees with no user in the loop, so the server must be able to sign alone.
        owner: { public_key: authorizationPublicKey() },
        display_name: platformWalletLabel(chain).slice(0, 64),
      });
  } catch (err) {
    throw new PlatformWalletError(
      `Could not create the platform ${chain} wallet: ${err instanceof Error ? err.message : String(err)}`,
      chain,
    );
  }

  const db = await getDb();
  const inserted = await db
    .insert(platformWallets)
    .values({ id: created.id, chain, address: created.address, label: "data + fees" })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    // Another process won the race. Its wallet is the platform's; ours is an empty
    // Privy wallet nobody will ever fund, which is harmless and worth a line in the log.
    const winner = await readRow(chain);
    if (winner) {
      console.warn(
        `[platform] discarded a duplicate ${chain} wallet (${created.id}); ${winner.walletId} was already recorded`,
      );
      cache.set(chain, winner);
      return winner;
    }
  }

  const row: PlatformWalletRow = { walletId: created.id, chain, address: created.address };
  cache.set(chain, row);
  return row;
}

/**
 * The platform wallet for a chain, creating it on first use.
 *
 * Throws {@link PlatformWalletError} rather than returning null: every caller either has
 * a wallet to pay from or has something specific to tell the operator.
 */
export async function ensurePlatformWallet(chain: Chain): Promise<PlatformWalletRow> {
  const cached = cache.get(chain);
  if (cached) return cached;

  const pending = inflight.get(chain);
  if (pending) return pending;

  const promise = create(chain).finally(() => inflight.delete(chain));
  inflight.set(chain, promise);
  return promise;
}

/**
 * What one platform wallet holds, with "we could not tell" kept distinct from "zero".
 *
 * Until W7 this reported an unreadable balance as `amount: 0`, so the operator card and
 * the preflight would still render — which made a Privy hiccup indistinguishable from an
 * empty wallet. The readiness checklist turns an empty platform wallet into a hard block
 * on going live, and a rule that says "could not tell is a fail, never a pass" cannot be
 * built on a reader that answers zero when it means nothing.
 *
 * So the error is left in: `null` means unread, a number means read. The card still
 * renders either way; it just says which it is looking at.
 */
export interface PlatformBalanceReading {
  chain: Chain;
  address: string;
  walletId: string;
  /** USDC held, or `null` when Privy could not be read. */
  usdc: number | null;
  /** ETH on Base / SOL on Solana, or `null` when Privy could not be read. */
  native: number | null;
  /** Why it could not be read. `null` when it could. */
  error: string | null;
}

export async function readPlatformBalance(row: PlatformWalletRow): Promise<PlatformBalanceReading> {
  const assets = ["usdc", NATIVE_ASSET[row.chain]] as const;
  const unread = (error: string): PlatformBalanceReading => ({
    chain: row.chain,
    address: row.address,
    walletId: row.walletId,
    usdc: null,
    native: null,
    error,
  });
  try {
    const { privy, isPrivyConfigured } = await import("@/lib/privy");
    if (!isPrivyConfigured()) return unread("Privy is not configured on this deployment.");

    // One `balance.get` per asset: the SDK's types accept an array but serialise it as a
    // single comma-joined query value ("usdc,eth") the API rejects with a 400. Same trap
    // `readWalletBalances` documents in `src/lib/wallets/index.ts`.
    const results = await Promise.all(
      assets.map((asset) => privy().wallets().balance.get(row.walletId, { chain: CHAIN_NAME[row.chain], asset })),
    );
    const held = new Map<string, number>();
    for (const res of results) {
      for (const b of res.balances ?? []) {
        const amount = Number(b.raw_value ?? "0") / 10 ** (b.raw_value_decimals ?? 0);
        const key = String(b.asset).toLowerCase();
        held.set(key, (held.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0));
      }
    }
    return {
      chain: row.chain,
      address: row.address,
      walletId: row.walletId,
      // A wallet Privy answered for but that holds nothing reports no balance line at
      // all, which is a read that found zero — not a read that failed.
      usdc: held.get("usdc") ?? 0,
      native: held.get(NATIVE_ASSET[row.chain]) ?? 0,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[platform] balance lookup failed for the ${row.chain} wallet:`, message);
    return unread(message);
  }
}

/** {@link readPlatformBalance} for every platform wallet on record, in a stable order. */
export async function readPlatformBalanceAll(): Promise<PlatformBalanceReading[]> {
  const rows = await listPlatformWallets();
  return Promise.all(rows.map(readPlatformBalance));
}

/** USDC held by one platform wallet. `null` when there is no wallet, or it could not be read. */
export async function platformUsdcBalance(chain: Chain): Promise<number | null> {
  const row = await getPlatformWallet(chain);
  if (!row) return null;
  return (await readPlatformBalance(row)).usdc;
}
