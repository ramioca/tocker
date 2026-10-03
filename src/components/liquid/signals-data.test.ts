import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { listDataSources } from "@/lib/data-sources/registry";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES } from "./signals-data";

/**
 * The landing page's data sources must describe what the app actually pays
 * for. The registry is the truth; this test keeps the mirror honest.
 */
describe("landing data sources mirror the registry", () => {
  const registry = new Map(listDataSources().map((s) => [s.id, s]));

  it("lists only sources that exist in the registry, with no duplicates", () => {
    const ids = LANDING_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(registry.has(id), `${id} is not in the registry`).toBe(true);
  });

  it("shows every non-dynamic registry source", () => {
    const expected = listDataSources()
      .filter((s) => s.priceUsd !== null)
      .map((s) => s.id)
      .sort();
    expect(LANDING_SOURCES.map((s) => s.id).sort()).toEqual(expected);
  });

  it.each(LANDING_SOURCES.map((s) => [s.id, s] as const))("%s matches the registry", (_, card) => {
    const source = registry.get(card.id)!;
    expect(card.priceUsd).toBe(source.priceUsd);
    expect(card.category).toBe(source.category);
    const tier = source.experimental
      ? "experimental"
      : DEFAULT_AGENT_CONFIG.dataSources.includes(card.id)
        ? "default"
        : "standard";
    expect(card.tier).toBe(tier);
  });

  it("quotes the real default data budget", () => {
    expect(DEFAULT_DATA_BUDGET_USD).toBe(DEFAULT_AGENT_CONFIG.risk.maxDataSpendUsdPerRun);
  });
});
