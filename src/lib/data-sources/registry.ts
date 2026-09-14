/**
 * The catalog of data sources an agent can pay for.
 *
 * Everything here was probed live at build time (see each source file's header for
 * what came back). Sources whose vendor endpoint could not be reached are kept in the
 * registry with `experimental: true` and ship a realistic fixture, so the agent's
 * reasoning and the UI still exercise the full path.
 */
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
import { deepnetsTokenSafety, rugMunch, tokenIntelSol } from "./token-intel";
import { xSearch, xquikSearch } from "./x-search";
import type { DataSource } from "./normalize";

export type { DataSource, NormalizedResult, PaidLaunch, Signals } from "./normalize";

export const DATA_SOURCES: DataSource[] = [
  sentimentAlpha,
  xSearch,
  cmcQuotes,
  cmcDexSearch,
  agentData,
  deepnetsTokenSafety,
  tokenIntelSol,
  rugMunch,
  xquikSearch,
  nansenSmartMoney,
  plexaPretrade,
  gate402BaseRadar,
  solEnrichLaunches,
  dripmetricsSummary,
  dripmetricsMetric,
  ottoPulse,
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

export function toDataSourceInfo(source: DataSource): DataSourceInfo {
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    category: source.category,
    network: source.network,
    priceUsd: source.priceUsd,
    url: source.url,
    experimental: source.experimental,
  };
}

/** Catalog view for the agent builder's "data sources" step. */
export function listDataSources(): DataSourceInfo[] {
  return DATA_SOURCES.map(toDataSourceInfo);
}
