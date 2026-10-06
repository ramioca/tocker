/**
 * What the Agent wallets card says about a funding transfer that is not on record as
 * sent. Pure, so the sentences can be tested without the card.
 *
 * The rule: never claim more than the record knows. `pending` means no answer was ever
 * written down, which covers a tab closed mid-signature and also a transfer whose submit
 * request got no reply and may have landed all the same. Neither is "never reached the
 * chain", and neither is a reason to send the same money again without looking first.
 */
import type { FundingIntentRow } from "@/server/actions/wallets";

type IntentStatus = FundingIntentRow["status"];

/** Follows the amount: "25 USDC on Solana did not complete". */
export function unfinishedIntentText(status: Exclude<IntentStatus, "sent">): string {
  if (status === "pending") return " has no result on record";
  if (status === "cancelled") return " was not attempted";
  // Not "was rejected": a failure after the signature is not the wallet saying no.
  return " did not complete";
}

/** The line under the list: what to do about it. */
export function unfinishedFundingAdvice(statuses: readonly IntentStatus[]): string {
  return statuses.includes("pending")
    ? "The agent exists and is safe. A transfer with no result on record may still have arrived, so check the balance above before you send it again with Fund."
    : "The agent exists and is safe; it just has less than you meant it to. Use Fund above to send the rest.";
}
