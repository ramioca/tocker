/**
 * Fees an agent owes when its owner takes money out on Base, or deletes it.
 *
 * Fees accrue at fill and are swept by the marks pass once they reach the batch
 * threshold. On Solana an owner's withdrawal carries them to the platform in the same
 * transaction (`./settlement.ts`, "Fees collected by an owner's withdrawal"). On Base the
 * withdrawal is Privy's `transfer`, a transaction we do not build, so nothing rode along
 * with it: an owner could trade, withdraw the whole balance before the next pass, and
 * delete the agent, and the fee rows went with it (they cascade).
 *
 * Two steps close that, without a new signing path:
 *
 *  1. {@link holdBaseFees}, before a USDC withdrawal is sent: the amount may not dip into
 *     what the agent owes on Base.
 *  2. {@link collectFeesOwed}, straight after the withdrawal and again when the agent is
 *     deleted: the ordinary sweep, with the batch threshold lowered to a cent.
 *
 * Deletion is never refused for fees still owed. Under the threshold nothing would ever
 * sweep them, and an owner must not be left with an agent they can neither empty nor
 * delete; the sweep is tried, and whatever it could not collect is let go.
 *
 * For the same reason a debt under that cent is not held at all. A fee is a share of a
 * fill, so one small fill owes half a cent; the sweep leaves that where it is, and the
 * cent held back for it could then be neither withdrawn nor deleted with.
 *
 * No `server-only` here, like `./settlement.ts`: the wallet library is imported where it
 * is used.
 */
import { fmtUsdExact } from "@/lib/money";
import type { Chain } from "@/server/types";
import { sumFees, withdrawableAfterFees } from "./fee";
import { accruedFees } from "./fees";
import { settlePlatformFees, type SettlementResult } from "./settlement";

/** What {@link collectFeesOwed} sweeps from, and so what {@link holdBaseFees} holds from: a cent. */
export const COLLECT_NOW_MIN_USD = 0.01;

/** Said when the wallet could not be read: a refusal, in words that do not blame the fees. */
export const BALANCE_UNREAD_FOR_WITHDRAWAL =
  "Couldn't read this agent's balance just now, so nothing was sent. Try again in a minute.";

export type FeeHold =
  /** The withdrawal may go. `owedUsd` is what the agent owes on Base, to be swept after it. */
  | { ok: true; owedUsd: number }
  | { ok: false; error: string };

const HELD_CHAIN: Chain = "base";

/**
 * May this much USDC leave the agent's Base wallet? Not when it would take the Tocker
 * fees the agent owes on Base with it: the most that may go is the balance less what is
 * owed, to the cent.
 *
 * Only a debt the sweep that follows is sure to collect is held, which is one of
 * {@link COLLECT_NOW_MIN_USD} or more. Less than that is reported as nothing owed, so the
 * caller neither holds money back for it nor sends a sweep for it.
 *
 * A balance that could not be read refuses the withdrawal. It is not an empty wallet, and
 * "the most you can withdraw is $0.00" would be a guess presented as a fact. Throws when
 * the fee ledger cannot be read; the caller refuses rather than assume nothing is owed.
 */
export async function holdBaseFees(input: { agentId: string; amount: number }): Promise<FeeHold> {
  const owedUsd = sumFees((await accruedFees(input.agentId)).filter((fee) => fee.chain === HELD_CHAIN));
  if (!(owedUsd >= COLLECT_NOW_MIN_USD)) return { ok: true, owedUsd: 0 };

  const { getAgentWallets, readWalletBalances } = await import("@/lib/wallets");
  const wallet = (await getAgentWallets(input.agentId)).find((w) => w.chain === HELD_CHAIN);
  const read = wallet ? await readWalletBalances(wallet) : null;
  if (read?.readFailed) return { ok: false, error: BALANCE_UNREAD_FOR_WITHDRAWAL };

  const usdc = read?.balances.find((b) => b.asset.toLowerCase() === "usdc")?.amount ?? 0;
  const most = withdrawableAfterFees(usdc, owedUsd);
  if (input.amount > most) {
    return {
      ok: false,
      // What is owed is seldom whole cents, so it is printed as it stands: a cent and a
      // quarter owed must not read "$0.01" while two cents are being held back for it.
      error: `This agent owes ${fmtUsdExact(owedUsd)} in Tocker fees. The most you can withdraw is $${most.toFixed(2)}.`,
    };
  }
  return { ok: true, owedUsd };
}

/**
 * Sweep what this agent owes now, whatever the batch threshold. Never throws: a sweep
 * that cannot happen leaves the fees accrued and says why on the result, exactly as on
 * the marks pass.
 *
 * `mode` is "live" whatever the agent's mode is today. A fee row is only ever left
 * `accrued` by a real-money fill (a paper fill's row is written already settled), and an
 * agent that traded live and went back to paper still owes them. Passing its current
 * mode would skip the sweep for exactly that agent, and leave it holding USDC it may
 * not withdraw and so cannot be deleted with.
 */
export async function collectFeesOwed(agent: { id: string; ownerId: string; name: string }): Promise<SettlementResult> {
  return settlePlatformFees({
    agentId: agent.id,
    ownerId: agent.ownerId,
    agentName: agent.name,
    mode: "live",
    minUsd: COLLECT_NOW_MIN_USD,
  });
}
