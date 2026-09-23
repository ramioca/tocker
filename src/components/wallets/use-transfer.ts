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
import { prepareSponsoredWithdrawal, submitSponsoredWithdrawal } from "@/server/actions/sponsored-withdraw";
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
  /** The receiving wallet — an agent's server wallet, or any address for a withdrawal. */
  to: string;
  /**
   * What this transfer is for, which on Solana decides how Tocker pays its fee.
   *
   *  - `"fund"` (the default): USDC into one of the user's own agents. The server checks
   *    the destination is an agent the session owns.
   *  - `"withdraw"`: USDC out to any Solana address. The recipient may need a USDC
   *    account opened, which carries a small one-time USDC fee the withdraw modal shows
   *    before the hold-to-confirm.
   */
  purpose?: "fund" | "withdraw";
  /**
   * Withdrawals only: the most USDC the user agreed to pay for opening the recipient's
   * account — the fee they were shown. A fee above it at send time stops the withdrawal
   * rather than charging something nobody saw.
   */
  maxFeeUsdc?: number;
}

export interface TransferResult {
  hash: string;
  /** Solana withdrawals only: the one-time account fee that was taken, in USDC. */
  feeUsdc?: number;
  /**
   * Sponsored Solana transfers only: the broadcast failed without proving the network
   * never got it, and it had not landed when the server last looked. It can still land
   * for about a minute. Say so — never "nothing moved", and never invite a resend
   * before the balance has had time to show it.
   */
  uncertain?: boolean;
}

export interface UseTransfer {
  /** Signs and broadcasts from the user's embedded wallet. Throws on rejection. */
  send: (request: TransferRequest) => Promise<TransferResult>;
  /** False when Privy is not configured — the caller must fall back to copy-address. */
  available: boolean;
}

/** Stops the send when the account fee went up between the quote and the send. */
const FEE_TOLERANCE_USDC = 0.005;

/**
 * Turn a Privy signing failure into a sentence a person can act on.
 *
 * Nobody using Tocker holds gas. Base fees are sponsored through Privy; Solana fees are
 * paid by Tocker's own fee wallet. So a fee failure is never "go and get SOL" (or ETH):
 *
 *  - **Tocker's own fee wallet cannot pay.** The server already wrote that sentence
 *    ("Tocker's fee wallet is refilling — try again in a minute") and it arrives here
 *    untouched: it names the only thing that fixes it, which is waiting.
 *  - **Sponsorship is off for this app.** Base asks Privy to sponsor; the bundle throws
 *    "Sponsoring transactions is only supported for wallets on the TEE stack" (or a
 *    message naming `sponsor`). Nothing the user does fixes it.
 *  - **A fee shortfall on a sponsored transfer** is Tocker's wallet being short, and
 *    reads as a retry.
 *  - **A native send the wallet cannot cover** (someone sending the SOL or ETH they
 *    actually hold) is about the amount, not about gas: send a little less.
 */
export function transferErrorMessage(
  err: unknown,
  chain: Chain,
  asset: TransferRequest["asset"] = "usdc",
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  // Verbatim: written by the server about Tocker's own fee wallet, and already says
  // what to do.
  if (lower.includes("fee wallet") || lower.includes("platform solana wallet") || lower.includes("platform wallet")) {
    return raw;
  }

  if (lower.includes("tee stack") || (lower.includes("sponsor") && !lower.includes("sponsored successfully"))) {
    return "Tocker couldn't cover this network fee: fee sponsorship is not enabled for this app yet. Nothing was sent and nothing is wrong with your wallet — the operator has to switch it on.";
  }
  if (isNativeGasShortfall(err) || lower.includes("0x1 ")) {
    if (asset === "native") {
      return chain === "solana"
        ? "That's more SOL than this wallet can send once the network fee is set aside. Try a slightly smaller amount."
        : "That's more ETH than this wallet can send once the network fee is set aside. Try a slightly smaller amount.";
    }
    return "Tocker couldn't cover the network fee this time. Nothing was sent — try again in a minute.";
  }
  if (lower.includes("user rejected") || lower.includes("rejected the request") || lower.includes("cancel")) {
    return "You cancelled the signature. Nothing was sent.";
  }
  return raw || "The transfer could not be signed.";
}

/** True when the failure is a wallet being out of gas, not the user changing their mind. */
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

const WRONG_WALLET =
  "The Solana wallet in your browser is not the one Tocker has on record for you. Sync your wallets from Settings and try again.";

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

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
 * **Solana** is paid by Tocker's own fee wallet on every USDC transfer, because Privy's
 * Solana gas model is not a sponsor flag: the app runs a fee-payer wallet, the server
 * builds the transaction with `payerKey` set to it, the user signs only
 * (`signTransaction` — their wallet cannot broadcast what it cannot pay for), and the
 * server validates, co-signs and broadcasts:
 *
 *  - funding an agent: `prepareSponsoredFunding` → sign → `submitSponsoredFunding`;
 *  - withdrawing anywhere: `prepareSponsoredWithdrawal` → sign → `submitSponsoredWithdrawal`.
 *
 * There is no self-paid fallback for USDC: the user's wallet has no SOL, and a failure
 * to sponsor is Tocker's to fix, not theirs. The self-paid `signAndSendTransaction`
 * path remains only for sending native SOL — a user who holds SOL may send it.
 */
function usePrivyTransfer(): UseTransfer {
  const { sendTransaction } = useSendTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const { wallets: solanaWallets } = useSolanaWallets();

  /** Native SOL only: the user's own wallet is the fee payer of the SOL it sends. */
  const sendNativeSol = useCallback(
    async (request: TransferRequest, wallet: SolanaWallet): Promise<TransferResult> => {
      const transaction = await buildSolanaTransfer({
        from: wallet.address,
        to: request.to,
        asset: "native",
        amount: request.amount,
      });
      try {
        const { signature } = await signAndSendTransaction({ transaction, wallet });
        return { hash: base58.encode(signature) };
      } catch (err) {
        throw new Error(transferErrorMessage(err, "solana", "native"), { cause: err });
      }
    },
    [signAndSendTransaction],
  );

  /** The user's half of a sponsored transaction: sign the server's bytes, never send them. */
  const signPrepared = useCallback(
    async (transactionBase64: string, wallet: SolanaWallet): Promise<string> => {
      try {
        const { signedTransaction } = await signTransaction({
          transaction: base64.decode(transactionBase64),
          wallet,
        });
        return base64.encode(signedTransaction);
      } catch (err) {
        throw new Error(transferErrorMessage(err, "solana"), { cause: err });
      }
    },
    [signTransaction],
  );

  const sendFunding = useCallback(
    async (request: TransferRequest, wallet: SolanaWallet): Promise<TransferResult> => {
      const prepared = await prepareSponsoredFunding({ toAddress: request.to, amount: request.amount });
      if (!prepared.ok) throw new Error(prepared.error);
      // The server no longer answers "sponsored: false" — a platform that cannot pay is
      // an error with its own sentence — but the type still allows it.
      if (!prepared.data.sponsored) throw new Error(prepared.data.message);

      const plan = prepared.data;
      if (plan.from !== wallet.address) throw new Error(WRONG_WALLET);

      const signed = await signPrepared(plan.transaction, wallet);
      const sent = await submitSponsoredFunding({
        toAddress: request.to,
        // The amount the transaction was actually built for, not the one we asked for:
        // the server validates the signed bytes against this number, so submitting
        // anything else can only ever be a mismatch it refuses to sign.
        amount: plan.expectedAmount,
        signedTransaction: signed,
      });
      // Not run through `transferErrorMessage`: the server already wrote these in plain
      // language, and the fee payer was Tocker's wallet, not the user's.
      if (!sent.ok) throw new Error(sent.error);
      return { hash: sent.data.hash, uncertain: sent.data.uncertain };
    },
    [signPrepared],
  );

  const sendWithdrawal = useCallback(
    async (request: TransferRequest, wallet: SolanaWallet): Promise<TransferResult> => {
      const prepared = await prepareSponsoredWithdrawal({ toAddress: request.to, amount: request.amount });
      if (!prepared.ok) throw new Error(prepared.error);

      const plan = prepared.data;
      if (plan.from !== wallet.address) throw new Error(WRONG_WALLET);
      const agreed = request.maxFeeUsdc ?? 0;
      if (plan.feeUsdc > agreed + FEE_TOLERANCE_USDC) {
        throw new Error(
          agreed > 0
            ? `Opening the recipient's USDC account now costs ${usd(plan.feeUsdc)}, not the ${usd(agreed)} shown. Nothing was sent — check the new fee and hold again.`
            : `This address has never held USDC, so its account has to be opened for a one-time ${usd(plan.feeUsdc)} fee. Nothing was sent — check the fee and hold again.`,
        );
      }

      const signed = await signPrepared(plan.transaction, wallet);
      const sent = await submitSponsoredWithdrawal({
        toAddress: request.to,
        amount: plan.amount,
        feeUsdc: plan.feeUsdc,
        signedTransaction: signed,
      });
      if (!sent.ok) throw new Error(sent.error);
      return { hash: sent.data.hash, feeUsdc: sent.data.feeUsdc, uncertain: sent.data.uncertain };
    },
    [signPrepared],
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
          throw new Error(transferErrorMessage(err, "base", request.asset), { cause: err });
        }
      }

      const wallet = solanaWallets[0];
      if (!wallet) {
        throw new Error("No Solana wallet is connected. Sync your wallets and try again.");
      }

      if (request.asset === "native") return sendNativeSol(request, wallet);
      if (request.purpose === "withdraw") return sendWithdrawal(request, wallet);
      return sendFunding(request, wallet);
    },
    [sendFunding, sendNativeSol, sendTransaction, sendWithdrawal, solanaWallets],
  );

  return { send, available: true };
}

function useUnavailableTransfer(): UseTransfer {
  const send = useCallback(async (): Promise<TransferResult> => {
    throw new Error("In-app transfers are not available in this environment. Copy the address and send from any wallet.");
  }, []);
  return { send, available: false };
}

// Chosen once at module load: Privy's hooks throw outside a PrivyProvider, and
// that provider is absent exactly when there is no app id.
const useTransferImpl: () => UseTransfer = PRIVY_APP_ID ? usePrivyTransfer : useUnavailableTransfer;

export function useTransfer(): UseTransfer {
  return useTransferImpl();
}
