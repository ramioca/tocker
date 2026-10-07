/**
 * The reasons are the executors' own wording (the same strings `trade-error-copy.test.ts`
 * feeds its rules), so a reworded venue error that stops matching shows up here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TradeRow } from "@/server/types";
import {
  FAILING_SINCE_MARKER,
  PLAIN_RULES,
  RETRY_NOTE,
  VISITOR_REASON,
  plainTradeReason,
  splitFailingSince,
  tradeRowView,
  tradeStatusChip,
} from "./trade-row-view";

const OWNER = { isOwner: true };
const VISITOR = { isOwner: false };

const SIGNATURE = "5".repeat(64);
const SOLANA_HASH = "5nXkQq7xWc2vT9rNhKpZmA8dLwYb3Zq9";

function trade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: "t1",
    agentId: "a1",
    runId: null,
    chain: "solana",
    side: "buy",
    token: {
      id: "solana:BONK",
      chain: "solana",
      address: "BONK",
      symbol: "BONK",
      name: "Bonk",
      logoUrl: null,
      decimals: 5,
      lastPriceUsd: 0.0000027,
    },
    amountToken: 4393.67,
    amountUsd: 5,
    priceUsd: 0.00114,
    feeUsd: 0.015,
    status: "filled",
    origin: "agent",
    exitReason: null,
    requestedUsd: null,
    proposedAt: null,
    decidedAt: null,
    decidedBy: null,
    entryScore: null,
    isPaper: false,
    txHash: null,
    rationale: "84/100, organic 88.",
    score: null,
    error: null,
    createdAt: "2026-09-21T10:00:00.000Z",
    filledAt: "2026-09-21T10:00:05.000Z",
    realizedPnlUsd: null,
    realizedPnlPct: null,
    ...overrides,
  };
}

/** A row as the writers store it when nothing filled: zeros, and the amount asked for. */
function unfilled(overrides: Partial<TradeRow> = {}): TradeRow {
  return trade({ status: "failed", amountToken: 0, priceUsd: 0, feeUsd: 0, filledAt: null, ...overrides });
}

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

/** The settlement layer's sentences: an order that may have filled. */
const SETTLEMENT = [
  `The venue threw (socket hang up) but transaction ${SIGNATURE} confirmed on chain. The fill was not recorded — check the explorer before trading this token again.`,
  `Jupiter execute: Expired (code -1005). — transaction ${SIGNATURE} did not resolve within 20s, so its outcome is unknown.`,
  `Jupiter execute: Slippage tolerance exceeded (code 6001). — but transaction ${SIGNATURE} confirmed on chain, so this order may have filled. Check the explorer before trading this token again.`,
];

/**
 * Every other sentence the settlement layer, the Solana executor and the Base executor
 * store, with the values they interpolate filled in. Each must reach the owner as stored:
 * several are about an order that was signed, and none has a rule that is sure of it.
 */
const STORED_AS_IS = [
  // The settlement layer, around an order that was signed.
  `Jupiter execute failed (HTTP 502). upstream connect error (transaction ${SIGNATURE} failed on chain)`,
  `Jupiter execute: Slippage tolerance exceeded (code 6001). (transaction ${SIGNATURE} failed on chain)`,
  `socket hang up — transaction ${SIGNATURE} did not resolve within 20s, so its outcome is unknown.`,
  `Jupiter execute failed (HTTP 502). upstream connect error — but transaction ${SIGNATURE} confirmed on chain, so this order may have filled. Check the explorer before trading this token again.`,
  "Jupiter: Insufficient funds (code 1). (retry against the wallet's real balance could not be quoted: Jupiter has no route for BONK.)",
  "Jupiter: Insufficient funds (code 1). (retry against the wallet's real balance could not be quoted: Jupiter Ultra did not answer: The operation was aborted due to timeout)",
  "execution failed",
  // The sweep of orders left on "submitted".
  "Submitted but never confirmed: no transaction signature was recorded, so this order did not reach the chain.",
  `Submitted but never confirmed. Transaction 0x${"a".repeat(64)} was signed — check the explorer before trading this token again.`,
  `Transaction ${SIGNATURE} confirmed on chain but the fill was never recorded, so this position is not in the book. Check the explorer and reconcile before trading this token again.`,
  `Transaction ${SIGNATURE} failed on chain.`,
  `Submitted but never confirmed: transaction ${SIGNATURE} has no on-chain status. It may still land — check the explorer.`,
  // The Solana executor, after the order was signed and handed to Jupiter.
  "Jupiter execute failed (HTTP 502). upstream connect error",
  "Jupiter execute failed (HTTP 429). Too many requests",
  "Jupiter execute failed (HTTP 200).",
  "Jupiter execute: status unknown.",
  "Jupiter execute: Failed to land (code -1000).",
  "Jupiter execute: Invalid block height (code -1004).",
  "Jupiter execute: Transaction timed out (code -1006).",
  "Jupiter execute: Invalid message bytes (code -3).",
  "Jupiter execute: custom program error (code 6024).",
  // The Solana executor, before signing, where no rule is sure of the meaning.
  "Jupiter Ultra /order failed (HTTP 400). Bad request",
  "Jupiter Ultra /order failed (HTTP 401). Unauthorized",
  `Jupiter Ultra /order failed (HTTP 400). Jupiter's routers had no quote for this pool three times in a row — usually a keyless-tier hiccup that clears within a minute; a JUPITER_API_KEY makes it rare. {"error":"Failed to get quotes"} Jupiter priced BONK at 900 bps and refused to build an order at this agent's 300 bps ceiling; 900 bps is past the 500 bps Tocker will accept on its own, so nothing was signed.`,
  "Jupiter Ultra /order returned a body that is not JSON: <html>",
  "Jupiter Ultra /order returned no usable order: {}",
  "Jupiter Ultra returned no transaction for BONK: Insufficient liquidity",
  "Jupiter prices BONK at 40 bps of slippage and this agent's ceiling is 10 bps. Tocker does not send an order tighter than 25 bps below Jupiter's own pick: it tends to fail on chain after it is sent, and a failed trade still costs a network fee. Nothing was signed — raise Slippage tolerance in Risk to at least 0.3%, or leave this one alone.",
  "Jupiter wants 9000000 lamports of network fees for this BONK trade, more than the 5000000 Tocker covers for one trade, so nothing was signed.",
  RAW.insufficient,
  RAW.slippageRefused,
  RAW.paused,
  RAW.notSigned,
  "Tocker did not send this BONK trade: Jupiter named no one as the fee payer, not Tocker's fee wallet. Nothing was signed.",
  "Tocker did not send this BONK trade: the order needs 9000000 lamports of gas, over the 5000000 a single swap is allowed. Nothing was signed.",
  "Tocker did not send this BONK trade: a first buy of a token opens an account for it, and Tocker does that for buys of $5 or more — this one is $2.00. Nothing was signed.",
  RAW.notSent,
  "Tocker did not send this swap: Jupiter's order carried no transaction. Nothing was sent.",
  "Tocker did not send this swap: the transaction could not be checked (Solana RPC getMultipleAccounts failed (HTTP 503)). Nothing was sent.",
  "Tocker did not send this swap: its priority fee is 9000000 lamports, over the 2000000 Tocker pays on any trade. Nothing was sent.",
  "Tocker did not send this swap: the agent's wallet did not sign it (no route to host). Nothing was sent.",
  "Jupiter order carried no transaction.",
  'the swap would fail on chain ({"InstructionError":[3,{"Custom":6001}]}: Program log: slippage tolerance exceeded)',
  // The Base executor.
  "No price for BRETT on Base — cannot size the sell.",
  RAW.unknown,
  "Privy swap failed: upstream answered (HTTP 502), no transaction was created",
  // The paper executor.
  "No price available for BONK on solana — cannot simulate a fill.",
] as const;

/**
 * One stored reason for each rule, in the rules' order, in the executor's own words, and
 * the sentence the owner reads for it on a buy (a sell for the last).
 */
const SLIPPAGE_ON_CHAIN =
  "The price moved past this agent's slippage limit while the order was landing, so it was cancelled on chain. Nothing was bought.";
const FEES_SPIKING =
  "Solana network fees were spiking and Tocker would not overpay for an order this size. Nothing was sent.";
const NO_ROUTE = "Jupiter had no route for BONK. Nothing was sent.";
const NO_ANSWER = "Jupiter did not respond. Nothing was sent.";
const RULE_CASES: Array<{ stored: string; reads: string; side?: "sell" }> = [
  { stored: RAW.slippageOnChain, reads: SLIPPAGE_ON_CHAIN },
  { stored: RAW.expired, reads: "The order expired before it could land. Nothing was bought." },
  { stored: RAW.priorityFee, reads: FEES_SPIKING },
  { stored: RAW.rateLimited, reads: "Jupiter was busy. Nothing was sent." },
  { stored: RAW.noQuotes, reads: NO_ROUTE },
  { stored: RAW.noRoute, reads: NO_ROUTE },
  { stored: RAW.noTransaction, reads: NO_ROUTE },
  { stored: RAW.noAnswer, reads: NO_ANSWER },
  { stored: RAW.serverError, reads: NO_ANSWER },
  {
    stored: RAW.emptyOnChain,
    side: "sell",
    reads: "The agent's wallet held no BONK, so there was nothing to sell.",
  },
];

const ORIGINS = ["agent", "guardian", "manual", "mirror"] as const;
const SIDES = ["buy", "sell"] as const;

function ownerReason(error: string, overrides: Partial<TradeRow> = {}) {
  return plainTradeReason(unfilled({ error, ...overrides }), OWNER);
}

describe("tradeRowView: the numbers", () => {
  it("1. prints a fill as it filled", () => {
    const view = tradeRowView(trade(), OWNER);
    expect(view.traded).toBe(true);
    expect(view.amount).toBe("4,393.67");
    expect(view.price).toBe("$0.00114");
    expect(view.value).toBe("$5.00");
    expect(view.valueAsked).toBe(false);
    expect(view.priceQuoted).toBe(false);
    expect(view.status).toBeNull();
    expect(view.reason).toBeNull();
    expect(view.rationale).toBe("84/100, organic 88.");
  });

  it("2. prints no amount and no price for a buy that never happened, and the value as asked", () => {
    const view = tradeRowView(unfilled({ error: RAW.priorityFee }), OWNER);
    expect(view.traded).toBe(false);
    expect(view.amount).toBeNull();
    expect(view.amountTitle).toBeNull();
    expect(view.price).toBeNull();
    expect(view.priceTitle).toBeNull();
    expect(view.value).toBe("$5.00");
    expect(view.valueAsked).toBe(true);
    expect(view.status).toEqual({ label: "Failed", tone: "danger" });
  });

  it("3. keeps the price a proposal was really quoted", () => {
    const view = tradeRowView(
      unfilled({ status: "proposed", priceUsd: 0.211, amountUsd: 25, requestedUsd: 25 }),
      OWNER,
    );
    expect(view.amount).toBeNull();
    expect(view.price).toBe("$0.211");
    expect(view.priceQuoted).toBe(true);
    expect(view.value).toBe("$25.00");
    expect(view.valueAsked).toBe(true);
    expect(view.status).toEqual({ label: "Awaiting you", tone: "wait" });
  });

  it("3b. prefers the amount asked for over the stored one on an unfilled row", () => {
    expect(tradeRowView(unfilled({ amountUsd: 0, requestedUsd: 40 }), OWNER).value).toBe("$40.00");
  });

  it("4. keeps a filled price of exactly zero as a price, not a dash", () => {
    const view = tradeRowView(trade({ priceUsd: 0 }), OWNER);
    expect(view.price).toBe("$0.00");
    expect(view.priceQuoted).toBe(false);
  });

  it("10. prints the longest figures whole, with the full number alongside", () => {
    const tiny = tradeRowView(trade({ priceUsd: 1.234e-10, amountToken: 1.234e-9 }), OWNER);
    expect(tiny.price).toBe("$0.000000000123");
    expect(tiny.priceTitle).not.toBeNull();
    expect(tiny.priceTitle).toContain("$0.0000000001234");
    expect(tiny.amount).toBe("0.000000001234");
    expect(tiny.amountTitle).not.toBeNull();
  });
});

describe("tradeStatusChip", () => {
  const rejected = [
    trade({ status: "rejected", decidedBy: "owner" }),
    trade({ status: "rejected", decidedBy: "guard" }),
    trade({ status: "rejected", decidedBy: null }),
  ];

  it("5. tells the owner who said no, and what each other state is", () => {
    expect(rejected.map((row) => tradeStatusChip(row, OWNER)?.label)).toEqual(["Declined", "Blocked", "Blocked"]);
    expect(tradeStatusChip(trade({ status: "expired" }), OWNER)).toEqual({ label: "Expired", tone: "quiet" });
    expect(tradeStatusChip(trade({ status: "pending" }), OWNER)).toEqual({ label: "Pending", tone: "quiet" });
    expect(tradeStatusChip(trade({ status: "submitted" }), OWNER)).toEqual({ label: "Sending", tone: "quiet" });
    expect(tradeStatusChip(trade({ status: "filled" }), OWNER)).toBeNull();
  });

  it("5. gives a visitor one word for a rejected trade, whoever rejected it", () => {
    for (const row of rejected) {
      expect(tradeStatusChip(row, VISITOR)).toEqual({ label: "Not placed", tone: "quiet" });
    }
    expect(tradeStatusChip(trade({ status: "failed" }), VISITOR)?.label).toBe("Failed");
    expect(tradeStatusChip(trade({ status: "expired" }), VISITOR)?.label).toBe("Expired");
    // Never sent to a visitor; if it were, it would not say the owner is being waited on.
    expect(tradeStatusChip(trade({ status: "proposed" }), VISITOR)?.label).toBe("Pending");
  });

  it("5. answers as a visitor when nobody says who is looking", () => {
    const view = tradeRowView(unfilled({ status: "rejected", decidedBy: "owner", error: "Declined by the owner." }));
    expect(view.status?.label).toBe("Not placed");
    expect(view.reason).toEqual({ text: VISITOR_REASON, raw: null, failingSince: null });
  });
});

describe("tradeRowView: the transaction", () => {
  it("6. says paper only for a paper trade, links a signature, and otherwise says nothing", () => {
    expect(tradeRowView(trade({ isPaper: true, txHash: SOLANA_HASH })).tx).toEqual({ kind: "paper" });

    const live = tradeRowView(trade({ txHash: SOLANA_HASH })).tx;
    expect(live).toEqual({
      kind: "link",
      href: `https://solscan.io/tx/${SOLANA_HASH}`,
      label: "5nXk…3Zq9",
      short: "5nXk…",
    });

    // A live order that failed before signing is not a paper trade.
    expect(tradeRowView(unfilled({ txHash: null })).tx).toEqual({ kind: "none" });
    // And one that failed after signing still links what was sent.
    expect(tradeRowView(unfilled({ txHash: SOLANA_HASH })).tx.kind).toBe("link");
    expect(tradeRowView(trade({ txHash: "abcde" })).tx).toMatchObject({ label: "abcde", short: "abcde" });
  });
});

describe("plainTradeReason, as the owner", () => {
  it("7. says fees were spiking, in the same words whoever placed the trade", () => {
    expect(ownerReason(RAW.priorityFee)).toEqual({ text: FEES_SPIKING, raw: RAW.priorityFee, failingSince: null });
    expect(ownerReason(RAW.priorityFee, { origin: "manual" })?.text).toBe(FEES_SPIKING);
    expect(ownerReason(RAW.priorityFee, { origin: "guardian", side: "sell" })?.text).toBe(`${FEES_SPIKING} ${RETRY_NOTE}`);
  });

  it("7. says a sell that did not happen was not sold, and names the token", () => {
    expect(ownerReason(RAW.expired, { side: "sell" })?.text).toBe(
      "The order expired before it could land. Nothing was sold.",
    );
    expect(ownerReason(RAW.slippageOnChain, { side: "sell" })?.text).toBe(SLIPPAGE_ON_CHAIN.replace("bought", "sold"));
    const wif = { ...trade().token, symbol: "WIF" };
    expect(ownerReason("Jupiter has no route for WIF.", { token: wif })?.text).toBe(
      "Jupiter had no route for WIF. Nothing was sent.",
    );
    expect(
      ownerReason("WIF position is already empty on chain — nothing left to sell.", { token: wif, side: "sell" })?.text,
    ).toBe("The agent's wallet held no WIF, so there was nothing to sell.");
  });

  it("7. says what Tocker does about a failed exit in words that stay true on an old row", () => {
    // The row may be days old and the position gone: nothing here says a retry is under way.
    expect(RETRY_NOTE).not.toMatch(/keeps|is retrying|still retrying|right now/i);
    for (const { stored, side } of RULE_CASES) {
      const text = ownerReason(stored, { origin: "guardian", side: "sell" })?.text ?? "";
      if (side === "sell") {
        // The wallet already holds none of the token: there is nothing for a retry to sell.
        expect(text).toBe("The agent's wallet held no BONK, so there was nothing to sell.");
        expect(text).not.toContain(RETRY_NOTE);
        expect(text).not.toMatch(/retr/i);
      } else {
        expect(text.endsWith(` ${RETRY_NOTE}`)).toBe(true);
      }
      // Only on an exit the guardian placed.
      expect(ownerReason(stored, { origin: "agent", side: "sell" })?.text).not.toContain(RETRY_NOTE);
      expect(ownerReason(stored, { origin: "manual", side: "sell" })?.text).not.toContain(RETRY_NOTE);
    }
    // And never on a sentence shown as stored.
    for (const stored of [...STORED_AS_IS, ...SETTLEMENT]) {
      expect(ownerReason(stored, { origin: "guardian", side: "sell" })?.text).toBe(stored);
    }
  });

  it("7. writes every reworded sentence as history: nothing about now, no advice to try again", () => {
    // The row can be days old, and nobody can press anything on it.
    for (const origin of ORIGINS) {
      for (const side of SIDES) {
        for (const { stored } of RULE_CASES) {
          const reason = ownerReason(stored, { origin, side });
          expect(reason?.raw, stored).toBe(stored);
          expect(reason?.text, stored).not.toMatch(/right now|try again/i);
        }
      }
    }
  });

  it("7. leaves the stored text on a row that links a transaction, whatever the text says", () => {
    // A reused guardian row keeps an earlier attempt's signature, so the text and the
    // link can be about two different orders. Only the sentence that says the order
    // reached the chain may sit beside a transaction link.
    for (const origin of ORIGINS) {
      for (const side of SIDES) {
        for (const { stored } of RULE_CASES) {
          const reason = ownerReason(stored, { origin, side, txHash: SOLANA_HASH });
          if (stored === RAW.slippageOnChain) {
            expect(reason?.raw).toBe(stored);
            expect(reason?.text).toContain("cancelled on chain");
            expect(reason?.text).not.toMatch(/nothing was sent/i);
          } else {
            expect(reason, stored).toEqual({ text: stored, raw: null, failingSince: null });
          }
        }
      }
    }
  });

  it("7. does not say nothing was sent on a guardian row that still carries an earlier signature", () => {
    // The exit was signed once and failed; the retry failed while it was being quoted.
    // The guardian rewrote the reason on the same row and left the first signature there.
    const since = "2026-09-21T07:00:00.000Z";
    for (const stored of [RAW.noRoute, RAW.priorityFee, RAW.noAnswer, RAW.rateLimited, RAW.expired, RAW.emptyOnChain]) {
      const row = unfilled({
        origin: "guardian",
        side: "sell",
        txHash: SOLANA_HASH,
        error: `${stored}${FAILING_SINCE_MARKER}${since}`,
      });
      const view = tradeRowView(row, OWNER);
      expect(view.tx.kind).toBe("link");
      expect(view.reason).toEqual({ text: stored, raw: null, failingSince: since });
      // Without the signature the row is still a reused one: an earlier attempt may have
      // been sent and left no signature, so the stored text stands.
      expect(tradeRowView({ ...row, txHash: null }, OWNER).reason).toEqual({ text: stored, raw: null, failingSince: since });
      // A first attempt, with no signature and no earlier one, is put into plain words.
      expect(tradeRowView({ ...row, txHash: null, error: stored }, OWNER).reason?.raw).toBe(stored);
    }
  });

  it("7. still rewords a paper row, which shows no transaction even if a hash is stored", () => {
    const row = unfilled({ isPaper: true, side: "sell", txHash: SOLANA_HASH, error: RAW.emptyOnChain });
    expect(tradeRowView(row, OWNER).tx).toEqual({ kind: "paper" });
    expect(plainTradeReason(row, OWNER)?.text).toBe("The agent's wallet held no BONK, so there was nothing to sell.");
  });

  it("7. passes an order that may have filled through byte for byte", () => {
    for (const error of SETTLEMENT) {
      expect(ownerReason(error)).toEqual({ text: error, raw: null, failingSince: null });
      expect(ownerReason(error, { origin: "guardian", side: "sell" })?.text).toBe(error);
    }
  });

  it("7. leaves a slippage refusal that is already a sentence alone", () => {
    const reason = ownerReason(RAW.slippageRefused);
    expect(reason).toEqual({ text: RAW.slippageRefused, raw: null, failingSince: null });
    expect(reason?.text).not.toContain("failed a safety check");
  });

  it("7. says an on-chain slippage failure without a limit it does not know", () => {
    const buy = ownerReason(RAW.slippageOnChain);
    expect(buy?.text).toBe(SLIPPAGE_ON_CHAIN);
    expect(buy?.text).not.toContain("0%");
    expect(buy?.text).not.toContain("NaN");
    expect(buy?.raw).toBe(RAW.slippageOnChain);
    expect(ownerReason(RAW.slippageOnChain, { side: "sell" })?.text).toContain("Nothing was sold.");
  });

  it("7. has a stored reason for every rule, and each reads as the sentence that means the same", () => {
    expect(RULE_CASES).toHaveLength(PLAIN_RULES.length);
    RULE_CASES.forEach(({ stored, reads, side }, index) => {
      // The case exercises this rule and no earlier one.
      expect(PLAIN_RULES.findIndex((rule) => rule.when.test(stored) && !rule.unless?.test(stored))).toBe(index);
      expect(ownerReason(stored, { side: side ?? "buy" })).toEqual({ text: reads, raw: stored, failingSince: null });
    });
  });

  it("7. says nothing was sent only about a refusal the executor makes before it signs", () => {
    // Read from the source: the executors are server code and cannot be imported here.
    // Each rule's opening must still be the words the executor writes, and for a
    // sentence that says "Nothing was sent" those words must sit above `execute`, the
    // only place an order is signed and handed to the venue.
    const trading = join(process.cwd(), "src", "lib", "trading");
    const jupiter = readFileSync(join(trading, "jupiter.ts"), "utf8");
    const base = readFileSync(join(trading, "base.ts"), "utf8");
    const jupiterExecute = jupiter.indexOf("  async execute(quote: Quote");
    const baseExecute = base.indexOf("  async execute(quote: Quote");
    expect(jupiterExecute).toBeGreaterThan(-1);
    expect(baseExecute).toBeGreaterThan(-1);

    const beforeSigning = [
      "network fees are running high: Jupiter wants a ${priority}-lamport priority fee, more than the ${priorityAllowanceLamports} Tocker pays on a trade this size — try again shortly, or trade a larger amount",
      "`Tocker did not send this ${req.symbol} trade: ${problem}. Nothing was signed.`",
      "`Jupiter Ultra did not answer: ${",
      "`Jupiter Ultra /order failed (HTTP ${res.status}).${hint} ${raw.slice(0, 300)}`",
      "` Jupiter's routers had no quote for this pool three times in a row",
      "`Jupiter has no route for ${req.symbol}.`",
      "`Jupiter Ultra returned no transaction for ${req.symbol}${",
      '" (no route)."',
      "`${req.symbol} position is already empty on chain — nothing left to sell.`",
    ];
    for (const words of beforeSigning) {
      const at = jupiter.indexOf(words);
      expect(at, words).toBeGreaterThan(-1);
      expect(at, words).toBeLessThan(jupiterExecute);
      // Written once: there is no second copy further down, after signing.
      expect(jupiter.indexOf(words, at + 1), words).toBe(-1);
    }
    const empty = base.indexOf("`${req.symbol} position is already empty on chain — nothing left to sell.`");
    expect(empty).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(baseExecute);

    // The two sentences about an order that landed come from the answer to `/execute`,
    // and neither is turned into a sentence that says nothing was sent.
    const landed = jupiter.indexOf("`Jupiter execute: ${detail}${code === null || code === undefined ? \"\" : ` (code ${code})`}.`");
    expect(landed).toBeGreaterThan(jupiterExecute);
    for (const { stored, reads } of RULE_CASES) {
      if (stored.startsWith("Jupiter execute")) expect(reads).not.toMatch(/nothing was sent/i);
    }
    // Every other `/execute` answer opens with these words, which no rule matches.
    expect(jupiter.indexOf("`Jupiter execute failed (HTTP ${response.httpStatus}).")).toBeGreaterThan(jupiterExecute);
    expect(PLAIN_RULES.some((rule) => rule.when.test("Jupiter execute failed (HTTP 502)."))).toBe(false);
  });

  it("7. shows the owner every other stored sentence as stored, on any row", () => {
    for (const stored of STORED_AS_IS) {
      for (const origin of ["agent", "guardian", "manual", "mirror"] as const) {
        for (const side of ["buy", "sell"] as const) {
          for (const chain of ["solana", "base"] as const) {
            expect(ownerReason(stored, { origin, side, chain })).toEqual({ text: stored, raw: null, failingSince: null });
          }
        }
      }
    }
  });

  it("7. never says nothing was sent about an order that was signed", () => {
    // The stale-order sweep: "no transaction signature" is not "no transaction".
    const sweep =
      "Submitted but never confirmed: no transaction signature was recorded, so this order did not reach the chain.";
    expect(STORED_AS_IS).toContain(sweep);
    expect(ownerReason(sweep)).toEqual({ text: sweep, raw: null, failingSince: null });
    // A failure after signing: the HTTP status is the answer to `/execute`, not to `/order`.
    const afterSigning = ownerReason("Jupiter execute failed (HTTP 502). upstream connect error");
    expect(afterSigning?.text).toBe("Jupiter execute failed (HTTP 502). upstream connect error");
    expect(afterSigning?.raw).toBeNull();

    // Anything naming a signature, a transaction id or an unknown outcome is left alone,
    // even where the text around it would fit a rule.
    for (const { stored } of RULE_CASES) {
      for (const tail of [
        ` (transaction ${SIGNATURE} failed on chain)`,
        ` — transaction ${SIGNATURE} did not resolve within 20s, so its outcome is unknown.`,
        ` — but transaction ${SIGNATURE} confirmed on chain, so this order may have filled. Check the explorer before trading this token again.`,
        " The signature was recorded.",
      ]) {
        const text = ownerReason(`${stored}${tail}`, { side: "sell" })?.text ?? "";
        expect(text).toBe(`${stored}${tail}`);
        expect(text).not.toMatch(/Nothing was sent|Nothing was (?:bought|sold)\.$/);
      }
    }
  });

  it("7. leaves a reworded executor sentence alone rather than guess at it", () => {
    for (const stored of [
      "Jupiter has no route for BONK. The order was sent anyway.",
      "The venue says: Jupiter has no route for BONK.",
      "Order sent, but Jupiter Ultra did not answer: timeout",
      "Jupiter execute: Expired (code -1005). It landed later.",
      "Privy: no route found",
      "there was no transaction to sign",
    ]) {
      expect(ownerReason(stored)).toEqual({ text: stored, raw: null, failingSince: null });
    }
  });

  it("7. leaves every sentence it has no rule for as it was stored", () => {
    for (const error of [
      "Declined by the owner.",
      "Expired before the owner decided.",
      RAW.insufficient,
      RAW.notSigned,
      RAW.notSent,
      RAW.unknown,
    ]) {
      expect(ownerReason(error)).toEqual({ text: error, raw: null, failingSince: null });
    }
  });

  it("7. says the Jupiter sentences only about Jupiter", () => {
    expect(ownerReason(RAW.priorityFee, { isPaper: true })).toEqual({
      text: RAW.priorityFee,
      raw: null,
      failingSince: null,
    });
    expect(ownerReason(RAW.priorityFee, { chain: "base" })?.text).toBe(RAW.priorityFee);
  });

  it("8. says a first failed exit in plain words, and leaves a retried one as stored with when it began", () => {
    // First attempt: nothing earlier to contradict the sentence.
    expect(ownerReason(RAW.priorityFee, { origin: "guardian", side: "sell" })).toEqual({
      text: `${FEES_SPIKING} ${RETRY_NOTE}`,
      raw: RAW.priorityFee,
      failingSince: null,
    });
    // Retried: the text is about the latest attempt only, so it is not turned into
    // "Nothing was sent" about the whole exit.
    const since = "2026-09-21T07:00:00.000Z";
    const reason = ownerReason(`${RAW.priorityFee}${FAILING_SINCE_MARKER}${since}`, { origin: "guardian", side: "sell" });
    expect(reason).toEqual({ text: RAW.priorityFee, raw: null, failingSince: since });
  });

  it("9. gives a filled row no reason, even with an error left on it", () => {
    expect(plainTradeReason(trade({ error: RAW.priorityFee }), OWNER)).toBeNull();
    expect(tradeRowView(trade({ error: RAW.priorityFee }), OWNER).reason).toBeNull();
    expect(plainTradeReason(unfilled({ error: null }), OWNER)).toBeNull();
  });
});

describe("plainTradeReason, as a visitor", () => {
  it("7. gives the fixed line whatever the text is", () => {
    const texts = [
      ...Object.values(RAW),
      ...SETTLEMENT,
      ...STORED_AS_IS,
      "This run failed. The details are visible to the owner.",
      "Declined by the owner.",
      "anything at all",
      `${RAW.priorityFee}${FAILING_SINCE_MARKER}2026-09-21T07:00:00.000Z`,
    ];
    for (const error of texts) {
      for (const origin of ["agent", "guardian", "manual"] as const) {
        expect(plainTradeReason(unfilled({ error, origin }), VISITOR)).toEqual({
          text: VISITOR_REASON,
          raw: null,
          failingSince: null,
        });
      }
    }
  });
});

describe("splitFailingSince", () => {
  it("8. takes the guardian's suffix off and keeps its date", () => {
    const since = "2026-09-21T07:00:00.000Z";
    expect(splitFailingSince(`Jupiter has no route for BONK.${FAILING_SINCE_MARKER}${since}`)).toEqual({
      text: "Jupiter has no route for BONK.",
      failingSince: since,
    });
  });

  it("8. leaves the text whole when what follows is not a date", () => {
    const odd = `Jupiter has no route for BONK.${FAILING_SINCE_MARKER}this morning`;
    expect(splitFailingSince(odd)).toEqual({ text: odd, failingSince: null });
    expect(splitFailingSince("Declined by the owner.")).toEqual({ text: "Declined by the owner.", failingSince: null });
  });

  it("8. uses the words the guardian writes", () => {
    // Read from the source: the guardian is server code and cannot be imported here, and
    // a reworded suffix would otherwise print in the table as part of the reason.
    const guardian = readFileSync(join(process.cwd(), "src", "lib", "trading", "guardian.ts"), "utf8");
    expect(guardian).toContain(JSON.stringify(FAILING_SINCE_MARKER));
  });
});
