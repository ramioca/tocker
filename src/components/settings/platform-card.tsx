import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { getPlatformOverview } from "@/server/queries/platform";
import { cn } from "@/lib/utils";

/**
 * The Platform card — the operator's view of the platform's own money.
 *
 * A server component with no interactivity beyond copying an address, because every
 * number on it is a fact from the database or from Privy and none of it benefits from
 * a client round trip.
 *
 * It answers, in one place: which wallets the app owns, what they hold, what data cost
 * this month, and how much of the per-fill fee has actually landed versus is still
 * sitting in agents' wallets waiting for the next sweep.
 *
 * **Who can see it.** Any signed-in user. Tocker is single-operator today — one person
 * owns this deployment, its Privy app and its authorization key — so there is no role to
 * check yet and a half-enforced one would be worse than none. This becomes a real
 * permission check the day a second operator exists.
 */

function Stat({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("tnum mt-0.5 font-mono text-sm", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
        {hint ? <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

export async function PlatformCard() {
  // Never take the settings page down with it: the profile form and the LLM keys below
  // are what people actually came here for, and a Privy or database wobble on a
  // read-only card is not a reason to show an error page instead of all of it.
  let overview: Awaited<ReturnType<typeof getPlatformOverview>>;
  try {
    overview = await getPlatformOverview();
  } catch (err) {
    return (
      <p className="rounded-lg border border-border/70 px-3 py-4 text-sm text-muted-foreground">
        Could not read the platform wallets: {err instanceof Error ? err.message : "unknown error"}.
      </p>
    );
  }
  const feeOff = overview.feeUsd <= 0;

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        These wallets are the platform&apos;s, not any agent&apos;s. They pay for every x402 data call your agents
        make — an operator funds an agent to trade, and sentiment and safety data is on us — and they receive the{" "}
        {feeOff ? (
          <span className="text-foreground">per-fill fee, which is currently switched off</span>
        ) : (
          <>
            flat <span className="tnum font-mono text-foreground">{formatUsd(overview.feeUsd)}</span> fee charged on
            every executed fill
          </>
        )}
        . Fees are collected in batches: an agent&apos;s accrued fees are swept here once they reach{" "}
        <span className="tnum font-mono text-foreground">{formatUsd(overview.settleMinUsd)}</span>, never on the trade
        path.
      </p>

      {overview.mockData ? (
        <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">X402_MOCK=1</span> — data calls return fixtures and nothing is
          being paid. Data spend below counts real payments only, so it will read $0.00 until mock mode is off.
        </p>
      ) : null}

      {overview.wallets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
          No platform wallet yet. One is created per chain the first time it is needed — a paid data call, a fee
          settlement, or <span className="font-mono text-foreground">pnpm preflight</span>, which prints the address to
          fund.
        </p>
      ) : (
        <ul className="space-y-3">
          {overview.wallets.map((wallet) => (
            <li key={wallet.chain} className="rounded-xl border border-border/70 bg-card/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ChainBadge chain={wallet.chain} />
                  <span className="text-sm font-medium">
                    {wallet.chain === "base" ? "Data + fees" : "Fees"}
                  </span>
                </div>
                <Address address={wallet.address} label={`platform ${wallet.chain} wallet address`} lead={6} tail={6} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Stat
                  label="USDC"
                  value={wallet.usdcBalance === null ? "unreadable" : formatUsd(wallet.usdcBalance)}
                  muted={wallet.usdcBalance === null}
                />
                <Stat label={`Data · ${overview.monthLabel}`} value={formatUsd(wallet.dataSpendThisMonthUsd)} />
                <Stat label="Fees accrued" value={formatUsd(wallet.feesAccruedUsd)} hint="not yet swept" />
                <Stat label="Fees collected" value={formatUsd(wallet.feesCollectedUsd)} />
              </dl>
            </li>
          ))}
        </ul>
      )}

      {overview.wallets.length > 0 ? (
        <p className="tnum text-xs text-muted-foreground">
          Across all chains: <span className="font-mono text-foreground">{formatUsd(overview.collectedUsd)}</span>{" "}
          collected, <span className="font-mono text-foreground">{formatUsd(overview.accruedUsd)}</span> still accrued.
          Paper agents&apos; fees are included and marked settled at accrual — there is no chain to move them on.
        </p>
      ) : null}
    </div>
  );
}
