import Link from "next/link";
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
import { ScoreBadge } from "@/components/tokens/score-badge";
import { describeBlocker } from "@/components/tokens/blocker-copy";
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
 * will close the position. A take-profit already reached says so in words — "−56.5"
 * there read as 56 points *short* of it, when the guardian is about to bank it.
 *
 * `labelled` is the phone form, which sits under the symbol with no column header
 * above it, so each exit gets its own line and says what it is.
 */
function ExitDistance({ position, labelled = false }: { position: Position; labelled?: boolean }) {
  const { stopDistancePct: stop, takeProfitDistancePct: target } = position;
  if (stop === null && target === null) {
    return labelled ? null : <span className="text-muted-foreground">—</span>;
  }
  const near = stop !== null && stop <= NEAR_EXIT_PP;
  const pastTarget = target !== null && target <= 0;
  const stopTone = near ? "text-negative font-medium" : "text-muted-foreground";
  const targetTone = pastTarget ? "text-positive font-medium" : "text-muted-foreground";

  if (labelled) {
    return (
      <span className="tnum block text-[11px] leading-snug">
        <span className={cn("block whitespace-nowrap", stopTone)}>
          {stop === null ? "no stop" : stop <= 0 ? "past stop" : `${stop.toFixed(1)} pts to stop`}
        </span>
        <span className={cn("block whitespace-nowrap", targetTone)}>
          {target === null ? "no TP" : pastTarget ? "past TP" : `${target.toFixed(1)} pts to TP`}
        </span>
      </span>
    );
  }

  // The unit once, on the last number printed.
  const unitOnStop = target === null || pastTarget;
  return (
    <span className="tnum text-[11px] whitespace-nowrap">
      <span
        className={stopTone}
        title={stop === null ? "No stop loss configured" : `${ppLabel(stop)} points of headroom above the stop loss`}
      >
        {stop === null ? "no stop" : `${ppLabel(stop)}${unitOnStop ? " pts" : ""}`}
      </span>
      <span className="text-muted-foreground/50"> / </span>
      <span
        className={targetTone}
        title={
          target === null
            ? "No take-profit configured"
            : pastTarget
              ? "At or past the take-profit; the next guardian pass closes it"
              : `${ppLabel(target)} points below the take-profit`
        }
      >
        {target === null ? "no TP" : pastTarget ? "past TP" : `${ppLabel(target)} pts`}
      </span>
    </span>
  );
}

/** "74 → 62" — the score at entry against the score now, when we have both. */
function ScoreDrift({ position }: { position: Position }) {
  const { entryScore, currentScore } = position;
  // Present only for the owner (null or absent for anyone else).
  const blockers = position.currentBlockers ?? [];
  const blockerTitles = blockers.map((code) => describeBlocker(code).title);
  if (entryScore === null && currentScore === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tnum text-[11px] whitespace-nowrap" title="Composite score at entry → most recent score">
      <span className="text-muted-foreground">{entryScore === null ? "—" : entryScore.toFixed(0)}</span>
      <span className="text-muted-foreground/50"> → </span>
      {/* Coloured from the number alone: a reading of what a visitor already sees, not a new fact. */}
      {currentScore === null ? (
        <span className="text-muted-foreground">—</span>
      ) : blockers.length > 0 ? (
        // Owner-only: the gates the owner's own universe failed, so an "Avoid" on a
        // decent number says why rather than looking like a bug.
        <>
          <ScoreBadge
            total={currentScore}
            blockers={blockers}
            size="xs"
            numberOnly
            className="align-middle"
            title={`${Math.round(currentScore)} / 100 — Avoid. Failed: ${blockerTitles.join("; ")}.`}
          />
          <span className="sr-only">. Failed: {blockerTitles.join("; ")}.</span>
        </>
      ) : (
        <ScoreBadge total={currentScore} size="xs" numberOnly className="align-middle" />
      )}
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
      {/*
        Below `sm` the row is Token / Value / Unrealized (/ Sell): the two numbers people
        check first. Amount, cost and mark are how you got there, and at 390px they pushed
        the answer off the right edge. The owner's Stop / TP moves under the symbol there
        rather than losing the near-stop warning, and Sell stays last, where a thumb and
        the row's end both expect it.
      */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Token</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Avg cost</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Mark</TableHead>
            <TableHead className="hidden text-right lg:table-cell" title="Score at entry → latest score">
              Score
            </TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Unrealized</TableHead>
            {showExits ? (
              <TableHead className="hidden text-right sm:table-cell">
                Stop / TP
                <span className="block text-[10px] font-normal text-muted-foreground">pts away</span>
              </TableHead>
            ) : null}
            {sellable ? (
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((position) => (
            <TableRow key={position.token.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  {/* The token's page first — its score and the reasons for it, which a
                      phone has no column for. GeckoTerminal is the secondary way out. */}
                  <Link
                    href={`/tokens/${position.token.chain}/${position.token.address}`}
                    className="inline-flex items-center gap-2 rounded hover:underline focus-ring"
                  >
                    <TokenIcon token={position.token} size="sm" />
                    <span className="font-medium">{position.token.symbol}</span>
                  </Link>
                  <ChainBadge chain={position.token.chain} className="hidden sm:inline-flex" />
                  <GeckoTerminalLink chain={position.token.chain} address={position.token.address} symbol={position.token.symbol} />
                </span>
                {showExits ? (
                  <span className="mt-1 block sm:hidden">
                    <ExitDistance position={position} labelled />
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tnum hidden text-right text-muted-foreground sm:table-cell">
                {formatTokenAmount(position.amountToken)}
              </TableCell>
              <TableCell className="tnum hidden text-right text-muted-foreground sm:table-cell">
                {formatPriceUsd(position.avgCostUsd)}
              </TableCell>
              <TableCell className="tnum hidden text-right sm:table-cell">
                {formatPriceUsd(position.markPriceUsd)}
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                <ScoreDrift position={position} />
              </TableCell>
              <TableCell className="tnum text-right font-medium">
                {formatUsd(position.valueUsd)}
              </TableCell>
              {/* Stacked on a phone: side by side, the pair was the widest cell in the row. */}
              <TableCell className="text-right">
                <PnlText usd={position.unrealizedPnlUsd} size="xs" className="max-sm:block" />
                <PnlText
                  pct={position.unrealizedPnlPct}
                  size="xs"
                  className="font-normal max-sm:block sm:ml-1.5"
                />
              </TableCell>
              {showExits ? (
                <TableCell className="hidden text-right sm:table-cell">
                  <ExitDistance position={position} />
                </TableCell>
              ) : null}
              {sellable ? (
                <TableCell className="text-right">
                  <SellPositionButton agentId={agentId} position={position} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {cashUsd !== null ? (
            <TableRow className="bg-muted/20">
              <TableCell className="font-medium text-muted-foreground">Cash (USDC)</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="tnum text-right font-medium">{formatUsd(cashUsd)}</TableCell>
              <TableCell />
              {showExits ? <TableCell className="hidden sm:table-cell" /> : null}
              {sellable ? <TableCell /> : null}
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
