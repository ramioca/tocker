"use client";

import { useCallback } from "react";
import { base58 } from "@scure/base";
import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { useSendTransaction } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { USDC_MINT } from "@/lib/wallets/funding";
import { buildSolanaTransfer } from "@/lib/wallets/solana-transfer";
import type { Chain } from "@/server/types";

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC = USDC_MINT.base as `0x${string}`;

export const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface TransferRequest {
  chain: Chain;
  asset: "usdc" | "native";
  /** Human units. */
  amount: number;
  /** The receiving wallet — an agent's server wallet, or the user's own. */
  to: string;
}

export interface TransferResult {
  hash: string;
}

export interface UseTransfer {
  /** Signs and broadcasts from the user's embedded wallet. Throws on rejection. */
  send: (request: TransferRequest) => Promise<TransferResult>;
  /** False when Privy is not configured — the caller must fall back to copy-address. */
  available: boolean;
}

/**
 * Turn a Privy signing failure into a sentence a person can act on.
 *
 * Two of these are not really errors in our code at all, they are configuration, and
 * both look identical from the browser (a rejected signature) unless we name them:
 *
 *  - **Sponsorship is off for this app.** The bundle throws "Sponsoring transactions is
 *    only supported for wallets on the TEE stack" (or a message naming `sponsor`).
 *    Nothing the user does fixes it.
 *  - **The wallet is dry and nobody is paying.** With sponsorship off, a Solana wallet
 *    holding USDC and no SOL fails at simulation with "insufficient lamports" / "0x1".
 */
export function transferErrorMessage(err: unknown, chain: Chain): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  if (lower.includes("tee stack") || (lower.includes("sponsor") && !lower.includes("sponsored successfully"))) {
    return "Tocker asked Privy to pay this network fee for you and Privy refused: gas sponsorship is not enabled for this app. Nothing is wrong with your wallet — tell the operator to turn on fee sponsorship in the Privy dashboard.";
  }
  if (
    lower.includes("insufficient lamports") ||
    lower.includes("insufficient funds for fee") ||
    lower.includes("attempt to debit an account but found no record of a prior credit") ||
    lower.includes("0x1 ")
  ) {
    return chain === "solana"
      ? "Your Solana wallet has no SOL for the network fee. Deposit about 0.01 SOL and try again."
      : "Your Base wallet has no ETH for the network fee. Deposit a little ETH and try again.";
  }
  if (lower.includes("user rejected") || lower.includes("rejected the request") || lower.includes("cancel")) {
    return "You cancelled the signature. Nothing was sent.";
  }
  return raw || "The transfer could not be signed.";
}

/** True when the failure is the wallet being out of gas, not the user changing their mind. */
export function isNativeGasShortfall(err: unknown): boolean {
  const lower = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    lower.includes("insufficient lamports") ||
    lower.includes("insufficient funds for fee") ||
    lower.includes("attempt to debit an account but found no record of a prior credit")
  );
}

/**
 * One place that knows how to move USDC or gas out of the user's embedded
 * wallet, on either chain.
 *
 * Every signature happens in the browser with the user's own Privy wallet: the
 * server has no key and cannot move this money. That is also why funding is
 * best-effort at create time — a rejected popup leaves an agent that exists and
 * is honestly unfunded, not a half-written transaction.
 */
function usePrivyTransfer(): UseTransfer {
  const { sendTransaction } = useSendTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { wallets: solanaWallets } = useSolanaWallets();

  const send = useCallback(
    async (request: TransferRequest): Promise<TransferResult> => {
      if (!(request.amount > 0)) throw new Error("Nothing to send");
      if (!request.to) throw new Error("No destination address");

      if (request.chain === "base") {
        const payload =
          request.asset === "native"
            ? { to: request.to as `0x${string}`, value: parseEther(String(request.amount)) }
            : {
                to: BASE_USDC,
                data: encodeFunctionData({
                  abi: ERC20_TRANSFER_ABI,
                  functionName: "transfer",
                  args: [request.to as `0x${string}`, parseUnits(String(request.amount), 6)],
                }),
              };
        try {
          // `sponsor` is the *second* argument, not part of the transaction request —
          // `useSendTransaction(): sendTransaction(input, options?)` in
          // @privy-io/react-auth/dist/dts/index.d.ts:3417.
          const result = await sendTransaction({ ...payload, chainId: BASE_CHAIN_ID }, { sponsor: true });
          return { hash: result.hash };
        } catch (err) {
          throw new Error(transferErrorMessage(err, "base"), { cause: err });
        }
      }

      const wallet = solanaWallets[0];
      if (!wallet) {
        throw new Error("No Solana wallet is connected. Sync your wallets and try again.");
      }
      const transaction = await buildSolanaTransfer({
        from: wallet.address,
        to: request.to,
        asset: request.asset,
        amount: request.amount,
      });
      try {
        // Privy pays the fee. The agent's USDC account is pre-created server-side by the
        // platform wallet (`ensureAgentUsdcAta`), so the idempotent create instruction
        // below it is almost always a no-op — sponsorship covers the fee, never the rent.
        const { signature } = await signAndSendTransaction({
          transaction,
          wallet,
          options: { sponsor: true },
        });
        return { hash: base58.encode(signature) };
      } catch (err) {
        throw new Error(transferErrorMessage(err, "solana"), { cause: err });
      }
    },
    [sendTransaction, signAndSendTransaction, solanaWallets],
  );

  return { send, available: true };
}

function useUnavailableTransfer(): UseTransfer {
  const send = useCallback(async (): Promise<TransferResult> => {
    throw new Error("In-app transfers need Privy configured. Copy the address and send from any wallet.");
  }, []);
  return { send, available: false };
}

// Chosen once at module load: Privy's hooks throw outside a PrivyProvider, and
// that provider is absent exactly when there is no app id.
const useTransferImpl: () => UseTransfer = PRIVY_APP_ID ? usePrivyTransfer : useUnavailableTransfer;

export function useTransfer(): UseTransfer {
  return useTransferImpl();
}
