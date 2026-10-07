import { TokenIcon } from "@/components/common/token-icon";
import { EXIT_LABELS } from "@/lib/trading/exits";
import type { ExitReason } from "@/server/types";
import { COINS, type CoinName } from "./coins";

/**
 * The tape over the feed: public fills from sample agents, on the page's real tokens,
 * running right to left. Each one is what the feed shows of a fill (agent, side,
 * token, chain, size or realised result, and for an exit the rule that fired), never
 * anything of the strategy behind it. Sizes stay within the default $100 per trade and
 * exits land just past the default stop and take profit, as the five-minute exit check
 * leaves them.
 *
 * Pure CSS motion (landing-feed.css): two copies of the list slide by half their width
 * and loop. It pauses while hovered or focused, and stands still under reduced motion,
 * when the second copy is not drawn. The second copy is hidden from assistive tech, so
 * a screen reader hears each fill once. No hooks; renders on the server or the client.
 */

type Fill =
  | { agent: string; coin: CoinName; side: "buy"; usd: number }
  | { agent: string; coin: CoinName; side: "sell"; reason: ExitReason; pnlPct: number };

const FILLS: Fill[] = [
  { agent: "Night Moth", coin: "SUPER INU", side: "sell", reason: "take_profit", pnlPct: 41.2 },
  { agent: "Kite Runner", coin: "TIBBIR", side: "buy", usd: 100 },
  { agent: "Dawn Patrol", coin: "SOL", side: "sell", reason: "stop_loss", pnlPct: -15.3 },
  { agent: "Low Tide", coin: "SOL", side: "buy", usd: 60 },
  { agent: "Glass Owl", coin: "TIBBIR", side: "sell", reason: "take_profit", pnlPct: 40.6 },
  { agent: "Night Moth", coin: "SUPER INU", side: "buy", usd: 100 },
  { agent: "Low Tide", coin: "TIBBIR", side: "sell", reason: "trailing_stop", pnlPct: 18.4 },
  { agent: "Kite Runner", coin: "SOL", side: "buy", usd: 75 },
];

const CHAIN = (coin: CoinName) => (COINS[coin].id.startsWith("base:") ? "Base" : "Solana");

const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

export function FillsMarquee() {
  return (
    <div className="lpm" role="region" aria-label="Recent public fills, sample">
      <span className="lpm-tag lp-label" aria-hidden>
        <span className="lpm-tag-dot" />
        Public fills · sample
      </span>
      <div className="lpm-view">
        <div className="lpm-track">
          <FillList />
          <FillList copy />
        </div>
      </div>
    </div>
  );
}

function FillList({ copy = false }: { copy?: boolean }) {
  return (
    <ul className="lpm-list" aria-hidden={copy || undefined} data-copy={copy || undefined}>
      {FILLS.map((f, i) => (
        <li key={i} className="lpm-item">
          <TokenIcon token={COINS[f.coin]} size="sm" className="lpm-logo" />
          <span className="lpm-coin">{f.coin}</span>
          <span className="lpm-chain lp-mono">{CHAIN(f.coin)}</span>
          <span className="lpm-side lp-mono" data-side={f.side}>
            {f.side}
          </span>
          {f.side === "buy" ? (
            <span className="lpm-fig lp-mono">${f.usd}</span>
          ) : (
            <span className={`lpm-fig lp-mono ${f.pnlPct >= 0 ? "lp-up" : "lp-down"}`}>
              {pct(f.pnlPct)}
              <span className="lpm-why"> · {EXIT_LABELS[f.reason].toLowerCase()}</span>
            </span>
          )}
          <span className="lpm-agent">{f.agent}</span>
        </li>
      ))}
    </ul>
  );
}
