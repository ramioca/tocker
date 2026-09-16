/**
 * Shared glass surfaces for the money screens.
 *
 * globals.css has no `.glass` utilities to lean on and is owned elsewhere, so
 * the recipe lives here instead: one blurred, faintly-lit card, defined once so
 * the wallet chip, the deposit sheet and the funding step are visibly the same
 * material.
 */
export const GLASS =
  "rounded-2xl border border-border/60 bg-card/45 backdrop-blur-xl supports-backdrop-filter:bg-card/35";

export const GLASS_HEAVY =
  "rounded-2xl border border-border/70 bg-card/80 backdrop-blur-2xl shadow-[inset_0_1px_0_0_oklch(1_0_0/7%)]";

/** A row inside a glass card: quieter, no blur of its own. */
export const GLASS_ROW = "rounded-xl border border-border/50 bg-background/40";
