/**
 * What the Slippage tolerance slider means, written once for the builder and the
 * settings form.
 *
 * Both used to say fills worse than the setting "are rejected". That is not always so.
 * When Jupiter answers 400 to an order built at the owner's ceiling, the Solana executor
 * signs Jupiter's own order instead, at Jupiter's tolerance, up to a hard cap
 * (`MAX_ACCEPTED_SLIPPAGE_BPS` in src/lib/trading/jupiter.ts, an operator decision
 * recorded there). So the sentence says what is sent, what the exception is, and where
 * the tolerance actually used can be read.
 */

/**
 * The most Tocker accepts of Jupiter's own tolerance, in percent. A copy of the
 * executor's `MAX_ACCEPTED_SLIPPAGE_BPS`, which is private to a server module this
 * client copy cannot import; `slippage-copy.test.ts` fails if the two drift apart.
 */
export const JUPITER_FALLBACK_MAX_PCT = 15;

export function slippageMeaning(slippageBps: number): string {
  return `Orders are sent with at most ${(slippageBps / 100).toFixed(2)}% slippage. If Jupiter cannot build the order that tight, Tocker takes Jupiter's own tolerance, never above ${JUPITER_FALLBACK_MAX_PCT}%, and the receipt shows what was used. Launch-day memecoins usually need 300–500 bps.`;
}
