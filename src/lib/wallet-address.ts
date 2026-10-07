import { getAddress, isAddress } from "viem";
import { USDC_MINT } from "@/lib/wallets/funding";
// Constants only, from a file with no imports of its own: safe in the browser.
import { INFERENCE_GATEWAY } from "@/lib/x402/inference-types";
import type { Chain } from "@/server/types";

/**
 * Checks that catch the withdrawal footguns that matter before an irreversible send:
 * a wrong-chain address (EVM on Solana and vice versa), a truncated one, and on EVM a
 * one-character typo, which the EIP-55 checksum exists to catch. The send path encodes
 * the address with viem, and viem refuses a mixed-case address whose checksum is wrong;
 * accepting one here meant the confirmation step vouched for an address the app would
 * then refuse, after the hold, in viem's words.
 */
const EVM = /^0x[a-fA-F0-9]{40}$/;
const EVM_ZERO = /^0x0{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0 O I l

/** Shown when a mixed-case EVM address fails its checksum. */
export const CHECKSUM_TYPO =
  "This address has a typo: its capitalisation doesn't match its checksum. Copy it again from the source.";

/**
 * What is wrong with `address` as a destination on `chain`, in one sentence, or `null`
 * when nothing is. A single-case EVM address carries no checksum (EIP-55), so only a
 * mixed-case one is checked against it.
 */
export function addressProblemForChain(chain: Chain, address: string): string | null {
  const value = address.trim();
  if (chain === "solana") return SOLANA.test(value) ? null : addressHintForChain(chain);
  if (!EVM.test(value)) return addressHintForChain(chain);
  if (EVM_ZERO.test(value)) return "That's the zero address. Anything sent there is gone for good.";
  const body = value.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return null;
  return isAddress(value, { strict: true }) ? null : CHECKSUM_TYPO;
}

export function isValidAddressForChain(chain: Chain, address: string): boolean {
  return addressProblemForChain(chain, address) === null;
}

/** A name service handle (`.base.eth` ends in `.eth`). Nothing here resolves one. */
const NAME = /\.(?:sol|eth)$/i;

/** Shown when a withdrawal's destination is a name rather than an address. */
export const NAME_NOT_SUPPORTED = "Names like .sol or .eth aren't supported here. Paste the full wallet address.";

/** Shown when a withdrawal's destination is the USDC mint or contract. */
export const USDC_TOKEN_NOT_A_WALLET =
  "That's the USDC token itself, not a wallet. Paste the address of the wallet you want the USDC to arrive in.";

/** Shown when a withdrawal's destination is the address pay-per-use thinking is paid to. */
export const THINKING_PROVIDER_NOT_A_WALLET =
  "That's an address agents make payments to, not a wallet of yours, so a withdrawal can't be sent there. Paste the address of the wallet you want this to arrive in.";

/**
 * True for an address pay-per-use thinking is paid to (`INFERENCE_GATEWAY`): the
 * gateway's own, on any chain it is pinned for. Base58 is case-sensitive, so the
 * comparison is exact.
 */
export function isThinkingProviderAddress(address: string): boolean {
  const value = address.trim();
  return Object.values(INFERENCE_GATEWAY).some((gateway) => (gateway.payTo as readonly string[]).includes(value));
}

/**
 * What is wrong with `address` as the place a withdrawal on `chain` is sent, or `null`.
 *
 * Everything {@link addressProblemForChain} refuses, in more specific words where the
 * mistake has a name (the other chain's address, a .sol or .eth name), plus two addresses
 * that are well-formed and still never the owner's wallet:
 *
 *  - USDC itself, which the Deposit sheet puts on the clipboard with its own copy button;
 *  - the address pay-per-use thinking is paid to. Money an agent sends there outside a
 *    paid step is a gift to the provider, and it is more than that: every transfer from
 *    an agent's wallet to that address is expected to match a row in the thinking ledger,
 *    and one that matches none is taken as a payment the ledger missed, which stops
 *    pay-per-use for every agent until an admin has looked. A withdrawal must never be
 *    able to look like that.
 *
 * It only ever refuses more.
 *
 * Apart from `addressProblemForChain` because that one also checks token addresses (the
 * blocklist, the trade picker), where the USDC contract is a valid answer and nothing is
 * being withdrawn.
 */
export function destinationProblemForChain(chain: Chain, address: string): string | null {
  const value = address.trim();
  if (NAME.test(value)) return NAME_NOT_SUPPORTED;
  // Either chain's USDC, whichever is selected: "switch the chain" would be the wrong
  // advice for a token. Base58 is case-sensitive; hex is not.
  if (value === USDC_MINT.solana || value.toLowerCase() === USDC_MINT.base.toLowerCase()) {
    return USDC_TOKEN_NOT_A_WALLET;
  }
  // Before the wrong-chain sentences, for the same reason: switching the chain would
  // only lead here.
  if (isThinkingProviderAddress(value)) return THINKING_PROVIDER_NOT_A_WALLET;
  if (chain === "solana" && EVM.test(value)) {
    return "That's a Base (0x…) address. This withdrawal leaves on Solana. Paste a Solana address, or switch the chain to Base.";
  }
  if (chain === "base" && SOLANA.test(value)) {
    return "That's a Solana address. This withdrawal leaves on Base. Paste a 0x… address, or switch the chain to Solana.";
  }
  return addressProblemForChain(chain, value);
}

/**
 * The address as the chain's tooling wants it: EIP-55 checksummed on EVM (viem refuses
 * an all-uppercase one, which EIP-55 allows), trimmed on Solana. Call it on an address
 * {@link isValidAddressForChain} accepted.
 */
export function normalizeAddressForChain(chain: Chain, address: string): string {
  const value = address.trim();
  if (chain === "solana" || !EVM.test(value)) return value;
  return getAddress(value.toLowerCase());
}

export function addressHintForChain(chain: Chain): string {
  return chain === "solana"
    ? "That doesn't look like a Solana address."
    : "That doesn't look like a Base address (expected 0x…40 hex).";
}
