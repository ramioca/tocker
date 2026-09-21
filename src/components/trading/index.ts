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
export { PriceChart } from "./price-chart";
// `pricePointsFrom` is NOT re-exported here on purpose. Everything else in this barrel is
// a client component, so a server component that imported the helper from here would pull
// the client module and get a reference proxy instead of the function. Import it from
// "@/components/trading/price-points" — see the doc in that file.
export type { PricePoint } from "./price-points";
export { SizingControls, SizingSummary } from "./sizing-controls";
