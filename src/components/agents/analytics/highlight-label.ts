/**
 * What to call a best/worst exit card, and how loud to make it.
 *
 * The slot says which end of the ranking the exit came from; the sign says what it
 * made. They disagree more often than you would think: in a losing week the "best"
 * exit is still a loss, and a green "Best exit" card over −$11 reads as a bug. So the
 * label follows the slot only while the sign agrees with it, and the card goes quiet
 * when it does not.
 */
export type HighlightSlot = "best" | "worst" | "only";
export type HighlightTone = "positive" | "negative" | "neutral";

export function highlightLabel(
  slot: HighlightSlot,
  pnlUsd: number | null,
): { label: string; tone: HighlightTone } {
  const sign = pnlUsd === null || pnlUsd === 0 ? 0 : Math.sign(pnlUsd);
  if (slot === "only") {
    return { label: "Only exit", tone: sign > 0 ? "positive" : sign < 0 ? "negative" : "neutral" };
  }
  if (slot === "best") {
    if (sign > 0) return { label: "Best exit", tone: "positive" };
    // Every exit in the window lost; this one lost least.
    if (sign < 0) return { label: "Smallest loss", tone: "neutral" };
    return { label: "Best exit", tone: "neutral" };
  }
  if (sign < 0) return { label: "Worst exit", tone: "negative" };
  // Every exit in the window made money; this one made least.
  if (sign > 0) return { label: "Smallest win", tone: "neutral" };
  return { label: "Worst exit", tone: "neutral" };
}
