/**
 * The client-safe half of the receipt module: constants and presentational helpers a
 * "use client" component may import. Nothing here touches the database — the server
 * half (`./receipt.ts`) re-exports these so callers on either side see one module.
 * Splitting it is what keeps `postgres` (and with it `fs`, `net`, `tls`) out of the
 * browser bundle.
 */
import type { TradeReceiptData } from "@/db/schema";

export type { ReceiptScoreReason, TradeReceiptData, TradeReceiptVenue } from "@/db/schema";

/** Exactly what a paper fill says, everywhere, forever. */
export const SIMULATED_FILL_TEXT = "Simulated fill · no on-chain transaction";

/** The literal written into `txHash` when there was no chain to write to. */
export const SIMULATED_TX = "simulated";

/** "+19 bps" / "-4 bps" / "at the quote" — the slippage, in a phrase. */
export function slippageText(bps: number): string {
  if (!Number.isFinite(bps) || Math.abs(bps) < 0.5) return "at the quote";
  const rounded = Math.round(bps);
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} bps`;
}

/** True when the fill drifted further from the quote than the agent said it would accept. */
export function exceededTolerance(receipt: Pick<TradeReceiptData, "slippageBps" | "slippageToleranceBps">): boolean {
  return receipt.slippageBps > receipt.slippageToleranceBps;
}

