/**
 * One funding transfer and the record of it, so the places that fund an agent cannot
 * disagree about what a transfer came to.
 *
 * Three outcomes, not two. `useTransfer` throws `TransferStatusUnknown` when the request
 * that submits the signed transfer got no answer: by then the server may already have
 * co-signed and broadcast, so it is not a failure. Recording it as one puts "send the
 * rest" on the agent's wallets card over money that may have arrived, and leaves a send
 * button armed on top of it. An unknown outcome leaves the intent as it was recorded
 * (pending) and is reported under its own name.
 *
 * Pure, and free of Privy: the callers hand in the send and the settle.
 */

export type FundingAttempt =
  | { outcome: "sent"; hash: string }
  | { outcome: "unknown"; message: string }
  | { outcome: "failed"; message: string };

/** How a caller closes the intent it recorded before asking for the signature. */
export type FundingSettlement = { status: "sent"; txHash: string } | { status: "failed"; error: string };

/**
 * Matched by `name` rather than `instanceof`, as the withdraw modal does: a class is
 * only itself within one copy of its module, and `use-transfer` is loaded in more than
 * one chunk.
 */
export function isTransferStatusUnknown(error: unknown): error is Error {
  return error instanceof Error && error.name === "TransferStatusUnknown";
}

export async function attemptFunding(input: {
  send: () => Promise<{ hash: string }>;
  /** Closes the recorded intent. Absent when recording it failed; never called for an unknown outcome. */
  settle?: (settlement: FundingSettlement) => void;
  /** What to say when the wallet threw something that is not an `Error`. */
  rejected: string;
}): Promise<FundingAttempt> {
  // The record is best-effort and the outcome is not: a settle that threw must never
  // turn a transfer that went into one that is reported as failed.
  const close = (settlement: FundingSettlement) => {
    try {
      input.settle?.(settlement);
    } catch {
      // The intent stays pending, which the wallets card words as "no result on record".
    }
  };

  let hash: string;
  try {
    ({ hash } = await input.send());
  } catch (error) {
    if (isTransferStatusUnknown(error)) return { outcome: "unknown", message: error.message };
    const message = error instanceof Error ? error.message : input.rejected;
    close({ status: "failed", error: message });
    return { outcome: "failed", message };
  }
  close({ status: "sent", txHash: hash });
  return { outcome: "sent", hash };
}
