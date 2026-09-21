/**
 * Outbound links for a token. One place, so every surface that shows a token — a
 * proposal awaiting review, a position in the book, a trade row, the token page — sends
 * the reader to the same chart.
 */
import type { Chain } from "@/server/types";

const GECKO_NETWORK: Record<Chain, string> = { solana: "solana", base: "base" };

/** The wrapped native asset GeckoTerminal charts when the book says "native". */
const NATIVE_ON_GECKO: Record<Chain, string> = {
  solana: "So11111111111111111111111111111111111111112",
  base: "0x4200000000000000000000000000000000000006",
};

/** The token's GeckoTerminal page (pools, chart, holders). */
export function geckoTerminalUrl(chain: Chain, address: string): string {
  const target = address.toLowerCase() === "native" ? NATIVE_ON_GECKO[chain] : address;
  return `https://www.geckoterminal.com/${GECKO_NETWORK[chain]}/tokens/${encodeURIComponent(target)}`;
}
