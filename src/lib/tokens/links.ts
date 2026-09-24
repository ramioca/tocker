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

const TX_EXPLORER: Record<Chain, string> = {
  solana: "https://solscan.io/tx/",
  base: "https://basescan.org/tx/",
};

/**
 * The block explorer page for a transaction. The hash is encoded: it comes out of the
 * database, and a value with a `/`, `?` or `#` in it must not be able to steer the link
 * somewhere else on the explorer's host.
 */
export function txExplorerUrl(chain: Chain, txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  const base = TX_EXPLORER[chain];
  return base ? `${base}${encodeURIComponent(txHash)}` : null;
}

/**
 * Whether a stored explorer URL is one of ours. Receipts persist the URL as JSON, and an
 * `href` rendered from storage is one bad writer away from `javascript:` — so the UI
 * only links URLs on a known explorer origin and prints nothing clickable otherwise.
 */
export function isTrustedExplorerUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return Object.values(TX_EXPLORER).some((prefix) => url.startsWith(prefix));
}
