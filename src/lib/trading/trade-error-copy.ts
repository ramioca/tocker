/**
 * A venue's failure, rewritten for the owner who just pressed Buy or Sell.
 *
 * The executors write their errors for the run log: HTTP statuses, Jupiter's codes, fee
 * figures in lamports, a raw response body, an env var an operator should set. That text
 * still goes to `trades.error` unchanged, which is the audit trail and owner-only. What
 * the person sees is one of the sentences below, and each of them answers the two things
 * that matter to someone trying to get out of a position: did anything move, and what to
 * do next. Pure, like `risk-copy.ts`, so every rule is tested.
 *
 * The rules run in order and the first match wins. The settlement layer's own sentences
 * ("confirmed on chain", "outcome is unknown") come first and pass through untouched:
 * they are the only place an order that may have filled says so, and they must reach
 * the owner word for word.
 */

export interface TradeErrorInput {
  /** `quote`: nothing was signed yet. `execute`: the order had been handed to the venue. */
  stage: "quote" | "execute";
  side: "buy" | "sell";
  symbol: string;
  /** The slippage tolerance the order ran under, in percent (300 bps is 3). */
  limitPct: number;
  /** True when the owner widened it for this one order, so the sentence says whose limit it was. */
  limitWidened?: boolean;
  /** The executor's own text. */
  message: string;
  /**
   * Which venue failed. The Jupiter and Solana sentences are only ever said about
   * Jupiter: a Privy error on Base that happens to mention a "priority fee" is not
   * Solana's fees spiking. Defaults to Jupiter.
   */
  venue?: "jupiter" | "privy-base" | "paper";
  /** `JupiterError`'s own fields, when the caught error was one. */
  kind?: string | null;
  httpStatus?: number | null;
  errorCode?: number | null;
}

/**
 * `JupiterError`'s `kind`, `httpStatus` and `errorCode`, read off a caught error by
 * name. Structural on purpose: the manual-trade action must not import the Solana
 * executor (and everything it pulls in) to ask what kind of error it is holding.
 */
export function venueErrorFacts(err: unknown): Pick<TradeErrorInput, "kind" | "httpStatus" | "errorCode"> {
  if (!(err instanceof Error) || err.name !== "JupiterError") return {};
  const facts = err as Error & { kind?: unknown; httpStatus?: unknown; errorCode?: unknown };
  return {
    kind: typeof facts.kind === "string" ? facts.kind : null,
    httpStatus: typeof facts.httpStatus === "number" ? facts.httpStatus : null,
    errorCode: typeof facts.errorCode === "number" ? facts.errorCode : null,
  };
}

/**
 * What a surface says when the order request itself threw. Unlike a failed preview, this
 * one may have moved money: the request can reach the server and fill while the answer
 * is lost on the way back.
 */
export const ORDER_IN_FLIGHT_LOST =
  "Lost contact with Tocker while this order was in flight. It may still have gone through. Check the Trades tab before trying again.";

/** The settlement layer's phrases for an order that may have filled without being recorded. */
const MAY_HAVE_FILLED = /confirmed on chain|outcome is unknown|may have filled/;

/**
 * True when the text does not establish that nothing moved: the settlement layer's own
 * sentences, and a lost answer. A surface must not head these "not sold".
 */
export function outcomeUncertain(text: string): boolean {
  return MAY_HAVE_FILLED.test(text) || text === ORDER_IN_FLIGHT_LOST;
}

/** "3" for 300 bps, "2.5" for 250: the percent as a person would say it. */
function pctText(pct: number): string {
  return Number.isFinite(pct) ? String(Number(pct.toFixed(2))) : "0";
}

/**
 * Both slippage sentences name the limit with these words, and nothing else does, so a
 * surface that can offer a wider limit for one order can tell them apart from the rest.
 */
const AGENT_LIMIT = "slippage limit";
const ORDER_LIMIT = "max slippage you set";

/** True for the two failures a wider slippage on this one order would fix. */
export function isSlippageFailure(text: string): boolean {
  return text.includes(AGENT_LIMIT) || text.includes(ORDER_LIMIT);
}

/** The settings label every sentence that sends the owner to Risk settings names. */
export function pointsToRiskSettings(text: string): boolean {
  return text.includes("Slippage tolerance");
}

/**
 * The sentence for a failure this module recognises, or null when it does not: the
 * caller then says its own generic thing (a failed order and a failed preview differ).
 */
export function knownTradeError(input: TradeErrorInput): string | null {
  const { side, symbol, message } = input;
  const done = side === "sell" ? "sold" : "bought";
  const limit = input.limitWidened
    ? `the ${pctText(input.limitPct)}% ${ORDER_LIMIT} for this order`
    : `this agent's ${pctText(input.limitPct)}% ${AGENT_LIMIT}`;
  const jupiter = (input.venue ?? "jupiter") === "jupiter";

  // 1. The settlement layer's own words: the order may have filled. Never rewritten.
  if (MAY_HAVE_FILLED.test(message)) return message;

  // 2. It landed and the chain rejected it for slippage.
  if (message.includes("(code 6001)") || /slippage tolerance exceeded/i.test(message)) {
    return `The price moved more than ${limit} while the order was landing, so it was cancelled on chain. Nothing was ${done}. Try again, or raise Slippage tolerance in Settings, Risk.`;
  }

  if (jupiter) {
    // 3. Jupiter's expiry and failed-to-land codes.
    if (/\(code -(?:1000|1004|1005|1006)\)/.test(message)) {
      return `Solana didn't confirm the order in time and it expired. Nothing was ${done}. Try again.`;
    }
    // 4. Refused before signing: the route needs more slippage than the limit allows.
    if (input.kind === "slippage") {
      return `Jupiter can't ${side} ${symbol} inside ${limit} right now. Nothing was sent. To ${side} anyway, raise Slippage tolerance in Settings, Risk (a fast-moving token can need 5 to 15%) and try again.`;
    }
    // 5. The failed-trade pause on sponsored fees.
    if (/failed on chain in the last hour/.test(message)) {
      return "Several of this agent's orders failed on chain in the last hour, so Tocker has paused paying its network fees for up to an hour. Nothing was sent. Raise Slippage tolerance in Settings, Risk so the next order lands, then try again.";
    }
    // 6. The priority fee is past what the platform pays on a trade this size.
    if (/priority fee/.test(message)) {
      return "Solana fees are spiking and Tocker won't overpay for an order this size. Nothing was sent. Try again in a minute.";
    }
    // 7. Rate limited.
    if (input.httpStatus === 429) return "Jupiter is busy. Nothing was sent. Try again in a few seconds.";
    // 8. No route.
    if ((input.httpStatus === 400 && /failed to get quotes/i.test(message)) || /no route|no transaction/i.test(message)) {
      return `Jupiter has no route for ${symbol} right now. Nothing was sent. Thin or brand-new pools drop in and out: try again in a minute, or ${
        side === "sell" ? "sell a smaller slice" : "buy a smaller amount"
      }.`;
    }
    // 9. No answer at all.
    if (/did not answer/.test(message) || (typeof input.httpStatus === "number" && input.httpStatus >= 500)) {
      return "Jupiter didn't respond. Nothing was sent. Try again.";
    }
  }

  // 10. The book lists a position the wallet does not hold (either venue says "empty";
  // code 1 is Jupiter's "the taker lacks the input token").
  if (side === "sell" && (/already empty on chain/.test(message) || input.errorCode === 1)) {
    return `The agent's wallet holds no ${symbol}, though the book still lists it. Nothing was sent. An earlier sell may have landed without being recorded: check the Trades tab and the wallet on the explorer.`;
  }

  // 11. Already a finished sentence with its own next step.
  if (/fee wallet is refilling/.test(message)) return message;
  // And so is this one, which only a buy meets: retrying it unchanged can never work,
  // so "try again" would be the wrong thing to say about it.
  if (side === "buy" && /opens an account for it/.test(message)) return message;

  // 12. Every other refusal to sign.
  if (jupiter && /did not send this swap|nothing was signed/i.test(message)) {
    return "Tocker refused to sign this order because it failed a safety check. Nothing was sent. Try again.";
  }

  return null;
}

/**
 * The owner's sentence for a failed manual order. Falls back to a plain line when the
 * failure is not one of the known ones. Before anything was signed that line can say
 * nothing changed; once the order had been handed to the venue it only says where to
 * look, because an unrecognised failure there is not proof that nothing moved.
 */
export function ownerTradeError(input: TradeErrorInput): string {
  const known = knownTradeError(input);
  if (known !== null) return known;
  const done = input.side === "sell" ? "sold" : "bought";
  return input.stage === "quote"
    ? `${input.symbol} wasn't ${done}. Nothing changed. Try again in a moment.`
    : `${input.symbol} wasn't ${done}. Check the Trades tab before trying again.`;
}
