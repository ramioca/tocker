/**
 * What counts as dust. A leaf with no imports, so the risk guard, which is pure and must
 * stay free of the database, reads the same floor as the bookkeeping in `./positions.ts`.
 */

/**
 * Below this, a position is dust: not worth a guardian's attention or the network fee
 * the platform fronts to sell it, and not something the model should count as "held".
 * It stays on the row (its cents still count in equity) but leaves the book.
 */
export const DUST_POSITION_USD = 0.25;

export function isDustPosition(valueUsd: number | null): boolean {
  return valueUsd !== null && Number.isFinite(valueUsd) && valueUsd < DUST_POSITION_USD;
}
