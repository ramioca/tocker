/**
 * One Base contract, one token page.
 *
 * An EVM address means the same thing in any letter-case, but every row about a token
 * is keyed by `${chain}:${address}` as whoever wrote it spelled it: discovery lowercases
 * Base addresses, the known-token list and block explorers use the EIP-55 checksum, and
 * a trade stores whatever spelling it was placed with. So `/tokens/base/0xabc…` and
 * `/tokens/base/0xAbC…` were two pages: one with the holders and fills, the other with
 * a different score and "No agent holds this".
 *
 * Nothing stored is rewritten. The page lives at one spelling (the checksum, see
 * {@link canonicalTokenAddress}) and reads the rows under every spelling
 * ({@link tokenAddressSpellings}). Solana mints are base58 and case-sensitive, and
 * "native" is a name, not an address: both pass through untouched.
 *
 * Pure, with no database import, so the route can use it without the query module.
 */
import { getAddress } from "viem";
import type { Chain } from "@/server/types";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True for an address whose letter-case carries no meaning: a Base contract. */
export function isCaseInsensitiveAddress(chain: Chain, address: string): boolean {
  return chain === "base" && EVM_ADDRESS.test(address);
}

/**
 * The spelling the token page lives at. A function of the address alone, never of what
 * happens to be stored, so the permanent redirect to it can never point back the other
 * way once a browser has cached it.
 */
export function canonicalTokenAddress(chain: Chain, address: string): string {
  // Lowercased first: viem refuses a mixed-case address whose checksum is wrong, and a
  // wrong-case URL is exactly what is being put right here.
  return isCaseInsensitiveAddress(chain, address) ? getAddress(address.toLowerCase()) : address;
}

/**
 * Every spelling a row about this token is likely to be stored under, canonical first:
 * the checksum, all lowercase, and the one given.
 */
export function tokenAddressSpellings(chain: Chain, address: string): string[] {
  if (!isCaseInsensitiveAddress(chain, address)) return [address];
  return [...new Set([canonicalTokenAddress(chain, address), address.toLowerCase(), address])];
}

/** {@link tokenAddressSpellings} as token ids. */
export function tokenIdSpellings(chain: Chain, address: string): string[] {
  return tokenAddressSpellings(chain, address).map((spelling) => `${chain}:${spelling}`);
}
