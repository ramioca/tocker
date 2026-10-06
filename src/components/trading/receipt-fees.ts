/**
 * How the compact receipt row words what a fill cost. Pure, and kept apart from the
 * component so the words can be tested.
 *
 * `totalFeeUsd` on a receipt is every cost of the fill in one number: the venue's cut,
 * the chain's, and Tocker's own flat fee (`buildReceipt`). The row printed that total as
 * "venue fees", which put Tocker's charge on Jupiter and the simulator on every public
 * feed card. The total is "fees"; who it went to is the split.
 */
import { formatUsd } from "@/components/common/format";
import type { TradeReceiptData } from "@/lib/trading/receipt-format";

/** The word after the total. Never "venue fees": the venue's is only one part of it. */
export const TOTAL_FEES_LABEL = "fees";

/**
 * Who the total went to, for the row's tooltip: "Tocker $0.10 · venue $0.15 · network
 * $0.002". Read from the receipt, part by part, so it is whatever this fill was actually
 * charged: a part that was nothing is left out, and so is a network fee the venue did
 * not report. Empty when the receipt records no cost at all.
 */
export function feeSplitText(
  receipt: Pick<TradeReceiptData, "venueFeeUsd" | "platformFeeUsd" | "networkFeeUsd">,
): string {
  const charged = (value: number | null | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  return [
    charged(receipt.platformFeeUsd) ? `Tocker ${formatUsd(receipt.platformFeeUsd)}` : null,
    charged(receipt.venueFeeUsd) ? `venue ${formatUsd(receipt.venueFeeUsd)}` : null,
    charged(receipt.networkFeeUsd) ? `network ${formatUsd(receipt.networkFeeUsd)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}
