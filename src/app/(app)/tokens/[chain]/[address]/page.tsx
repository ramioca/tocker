import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChartSkeleton } from "@/components/spectrumui/charts/chart-engine";
import {
  AgentsHolding,
  BlockMenu,
  FlowStats,
  PriceSparkline,
  ScoreHero,
  ScoreHistoryChart,
  ScoreTokenPanel,
  TokenHeader,
  TokenTrades,
} from "@/components/tokens/page";
import { viewerSession } from "@/components/common/data-access";
import { agentRefs, getTokenPage, myAgentsForBlocklist } from "@/server/queries/tokens";
import type { Chain, TokenPage } from "@/server/types";

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

function parseChain(value: string): Chain | null {
  return value === "solana" || value === "base" ? value : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { chain: rawChain, address } = await params;
  const chain = parseChain(rawChain);
  if (!chain) return { title: "Token not found" };
  const page = await getTokenPage(chain, decodeURIComponent(address));
  if (!page) return { title: "Token not found" };
  const score = page.score;
  return {
    title: `${page.token.symbol} · ${chain === "solana" ? "Solana" : "Base"}`,
    description: score
      ? `${page.token.symbol} scores ${Math.round(score.total)}/100 — ${score.verdict}. ${page.holders.length} agent${page.holders.length === 1 ? "" : "s"} holding.`
      : `${page.token.symbol} has not been scored yet on Tocker.`,
  };
}

export default async function TokenPageRoute({ params }: Params) {
  const { chain: rawChain, address: rawAddress } = await params;
  const chain = parseChain(rawChain);
  if (!chain) notFound();
  const address = decodeURIComponent(rawAddress);

  const session = await viewerSession();
  const viewerId = session?.userId ?? null;

  const page = await getTokenPage(chain, address, viewerId);
  if (!page) notFound();

  const [blockTargets, agents] = await Promise.all([
    viewerId ? myAgentsForBlocklist(viewerId, chain, address) : Promise.resolve([]),
    agentRefs(page.recentTrades.map((trade) => trade.agentId)),
  ]);

  const blockMenu =
    blockTargets.length > 0 ? (
      <BlockMenu chain={chain} address={address} symbol={page.token.symbol} agents={blockTargets} />
    ) : null;

  return (
    <div className="w-full">
      <TokenHeader page={page} action={blockMenu} />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-6">
        {page.score ? (
          <ScoreHero score={page.score} />
        ) : (
          <ScoreTokenPanel chain={chain} address={address} signedIn={Boolean(viewerId)} />
        )}

        <History page={page} />

        <FlowStats stats={page.stats} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section aria-labelledby="token-trades-heading" className="min-w-0">
            <h2
              id="token-trades-heading"
              className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Recent agent trades
            </h2>
            <TokenTrades trades={page.recentTrades} agentNames={agents} />
          </section>

          <section aria-labelledby="token-holders-heading" className="min-w-0">
            <h2
              id="token-holders-heading"
              className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Agents holding
            </h2>
            <AgentsHolding holders={page.holders} />
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Score and price over the same 30 days, at the same width. The question a token
 * page has to answer is whether the score moved before the price did, and two
 * charts sharing an x range is the only honest way to show it.
 */
function History({ page }: { page: TokenPage }) {
  return (
    <section
      aria-labelledby="token-history-heading"
      className="rounded-2xl border border-border/70 bg-card/30 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="token-history-heading" className="text-sm font-medium tracking-tight">
          Score history
        </h2>
        <p className="tnum font-mono text-[11px] text-muted-foreground">
          last 30 days · {page.history.length} point{page.history.length === 1 ? "" : "s"}
        </p>
      </div>

      <Suspense fallback={<ChartSkeleton variant="line" height={220} />}>
        <ScoreHistoryChart history={page.history} className="mt-2" />
      </Suspense>
      <PriceSparkline history={page.history} className="mt-3 border-t border-border/50 pt-3" />
    </section>
  );
}
