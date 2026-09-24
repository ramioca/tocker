/**
 * The catalog of data sources an agent can pay for.
 *
 * Every entry here was probed live — with no payment header, so the probe costs
 * nothing and proves only that the resource exists and what it charges. The probe
 * output is written into each source file's header with the date, because a registry
 * that describes what a vendor *used to* do is worse than an empty one.
 *
 * ## The rule for `experimental`
 *
 * `experimental: true` means **we have never seen this source's paid response**, not
 * "we made it up". A source whose 402 is real, whose price is real and whose request
 * shape is documented, but whose response keys can only be learned by paying, is
 * experimental until somebody pays. It still makes a real call and it is still really
 * paid for; the parser just accepts several plausible spellings instead of betting on
 * one. `X402_MOCK=1` is the only mode in which a fixture is returned, and the readiness
 * checklist fails go-live while that is set.
 *
 * ## What W7 removed
 *
 * Three entries shipped a fixture against an endpoint that no longer answers, which is
 * indistinguishable from data when `X402_MOCK` is off and a lie when it is on:
 *
 * | id | endpoint | re-probed 2026-09-21 |
 * |---|---|---|
 * | `token-intel-sol` | `token-intel-x402.echolonius.deno.net/intel` | 503 `USAGE_EXCEEDED` — Deno Deploy project suspended |
 * | `rugmunch` | `x402.rugmunch.io/api/analyze` | 404 `not_found` |
 * | `xquik-search` | `xquik.com/api/x402/search` | 404 (a Next.js not-found page) |
 *
 * They are gone from here and from `SENTIMENT_SOURCE_IDS` in `src/lib/tokens/index.ts`.
 * A dead source is not a feature with a caveat.
 */
import type { Chain } from "@/server/types";
import type { DataSourceInfo } from "@/server/types";
import { agentData } from "./agentdata";
import { bazaar } from "./bazaar";
import { cmcDexSearch, cmcQuotes } from "./coinmarketcap";
import { dripmetricsMetric, dripmetricsSummary } from "./dripmetrics";
import { gate402BaseRadar } from "./gate402";
import { nansenSmartMoney } from "./nansen";
import { ottoPulse } from "./otto";
import { plexaPretrade } from "./plexa";
import { sentimentAlpha } from "./sentimentalpha";
import { solEnrichLaunches } from "./solenrich";
import { deepnetsTokenSafety } from "./token-intel";
import { xSearch } from "./x-search";
import type { DataSource } from "./normalize";

export type { DataSource, NormalizedResult, PaidLaunch, Signals } from "./normalize";

export const DATA_SOURCES: DataSource[] = [
  xSearch,
  cmcQuotes,
  cmcDexSearch,
  deepnetsTokenSafety,
  agentData,
  nansenSmartMoney,
  plexaPretrade,
  gate402BaseRadar,
  solEnrichLaunches,
  dripmetricsSummary,
  dripmetricsMetric,
  ottoPulse,
  sentimentAlpha,
  bazaar,
];

const BY_ID = new Map(DATA_SOURCES.map((s) => [s.id, s]));

export function getDataSource(id: string): DataSource | undefined {
  return BY_ID.get(id);
}

/** Registry entries an agent is configured to use (unknown ids are dropped). */
export function resolveDataSources(ids: readonly string[]): DataSource[] {
  return ids.map((id) => BY_ID.get(id)).filter((s): s is DataSource => s !== undefined);
}

/**
 * Which platform wallets a set of configured sources will actually spend from.
 *
 * The registry's `network` is the CAIP-2 the resource *prices* on, and that decides
 * which platform wallet signs the payment (`payingWalletFor` in
 * `src/lib/x402/paidFetch.ts`). An agent whose list is all-Base needs nothing on the
 * Solana platform wallet; one that scores Solana tokens through `deepnets-token-safety`
 * needs USDC there or every call it makes 402s. The readiness checklist and the Platform
 * card both derive their chains from here rather than each keeping a list that can
 * drift from the registry.
 *
 * Unknown ids and networks the platform holds no wallet for are dropped: they are a
 * different failure, reported by the `data` step's registry check.
 *
 * `bazaar` is deliberately no signal — the chain depends on whichever resource the model
 * picks at runtime, so its registry `network` is a default, not a fact.
 */
export function dataChainsFor(ids: readonly string[], agentChains?: readonly Chain[]): Chain[] {
  const out: Chain[] = [];
  for (const source of resolveDataSources(ids)) {
    if (source.id === "bazaar") continue;
    // A source payable on several chains is paid on one the agent trades when it can
    // be (`selectPaymentOption` prefers the same), so only that wallet has to be funded.
    const onAgentChains = agentChains ? source.chains.filter((chain) => agentChains.includes(chain)) : [];
    for (const chain of onAgentChains.length > 0 ? onAgentChains : source.chains) {
      if (!out.includes(chain)) out.push(chain);
    }
  }
  return out.sort();
}

/**
 * Sources an agent could not pay for on any chain it trades (W7). `bazaar` is never
 * listed: the chain depends on the resource picked at runtime.
 */
export function unpayableSources(ids: readonly string[], agentChains: readonly Chain[]): DataSourceInfo[] {
  return resolveDataSources(ids)
    .filter((source) => source.id !== "bazaar" && !source.chains.some((chain) => agentChains.includes(chain)))
    .map(toDataSourceInfo);
}

/** Registry entries payable on at least one of these chains — what the picker offers. */
export function sourcesPayableOn(chains: readonly Chain[]): DataSourceInfo[] {
  return DATA_SOURCES.filter((source) => source.id === "bazaar" || source.chains.some((chain) => chains.includes(chain))).map(
    toDataSourceInfo,
  );
}

export function toDataSourceInfo(source: DataSource): DataSourceInfo {
  return {
    id: source.id,
    name: source.name,
    summary: source.summary,
    description: source.description,
    category: source.category,
    network: source.network,
    chains: source.chains,
    priceUsd: source.priceUsd,
    url: source.url,
    experimental: source.experimental,
  };
}

/** Catalog view for the agent builder's "data sources" step. */
export function listDataSources(): DataSourceInfo[] {
  return DATA_SOURCES.map(toDataSourceInfo);
}
