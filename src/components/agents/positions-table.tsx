import { Wallet } from "lucide-react";
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
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import { HeldFor } from "@/components/agents/held-for";
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
}: {
  positions: Position[];
  cashUsd: number | null;
}) {
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
    <div className="overflow-x-auto rounded-xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Token</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden text-right md:table-cell">Held</TableHead>
            <TableHead className="text-right">Avg cost</TableHead>
            <TableHead className="text-right">Mark</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Peak</TableHead>
            <TableHead className="hidden text-right lg:table-cell" title="Score at entry → latest score">
              Score
            </TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Unrealised</TableHead>
            <TableHead className="text-right" title="Percentage points to the stop loss / to the take-profit">
              Stop / TP
            </TableHead>
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
                </span>
              </TableCell>
              <TableCell className="tnum text-right text-muted-foreground">
                {formatTokenAmount(position.amountToken)}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <HeldFor openedAt={position.openedAt} />
              </TableCell>
              <TableCell className="tnum text-right text-muted-foreground">
                {formatUsd(position.avgCostUsd)}
              </TableCell>
              <TableCell className="tnum text-right">{formatUsd(position.markPriceUsd)}</TableCell>
              <TableCell
                className="tnum hidden text-right text-muted-foreground lg:table-cell"
                title="Highest mark since entry — the trailing stop's reference"
              >
                {formatUsd(position.peakPriceUsd)}
              </TableCell>
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
              <TableCell className="text-right">
                <ExitDistance position={position} />
              </TableCell>
            </TableRow>
          ))}
          {cashUsd !== null ? (
            <TableRow className="bg-muted/20">
              <TableCell className="font-medium text-muted-foreground">Cash (USDC)</TableCell>
              <TableCell />
              <TableCell className="hidden md:table-cell" />
              <TableCell />
              <TableCell />
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="tnum text-right font-medium">{formatUsd(cashUsd)}</TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
