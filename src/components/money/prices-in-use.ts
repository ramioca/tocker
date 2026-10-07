import { isCatalogueId, providerLabel } from "@/lib/agent/providers";
import { resolveModelPrice, type MoneyAgentRow } from "@/server/queries/money";

/** One rate under "How we estimate": a model these agents run, and what it lists at. */
export interface PriceLine {
  /** Unique among the lines of one note. */
  key: string;
  /** The model's name, with the provider after it only where the name alone is not enough. */
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * The rates behind the model estimate: one line per priced model the agents on a page
 * run, in the order they appear. Not the whole price list, which is every provider's.
 *
 * Each agent's price is its own provider's, the one its estimate was made from. Two
 * agents on the same model at the same price are one line. The same model sold by two
 * hosts at two prices is two lines, and then each says whose price it is ("GLM-5.3 on
 * DeepInfra"): two lines reading "GLM-5.3" with different numbers would explain nothing.
 * Where a name has one price on the page it is printed alone, as it always was.
 *
 * A model with no known price has no line. That it is missing from the total is said by
 * the note itself.
 */
export function pricesInUse(agents: ReadonlyArray<Pick<MoneyAgentRow, "model" | "provider">>): PriceLine[] {
  const lines = new Map<string, { name: string; inputPerMTok: number; outputPerMTok: number; providers: string[] }>();
  for (const agent of agents) {
    const price = resolveModelPrice(agent.model, agent.provider);
    if (!price) continue;
    const key = `${price.label}|${price.inputPerMTok}|${price.outputPerMTok}`;
    const line = lines.get(key) ?? { name: price.label, inputPerMTok: price.inputPerMTok, outputPerMTok: price.outputPerMTok, providers: [] };
    // Only a provider the registry has is named: the value is whatever the config stored.
    if (isCatalogueId(agent.provider) && !line.providers.includes(agent.provider)) line.providers.push(agent.provider);
    lines.set(key, line);
  }

  const timesNamed = new Map<string, number>();
  for (const line of lines.values()) timesNamed.set(line.name, (timesNamed.get(line.name) ?? 0) + 1);

  return [...lines].map(([key, line]) => {
    const shared = (timesNamed.get(line.name) ?? 0) > 1 && line.providers.length > 0;
    return {
      key,
      label: shared ? `${line.name} on ${line.providers.map(providerLabel).join(", ")}` : line.name,
      inputPerMTok: line.inputPerMTok,
      outputPerMTok: line.outputPerMTok,
    };
  });
}
