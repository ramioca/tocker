import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { formatFeeRate } from "@/lib/platform/fee";
import { getPlatformOverview } from "@/server/queries/platform";
import { DATA_SOURCES } from "@/lib/data-sources/registry";
import { chainForNetwork } from "@/lib/x402/types";
import { MIN_PLATFORM_SOL } from "@/lib/wallets/gas";
import { PlatformWithdraw } from "@/components/settings/platform-withdraw";
import type { Chain } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * The Platform card — the operator's view of the platform's own money.
 *
 * A server component with no interactivity beyond copying an address, because every
 * number on it is a fact from the database or from Privy and none of it benefits from
 * a client round trip.
 *
 * It answers, in one place: which wallets the app owns, what they hold, **which sources
 * each one pays for**, what data cost this month, and how much of the per-fill fee has
 * actually landed versus is still sitting in agents' wallets waiting for the next sweep.
 *
 * That third question is new, and it is the one the card used to get wrong: it labelled
 * Base "Data + fees" and Solana "Fees", which read as "Solana needs no USDC". It does —
 * `deepnets-token-safety` is in the default source list and prices on Solana. The chains
 * are derived from the registry here rather than written into the copy, so a source
 * moving network changes this card without anyone remembering to.
 *
 * **Who can see it.** Admins only, since W6: it lives inside `/settings/admin`, behind
 * `requireAdmin()`. The card itself does not re-check — a component that 404s on its own
 * would be a second, weaker gate next to a real one — so it must not be mounted anywhere
 * that is not already admin-gated.
 */

/** Registry sources priced on a chain, for "what does this wallet actually pay for". */
function sourcesPricedOn(chain: Chain): string[] {
  return DATA_SOURCES.filter((s) => chainForNetwork(s.network) === chain && s.priceUsd !== null).map((s) => s.name);
}

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
  const feeOff = overview.feeBps <= 0;

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        These wallets are the platform&apos;s, not any agent&apos;s. They pay for every x402 data call your agents
        make — an operator funds an agent to trade, and sentiment and safety data is on us. Which wallet pays is
        decided by the <em>resource&apos;s</em> network, not the agent&apos;s chain, so both need USDC: fund one and
        every source priced on the other still 402s. They also receive the{" "}
        {feeOff ? (
          <span className="text-foreground">per-fill fee, which is currently switched off</span>
        ) : (
          <>
            <span className="tnum font-mono text-foreground">{formatFeeRate(overview.feeBps)}</span> Tocker fee
            charged on every executed fill
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
          No platform wallet yet. Create both with the button below — one per chain, and both are needed: Base pays
          every 402 priced on <span className="font-mono text-foreground">eip155:8453</span>, Solana pays every 402
          priced on Solana. An agent cannot go live against a wallet that does not exist.
        </p>
      ) : (
        <ul className="space-y-3">
          {overview.wallets.map((wallet) => {
            const pays = sourcesPricedOn(wallet.chain);
            const nativeSymbol = wallet.chain === "base" ? "ETH" : "SOL";
            // Only the Solana wallet spends native: it drips gas to agent wallets and
            // opens their token accounts. x402 needs none — every Solana 402 probed for
            // W7 carries an `extra.feePayer`, so the facilitator pays the network fee.
            const nativeLow = wallet.chain === "solana" && wallet.nativeBalance !== null && wallet.nativeBalance < MIN_PLATFORM_SOL;
            return (
              <li key={wallet.chain} className="rounded-xl border border-border/70 bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ChainBadge chain={wallet.chain} />
                    <span className="text-sm font-medium">Data + fees</span>
                  </div>
                  <Address
                    address={wallet.address}
                    label={`platform ${wallet.chain} wallet address`}
                    lead={6}
                    tail={6}
                  />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                  <Stat
                    label="USDC"
                    value={wallet.usdcBalance === null ? "unreadable" : formatUsd(wallet.usdcBalance)}
                    muted={wallet.usdcBalance === null}
                  />
                  <Stat
                    label={nativeSymbol}
                    value={wallet.nativeBalance === null ? "unreadable" : wallet.nativeBalance.toFixed(4)}
                    hint={wallet.chain === "solana" ? "gas + rent" : undefined}
                    muted={wallet.nativeBalance === null || wallet.chain === "base"}
                  />
                  <Stat label={`Data · ${overview.monthLabel}`} value={formatUsd(wallet.dataSpendThisMonthUsd)} />
                  <Stat label="Fees accrued" value={formatUsd(wallet.feesAccruedUsd)} hint="not yet swept" />
                  <Stat label="Fees collected" value={formatUsd(wallet.feesCollectedUsd)} />
                </dl>

                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {pays.length > 0 ? (
                    <>
                      Pays for <span className="text-foreground">{pays.join(", ")}</span> — every source priced on{" "}
                      {wallet.chain} — and receives {wallet.chain} fee sweeps.
                    </>
                  ) : (
                    <>Receives {wallet.chain} fee sweeps. No registered source prices on {wallet.chain} today.</>
                  )}
                  {wallet.chain === "solana" ? (
                    <>
                      {" "}
                      It is also the wallet that drips gas to agent wallets and opens their USDC token accounts, which
                      is the only reason it needs SOL — x402 itself does not, because every Solana 402 names a fee
                      payer.
                    </>
                  ) : null}
                </p>

                {wallet.balanceError ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Balances could not be read: {wallet.balanceError}. That is not the same as empty — this card is not
                    guessing either way.
                  </p>
                ) : null}
                {wallet.usdcBalance === 0 ? (
                  <p className="mt-2 text-xs text-destructive">
                    Holds no USDC. Every source priced on {wallet.chain} would answer 402. Send USDC to the address
                    above.
                  </p>
                ) : null}
                {nativeLow ? (
                  <p className="mt-2 text-xs text-destructive">
                    Under {MIN_PLATFORM_SOL} SOL, so it cannot top up an agent wallet or open a token account for one.
                    Send it ~0.05 SOL.
                  </p>
                ) : null}
                <PlatformWithdraw
                  chain={wallet.chain}
                  address={wallet.address}
                  usdc={wallet.usdcBalance}
                  native={wallet.nativeBalance}
                />
              </li>
            );
          })}
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
