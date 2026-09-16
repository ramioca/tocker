import type { ReactNode } from "react";
import { fmtUsd } from "@/lib/money";
import { formatCount } from "@/components/common/format";
import type { AdminBalancesSnapshot, AdminHeadline } from "@/server/queries/admin";
import { cn } from "@/lib/utils";

/**
 * The headline: eleven facts, no interpretation.
 *
 * Every tile is a `count` or a `sum` from the database, or USDC read from Privy. There
 * is deliberately no growth percentage, no sparkline-on-a-tile and no "vs last week"
 * anywhere here — the app records absolute events, so a derived trend would be either a
 * restatement of the chart below it or a number nobody could reproduce. The windows
 * (7d / 30d / all) are shown as separate facts instead, which is what they are.
 *
 * One `.glass-panel` holding a grid of plain tiles, not twelve glass cards: the material
 * system caps blurred surfaces per viewport, and a repeating element is not a panel.
 */

function Tile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  /** One or two short facts under the number. Each is a fact, not a comment. */
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-3.5", className)}>
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="tnum mt-1 truncate font-mono text-xl leading-tight text-foreground">{value}</p>
      {sub ? (
        <p className="tnum mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-muted-foreground">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One fact under a tile's number.
 *
 * Deliberately *not* `whitespace-nowrap`: at 390px a tile is about 140px wide, and a
 * nowrap phrase ("swept into a platform wallet") overflows it silently — the page does
 * not scroll sideways, the text just runs under the tile next to it. Numbers are atomic
 * on their own ("$188K" has no space in it), so letting the line wrap costs nothing and
 * fixes every one of those.
 */
function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("min-w-0", className)}>{children}</span>;
}

export function HeadlineTiles({
  headline,
  balances,
}: {
  headline: AdminHeadline;
  balances: AdminBalancesSnapshot | null;
}) {
  const { users, agents, wallets, volume, fees, dataSpend } = headline;

  return (
    <div className="glass-panel grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--glass-hairline)] sm:grid-cols-3 lg:grid-cols-4">
      {/* Each tile paints its own ground so the 1px grid gaps read as hairlines. */}
      <Tile
        className="bg-[var(--card)]"
        label="Users"
        value={formatCount(users.total)}
        sub={
          <>
            <Sub>+{formatCount(users.new7d)} · 7d</Sub>
            <Sub>+{formatCount(users.new30d)} · 30d</Sub>
          </>
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Agents"
        value={formatCount(agents.total)}
        sub={
          <>
            <Sub>{formatCount(agents.live)} live</Sub>
            <Sub>{formatCount(agents.paper)} paper</Sub>
          </>
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Agent status"
        value={`${formatCount(agents.active)} active`}
        sub={
          <>
            <Sub>{formatCount(agents.paused)} paused</Sub>
            <Sub>{formatCount(agents.draft)} draft</Sub>
            {agents.error > 0 ? <Sub className="text-destructive">{formatCount(agents.error)} error</Sub> : null}
          </>
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Wallets"
        value={formatCount(wallets.agentServer)}
        sub={
          <>
            <Sub>agent server</Sub>
            <Sub>{formatCount(wallets.userEmbedded)} user embedded</Sub>
          </>
        }
      />

      <Tile
        className="bg-[var(--card)]"
        label="Funded wallets"
        value={balances === null ? "—" : formatCount(balances.fundedCount)}
        sub={
          balances === null ? (
            <Sub>not read</Sub>
          ) : (
            <>
              <Sub>{fmtUsd(balances.totalUsdc)} USDC held</Sub>
              {balances.privyConfigured ? null : <Sub>Privy not configured</Sub>}
            </>
          )
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Volume · all time"
        value={fmtUsd(volume.allTime.notionalUsd, { compact: true })}
        sub={
          <>
            <Sub>{formatCount(volume.allTime.count)} fills</Sub>
            <Sub>{fmtUsd(volume.allTime.liveNotionalUsd, { compact: true })} live</Sub>
            <Sub>{fmtUsd(volume.allTime.paperNotionalUsd, { compact: true })} paper</Sub>
          </>
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Volume · 30d"
        value={fmtUsd(volume.d30.notionalUsd, { compact: true })}
        sub={
          <>
            <Sub>{formatCount(volume.d30.count)} fills</Sub>
            <Sub>{formatCount(volume.d30.liveCount)} live</Sub>
          </>
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Volume · 7d"
        value={fmtUsd(volume.d7.notionalUsd, { compact: true })}
        sub={
          <>
            <Sub>{formatCount(volume.d7.count)} fills</Sub>
            <Sub>{formatCount(volume.d7.liveCount)} live</Sub>
          </>
        }
      />

      <Tile
        className="bg-[var(--card)]"
        label="Fees collected"
        value={fmtUsd(fees.collectedUsd)}
        sub={<Sub>swept into a platform wallet</Sub>}
      />
      <Tile
        className="bg-[var(--card)]"
        label="Fees accrued"
        value={fmtUsd(fees.accruedUsd)}
        sub={<Sub>charged, not yet swept</Sub>}
      />
      <Tile
        className="bg-[var(--card)]"
        label="Data spend · x402"
        value={fmtUsd(dataSpend.usd)}
        sub={
          <>
            <Sub>{formatCount(dataSpend.count)} payments</Sub>
            {dataSpend.simulatedCount > 0 ? <Sub>{formatCount(dataSpend.simulatedCount)} fixtures</Sub> : null}
          </>
        }
      />
      <Tile
        className="bg-[var(--card)]"
        label="Waitlist"
        value={formatCount(headline.waitlistSignups)}
        sub={<Sub>landing-page signups</Sub>}
      />
    </div>
  );
}
