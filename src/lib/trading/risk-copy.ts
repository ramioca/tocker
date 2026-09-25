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
import { fmtUsd } from "@/lib/money";
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
    case "cash":
      if (p.cashUsd === undefined || p.amountUsd === undefined) return verdict.reason;
      return p.feeUsd && p.feeUsd > 0
        ? `Not enough cash: ${fmtUsd(p.cashUsd)} available, and this needs ${fmtUsd(p.amountUsd + p.feeUsd)} with the ${fmtUsd(p.feeUsd)} Tocker fee.`
        : `Not enough cash: ${fmtUsd(p.cashUsd)} available, ${fmtUsd(p.amountUsd)} needed.`;
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
