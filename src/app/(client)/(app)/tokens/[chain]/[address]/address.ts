import { canonicalTokenAddress } from "@/server/queries/token-address";
import type { Chain } from "@/server/types";

/**
 * Is this a token address the page can mean? Anything else is a 404, not a full token
 * page offering "Score it" and "Block on…" for a string that can never be a token.
 *
 * - "native" is the book's own name for the chain's gas asset (Base ETH in
 *   KNOWN_TOKENS); trade tables link `/tokens/base/native`.
 * - Base: 0x + 40 hex, any case (EVM addresses are case-insensitive).
 * - Solana: base58 (no 0, O, I or l), 32–44 characters.
 */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isTokenAddress(chain: Chain, address: string): boolean {
  if (address === "native") return true;
  return chain === "base" ? EVM_ADDRESS.test(address) : SOLANA_ADDRESS.test(address);
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Where a token URL should be instead, or null when it is already there.
 *
 * A Base contract has one page, at its checksum spelling: `/tokens/base/0xabc…` and the
 * same address in any other case are the same token, and were two pages with different
 * scores and holders. The query string is kept, so a `?trade=…` link still lands on its
 * row. Same idea as `canonicalSlug` on /agents/[slug].
 */
export function canonicalTokenPath(chain: Chain, address: string, searchParams?: SearchParams): string | null {
  const canonical = canonicalTokenAddress(chain, address);
  if (canonical === address) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  return `/tokens/${chain}/${canonical}${query.size > 0 ? `?${query}` : ""}`;
}
