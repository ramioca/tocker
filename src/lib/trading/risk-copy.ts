/**
 * The risk guard's refusal, rewritten for the owner who just tapped Buy, Sell or Approve.
 *
 * `riskGuard`'s `reason` is written for the model: it names config keys (`maxTradeUsd`),
 * lists snake_case gate codes and says which tool to call next, because that is what lets
 * an agent correct itself mid-tick. Shown to a person it reads as an error dump — six
 * `*_unknown` codes in a red block on a phone. The guard also returns the rule it applied
 * (`code`) and the numbers behind it (`params`); this turns those into one or two
 * sentences that say what is true and what to change. Pure, so every rule is tested.
 *
 * Owner-only by construction: every caller is an owner surface, and several of these
 * sentences quote the owner's own caps.
 */
import { describeBlocker } from "@/components/tokens/blocker-copy";
import { fmtUsd, fmtUsdExact } from "@/lib/money";
import { formatFeeRate } from "@/lib/platform/fee";
import { chainLabelFor } from "@/lib/wallets/funding";
import type { RiskVerdict } from "./risk";

/** How many failed gates are named before the rest become "+N more". */
const GATES_SHOWN = 2;

/** "$5,000" for a round amount, "$4.50" otherwise: the copy reads, it does not reconcile. */
function money(amount: number): string {
  return Number.isInteger(amount) ? `$${amount.toLocaleString("en-US")}` : fmtUsd(amount);
}

function pct(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

/** ", with $5.00 kept in reserve" when the owner set a reserve, nothing otherwise. */
function kept(reserveUsd: number | undefined): string {
  return reserveUsd !== undefined && reserveUsd > 0 ? `, with ${fmtUsd(reserveUsd)} kept in reserve` : "";
}

/**
 * The owner's sentence for a refusal. A verdict without a `code` (or one this does not
 * know) falls back to the guard's own reason, which is at worst technical, never wrong.
 */
export function ownerRiskMessage(verdict: Extract<RiskVerdict, { ok: false }>): string {
  const p = verdict.params ?? {};
  const symbol = p.symbol ?? "This token";
  switch (verdict.code) {
    case "bad_size":
      return "Enter an amount greater than zero.";
    case "chain_disabled":
      return p.chain
        ? `${chainLabelFor(p.chain)} isn't enabled for this agent. Turn it on in Settings to trade ${symbol}.`
        : verdict.reason;
    case "blocklisted":
      return `${symbol} is on this agent's blocklist. Remove it in Settings to trade it.`;
    case "max_trade":
      return p.amountUsd !== undefined && p.capUsd !== undefined
        ? `${money(p.amountUsd)} is over this agent's ${money(p.capUsd)} per-trade cap. Lower the size or raise Max per trade in Settings.`
        : verdict.reason;
    case "sizing":
      return p.capUsd !== undefined
        ? `This agent's ${p.mode ?? "position"} sizing allows ${money(p.capUsd)} right now. Lower the size to ${money(p.capUsd)} or less.`
        : verdict.reason;
    case "daily_limit":
      return p.maxDailyTrades !== undefined
        ? `This agent has used all ${p.maxDailyTrades} of today's buys. The count resets at 00:00 UTC, or raise Max trades per day in Settings.`
        : verdict.reason;
    case "position_limit": {
      if (p.maxOpenPositions === undefined || p.heldPositions === undefined) return verdict.reason;
      const many = p.maxOpenPositions === 1 ? "position" : "positions";
      const waiting = p.waitingBuys ?? 0;
      const placing = p.placingBuys ?? 0;
      // A buy waiting for approval takes a slot too, and so does one that is being placed
      // right now, so each is named: "holds 2" under a limit of 3 would read as room for
      // one more.
      const beside = [
        placing > 0 ? `${placing} more being bought right now` : null,
        waiting > 0 ? `${waiting} more buy${waiting === 1 ? "" : "s"} waiting for your approval` : null,
      ].filter((part): part is string => part !== null);
      const holds = beside.length === 0 ? `and holds ${p.heldPositions}` : `and holds ${p.heldPositions}, with ${beside.join(" and ")}`;
      // How many have to go before this buy can open one. One, unless the limit was set
      // under what the agent already has: "sell one first" would then be untrue, and the
      // owner who did would be refused again. A waiting buy frees its slot when declined.
      const toFree = p.heldPositions + placing + waiting - p.maxOpenPositions + 1;
      const first =
        placing > 0
          ? // The order being placed settles in seconds, as a position or as nothing.
            "Try again when that buy has settled"
          : toFree > 1
            ? `${waiting === 0 ? "Sell" : "Sell or decline"} ${toFree} first`
            : "Sell one first";
      return `This agent may hold at most ${p.maxOpenPositions} ${many} ${holds}. ${first}, or raise Max open positions in Settings.`;
    }
    case "no_score":
      return `${symbol} couldn't be scored, and this agent never buys a token it hasn't scored. Try again in a minute.`;
    case "hard_gates": {
      const titles = [...new Set((p.blockers ?? []).map((code) => describeBlocker(code, "owner").title))];
      if (titles.length === 0) return `${symbol} fails a hard gate. Hard gates can't be outscored.`;
      const shown = titles.slice(0, GATES_SHOWN).join("; ");
      const more = titles.length > GATES_SHOWN ? `; +${titles.length - GATES_SHOWN} more` : "";
      return `${symbol} fails ${titles.length === 1 ? "a hard gate" : "hard gates"}: ${shown}${more}.`;
    }
    case "avoid":
      return p.total !== undefined
        ? `${symbol} scores ${p.total.toFixed(1)} with an "avoid" verdict, so this agent won't buy it.`
        : verdict.reason;
    case "min_score":
      return p.total !== undefined && p.minScore !== undefined
        ? `Your agent's minimum score is ${p.minScore}; ${symbol} scores ${p.total.toFixed(1)}. Lower the minimum in Settings if you meant to take this trade anyway.`
        : verdict.reason;
    case "cash": {
      if (p.cashUsd === undefined || p.amountUsd === undefined) return verdict.reason;
      if (!p.feeBps || !(p.feeBps > 0)) {
        return `Not enough cash: ${fmtUsd(p.cashUsd)} available, ${fmtUsd(p.amountUsd)} needed.`;
      }
      // The rate and this order's fee are the guard's own figures: this file reads no
      // setting. Printed exactly, because buying with all of one's cash is the common
      // case and to the cent the need and the cash are the same number.
      const needs = fmtUsdExact(p.amountUsd + (p.feeUsd ?? 0));
      const most = p.maxBuyUsd !== undefined && p.maxBuyUsd > 0 ? ` The most you can buy is ${fmtUsd(p.maxBuyUsd)}${kept(p.reserveUsd)}.` : "";
      return `Not enough cash: ${fmtUsdExact(p.cashUsd)} available, and a ${fmtUsdExact(p.amountUsd)} buy needs ${needs} with the ${formatFeeRate(p.feeBps)} Tocker fee.${most}`;
    }
    case "cash_reserve": {
      if (p.leftUsd === undefined || p.reserveUsd === undefined) return verdict.reason;
      // Exact, like the cash sentence above: a buy that misses the reserve by a fraction
      // of a cent would otherwise read "$5.00 in cash" against a "$5.00" reserve.
      const most =
        p.maxBuyUsd !== undefined && p.maxBuyUsd > 0
          ? ` The most you can buy is ${fmtUsd(p.maxBuyUsd)}.`
          : " Add funds, or lower Cash reserve in Settings.";
      // Buys of this agent's that are still settling are already taken off, and said, or
      // the figure would not square with the balance the owner can see.
      const settling =
        p.settlingUsd !== undefined && p.settlingUsd > 0 ? ` once the ${fmtUsd(p.settlingUsd)} of buys already placed have settled` : "";
      const leaves = p.leftUsd < 0 ? "nothing" : fmtUsdExact(p.leftUsd);
      return `This buy would leave ${leaves} in cash${settling}; the agent keeps ${fmtUsd(p.reserveUsd)} in reserve.${most}`;
    }
    case "concentration":
      return p.pct !== undefined && p.capPct !== undefined
        ? `This would make ${symbol} ${pct(p.pct)} of equity; the cap is ${pct(p.capPct)}. Lower the size or raise Max position size in Settings.`
        : verdict.reason;
    case "no_position":
      return `This agent holds no ${symbol} to sell.`;
    case "unpriced":
      return `${symbol} can't be priced right now, so the sell is held back rather than sent blind. Try again in a minute.`;
    case "oversell":
      return p.positionUsd !== undefined
        ? `That's more than the position is worth (${fmtUsd(p.positionUsd)}). Sell ${fmtUsd(p.positionUsd)} or less.`
        : verdict.reason;
    default:
      return verdict.reason;
  }
}
