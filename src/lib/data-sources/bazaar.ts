/**
 * The dynamic source: pay for any resource the agent finds in the x402 Bazaar.
 *
 * REAL: discovery (`searchX402Resources`) is public and was verified live at build
 * time. The price is not known up front, so `paidFetch` reads it from the resource's
 * own 402 and the per-run budget check happens there. In mock mode this returns a
 * synthetic envelope rather than a vendor-shaped fixture, because the shape depends
 * on whichever resource the model picked.
 */
import { z } from "zod";
import { paidFetch } from "@/lib/x402/paidFetch";
import { bazaarSourceId, searchDataSources } from "@/lib/x402/discovery";
import { defineSource, truncate, type NormalizedResult } from "./normalize";

const inputSchema = z.object({
  resourceUrl: z.string().url().describe("Full resource URL from search_data_sources"),
  method: z.enum(["GET", "POST"]).optional().describe("HTTP method (default GET)"),
  query: z.record(z.string(), z.string()).optional().describe("Query-string parameters"),
  body: z.record(z.string(), z.unknown()).optional().describe("JSON body for POST"),
});

export const bazaar = defineSource({
  id: "bazaar",
  name: "x402 Bazaar resource",
  description:
    "Call any x402 resource discovered via search_data_sources. Price is read from the resource's own 402 response and charged against the run's data budget.",
  category: "other",
  network: "eip155:8453",
  priceUsd: null,
  url: "https://x402.org/bazaar",
  experimental: true,
  inputSchema,
  async query(ctx, input): Promise<NormalizedResult> {
    const url = new URL(input.resourceUrl);
    for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, v);

    // Look up the advertised network so we pay from the right wallet when we can.
    let network = "eip155:8453";
    let priceUsd: number | null = null;
    try {
      const found = await searchDataSources({ query: url.hostname, urlSubstring: url.hostname, limit: 10 });
      const match = found.find((r) => r.resource.startsWith(url.origin));
      if (match) {
        network = match.network === "unknown" ? network : match.network;
        priceUsd = match.priceUsd;
      }
    } catch {
      // discovery is best-effort; the 402 is authoritative
    }

    const res = await paidFetch(ctx, {
      sourceId: bazaarSourceId(input.resourceUrl),
      url: url.toString(),
      method: input.method ?? (input.body ? "POST" : "GET"),
      ...(input.body ? { body: input.body } : {}),
      network,
      priceUsd,
      fixture: {
        _mock: true,
        note: "X402_MOCK=1 — no Bazaar resource was called.",
        resource: input.resourceUrl,
      },
    });

    return {
      summary: truncate(
        `${input.resourceUrl} responded${res.free ? " for free" : ` after a $${res.amountUsd.toFixed(4)} payment`}: ${JSON.stringify(res.data)}`,
        900,
      ),
      data: res.data,
    };
  },
});
