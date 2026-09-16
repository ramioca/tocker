/**
 * The pure, client-safe half of a trade receipt: the phrases and predicates a
 * component needs to render one.
 *
 * Split out of `./receipt.ts` because that module also holds `saveReceipt`,
 * `getReceipt` and `getReceipts`, which import `@/db` — and `@/db` pulls in the
 * `postgres` driver. Any client component importing a display helper from there
 * therefore drags a Node-only driver into its browser bundle, and the build fails
 * with `Module not found: Can't resolve 'fs'`. A lazy `await import("@/db")` does
 * not help: the bundler still traces the dynamic edge into the client graph. The
 * only reliable fix is for the client-reachable code to live in a module with no
 * path to the database at all — which is this one.
 *
 * `./receipt.ts` re-exports everything here, so every existing import site is
 * unchanged; only client components need to import from this file directly.
 */
import type { TradeReceiptData } from "@/db/schema";

/** Exactly what a paper fill says, everywhere, forever. */
export const SIMULATED_FILL_TEXT = "Simulated fill · no on-chain transaction";

/** The literal written into `txHash` when there was no chain to write to. */
export const SIMULATED_TX = "simulated";

/** "+19 bps" / "−4 bps" / "at the quote" — the slippage, in a phrase. */
export function slippageText(bps: number): string {
  if (!Number.isFinite(bps) || Math.abs(bps) < 0.5) return "at the quote";
  const rounded = Math.round(bps);
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} bps`;
}

/** True when the fill drifted further from the quote than the agent said it would accept. */
export function exceededTolerance(receipt: Pick<TradeReceiptData, "slippageBps" | "slippageToleranceBps">): boolean {
  return receipt.slippageBps > receipt.slippageToleranceBps;
}

/** One line for a notification body: what filled, where, and how well. */
export function receiptSummary(receipt: TradeReceiptData): string {
  const fee = receipt.totalFeeUsd > 0 ? `, $${receipt.totalFeeUsd.toFixed(2)} fees` : "";
  const where = receipt.simulated ? SIMULATED_FILL_TEXT : receipt.venueLabel;
  return `${where} · ${slippageText(receipt.slippageBps)} vs quote${fee}`;
}
