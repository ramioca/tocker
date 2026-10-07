/**
 * What one row of an agent's Trades tab says, worked out from the stored trade.
 *
 * A trade that did not fill still has an amount, a price and a value in the database:
 * the columns are not nullable, so the writers store zeros and the amount that was asked
 * for. Printed as they are, a buy that never happened reads "0.000 at $0.00". This module
 * decides what is a fact and what is a placeholder, and puts the failure reason into
 * plain words. Pure, so every rule is tested; the table only lays the answers out.
 */
import { formatPriceUsd, formatTokenAmount, formatUsd, truncateAddress } from "@/components/common/format";
import { txExplorerUrl } from "@/lib/tokens/links";
import { outcomeUncertain } from "@/lib/trading/trade-error-copy";
import type { TradeRow } from "@/server/types";

export type StatusTone = "danger" | "quiet" | "wait";

export interface TradeRowView {
  /** `status === "filled"`: the only state whose amount, price and value are a fill. */
  traded: boolean;
  /** Null on a filled row, which needs no word. */
  status: { label: string; tone: StatusTone } | null;
  /** Null prints a dash. */
  amount: string | null;
  /** The full-precision amount, only when `amount` is not null. */
  amountTitle: string | null;
  price: string | null;
  /** An unfilled row that still carries a real quoted price (a proposal). */
  priceQuoted: boolean;
  /** The full-precision price, only when `price` is not null. */
  priceTitle: string | null;
  value: string;
  /** The value is what was asked for, not what traded. */
  valueAsked: boolean;
  /** `label` is four…four for the table, `short` is the first four and an ellipsis for a card. */
  tx: { kind: "link"; href: string; label: string; short: string } | { kind: "paper" } | { kind: "none" };
  /**
   * `raw` is the stored text, when the sentence shown is not it. `failingSince` is when
   * a guardian exit first failed; the exit may have stopped being retried long ago.
   */
  reason: { text: string; raw: string | null; failingSince: string | null } | null;
  rationale: string | null;
}

/** Who is looking. Chooses words only; the server has already removed what a visitor may not have. */
export interface TradeViewer {
  isOwner: boolean;
}

/** The one line a visitor reads in place of any reason. */
export const VISITOR_REASON = "Not traded. The reason is visible to the agent's owner.";

/**
 * The word beside BUY or SELL on a row that did not fill.
 *
 * Who said no to a rejected trade (the owner, or the agent's own guard) says how the
 * owner runs the agent, so only the owner is told. A visitor gets one word for both, and
 * `decidedBy` is not read for them at all.
 */
export function tradeStatusChip(
  trade: Pick<TradeRow, "status" | "decidedBy">,
  viewer: TradeViewer,
): TradeRowView["status"] {
  switch (trade.status) {
    case "filled":
      return null;
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "rejected":
      if (!viewer.isOwner) return { label: "Not placed", tone: "quiet" };
      return { label: trade.decidedBy === "owner" ? "Declined" : "Blocked", tone: "quiet" };
    case "expired":
      return { label: "Expired", tone: "quiet" };
    case "proposed":
      // A visitor is never sent a proposal. If one arrived anyway it would not say whose turn it is.
      return viewer.isOwner ? { label: "Awaiting you", tone: "wait" } : { label: "Pending", tone: "quiet" };
    case "pending":
      return { label: "Pending", tone: "quiet" };
    case "submitted":
      return { label: "Sending", tone: "quiet" };
  }
}

/**
 * What the guardian appends to the reason of an exit it has tried more than once. The
 * guardian is server code and is not imported here, so the words are repeated; a test
 * reads its source to hold the two together.
 */
export const FAILING_SINCE_MARKER = " — this exit has been failing since ";

/** The reason without the guardian's suffix, and the date the suffix carried. */
export function splitFailingSince(error: string): { text: string; failingSince: string | null } {
  const at = error.lastIndexOf(FAILING_SINCE_MARKER);
  if (at === -1) return { text: error, failingSince: null };
  const tail = error.slice(at + FAILING_SINCE_MARKER.length).trim();
  if (tail === "" || Number.isNaN(Date.parse(tail))) return { text: error, failingSince: null };
  return { text: error.slice(0, at), failingSince: tail };
}

/**
 * Text that says an order reached the chain, or leaves it open. Checked before any rule
 * below: nothing that names a signature or a transaction id, or that comes back from
 * the step that sends the signed order, is ever put into other words.
 */
const SENT_OR_UNKNOWN =
  /signature|\btransaction \S{32,}|failed on chain|confirmed on chain|outcome is unknown|never confirmed|may still land|may have filled|could not be quoted|^Jupiter execute failed/i;

export type PlainMeaning =
  | "slippageOnChain"
  | "expired"
  | "feesSpiking"
  | "rateLimited"
  | "noRoute"
  | "noAnswer"
  | "walletEmpty";

/**
 * The only stored reasons that are reworded, each matched on the executor's own
 * sentence from its first word: a loose match on a phrase such as "no transaction" would
 * also catch the sweep's "no transaction signature was recorded" and tell the owner
 * nothing was sent about an order that was. Where the sentence ends in text the executor
 * does not write (a response body), only its opening is matched. A reason that fits none
 * of these is shown as stored.
 *
 * All but the last come from the Solana executor and are said only about a live Solana
 * trade. The executors are server code and are not imported here, so a test reads their
 * source to hold each opening to the words they still write.
 */
export const PLAIN_RULES: ReadonlyArray<{
  meaning: PlainMeaning;
  when: RegExp;
  /** The same opening with a different meaning. */
  unless?: RegExp;
  venue: "jupiter" | "any";
}> = [
  // It landed and the chain cancelled it.
  { meaning: "slippageOnChain", when: /^Jupiter execute: [^()]*slippage[^()]* \(code 6001\)\.$/i, venue: "jupiter" },
  // Only the code whose name says it: an expired transaction can never land. The other
  // failed-to-land codes are shown as stored.
  { meaning: "expired", when: /^Jupiter execute: (?:Transaction expired|Expired) \(code -1005\)\.$/, venue: "jupiter" },
  // Refused while the order was being priced, before anything was signed.
  {
    meaning: "feesSpiking",
    when: /^Tocker did not send this [^:]+ trade: network fees are running high: Jupiter wants a \d+-lamport priority fee, more than the \d+ Tocker pays on a trade this size — try again shortly, or trade a larger amount\. Nothing was signed\.$/,
    venue: "jupiter",
  },
  // Jupiter's answer to the request for an order. Nothing exists to sign until it answers.
  { meaning: "rateLimited", when: /^Jupiter Ultra \/order failed \(HTTP 429\)\./, venue: "jupiter" },
  {
    meaning: "noRoute",
    when: /^Jupiter Ultra \/order failed \(HTTP 400\)\. Jupiter's routers had no quote for this pool three times in a row/,
    // The same opening, carried inside a refusal that is about the slippage ceiling.
    unless: /refused to build an order/,
    venue: "jupiter",
  },
  { meaning: "noRoute", when: /^Jupiter has no route for [^.]+\.$/, venue: "jupiter" },
  { meaning: "noRoute", when: /^Jupiter Ultra returned no transaction for [^.:]+ \(no route\)\.$/, venue: "jupiter" },
  { meaning: "noAnswer", when: /^Jupiter Ultra did not answer: /, venue: "jupiter" },
  { meaning: "noAnswer", when: /^Jupiter Ultra \/order failed \(HTTP 5\d\d\)\./, venue: "jupiter" },
  // Either live venue, sizing a sell against a wallet that holds none of the token.
  { meaning: "walletEmpty", when: /^[^.]+ position is already empty on chain — nothing left to sell\.$/, venue: "any" },
];

/**
 * The sentence for each meaning. This is history, so it is in the past tense and gives
 * no advice: the row can be days old, and what was true the moment an order failed
 * ("right now", "try again in a minute") is not true of it any more.
 */
function plainSentence(meaning: PlainMeaning, side: TradeRow["side"], symbol: string): string {
  const done = side === "sell" ? "sold" : "bought";
  switch (meaning) {
    case "slippageOnChain":
      return `The price moved past this agent's slippage limit while the order was landing, so it was cancelled on chain. Nothing was ${done}.`;
    case "expired":
      return `The order expired before it could land. Nothing was ${done}.`;
    case "feesSpiking":
      return "Solana network fees were spiking and Tocker would not overpay for an order this size. Nothing was sent.";
    case "rateLimited":
      return "Jupiter was busy. Nothing was sent.";
    case "noRoute":
      return `Jupiter had no route for ${symbol}. Nothing was sent.`;
    case "noAnswer":
      return "Jupiter did not respond. Nothing was sent.";
    case "walletEmpty":
      return `The agent's wallet held no ${symbol}, so there was nothing to sell.`;
  }
}

/**
 * Added to a reworded reason on an exit the guardian placed. It says what Tocker does,
 * not what it is doing now: the row can be days old and the position long gone.
 */
export const RETRY_NOTE = "Tocker retries an automatic exit on its next pass while its rule still holds.";

/**
 * Why a trade did not happen, in plain words.
 *
 * Null when the row filled or carries no error. A visitor gets the fixed line whatever
 * the text is: the answer is decided before the text is looked at, so nothing derived
 * from it can reach them even if the server one day sent it.
 */
export function plainTradeReason(
  trade: Pick<TradeRow, "status" | "error" | "side" | "chain" | "isPaper" | "txHash" | "token" | "origin">,
  viewer: TradeViewer,
): TradeRowView["reason"] {
  if (trade.status === "filled" || !trade.error) return null;
  if (!viewer.isOwner) return { text: VISITOR_REASON, raw: null, failingSince: null };

  const { text: stored, failingSince } = splitFailingSince(trade.error);
  const same = { text: stored, raw: null, failingSince };

  // An order that was sent, or may have been, reaches the owner word for word.
  if (outcomeUncertain(stored) || SENT_OR_UNKNOWN.test(stored)) return same;

  const jupiter = !trade.isPaper && trade.chain === "solana";
  const rule = PLAIN_RULES.find(
    (candidate) =>
      (candidate.venue === "any" || jupiter) && candidate.when.test(stored) && !candidate.unless?.test(stored),
  );
  // Guard reasons, "Declined by the owner." and the like are already sentences.
  if (!rule) return same;

  // The row links a transaction, and the stored text is not always about that one: the
  // guardian reuses one failed row for a whole exit and keeps an earlier attempt's
  // signature on it. "Nothing was sent" beside a transaction link would be read as
  // false, so only the sentence that says the order reached the chain is said here.
  const linksTransaction = !trade.isPaper && Boolean(trade.txHash);
  // The guardian's suffix means the row has been reused: this text is about the latest
  // attempt only, and an earlier one may have been sent without leaving a signature.
  const reused = failingSince !== null;
  if ((linksTransaction || reused) && rule.meaning !== "slippageOnChain") return same;

  let plain = plainSentence(rule.meaning, trade.side, trade.token.symbol);
  // An exit the guardian placed is tried again, except the one a retry cannot help: the
  // wallet already held none of the token.
  if (trade.origin === "guardian" && rule.meaning !== "walletEmpty") plain = `${plain} ${RETRY_NOTE}`;

  return { text: plain, raw: stored, failingSince };
}

/** `viewer` defaults to a visitor, so a caller that forgets it under-shares. */
export function tradeRowView(trade: TradeRow, viewer: TradeViewer = { isOwner: false }): TradeRowView {
  const traded = trade.status === "filled";

  // Only a fill writes the amount and the price; before one they are stored as zero.
  const hasAmount = traded || trade.amountToken > 0;
  const hasPrice = traded || trade.priceUsd > 0;

  const href = trade.isPaper ? null : txExplorerUrl(trade.chain, trade.txHash);
  const hash = trade.txHash ?? "";
  const tx: TradeRowView["tx"] = trade.isPaper
    ? { kind: "paper" }
    : href
      ? {
          kind: "link",
          href,
          label: truncateAddress(hash, 4, 4),
          short: hash.length <= 5 ? hash : `${hash.slice(0, 4)}…`,
        }
      : { kind: "none" };

  return {
    traded,
    status: tradeStatusChip(trade, viewer),
    amount: hasAmount ? formatTokenAmount(trade.amountToken, { fixed: true }) : null,
    amountTitle: hasAmount ? trade.amountToken.toLocaleString("en-US", { maximumFractionDigits: 18 }) : null,
    price: hasPrice ? formatPriceUsd(trade.priceUsd) : null,
    priceQuoted: !traded && trade.priceUsd > 0,
    priceTitle: hasPrice ? `$${trade.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 18 })}` : null,
    value: formatUsd(traded ? trade.amountUsd : (trade.requestedUsd ?? trade.amountUsd)),
    valueAsked: !traded,
    tx,
    reason: plainTradeReason(trade, viewer),
    rationale: trade.rationale,
  };
}
