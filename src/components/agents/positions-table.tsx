import { Wallet } from "lucide-react";
import { GeckoTerminalLink } from "@/components/common/chart-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChainBadge } from "@/components/common/chain-badge";
import { EmptyState } from "@/components/common/empty-state";
import { PnlText } from "@/components/common/pnl-text";
import { TokenIcon } from "@/components/common/token-icon";
import { formatPriceUsd, formatTokenAmount, formatUsd } from "@/components/common/format";
import { SellPositionButton } from "@/components/agents/sell-position";
import { cn } from "@/lib/utils";
import type { Position } from "@/server/types";

/** Inside this many percentage points of the stop, the cell turns red. */
const NEAR_EXIT_PP = 5;

function ppLabel(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
}

/**
 * Distance to the two fixed exits, in percentage points. This is the column that tells
 * an operator whether the exit engine is about to act: the stop turns red inside
 * {@link NEAR_EXIT_PP} points, or once it is already breached and the next guardian pass
 * will close the position.
 */
function ExitDistance({ position }: { position: Position }) {
  const { stopDistancePct: stop, takeProfitDistancePct: target } = position;
  if (stop === null && target === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const near = stop !== null && stop <= NEAR_EXIT_PP;
  return (
    <span className="tnum text-[11px] whitespace-nowrap">
      <span
        className={cn(near ? "text-negative font-medium" : "text-muted-foreground")}
        title={stop === null ? "No stop loss configured" : `${ppLabel(stop)} points of headroom above the stop loss`}
      >
        {stop === null ? "no stop" : ppLabel(stop)}
      </span>
      <span className="text-muted-foreground/50"> / </span>
      <span
        className="text-muted-foreground"
        title={target === null ? "No take-profit configured" : `${ppLabel(target)} points below the take-profit`}
      >
        {target === null ? "no TP" : ppLabel(target)}
      </span>
    </span>
  );
}

/** "74 → 62" — the score at entry against the score now, when we have both. */
function ScoreDrift({ position }: { position: Position }) {
  const { entryScore, currentScore } = position;
  if (entryScore === null && currentScore === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tnum text-[11px] whitespace-nowrap" title="Composite score at entry → most recent score">
      <span className="text-muted-foreground">{entryScore === null ? "?" : entryScore.toFixed(0)}</span>
      <span className="text-muted-foreground/50"> → </span>
      <span className={currentScore === null ? "text-muted-foreground" : "font-medium"}>
        {currentScore === null ? "?" : currentScore.toFixed(0)}
      </span>
    </span>
  );
}

export function PositionsTable({
  positions,
  cashUsd,
  agentId,
  canTrade = false,
  showExits = false,
}: {
  positions: Position[];
  cashUsd: number | null;
  /** With `canTrade`, each row gets a Sell control that trades on this agent's book. */
  agentId?: string;
  canTrade?: boolean;
  /**
   * The Stop / TP column. Owner-only: the distances are the owner's risk rules seen
   * from one side, and the query nulls them for everyone else anyway — a column of
   * dashes would only read as "this agent has no stops", which is not what it means.
   */
  showExits?: boolean;
}) {
  const sellable = canTrade && agentId !== undefined;
  if (positions.length === 0) {
    return (
      <EmptyState
        icon={<Wallet />}
        title="Flat — no open positions"
        description={
          cashUsd === null
            ? "Everything is in the quote asset right now."
            : `${formatUsd(cashUsd)} sitting in USDC, waiting for a setup.`
        }
      />
    );
  }

  return (
    <div className="glass-card overflow-x-auto rounded-xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Token</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Avg cost</TableHead>
            <TableHead className="text-right">Mark</TableHead>
            <TableHead className="hidden text-right lg:table-cell" title="Score at entry → latest score">
              Score
            </TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Unrealised</TableHead>
            {sellable ? <TableHead className="w-0" /> : null}
            {showExits ? (
              <TableHead className="text-right" title="Percentage points to the stop loss / to the take-profit">
                Stop / TP
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((position) => (
            <TableRow key={position.token.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <TokenIcon token={position.token} size="sm" />
                  <span className="font-medium">{position.token.symbol}</span>
                  <ChainBadge chain={position.token.chain} className="hidden sm:inline-flex" />
                  <GeckoTerminalLink chain={position.token.chain} address={position.token.address} symbol={position.token.symbol} />
                </span>
              </TableCell>
              <TableCell className="tnum text-right text-muted-foreground">
                {formatTokenAmount(position.amountToken)}
              </TableCell>
              <TableCell className="tnum text-right text-muted-foreground">
                {formatPriceUsd(position.avgCostUsd)}
              </TableCell>
              <TableCell className="tnum text-right">{formatPriceUsd(position.markPriceUsd)}</TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                <ScoreDrift position={position} />
              </TableCell>
              <TableCell className="tnum text-right font-medium">
                {formatUsd(position.valueUsd)}
              </TableCell>
              <TableCell className="text-right">
                <PnlText
                  usd={position.unrealizedPnlUsd}
                  pct={position.unrealizedPnlPct}
                  size="xs"
                />
              </TableCell>
              {sellable ? (
                <TableCell className="text-right">
                  <SellPositionButton agentId={agentId} position={position} />
                </TableCell>
              ) : null}
              {showExits ? (
                <TableCell className="text-right">
                  <ExitDistance position={position} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {cashUsd !== null ? (
            <TableRow className="bg-muted/20">
              <TableCell className="font-medium text-muted-foreground">Cash (USDC)</TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="tnum text-right font-medium">{formatUsd(cashUsd)}</TableCell>
              <TableCell />
              {sellable ? <TableCell /> : null}
              {showExits ? <TableCell /> : null}
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
