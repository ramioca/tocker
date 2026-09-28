import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChartEmpty, ChartSkeleton } from "@/components/spectrumui/charts/chart-engine";
import { ModeBadge } from "@/components/common/mode-badge";
import {
  AgentsHolding,
  BlockMenu,
  FlowStats,
  ScoreHero,
  ScoreHistoryChart,
  ScoreTokenPanel,
  TokenHeader,
  TokenTrades,
  TradeMenu,
  sharedHolderMode,
} from "@/components/tokens/page";
import { isNoDataReading } from "@/components/tokens/page/score-history-paths";
import { ScrollIntoView } from "@/components/tokens/page/scroll-into-view";
import { recentWindowLabel } from "@/components/tokens/page/time-span";
import { PriceChart } from "@/components/trading";
// Server module on purpose — `price-chart.tsx` is "use client" and importing a helper out
// of it from here returns a client reference, not a function (it 500'd this page).
// Not from the `@/components/trading` barrel: its other exports are client components,
// and this is a server page (see price-points.ts).
import { priceAxisPadLeft, pricePointsFrom } from "@/components/trading/price-points";
import { viewerSession } from "@/components/common/data-access";
import {
  MAX_TRADE_ID_LENGTH,
  agentRefs,
  getTokenPage,
  getTokenTrade,
  myAgentsForBlocklist,
} from "@/server/queries/tokens";
import { myTokenMarkers, receiptsFor, tokenActivityCount, type TokenMarker } from "@/server/queries/trading";
import type { Chain, TokenPage } from "@/server/types";
import { isTokenAddress } from "./address";

/**
 * `/tokens/[chain]/[address]` — the public record on one token.
 *
 * Everything here is public: the score and how it was built, which agents hold
 * it, every fill, and the net dollars agents moved through it. What is nowhere on
 * this page is any agent's universe rules, thresholds or transcript — the score
 * shown is computed under the platform's **default** universe precisely so that
 * no operator's gates leak through a public verdict.
 *
 * The page never scores on render. Anyone can point a URL at any address, so an
 * unknown token gets an explicit, free "score it" action instead of four silent
 * provider calls.
 */

type Params = { params: Promise<{ chain: string; address: string }> };
type Props = Params & { searchParams: Promise<{ trade?: string | string[] }> };

function parseChain(value: string): Chain | null {
  return value === "solana" || value === "base" ? value : null;
}

/** The chain and address, or null when the URL cannot name a token (→ 404). */
async function parseParams(params: Params["params"]): Promise<{ chain: Chain; address: string } | null> {
  const { chain: rawChain, address: rawAddress } = await params;
  const chain = parseChain(rawChain);
  if (!chain) return null;
  let address: string;
  try {
    address = decodeURIComponent(rawAddress);
  } catch {
    return null;
  }
  return isTokenAddress(chain, address) ? { chain, address } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const parsed = await parseParams(params);
  if (!parsed) return { title: "Token not found" };
  const { chain, address } = parsed;
  const page = await getTokenPage(chain, address);
  if (!page) return { title: "Token not found" };
  const score = page.score;
  return {
    title: `${page.token.symbol} · ${chain === "solana" ? "Solana" : "Base"}`,
    description: score
      ? `${page.token.symbol} scores ${Math.round(score.total)}/100 — ${score.verdict}. ${page.holders.length} agent${page.holders.length === 1 ? "" : "s"} holding.`
      : `${page.token.symbol} has not been scored yet on Tocker.`,
  };
}

export default async function TokenPageRoute({ params, searchParams }: Props) {
  const parsed = await parseParams(params);
  if (!parsed) notFound();
  const { chain, address } = parsed;

  const session = await viewerSession();
  const viewerId = session?.userId ?? null;

  const page = await getTokenPage(chain, address, viewerId);
  if (!page) notFound();

  // `?trade=<id>` is where a fill notification's "see the receipt" and the admin's
  // Recent fills land. The table only holds the 20 newest fills, so an older one is
  // fetched on its own — under the same visibility — and joins the end of the list,
  // which is where it falls in time.
  const { trade: tradeParam } = await searchParams;
  const focusId =
    typeof tradeParam === "string" && tradeParam.length > 0 && tradeParam.length <= MAX_TRADE_ID_LENGTH
      ? tradeParam
      : null;
  const focusInWindow = focusId ? (page.recentTrades.find((trade) => trade.id === focusId) ?? null) : null;
  const focusOlder = focusId && !focusInWindow ? await getTokenTrade(focusId, page.token, viewerId) : null;
  const focus = focusInWindow ?? focusOlder;
  const trades = focusOlder ? [...page.recentTrades, focusOlder] : page.recentTrades;

  const [targets, agents, markers, agentCount, receipts] = await Promise.all([
    viewerId ? myAgentsForBlocklist(viewerId, chain, address) : Promise.resolve([]),
    agentRefs(trades.map((trade) => trade.agentId)),
    // Owner-only by construction: `myTokenMarkers` filters on agents.ownerId in SQL and
    // returns [] for an anonymous viewer. Nobody else's entries land on this chart.
    myTokenMarkers(page.token.id, viewerId),
    tokenActivityCount(page.token.id),
    receiptsFor(trades.map((trade) => trade.id)),
  ]);

  // An agent that doesn't trade this chain has nothing to block here (the menu still
  // lists it, disabled, so the list matches the agents page). With no agent on the
  // chain and nothing to lift, there is no menu at all.
  // `targets` is only ever the viewer's own agents, so joining the public holders onto it
  // cannot put anyone else's position in the menu.
  const holdings = new Map(page.holders.map((holder) => [holder.agent.id, holder.valueUsd]));
  const blockTargets = targets.map((agent) =>
    holdings.has(agent.id) ? { ...agent, holdingUsd: holdings.get(agent.id) ?? null } : agent,
  );
  const blockMenu = targets.some((agent) => agent.onChain || agent.blocked) ? (
    <BlockMenu chain={chain} address={address} symbol={page.token.symbol} agents={blockTargets} />
  ) : null;
  // "native" is the gas asset's bookkeeping name, not something a swap can target.
  const tradeMenu =
    address === "native" ? null : (
      <TradeMenu chain={chain} address={address} symbol={page.token.symbol} agents={blockTargets} />
    );
  const actions =
    tradeMenu || blockMenu ? (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {tradeMenu}
        {blockMenu}
      </div>
    ) : null;
  const holderMode = sharedHolderMode(page.holders);
  // A URL pointed at a token nobody has scored, traded or held: every section below would
  // be its own empty box (four of them, two nested in the price card). The one thing to
  // do here is score it, so that is all the page shows. A `?trade=` link keeps the trades
  // section, where its "isn't visible to you" notice lives.
  const blank = !page.score && page.history.length === 0 && trades.length === 0 && page.holders.length === 0 && !focusId;

  return (
    <div className="w-full">
      <TokenHeader page={page} action={actions} />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-6">
        {page.score ? (
          <ScoreHero score={page.score} />
        ) : (
          <ScoreTokenPanel
            chain={chain}
            address={address}
            signedIn={Boolean(viewerId)}
            symbol={page.token.symbol}
            // History keeps every reading; the public verdict only shows one taken under
            // the default rules. A chart full of points under "Not scored yet" was a lie.
            lastScoredAt={page.history.at(-1)?.at ?? null}
          />
        )}

        {blank ? null : (
          <>
            <History page={page} markers={markers} agentCount={agentCount} />

            <FlowStats stats={page.stats} />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <section aria-labelledby="token-trades-heading" className="min-w-0">
                <h2
                  id="token-trades-heading"
                  className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Recent agent trades
                </h2>
                {focusId && !focus ? (
                  // One sentence for every miss — wrong token, not filled, or a private agent's
                  // fill — so the notice never confirms that a private trade exists. It is
                  // scrolled to, as a found fill would be: the link promised this spot.
                  <p className="mb-2 text-xs text-muted-foreground">
                    That fill isn&rsquo;t visible to you, or isn&rsquo;t on this token.
                    <ScrollIntoView />
                  </p>
                ) : null}
                <TokenTrades trades={trades} agentNames={agents} receipts={receipts} focusTradeId={focus?.id ?? null} />
              </section>

              <section aria-labelledby="token-holders-heading" className="min-w-0">
                <h2
                  id="token-holders-heading"
                  className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  <span>
                    Agents holding
                    {page.holders.length > 0 ? <span className="tnum"> · {page.holders.length}</span> : null}
                  </span>
                  {/* One badge for all of them when they share a mode; otherwise each row has its own. */}
                  {holderMode ? <ModeBadge mode={holderMode} size="xs" /> : null}
                </h2>
                <AgentsHolding holders={page.holders} />
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Price and score over the same window (up to 30 days), at the same width. The
 * question a token page has to answer is whether the score moved before the price did,
 * and two charts sharing an x range is the only honest way to show it.
 *
 * The price chart carries the viewer's **own** entries and exits. Not anyone else's: a
 * handful of marked fills on a price line is a readable strategy, and this product
 * promises operators it will not publish that. A viewer with no fills of their own sees
 * the aggregate instead — how many agents traded the token, never which or when.
 */
function History({
  page,
  markers,
  agentCount,
}: {
  page: TokenPage;
  markers: TokenMarker[];
  agentCount: number;
}) {
  const prices = pricePointsFrom(page.history);
  // One gutter for both plots: a micro-cap's long price labels widen the price chart's,
  // and the score chart under it has to start at the same x for the two to line up.
  const padLeft = priceAxisPadLeft(prices, markers);
  // The real reach of the readings, not the query's 30-day ceiling: a token first scored
  // this morning is "last 6 hours".
  const oldest = page.history.length > 0 ? Date.parse(page.history[0].at) : Number.NaN;
  const reach = Number.isFinite(oldest) ? recentWindowLabel(oldest) : "last 30 days";
  // Counted the way the chart draws them: a reading no provider answered is a gap.
  const readings = page.history.filter((point) => !isNoDataReading(point)).length;
  const empty = page.history.length - readings;
  const nothing = prices.length === 0 && readings === 0 && markers.length === 0;
  return (
    <section
      aria-labelledby="token-history-heading"
      className="rounded-2xl border border-border/70 bg-card/30 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="token-history-heading" className="text-sm font-medium tracking-tight">
          Price
        </h2>
        {nothing ? null : (
          <p className="tnum font-mono text-[11px] text-muted-foreground">
            {reach} · {prices.length} point{prices.length === 1 ? "" : "s"}
            {markers.length > 0 ? ` · ${markers.length} of your fills` : ""}
          </p>
        )}
      </div>

      {nothing ? (
        // One empty state for the card, not a dashed box per chart nested inside it.
        <div className="mt-2">
          <ChartEmpty
            height={200}
            variant="line"
            title="No price or score history yet"
            description="Every time this token is scored, a price and a score land here. The lines fill in from the next sweep."
          />
        </div>
      ) : (
        <>
          <Suspense fallback={<ChartSkeleton variant="line" height={240} />}>
            <PriceChart
              points={prices}
              markers={markers}
              agentCount={agentCount}
              padLeft={padLeft}
              className="mt-2"
            />
          </Suspense>

          <div className="mt-4 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Score</h3>
              <p className="tnum font-mono text-[11px] text-muted-foreground">
                {readings} point{readings === 1 ? "" : "s"}
                {empty > 0 ? ` · ${empty} with no data` : ""}
              </p>
            </div>
            <Suspense fallback={<ChartSkeleton variant="line" height={220} />}>
              <ScoreHistoryChart history={page.history} padLeft={padLeft} className="mt-2" />
            </Suspense>
          </div>
        </>
      )}
    </section>
  );
}
