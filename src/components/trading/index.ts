/**
 * The trading surfaces, in one import.
 *
 * `TradeReceiptRow` is the compact line a feed card embeds:
 *
 * ```tsx
 * import { TradeReceiptRow } from "@/components/trading";
 * {receipt ? <TradeReceiptRow receipt={receipt} className="mt-2" /> : null}
 * ```
 *
 * `receipt` is `TradeReceiptData | null` — from `receiptsFor([...])` in
 * `@/server/queries/trading` — and `null` renders nothing, so a trade that predates
 * receipts keeps whatever layout it already had.
 */
export {
  TradeReceiptRow,
  TradeReceiptDetail,
  TradeReceiptSheet,
  TradeReceiptCard,
} from "./trade-receipt";
export { PriceChart, pricePointsFrom, type PricePoint } from "./price-chart";
export { SizingControls, SizingSummary } from "./sizing-controls";
