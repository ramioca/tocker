"use client";

import { useCallback } from "react";
import { base58, base64 } from "@scure/base";
import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { useSendTransaction } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { USDC_MINT } from "@/lib/wallets/funding";
import { buildSolanaTransfer } from "@/lib/wallets/solana-transfer";
import { prepareSponsoredFunding, submitSponsoredFunding } from "@/server/actions/wallets";
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
 * Three of these are not really errors in our code at all, they are configuration, and
 * all of them look identical from the browser (a rejected signature) unless we name them:
 *
 *  - **Tocker's own platform wallet cannot pay.** On Solana the fee payer is Tocker's
 *    platform wallet, not Privy's sponsor, so "we cannot sponsor this" is a sentence
 *    about an address the operator can top up. It arrives already written — pass it
 *    through untouched rather than translating it into something vaguer.
 *  - **Sponsorship is off for this app.** Base still asks Privy to sponsor; the bundle
 *    throws "Sponsoring transactions is only supported for wallets on the TEE stack"
 *    (or a message naming `sponsor`). Nothing the user does fixes it.
 *  - **The wallet is dry and nobody is paying.** A Solana wallet holding USDC and no SOL
 *    fails at simulation with "insufficient lamports" / "0x1" on the self-paid path.
 */
export function transferErrorMessage(err: unknown, chain: Chain): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  // Verbatim: it already names the wallet and the SOL it is short of, which is the only
  // information that leads anywhere.
  if (lower.includes("platform solana wallet") || lower.includes("platform wallet")) return raw;

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

/** A Solana wallet as `useWallets()` hands it over — enough to pass to a signing hook. */
type SolanaWallet = ReturnType<typeof useSolanaWallets>["wallets"][number];

/**
 * One place that knows how to move USDC or gas out of the user's embedded
 * wallet, on either chain.
 *
 * Every signature happens in the browser with the user's own Privy wallet: the
 * server has no key and cannot move this money. That is also why funding is
 * best-effort at create time — a rejected popup leaves an agent that exists and
 * is honestly unfunded, not a half-written transaction.
 *
 * ## Who pays the network fee, per chain
 *
 * **Base** asks Privy to sponsor, which depends on fee sponsorship being enabled for the
 * app in Privy's dashboard.
 *
 * **Solana** does not, because Privy's Solana gas model is not a sponsor flag: the app
 * runs a fee-payer wallet, builds the transaction with `payerKey` set to it, the user
 * partially signs, and the backend adds its signature and broadcasts. Tocker already
 * runs that wallet, so a USDC-funding transfer here is `prepareSponsoredFunding` →
 * `signTransaction` (sign only — the user's wallet cannot broadcast what it cannot pay
 * for) → `submitSponsoredFunding`. The old self-paid `signAndSendTransaction` path is
 * kept for everything that is not a funding transfer (a withdrawal to an exchange, a
 * SOL transfer) and as the fallback when the platform wallet itself is dry.
 */
function usePrivyTransfer(): UseTransfer {
  const { sendTransaction } = useSendTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const { wallets: solanaWallets } = useSolanaWallets();

  /**
   * The self-paid Solana path: the user's own wallet is the fee payer.
   *
   * `sponsorFailure` is set only when we got here because Tocker's platform wallet could
   * not pay. If the user's wallet turns out to be dry as well, that message — not the
   * RPC's "insufficient lamports" — is the one that says what to do, because the wallet
   * the operator has to fund is Tocker's, not theirs.
   */
  const sendSelfPaid = useCallback(
    async (
      request: TransferRequest,
      wallet: SolanaWallet,
      sponsorFailure: string | null,
    ): Promise<TransferResult> => {
      const transaction = await buildSolanaTransfer({
        from: wallet.address,
        to: request.to,
        asset: request.asset,
        amount: request.amount,
      });
      try {
        // No `sponsor` option: on Solana that was a request Privy never honoured for
        // this app, and asking for it only turned a dry wallet into a confusing error.
        const { signature } = await signAndSendTransaction({ transaction, wallet });
        return { hash: base58.encode(signature) };
      } catch (err) {
        if (sponsorFailure && isNativeGasShortfall(err)) {
          throw new Error(sponsorFailure, { cause: err });
        }
        throw new Error(transferErrorMessage(err, "solana"), { cause: err });
      }
    },
    [signAndSendTransaction],
  );

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

      // Only USDC into an agent's wallet is sponsored. Sending SOL means the wallet
      // already holds SOL, and a transfer to anywhere else is not Tocker's fee to pay.
      if (request.asset !== "usdc") return sendSelfPaid(request, wallet, null);

      const prepared = await prepareSponsoredFunding({ toAddress: request.to, amount: request.amount });
      if (!prepared.ok) {
        // Not a sponsorable destination (a withdrawal, a stranger's address) — or an
        // ownership check the user cannot argue with. Either way, they pay for it.
        return sendSelfPaid(request, wallet, null);
      }
      if (!prepared.data.sponsored) {
        // Tocker's own wallet is short. The user may still be able to pay; if they
        // cannot either, they are shown the operator's message rather than a raw one.
        return sendSelfPaid(request, wallet, prepared.data.message);
      }

      const plan = prepared.data;
      if (plan.from !== wallet.address) {
        throw new Error(
          "The Solana wallet in your browser is not the one Tocker has on record for you. Sync your wallets from Settings and try again.",
        );
      }

      let signed: string;
      try {
        // Sign, not sign-and-send: the fee payer is Tocker's wallet, so this transaction
        // is not complete until the server adds the second signature.
        const { signedTransaction } = await signTransaction({
          transaction: base64.decode(plan.transaction),
          wallet,
        });
        signed = base64.encode(signedTransaction);
      } catch (err) {
        throw new Error(transferErrorMessage(err, "solana"), { cause: err });
      }

      const sent = await submitSponsoredFunding({
        toAddress: request.to,
        amount: request.amount,
        signedTransaction: signed,
      });
      if (!sent.ok) throw new Error(transferErrorMessage(new Error(sent.error), "solana"));
      return { hash: sent.data.hash };
    },
    [sendSelfPaid, sendTransaction, signTransaction, solanaWallets],
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
