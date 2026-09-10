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
import type { Position } from "@/server/types";

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
            <TableHead className="text-right">Avg cost</TableHead>
            <TableHead className="text-right">Mark</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Unrealised</TableHead>
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
              <TableCell className="tnum text-right text-muted-foreground">
                {formatUsd(position.avgCostUsd)}
              </TableCell>
              <TableCell className="tnum text-right">{formatUsd(position.markPriceUsd)}</TableCell>
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
            </TableRow>
          ))}
          {cashUsd !== null ? (
            <TableRow className="bg-muted/20">
              <TableCell className="font-medium text-muted-foreground">Cash (USDC)</TableCell>
              <TableCell colSpan={3} />
              <TableCell className="tnum text-right font-medium">{formatUsd(cashUsd)}</TableCell>
              <TableCell />
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
