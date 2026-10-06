import "server-only";
/**
 * What deleting an agent would strand, read for the one place that asks: `deleteAgent`.
 *
 * The rules live in `strandedHoldings` (`./funding`, pure and tested). This module only
 * gathers its inputs, and gathers them strictly:
 *
 *  - **Solana is read from the chain, and a failed read fails the deletion.** SOL comes
 *    from `getBalance` and every token from `getTokenAccountsByOwner` under both token
 *    programs, and either one throwing refuses the delete. The balance reader the wallet
 *    card uses turns an RPC error into "0 USDC" by design — the card should always
 *    render — and "0" is exactly the wrong answer to an irreversible question.
 *  - **Tokens count only when the agent bought them with real money** (a live trade row
 *    for that token). On Solana it is the chain that says how much is held, not the
 *    book: a live position the book lost track of is still the owner's money. A token
 *    the agent never bought — an airdrop, spam — never counts, or anyone could make an
 *    agent undeletable by sending it something.
 *  - **Base** has no token read of its own here: its USDC and ETH come from the same
 *    balance read the wallet card uses, and its tokens from the book.
 */
import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb, positions, tokens, trades } from "@/db";
import type { Chain } from "@/server/types";
import { USDC_MINT, strandedHoldings, type StrandedHolding, type StrandedTokenInput, type StrandedWalletInput } from "./funding";
import { NATIVE_ASSET, getAgentWallets, isPaperWallet, readWalletBalances } from "./index";

export type StrandedRead = { ok: true; holdings: StrandedHolding[] } | { ok: false; error: string };

export const STRANDED_READ_FAILED =
  "Couldn't read this agent's wallet just now, so it was not deleted. Try again in a minute.";

interface HeldToken {
  id: string;
  chain: Chain;
  symbol: string;
  amountToken: number;
}

interface LiveToken {
  id: string;
  chain: Chain;
  address: string;
  symbol: string;
  decimals: number;
}

/** Tokens this agent has at least one live (non-paper) trade row for. */
async function liveTradedTokens(agentId: string): Promise<LiveToken[]> {
  const db = await getDb();
  return db
    .selectDistinct({
      id: tokens.id,
      chain: tokens.chain,
      address: tokens.address,
      symbol: tokens.symbol,
      decimals: tokens.decimals,
    })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(and(eq(trades.agentId, agentId), eq(trades.isPaper, false)));
}

/** SOL, USDC and every live-bought token in one Solana wallet, straight from the chain. Throws when it cannot. */
async function readSolanaStrict(
  address: string,
  live: readonly LiveToken[],
): Promise<{ wallet: StrandedWalletInput; held: HeldToken[] }> {
  const [{ getLamports, LAMPORTS_PER_SOL }, { readTokenAccounts }] = await Promise.all([
    import("./solana-rpc"),
    import("./rent-recycle"),
  ]);
  const [lamports, accounts] = await Promise.all([getLamports(address), readTokenAccounts(address)]);

  const byMint = new Map<string, bigint>();
  for (const account of accounts) {
    let amount: bigint;
    try {
      amount = BigInt(account.amount);
    } catch {
      continue;
    }
    if (amount <= BigInt(0)) continue;
    byMint.set(account.mint, (byMint.get(account.mint) ?? BigInt(0)) + amount);
  }

  const usdcRaw = byMint.get(USDC_MINT.solana) ?? BigInt(0);
  const held: HeldToken[] = [];
  for (const token of live) {
    if (token.chain !== "solana" || token.address === USDC_MINT.solana) continue;
    const raw = byMint.get(token.address);
    if (raw === undefined) continue;
    held.push({ id: token.id, chain: "solana", symbol: token.symbol, amountToken: Number(raw) / 10 ** token.decimals });
  }

  return {
    wallet: { chain: "solana", usdc: Number(usdcRaw) / 1e6, native: lamports / LAMPORTS_PER_SOL },
    held,
  };
}

/** Base tokens the book holds that were bought live. */
async function baseBookHoldings(agentId: string, live: readonly LiveToken[]): Promise<HeldToken[]> {
  const ids = live.filter((t) => t.chain === "base").map((t) => t.id);
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({ tokenId: positions.tokenId, amountToken: positions.amountToken })
    .from(positions)
    .where(and(eq(positions.agentId, agentId), inArray(positions.tokenId, ids), gt(positions.amountToken, "0")));
  const byId = new Map(live.map((t) => [t.id, t]));
  return rows.flatMap((row) => {
    const token = byId.get(row.tokenId);
    const amountToken = Number(row.amountToken);
    return token && Number.isFinite(amountToken) && amountToken > 0
      ? [{ id: token.id, chain: "base" as const, symbol: token.symbol, amountToken }]
      : [];
  });
}

/**
 * Everything deleting this agent would strand, or `{ ok: false }` when a wallet could
 * not be read — which the caller must treat as a refusal, never as "empty".
 * Paper wallets hold nothing real and are skipped.
 */
export async function readStrandedHoldings(agentId: string): Promise<StrandedRead> {
  const real = (await getAgentWallets(agentId)).filter((w) => !isPaperWallet(w.id));
  if (real.length === 0) return { ok: true, holdings: [] };

  const live = await liveTradedTokens(agentId);
  const wallets: StrandedWalletInput[] = [];
  const held: HeldToken[] = [];

  try {
    for (const w of real) {
      if (w.chain === "solana") {
        const solana = await readSolanaStrict(w.address, live);
        wallets.push(solana.wallet);
        held.push(...solana.held);
        continue;
      }
      const read = await readWalletBalances(w);
      // That reader answers a failed lookup with zeros so the wallet card still renders.
      // Here zeros would say "nothing to strand" about a wallet nobody could read.
      if (read.readFailed) throw new Error(`could not read the ${w.chain} wallet's balance`);
      const amountOf = (asset: string) =>
        read.balances.find((b) => b.asset.toLowerCase() === asset)?.amount ?? 0;
      wallets.push({ chain: w.chain, usdc: amountOf("usdc"), native: amountOf(NATIVE_ASSET[w.chain]) });
      held.push(...(await baseBookHoldings(agentId, live)));
    }
  } catch (err) {
    console.warn(`[stranded] wallet read failed for ${agentId}:`, err instanceof Error ? err.message : err);
    return { ok: false, error: STRANDED_READ_FAILED };
  }

  // A price feed that is down leaves a holding unpriced, and unpriced blocks: the
  // conservative answer, since nothing then says the holding is small.
  let marks = new Map<string, number | null>();
  if (held.length > 0) {
    try {
      const { getMarks } = await import("@/lib/trading/prices");
      marks = await getMarks(held.map((h) => h.id));
    } catch {
      marks = new Map();
    }
  }
  const tokenInputs: StrandedTokenInput[] = held.map((h) => {
    const mark = marks.get(h.id) ?? null;
    return { chain: h.chain, symbol: h.symbol, amountToken: h.amountToken, valueUsd: mark === null ? null : h.amountToken * mark };
  });

  return { ok: true, holdings: strandedHoldings({ wallets, tokens: tokenInputs }) };
}
