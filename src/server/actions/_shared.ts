/**
 * Helpers the server actions share. Deliberately NOT a "use server" file: nothing here
 * is callable from the browser, it is imported by the files that are.
 */
import { limiter, type RateLimitRule } from "@/lib/security/rate-limit";
import { feeFailureKind, feeFailureSentence } from "@/lib/wallets/funding";
import type { Chain } from "@/server/types";

/** Per-user caps for actions that are cheap to call and cost us something each time. */
export const ACTION_LIMITS = {
  /** Scoring fans out to four third-party APIs per call. */
  score: { limit: 10, windowMs: 60_000 },
  /** The manual sheet previews on debounced typing, so this has to be generous. */
  preview: { limit: 60, windowMs: 60_000 },
  /** Follows and likes each write a notification into someone else's inbox. */
  social: { limit: 30, windowMs: 60_000 },
  /** Comments and notes are public text; a loop of them is spam. */
  comment: { limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Consume one unit of `${prefix}:${userId}`'s bucket. Returns `null` when allowed, or the
 * sentence to hand back in the action's `{ ok: false, error }` when not.
 */
export function slowDown(prefix: string, userId: string, rule: RateLimitRule): string | null {
  const verdict = limiter.consume(`${prefix}:${userId}`, rule);
  if (verdict.ok) return null;
  const s = verdict.retryAfterSeconds;
  return `Slow down — try again in ${s} second${s === 1 ? "" : "s"}.`;
}

/** A URL (the RPC's carries its key), a key by name, or a drizzle query dump. */
const LEAKY = /:\/\/|api[-_ ]?key|^Failed query/i;

/**
 * The message of a caught error, but only when it reads like a sentence this codebase
 * wrote for a person ("That amount rounds to zero USDC.") — otherwise `fallback`.
 *
 * Why a heuristic and not a class check: the wallet and token libraries throw plain
 * `Error`s with deliberately user-facing text, and the same `catch` also sees raw
 * throws from Postgres, drizzle, Privy's API and the RPC. Those are the ones that can
 * carry a table name, a query, or an RPC URL with its API key in it. Our own sentences
 * start with a capital and end in a full stop; postgres (`relation "x" does not
 * exist`), undici (`fetch failed`), Privy's API errors (`400 {...}`) and drizzle
 * (`Failed query: ...\nparams: ...`) do not. Anything with a URL is refused outright.
 * The raw error is the caller's to `console.error` either way.
 */
export function publicErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message.trim();
  if (!message || message.length > 300 || message.includes("\n")) return fallback;
  if (LEAKY.test(message)) return fallback;
  if (!/^[A-Z]/.test(message) || !/[.!?]$/.test(message)) return fallback;
  return message;
}

/**
 * {@link publicErrorMessage} for a failed transfer, with one exception: a network-fee
 * failure. The withdraw and fund forms run `userFacingTransferError` over the text they
 * get back to tell "Tocker's fee wallet is refuelling, retry" from "Tocker won't pay
 * this fee", and the raw RPC/Privy wording is what that classifier reads — so a fee
 * failure is passed through when it is short and carries no URL, and otherwise becomes
 * the finished sentence for its kind.
 */
export function transferErrorMessage(
  err: unknown,
  fallback: string,
  chain: Chain,
  asset: "usdc" | "native" = "usdc",
): string {
  const message = err instanceof Error ? err.message.trim() : "";
  const kind = feeFailureKind(message);
  if (kind) return message.length <= 300 && !LEAKY.test(message) ? message : feeFailureSentence(chain, kind, asset);
  return publicErrorMessage(err, fallback);
}
