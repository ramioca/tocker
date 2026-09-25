/**
 * The withdraw modal's amount rules, apart from the modal so they can be tested.
 *
 * USDC has six decimals, so a balance carries sub-cent dust (123.456789). The input is in
 * cents, so what can leave is the balance floored to a cent, and that floored figure is
 * the one to show: rounding showed $123.46, and typing it back was refused.
 */

export const floorCents = (value: number) => Math.floor(value * 100 + 1e-9) / 100;

export function checkWithdrawAmount({
  amount,
  availableUsdc,
  feeUsdc,
  minAmount,
}: {
  /** What is in the input, as typed. */
  amount: string;
  availableUsdc: number;
  /** A one-time fee taken from the same balance (a Solana recipient's new USDC account). */
  feeUsdc: number;
  minAmount: number;
}) {
  const spendable = Math.max(0, availableUsdc - feeUsdc);
  // The input is capped at cents as it is typed; the floor is what makes "what they
  // receive", the hold label and the signed amount one number whatever reaches here.
  const parsed = floorCents(Number(amount));
  const entered = Number.isFinite(parsed) && parsed > 0;
  const underMinimum = entered && parsed < minAmount;
  const overBalance = entered && parsed + feeUsdc > availableUsdc + 1e-9;
  return {
    spendable,
    /** The most that can be sent, in cents — the only balance figure the modal shows. */
    sendable: floorCents(spendable),
    parsed,
    entered,
    underMinimum,
    overBalance,
    validAmount: entered && !underMinimum && !overBalance,
  };
}
