import { formatTokenAmount } from "@/components/common/format";

/**
 * A token amount at the precision a feed line can afford.
 *
 * The shared formatter keeps four decimals from 1 up, which a ledger wants and a
 * 390px card does not: "1,018.4809 AERO" is what pushed the trade line onto three
 * rows. From 100 up the last two of those decimals are noise next to the dollar
 * figure printed beside it; below 100 (and in compact millions) the shared rules
 * stand, because a 0.0042 WBTC fill needs its significant digits.
 */
export function formatFeedTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return formatTokenAmount(value);
  const abs = Math.abs(value);
  if (abs >= 100 && abs < 1_000_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return formatTokenAmount(value);
}
