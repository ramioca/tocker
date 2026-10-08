/**
 * The paid smart money read, as a number for the scorer and a sentence for the model.
 *
 * A score used to carry this read as one component and nothing else: "smart money 53".
 * A model given that number almost never mentioned it, and a token no tracked wallet
 * had traded said nothing at all, though that is information too. So the read is also
 * said in words, in one line, wherever the score is rendered.
 *
 * Pure: no network, no clock, no database. Every amount in a line is one the source
 * returned (or the sum of the two the score adds together), rounded for reading; a line
 * never states a number that was not returned.
 */
import type { SmartMoneyRead, WalletFlow } from "@/lib/data-sources/normalize";
import type { TokenScore } from "@/server/types";

export type { SmartMoneyRead, WalletFlow } from "@/lib/data-sources/normalize";

/** Data sources whose per-token read feeds the `smartMoney` component. */
export const SMART_MONEY_SOURCE_IDS: readonly string[] = ["nansen-smart-money"];

/** What the scorer takes from a read: one net flow, and how many wallets were behind it. */
export interface SmartMoneyReading {
  netflowUsd: number;
  wallets: number;
}

/**
 * Smart money for the score is smart traders plus top-PnL wallets: their two net flows
 * added, their two wallet counts added.
 *
 * `null` when there is no reading: neither flow was returned, or no wallet was counted
 * and no dollar moved. That is "nobody tracked traded it", which the scorer must never
 * take for a flow of zero: zero scores a neutral 50, and nobody having looked is not
 * neutral. Wallets that did trade and came out even are a reading, of zero.
 */
export function smartMoneyReading(read: SmartMoneyRead): SmartMoneyReading | null {
  const flows = [read.smartTraders.netFlowUsd, read.topPnl.netFlowUsd].filter((n): n is number => n !== null);
  const wallets = (read.smartTraders.wallets ?? 0) + (read.topPnl.wallets ?? 0);
  const netflowUsd = flows.reduce((sum, n) => sum + n, 0);
  if (flows.length === 0 || (wallets === 0 && netflowUsd === 0)) return null;
  return { netflowUsd, wallets };
}

/** "$950", "$12.4k", "$1.28M". The sign is said in words by the caller, never printed. */
function usd(n: number): string {
  const abs = Math.abs(n);
  const trim = (fixed: string) => fixed.replace(/\.?0+$/, "");
  if (abs >= 999_950_000) return `$${trim((abs / 1_000_000_000).toFixed(2))}B`;
  if (abs >= 999_950) return `$${trim((abs / 1_000_000).toFixed(2))}M`;
  if (abs >= 999.5) return `$${trim((abs / 1_000).toFixed(1))}k`;
  return `$${Math.round(abs)}`;
}

/** Under half a dollar reads "$0", which is not a purchase or a sale. */
function moved(n: number | null): n is number {
  return n !== null && Math.abs(n) >= 0.5;
}

function counted(n: number | null, one: string, many: string): string | null {
  return n === null || n <= 0 ? null : `${n} ${n === 1 ? one : many}`;
}

function trade(group: string, flow: WalletFlow): string | null {
  return moved(flow.netFlowUsd) ? `${group} net ${flow.netFlowUsd > 0 ? "bought" : "sold"} ${usd(flow.netFlowUsd)}` : null;
}

const NOBODY = "no smart trader or top-PnL wallet tracked by Nansen traded it.";

/**
 * One read as one line: what smart money did, then what the other tracked groups did.
 *
 *   Smart money, last 24h: 3 smart traders and 1 top-PnL wallet net bought $12.4k. Whales
 *   net sold $2.1k; fresh wallets net bought $40.2k.
 *
 *   Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it.
 *
 * The exchange figure is printed as the source names it, a signed net flow, because which
 * way that sign points has not been checked against a paid answer.
 */
export function smartMoneyLine(read: SmartMoneyRead, window = "24h"): string {
  const reading = smartMoneyReading(read);
  const who = [
    counted(read.smartTraders.wallets, "smart trader", "smart traders"),
    counted(read.topPnl.wallets, "top-PnL wallet", "top-PnL wallets"),
  ]
    .filter((part): part is string => part !== null)
    .join(" and ");

  let first: string;
  if (reading === null) {
    first = who === "" ? NOBODY : `${who} traded it, and no net flow was returned.`;
  } else {
    const subject = who === "" ? "smart traders and top-PnL wallets" : who;
    first = moved(reading.netflowUsd)
      ? `${subject} net ${reading.netflowUsd > 0 ? "bought" : "sold"} ${usd(reading.netflowUsd)}.`
      : `${subject} traded it with no net flow.`;
  }

  const exchange = read.exchanges.netFlowUsd;
  const others = [
    trade("whales", read.whales),
    trade("fresh wallets", read.freshWallets),
    trade("public figures", read.publicFigures),
    moved(exchange) ? `exchange net flow ${exchange > 0 ? "+" : "-"}${usd(exchange)}` : null,
  ].filter((part): part is string => part !== null);

  const context = others.join("; ");
  return `Smart money, last ${window}: ${first}${
    context === "" ? "" : ` ${context.charAt(0).toUpperCase()}${context.slice(1)}.`
  }`;
}

/**
 * The line for a score that lists a smart money source when the read itself is not on
 * hand: a score served from the cache by another process, or one cached before the read
 * was per token. Only what the score still holds is said. A read that found no tracked
 * wallet left the component empty; one that found a flow left a component centred on 50,
 * which keeps the direction of the flow and none of its amounts.
 *
 * `null` for a score no smart money read was bought for.
 */
export function smartMoneyLineFromScore(score: Pick<TokenScore, "components" | "sources">): string | null {
  if (!score.sources.some((source) => SMART_MONEY_SOURCE_IDS.includes(source))) return null;
  const component = score.components.smartMoney;
  if (component === null) return `Smart money, last 24h: ${NOBODY}`;
  const did = component > 50 ? "net bought it" : component < 50 ? "net sold it" : "traded it with little or no net flow";
  return `Smart money, last 24h: tracked wallets ${did}. The amounts were not kept with this cached score.`;
}

/**
 * The line for a read that was wanted and is not in the score. `why` is a clause, as
 * `notBought` carries it: "$0.01 exceeds the $0.00 left in this run's data budget".
 */
export function smartMoneyNotReadLine(why: string): string {
  return `Smart money: not read (${why.trim().replace(/\.$/, "")}).`;
}
