/**
 * One test per rule, each fed the text the executors really write (see `jupiter.ts`,
 * `settle.ts`, `base.ts`), so a reworded venue error that stops matching shows up here.
 */
import { describe, expect, it } from "vitest";
import {
  ORDER_IN_FLIGHT_LOST,
  isSlippageFailure,
  knownTradeError,
  outcomeUncertain,
  ownerTradeError,
  pointsToRiskSettings,
  venueErrorFacts,
  type TradeErrorInput,
} from "./trade-error-copy";

function sell(message: string, over: Partial<TradeErrorInput> = {}): string {
  return ownerTradeError({ stage: "quote", side: "sell", symbol: "BONK", limitPct: 3, message, ...over });
}

const SIGNATURE = "5".repeat(64);

/** The executors' own wording for every failure the rules rewrite (2 to 13). */
const RAW = {
  slippageOnChain: "Jupiter execute: Slippage tolerance exceeded (code 6001).",
  expired: "Jupiter execute: Expired (code -1005).",
  slippageRefused:
    "Jupiter would only fill BONK with 812 bps of slippage and this agent's ceiling is 300 bps, so nothing was signed. BONK is thinner than the agent's risk settings allow — raise Slippage tolerance in Risk, or leave this one alone.",
  paused:
    "BONK: 5 of this agent's trades failed on chain in the last hour, and each one still cost a network fee, so Tocker has paused paying for its trades until the hour rolls over — a looser slippage tolerance usually stops the failures. Nothing was sent.",
  priorityFee:
    "Tocker did not send this BONK trade: network fees are running high: Jupiter wants a 249247-lamport priority fee, more than the 150000 Tocker pays on a trade this size — try again shortly, or trade a larger amount. Nothing was signed.",
  rateLimited: "Jupiter Ultra /order failed (HTTP 429). Ultra is rate-limiting this app — set JUPITER_API_KEY. {}",
  noQuotes:
    'Jupiter Ultra /order failed (HTTP 400). Jupiter\'s routers had no quote for this pool three times in a row — usually a keyless-tier hiccup that clears within a minute; a JUPITER_API_KEY makes it rare. {"error":"Failed to get quotes"}',
  noRoute: "Jupiter has no route for BONK.",
  noTransaction: "Jupiter Ultra returned no transaction for BONK (no route).",
  noAnswer: "Jupiter Ultra did not answer: The operation was aborted due to timeout",
  serverError: "Jupiter Ultra /order failed (HTTP 502). upstream connect error",
  emptyOnChain: "BONK position is already empty on chain — nothing left to sell.",
  insufficient:
    "Jupiter: Insufficient funds (code 1). The agent wallet (AgentWa11et) holds less BONK than this order spends. Tocker pays this trade's network fee and any token-account rent, so the BONK is all it needs.",
  notSigned: "Tocker did not send this BONK trade: Jupiter left part of the gas on the agent's wallet. Nothing was signed.",
  notSent: "Tocker did not send this swap: the transaction changed after it was quoted. Nothing was sent.",
  unknown: "Privy swap failed",
} as const;

describe("ownerTradeError", () => {
  it("1. passes the settlement layer's sentences through byte for byte", () => {
    const sentences = [
      `The venue threw (socket hang up) but transaction ${SIGNATURE} confirmed on chain. The fill was not recorded — check the explorer before trading this token again.`,
      `Jupiter execute: Expired (code -1005). — transaction ${SIGNATURE} did not resolve within 20s, so its outcome is unknown.`,
      `Jupiter execute: Slippage tolerance exceeded (code 6001). — but transaction ${SIGNATURE} confirmed on chain, so this order may have filled. Check the explorer before trading this token again.`,
    ];
    for (const message of sentences) {
      expect(sell(message, { stage: "execute" })).toBe(message);
      // Whatever else is known about the error, an order that may have filled says so.
      expect(sell(message, { stage: "execute", kind: "slippage", httpStatus: 429, errorCode: 1 })).toBe(message);
    }
  });

  it("2. says an on-chain slippage failure cancelled the order, with the limit it ran under", () => {
    expect(sell(RAW.slippageOnChain, { stage: "execute" })).toBe(
      "The price moved more than this agent's 3% slippage limit while the order was landing, so it was cancelled on chain. Nothing was sold. Try again, or raise Slippage tolerance in Settings, Risk.",
    );
    // A transaction the chain already rejected is still this failure, not an unknown one.
    expect(sell(`${RAW.slippageOnChain} (transaction ${SIGNATURE} failed on chain)`, { stage: "execute" })).toContain(
      "cancelled on chain",
    );
  });

  it("3. says an expired or unlanded order expired", () => {
    for (const code of [-1000, -1004, -1005, -1006]) {
      expect(sell(`Jupiter execute: Expired (code ${code}).`, { stage: "execute" })).toBe(
        "Solana didn't confirm the order in time and it expired. Nothing was sold. Try again.",
      );
    }
  });

  it("4. says a slippage refusal before signing sent nothing, and where the limit lives", () => {
    expect(sell(RAW.slippageRefused, { kind: "slippage" })).toBe(
      "Jupiter can't sell BONK inside this agent's 3% slippage limit right now. Nothing was sent. To sell anyway, raise Slippage tolerance in Settings, Risk (a fast-moving token can need 5 to 15%) and try again.",
    );
  });

  it("5. explains the failed-trade pause", () => {
    expect(sell(RAW.paused, { kind: "sponsor" })).toBe(
      "Several of this agent's orders failed on chain in the last hour, so Tocker has paused paying its network fees for up to an hour. Nothing was sent. Raise Slippage tolerance in Settings, Risk so the next order lands, then try again.",
    );
  });

  it("6. says fees are spiking without quoting lamports", () => {
    expect(sell(RAW.priorityFee, { kind: "sponsor" })).toBe(
      "Solana fees are spiking and Tocker won't overpay for an order this size. Nothing was sent. Try again in a minute.",
    );
  });

  it("7. says a rate limit is Jupiter being busy", () => {
    expect(sell(RAW.rateLimited, { httpStatus: 429 })).toBe("Jupiter is busy. Nothing was sent. Try again in a few seconds.");
  });

  it("8. says there is no route, for each way Jupiter reports one", () => {
    const expected =
      "Jupiter has no route for BONK right now. Nothing was sent. Thin or brand-new pools drop in and out: try again in a minute, or sell a smaller slice.";
    expect(sell(RAW.noQuotes, { httpStatus: 400 })).toBe(expected);
    expect(sell(RAW.noRoute)).toBe(expected);
    expect(sell(RAW.noTransaction)).toBe(expected);
  });

  it("9. says Jupiter did not respond on a timeout or a 5xx", () => {
    expect(sell(RAW.noAnswer)).toBe("Jupiter didn't respond. Nothing was sent. Try again.");
    expect(sell(RAW.serverError, { httpStatus: 502 })).toBe("Jupiter didn't respond. Nothing was sent. Try again.");
  });

  it("10. says the wallet holds none of a position the book still lists", () => {
    const expected =
      "The agent's wallet holds no BONK, though the book still lists it. Nothing was sent. An earlier sell may have landed without being recorded: check the Trades tab and the wallet on the explorer.";
    expect(sell(RAW.emptyOnChain)).toBe(expected);
    expect(sell(RAW.insufficient, { kind: "funds", errorCode: 1 })).toBe(expected);
    // Base says "empty" in the same words.
    expect(sell(RAW.emptyOnChain, { venue: "privy-base" })).toBe(expected);
    // A buy short of USDC is a different problem and never reads as a missing position.
    expect(
      ownerTradeError({ stage: "quote", side: "buy", symbol: "BONK", limitPct: 3, message: RAW.insufficient, kind: "funds", errorCode: 1 }),
    ).not.toContain("holds no BONK");
  });

  it("11. leaves a sentence that already carries its own next step alone", () => {
    const refilling = "Tocker's fee wallet is refilling — try again in a minute.";
    expect(sell(refilling)).toBe(refilling);

    // Buys only: a first buy under the account-opening minimum cannot succeed on a retry.
    const opening =
      "Tocker did not send this BONK trade: a first buy of a token opens an account for it, and Tocker does that for buys of $2 or more — this one is $1.00. Nothing was signed.";
    expect(ownerTradeError({ stage: "quote", side: "buy", symbol: "BONK", limitPct: 3, message: opening, kind: "sponsor" })).toBe(
      opening,
    );
  });

  it("12. calls every other refusal to sign a safety check", () => {
    const expected = "Tocker refused to sign this order because it failed a safety check. Nothing was sent. Try again.";
    expect(sell(RAW.notSigned, { kind: "sponsor" })).toBe(expected);
    expect(sell(RAW.notSent, { stage: "execute" })).toBe(expected);
  });

  it("13. falls back to a plain line, and only claims nothing changed before anything was signed", () => {
    expect(sell(RAW.unknown, { stage: "quote" })).toBe("BONK wasn't sold. Nothing changed. Try again in a moment.");
    expect(sell(RAW.unknown, { stage: "execute" })).toBe("BONK wasn't sold. Check the Trades tab before trying again.");
    expect(knownTradeError({ stage: "quote", side: "sell", symbol: "BONK", limitPct: 3, message: RAW.unknown })).toBeNull();
  });

  it("says bought and buy for a buy", () => {
    const buy = (message: string, over: Partial<TradeErrorInput> = {}) =>
      ownerTradeError({ stage: "quote", side: "buy", symbol: "WIF", limitPct: 3, message, ...over });
    expect(buy(RAW.slippageOnChain, { stage: "execute" })).toContain("Nothing was bought.");
    expect(buy(RAW.expired, { stage: "execute" })).toContain("Nothing was bought.");
    expect(buy(RAW.slippageRefused, { kind: "slippage" })).toContain("Jupiter can't buy WIF inside");
    expect(buy(RAW.slippageRefused, { kind: "slippage" })).toContain("To buy anyway");
    expect(buy(RAW.noRoute)).toContain("or buy a smaller amount.");
    expect(buy(RAW.unknown)).toBe("WIF wasn't bought. Nothing changed. Try again in a moment.");
  });

  it("prints the limit as a person would say it, and says whose limit it was", () => {
    expect(sell(RAW.slippageOnChain, { limitPct: 2.5 })).toContain("this agent's 2.5% slippage limit");
    expect(sell(RAW.slippageOnChain, { limitPct: 0.1 })).toContain("this agent's 0.1% slippage limit");
    // Widened for one order by the owner: the number is theirs, not the agent's.
    expect(sell(RAW.slippageOnChain, { limitPct: 10, limitWidened: true })).toContain(
      "more than the 10% max slippage you set for this order while",
    );
    expect(sell(RAW.slippageRefused, { kind: "slippage", limitPct: 10, limitWidened: true })).toContain(
      "inside the 10% max slippage you set for this order right now",
    );
  });

  it("never names Jupiter or Solana for a failure on another venue", () => {
    const base = (message: string) => sell(message, { venue: "privy-base", stage: "execute" });
    // An EVM error can mention a priority fee; it is not Solana's fees spiking.
    expect(base("max priority fee per gas higher than max fee per gas")).toBe(
      "BONK wasn't sold. Check the Trades tab before trying again.",
    );
    expect(base("no route found for this pair")).not.toContain("Jupiter");
    expect(base("upstream did not answer")).not.toContain("Jupiter");
  });

  it("never shows an operator's hint, a fee in lamports or an HTTP status", () => {
    for (const [name, message] of Object.entries(RAW)) {
      for (const stage of ["quote", "execute"] as const) {
        for (const side of ["buy", "sell"] as const) {
          const text = ownerTradeError({
            stage,
            side,
            symbol: "BONK",
            limitPct: 3,
            message,
            kind: name === "slippageRefused" ? "slippage" : null,
            httpStatus: name === "rateLimited" ? 429 : name === "noQuotes" ? 400 : name === "serverError" ? 502 : null,
            errorCode: name === "insufficient" ? 1 : null,
          });
          for (const banned of ["JUPITER_API_KEY", "lamport", "HTTP", "leave this one alone"]) {
            expect(text, `${name} (${stage}, ${side})`).not.toContain(banned);
          }
        }
      }
    }
  });
});

describe("what a surface can offer after a failure", () => {
  it("knows the two failures a wider slippage for one order would fix", () => {
    expect(isSlippageFailure(sell(RAW.slippageOnChain))).toBe(true);
    expect(isSlippageFailure(sell(RAW.slippageRefused, { kind: "slippage" }))).toBe(true);
    expect(isSlippageFailure(sell(RAW.slippageOnChain, { limitPct: 10, limitWidened: true }))).toBe(true);
    expect(isSlippageFailure(sell(RAW.slippageRefused, { kind: "slippage", limitPct: 10, limitWidened: true }))).toBe(true);
    // The pause names the setting too, but a wider limit on this order does not lift it.
    expect(isSlippageFailure(sell(RAW.paused))).toBe(false);
    expect(isSlippageFailure(sell(RAW.noRoute))).toBe(false);
    expect(isSlippageFailure(sell(RAW.unknown))).toBe(false);
  });

  it("knows when it cannot say that nothing moved", () => {
    expect(outcomeUncertain(ORDER_IN_FLIGHT_LOST)).toBe(true);
    expect(
      outcomeUncertain(
        sell(`Jupiter execute: Expired (code -1005). — transaction ${SIGNATURE} did not resolve within 20s, so its outcome is unknown.`, {
          stage: "execute",
        }),
      ),
    ).toBe(true);
    expect(
      outcomeUncertain(
        sell(`The venue threw (socket hang up) but transaction ${SIGNATURE} confirmed on chain. The fill was not recorded — check the explorer before trading this token again.`, {
          stage: "execute",
        }),
      ),
    ).toBe(true);
    // Every rewritten sentence says what happened; none of them is an open question.
    for (const message of Object.values(RAW)) {
      expect(outcomeUncertain(sell(message))).toBe(false);
    }
  });

  it("knows which sentences send the owner to Risk settings", () => {
    expect(pointsToRiskSettings(sell(RAW.slippageOnChain))).toBe(true);
    expect(pointsToRiskSettings(sell(RAW.slippageRefused, { kind: "slippage" }))).toBe(true);
    expect(pointsToRiskSettings(sell(RAW.paused))).toBe(true);
    expect(pointsToRiskSettings(sell(RAW.rateLimited, { httpStatus: 429 }))).toBe(false);
    expect(pointsToRiskSettings(sell(RAW.emptyOnChain))).toBe(false);
  });
});

describe("venueErrorFacts", () => {
  it("reads kind, status and code off a JupiterError by name", () => {
    const err = Object.assign(new Error(RAW.rateLimited), { name: "JupiterError", kind: null, httpStatus: 429, errorCode: null });
    expect(venueErrorFacts(err)).toEqual({ kind: null, httpStatus: 429, errorCode: null });
    const funds = Object.assign(new Error(RAW.insufficient), { name: "JupiterError", kind: "funds", httpStatus: null, errorCode: 1 });
    expect(venueErrorFacts(funds)).toEqual({ kind: "funds", httpStatus: null, errorCode: 1 });
  });

  it("reads nothing off any other error, whatever fields it carries", () => {
    expect(venueErrorFacts(Object.assign(new Error("boom"), { httpStatus: 429, kind: "slippage" }))).toEqual({});
    expect(venueErrorFacts("boom")).toEqual({});
    expect(venueErrorFacts(null)).toEqual({});
  });
});
