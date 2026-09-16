import type { Chain } from "@/server/types";

/**
 * Cheap, dependency-free shape checks that catch the withdrawal footgun that
 * matters: pasting a wrong-chain or truncated/typo'd address and sending funds
 * to a dead destination. This is not a full checksum validation — it exists to
 * stop an EVM address on Solana (and vice versa) before an irreversible send.
 */
const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0 O I l

export function isValidAddressForChain(chain: Chain, address: string): boolean {
  const value = address.trim();
  if (chain === "solana") return SOLANA.test(value);
  return EVM.test(value); // base + any other evm chain
}

export function addressHintForChain(chain: Chain): string {
  return chain === "solana"
    ? "That doesn't look like a Solana address."
    : "That doesn't look like a Base address (expected 0x…40 hex).";
}
