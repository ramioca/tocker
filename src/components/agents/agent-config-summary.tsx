import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

export function intervalLabel(minutes: number): string {
  if (minutes === 0) return "Manual only";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
  return `Every ${minutes} min`;
}

/**
 * The config as an owner reads it back: prose where prose helps, numbers where
 * the number is the point. Nothing here is editable — that is what settings is for.
 */
export function AgentConfigSummary({
  config,
  className,
}: {
  config: AgentConfig;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Strategy
        </h3>
        <p className="mt-2 whitespace-pre-wrap rounded-xl border border-border/70 bg-card/40 p-3 text-sm leading-relaxed text-foreground/85">
          {config.strategyPrompt}
        </p>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Brain &amp; schedule
          </h3>
          <dl className="mt-1">
            <Row label="Provider">
              <span className="capitalize">{config.llm.provider}</span>
            </Row>
            <Row label="Model">
              <span className="font-mono text-xs">{config.llm.model}</span>
            </Row>
            <Row label="Temperature">
              <span className="tnum">{config.llm.temperature}</span>
            </Row>
            <Row label="Max steps per run">
              <span className="tnum">{config.llm.maxSteps}</span>
            </Row>
            <Row label="Schedule">{intervalLabel(config.schedule.intervalMinutes)}</Row>
          </dl>
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Risk
          </h3>
          <dl className="mt-1">
            <Row label="Max per trade">
              <span className="tnum">{formatUsd(config.risk.maxTradeUsd)}</span>
            </Row>
            <Row label="Max trades / day">
              <span className="tnum">{config.risk.maxDailyTrades}</span>
            </Row>
            <Row label="Max position size">
              <span className="tnum">{config.risk.maxPositionPct}% of equity</span>
            </Row>
            <Row label="Data spend cap">
              <span className="tnum">{formatUsd(config.risk.maxDataSpendUsdPerRun)} / run</span>
            </Row>
            <Row label="Stop / take profit">
              <span className="tnum">
                {config.risk.stopLossPct === null ? "—" : `−${config.risk.stopLossPct}%`} /{" "}
                {config.risk.takeProfitPct === null ? "—" : `+${config.risk.takeProfitPct}%`}
              </span>
            </Row>
            <Row label="Slippage">
              <span className="tnum">{config.risk.slippageBps} bps</span>
            </Row>
          </dl>
        </section>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Data sources
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {config.dataSources.length === 0 ? (
              <li className="text-sm text-muted-foreground">None — trades blind.</li>
            ) : (
              config.dataSources.map((source) => (
                <li
                  key={source}
                  className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px]"
                >
                  {source}
                </li>
              ))
            )}
          </ul>
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Chains &amp; tokens
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {config.chains.map((chain) => (
              <ChainBadge key={chain} chain={chain} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {config.tokenAllowlist.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                Any token its data sources surface.
              </li>
            ) : (
              config.tokenAllowlist.map((token) => (
                <li
                  key={`${token.chain}:${token.address}`}
                  className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium"
                >
                  {token.symbol}
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
