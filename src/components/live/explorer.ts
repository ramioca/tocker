import type { Chain } from "@/server/types";

/**
 * Block-explorer links.
 *
 * A receipt without a link to the chain is a claim; with one it is evidence, and
 * the first thing anyone does with their first live fill is go and look at it.
 */
const EXPLORERS: Record<Chain, { name: string; tx: (hash: string) => string; address: (addr: string) => string }> = {
  solana: {
    name: "Solscan",
    tx: (hash) => `https://solscan.io/tx/${hash}`,
    address: (addr) => `https://solscan.io/account/${addr}`,
  },
  base: {
    name: "Basescan",
    tx: (hash) => `https://basescan.org/tx/${hash}`,
    address: (addr) => `https://basescan.org/address/${addr}`,
  },
};

export function explorerName(chain: Chain): string {
  return EXPLORERS[chain].name;
}

/**
 * A transaction URL, or null when there is nothing worth linking to.
 *
 * Paper fills and Privy transfer ids are not chain transactions; linking them
 * would send the operator to an explorer 404 and make them doubt a real fill
 * later. Solana signatures are base58 (typically 87-88 chars) and EVM hashes are
 * 0x + 64 hex, so anything else is not a hash we should dress up as one.
 */
export function explorerTxUrl(chain: Chain, hash: string | null | undefined): string | null {
  if (!hash) return null;
  const value = hash.trim();
  if (!value || value.startsWith("paper") || value.startsWith("0xmocked")) return null;
  if (chain === "base") return /^0x[a-fA-F0-9]{64}$/.test(value) ? EXPLORERS.base.tx(value) : null;
  return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value) ? EXPLORERS.solana.tx(value) : null;
}

export function explorerAddressUrl(chain: Chain, address: string): string {
  return EXPLORERS[chain].address(address);
}
