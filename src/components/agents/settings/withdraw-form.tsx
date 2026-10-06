"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { formatUsd, truncateAddress } from "@/components/common/format";
import { FullAddress } from "@/components/common/address";
import { useRefreshCash, useUserWallets } from "@/components/wallets/use-cash";
import { useSession } from "@/hooks/use-session";
import { previewAgentWithdrawalAction, secureWithdrawAction } from "@/server/actions/security";
import { txExplorerUrl } from "@/lib/tokens/links";
import { destinationProblemForChain, normalizeAddressForChain } from "@/lib/wallet-address";
import {
  MIN_SOL_SEND,
  NATIVE_SYMBOL,
  NETWORK_WORDING,
  chainLabelFor,
  hasLeftoverNative,
  nativeKeptBack,
  userFacingTransferError,
  withdrawableNative,
} from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain, WalletBalance } from "@/server/types";
import { useWalletBalances, walletBalancesKey } from "./wallets-card";

/** A stable empty list, so the memos below do not recompute on every render. */
const NO_BALANCES: WalletBalance[] = [];
/** A withdrawal that was only submitted lands later: look again once it has had time. */
const LATE_BALANCE_CHECKS_MS = [12_000, 45_000] as const;
/** Below this, open positions are dust and not worth a line under the amount. */
const POSITIONS_WORTH_MENTIONING_USD = 1;

type Asset = "usdc" | "native";

/** The server's answer to "what would this withdrawal do": what arrives, and what is settled beside it. */
interface WithdrawalBreakdown {
  delivered: number;
  accountFeeUsdc: number;
  tradingFeesUsdc: number;
}

/**
 * One withdrawal as it was put to the owner at Review. Confirm sends this and nothing
 * else: the form's own values are derived from balances that refetch on their own, and
 * the asset or the address under a confirm step must not be able to change after it was
 * read.
 */
interface ReviewedWithdrawal {
  chain: Chain;
  asset: Asset;
  /** As typed, for the row and the button. */
  amountText: string;
  amount: number;
  to: string;
  toOwnCash: boolean;
  /** Solana USDC only; null on Base and for leftover SOL, where what is typed is what moves. */
  breakdown: WithdrawalBreakdown | null;
}
/** Where the withdrawal goes: the owner's own Tocker wallet on this chain, or an address they paste. */
type SendTo = "cash" | "address";

/** Hydration never changes after it happens, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

function assetAmount(balances: WalletBalance[], chain: Chain, asset: Asset): number | null {
  const wallet = balances.find((w) => w.chain === chain);
  if (!wallet) return null;
  // By symbol, not "whatever is not USDC": a wallet row list can carry other tokens, and
  // the first of those is not the chain's native asset.
  const symbol = asset === "usdc" ? "usdc" : NATIVE_SYMBOL[chain].toLowerCase();
  const row = wallet.balances.find((b) => b.asset.toLowerCase() === symbol);
  return row ? row.amount : 0;
}

/**
 * The chain to open on: where the agent's USDC is. A two-chain agent used to open on
 * `chains[0]` whatever it held, which could be the wallet with nothing in it.
 */
function richestChain(agent: AgentDetail, balances: WalletBalance[]): Chain {
  let best: Chain = agent.chains[0] ?? "base";
  let most = 0;
  for (const wallet of agent.wallets) {
    const usdc = assetAmount(balances, wallet.chain, "usdc") ?? 0;
    if (usdc > most) {
      most = usdc;
      best = wallet.chain;
    }
  }
  return best;
}

/** A balance as the Max button and the chain picker print it. */
function balanceText(amount: number, asset: Asset): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: asset === "native" ? 6 : 4 });
}

/**
 * An amount that moved, to the precision it moved at: the audit row prints the same
 * figure, and a receipt that rounds it would disagree with the log by a fraction of a cent.
 */
function movedText(amount: number, asset: Asset): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: asset === "usdc" ? 2 : 0,
    maximumFractionDigits: asset === "usdc" ? 6 : 9,
  });
}

/** "USDC", or the chain's own asset for a leftover withdrawal. */
function symbolOf(withdrawal: { chain: Chain; asset: Asset }): string {
  return withdrawal.asset === "usdc" ? "USDC" : NATIVE_SYMBOL[withdrawal.chain];
}

/**
 * What a planned withdrawal takes out of the agent: what arrives plus what is settled
 * beside it. Rounded to USDC's six decimals, so three figures that add up on screen do
 * not print a float's sixteenth digit.
 */
function leavesAgent(plan: WithdrawalBreakdown): number {
  return Math.round((plan.delivered + plan.accountFeeUsdc + plan.tradingFeesUsdc) * 1e6) / 1e6;
}

export function WithdrawForm({
  agent,
  balances: initialBalances,
  perTxUsd = null,
}: {
  agent: AgentDetail;
  balances?: WalletBalance[];
  /**
   * The agent's wallet-layer cap on one USDC transfer, when it has one. Above it the
   * server only sends to the owner's own Tocker wallet; the form says so before Review
   * instead of after Confirm. The server stays the authority.
   */
  perTxUsd?: number | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refreshCash = useRefreshCash();
  // The same query the Money strip and the Agent wallets card read, with the server's
  // figures as its first paint: one number on the page, and Max is never worked out from
  // a prop that predates the last withdrawal.
  const { data: liveBalances } = useWalletBalances(agent.id, initialBalances);
  const balances = liveBalances ?? initialBalances ?? NO_BALANCES;
  const { ready, session } = useSession();
  // Already warm on this page — the wallet chip in the top bar uses the same query key.
  const { data: mine, isPending: mineLoading } = useUserWallets(Boolean(ready && session));
  const [chain, setChain] = useState<Chain>(() => richestChain(agent, balances));
  const [asset, setAsset] = useState<Asset>("usdc");
  const [amount, setAmount] = useState("");
  // Null until the owner picks: the default is their own Tocker cash, which is where
  // nearly every withdrawal out of an agent is headed.
  const [sendToChoice, setSendToChoice] = useState<SendTo | null>(null);
  const [toAddress, setToAddress] = useState("");
  const [pending, setPending] = useState(false);
  // Set while the confirm step is showing; null on the form.
  const [reviewed, setReviewed] = useState<ReviewedWithdrawal | null>(null);
  // Solana only: Review opens on the server's figures, or not at all (see `review`).
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<{ inputs: string; message: string } | null>(null);

  // The late balance checks outlive the click that scheduled them, not the page.
  const lateChecks = useRef<number[]>([]);
  useEffect(() => {
    const timers = lateChecks.current;
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  /** The user's own embedded wallet on this chain — where a withdrawal normally goes. */
  const myAddress = useMemo(
    () => (mine?.wallets ?? []).find((wallet) => wallet.chain === chain && wallet.address)?.address ?? null,
    [mine, chain],
  );
  // Known to be missing, as opposed to not loaded yet: only then is the choice taken away.
  // Not before hydration either: the wallet query can already be warm in the browser
  // (the top bar's chip shares it) while the server rendered it as still loading, and
  // the first client render has to draw what the server drew.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const cashUnavailable = hydrated && myAddress === null && !mineLoading;
  const sendTo: SendTo = cashUnavailable ? "address" : (sendToChoice ?? "cash");

  // USDC is the only thing an agent is ever funded with. SOL or ETH shows up only as a
  // leftover — someone sent some, or it predates Tocker paying every fee — and the form
  // offers it only when there is enough of it to be worth a withdrawal.
  //
  // On Solana the last AGENT_SOL_KEPT stays behind: an agent that pays its own fee is
  // topped up from Tocker's wallet first, and that SOL is not the owner's to take. Offering
  // it would make "withdraw a cent, then withdraw the leftover SOL" a one-click loop that
  // empties the platform's fee wallet a drip at a time.
  const nativeBalance = useMemo(() => assetAmount(balances, chain, "native"), [balances, chain]);
  const leftoverNative = withdrawableNative(chain, nativeBalance);
  const keptNative = nativeKeptBack(chain);
  const offerNative = hasLeftoverNative(leftoverNative);
  const selected: Asset = offerNative ? asset : "usdc";
  const assetLabel = selected === "usdc" ? "USDC" : NATIVE_SYMBOL[chain];
  const usdcAvailable = useMemo(() => assetAmount(balances, chain, "usdc"), [balances, chain]);
  const available = selected === "usdc" ? usdcAvailable : leftoverNative;
  const amountNum = Number(amount);
  /** A SOL withdrawal whose remainder stays with the agent — and pays the fee from there. */
  const keepsNative = selected === "native" && keptNative > 0;

  // In cash mode the destination is the owner's wallet as the server recorded it, never
  // something typed.
  const destination = sendTo === "cash" ? (myAddress ?? "") : toAddress.trim();
  // Checksum included: a mixed-case Base address with one wrong letter says so here.
  const addressProblem =
    sendTo === "address" && toAddress.trim().length > 0 ? destinationProblemForChain(chain, toAddress) : null;
  const addressValid = addressProblem === null;
  const overBalance = available !== null && amount.length > 0 && amountNum > available;
  // Solana will not credit a fresh wallet with less than its rent-exempt minimum.
  const belowSolMinimum =
    selected === "native" && chain === "solana" && amount.length > 0 && amountNum > 0 && amountNum < MIN_SOL_SEND;
  const canReview =
    amount.length > 0 &&
    amountNum > 0 &&
    !overBalance &&
    !belowSolMinimum &&
    destination.length > 0 &&
    addressValid;

  // Above the wallet cap the server only sends to the owner's own Tocker wallet. Said as
  // the amount is typed; the check at Review is what refuses it.
  const overCap =
    chain === "solana" &&
    selected === "usdc" &&
    sendTo === "address" &&
    perTxUsd !== null &&
    amount.length > 0 &&
    amountNum > perTxUsd;

  // A refusal belongs to the inputs it was given for. Anything typed since makes it
  // stale, which is simply "not current": nothing to reset on every keystroke.
  const inputs = `${chain}|${selected}|${amount}|${destination}`;
  const refused = refusal?.inputs === inputs ? refusal.message : null;

  /**
   * Opens Review. On Solana the server plans the withdrawal first, so the confirm step
   * shows what will arrive and what is settled beside it (a Solana USDC withdrawal also
   * pays the Tocker trading fees the agent owes, and a one-time fee when the recipient
   * has never held USDC), and a withdrawal the server would refuse (over the cap to an
   * outside address, a token account, under the minimum, nothing left after fees) is
   * refused here instead of after Confirm. Nothing is signed. Base has no planner and no
   * such deductions.
   */
  const review = async () => {
    if (!canReview || checking) return;
    const draft = { chain, asset: selected, amountText: amount, amount: amountNum, to: destination, toOwnCash: sendTo === "cash" };
    if (draft.chain !== "solana") {
      setReviewed({ ...draft, breakdown: null });
      return;
    }
    setChecking(true);
    try {
      const result = await previewAgentWithdrawalAction({
        agentId: agent.id,
        asset: draft.asset,
        amount: draft.amount,
        toAddress: draft.to,
      });
      if (result.ok) {
        setRefusal(null);
        setReviewed({ ...draft, breakdown: draft.asset === "usdc" ? result.data : null });
      } else {
        // The same treatment a failed withdrawal gets below.
        setRefusal({
          inputs,
          message:
            draft.asset === "native" ? result.error : userFacingTransferError(result.error, draft.chain, draft.asset),
        });
      }
    } catch {
      setRefusal({
        inputs,
        message: "Couldn't reach Tocker to check this withdrawal. Nothing was sent. Check your connection and try again.",
      });
    } finally {
      setChecking(false);
    }
  };

  // "Balance" is USDC only. A live agent's open positions are money too, and none of it
  // can leave until they are sold.
  const openPositions = agent.mode === "live" ? agent.positions.filter((position) => (position.valueUsd ?? 0) > 0) : [];
  const positionsUsd = openPositions.reduce((sum, position) => sum + (position.valueUsd ?? 0), 0);

  /**
   * Goes through `secureWithdrawAction`: it re-checks ownership, re-validates the address
   * against the chosen chain before anything is signed (a Base address pasted into a
   * Solana withdrawal is money gone) and writes an audit row with the amount, the
   * destination and the resulting transaction hash.
   */
  const send = async () => {
    // What Review showed. Nothing below reads the form.
    if (!reviewed) return;
    const sending = reviewed;
    setPending(true);
    let result: Awaited<ReturnType<typeof secureWithdrawAction>>;
    try {
      result = await secureWithdrawAction({
        agentId: agent.id,
        chain: sending.chain,
        asset: sending.asset,
        amount: sending.amount,
        toAddress: normalizeAddressForChain(sending.chain, sending.to),
      });
    } catch {
      // The request itself failed (network drop, deploy): the server may or may not
      // have signed. Say so rather than leaving the button on "Sending…" forever.
      toast.error("Withdrawal status unknown", {
        description: "The connection dropped before Tocker answered. Check the wallet balance and the audit log before retrying.",
      });
      return;
    } finally {
      setPending(false);
    }

    if (!result.ok) {
      // Never the server's raw text for USDC: a fee failure there can still read "send SOL
      // to the platform wallet", which is Tocker's to fix and never the owner's. The raw
      // message is in the server log and the audit trail.
      //
      // A leftover SOL or ETH withdrawal is shown as the server wrote it. Its refusals are
      // about amounts and name the asset ("Send at least 0.001 SOL"), which the fee
      // classifier reads as a fee failure and rewrites into "try again in a minute"; real
      // fee failures already arrive from the server as finished sentences.
      toast.error("Withdrawal failed", {
        description:
          sending.asset === "native" ? result.error : userFacingTransferError(result.error, sending.chain, sending.asset),
      });
      return;
    }

    // W7 H12: `txHash` is null until a step broadcasts, and `pending` is not `sent`.
    // The action id used to be printed here as if it were a signature — it is not one,
    // and no explorer will find it.
    const { txHash, status, delivered, accountFeeUsdc = 0, tradingFeesUsdc = 0 } = result.data;
    const explorer = txExplorerUrl(sending.chain, txHash);
    const view = explorer
      ? { action: { label: "View", onClick: () => window.open(explorer, "_blank", "noopener,noreferrer") } }
      : {};
    const symbol = symbolOf(sending);
    if (status === "succeeded") {
      // What arrived, which is not always what was typed: the server settles the agent's
      // trading fees and a new recipient's account fee in the same transaction. Base
      // carries no such figures, so the amount asked for is the amount sent.
      const parts = [
        `${movedText(delivered ?? sending.amount, sending.asset)} ${symbol} arrived ${
          sending.toOwnCash ? "in your Tocker cash" : `at ${truncateAddress(sending.to, 4, 4)}`
        }.`,
      ];
      if (tradingFeesUsdc > 0) parts.push(`${movedText(tradingFeesUsdc, "usdc")} USDC of Tocker trading fees were settled.`);
      if (accountFeeUsdc > 0) parts.push(`${movedText(accountFeeUsdc, "usdc")} USDC opened the recipient's USDC account.`);
      // Longer than the default four seconds: it carries figures someone will want to read.
      toast.success("Withdrawal confirmed", { description: parts.join(" "), duration: 10_000, ...view });
    } else {
      toast.message("Withdrawal submitted", {
        description: "Waiting for the network to confirm. Balances update on their own.",
        ...view,
      });
    }
    setAmount("");
    setToAddress("");
    setSendToChoice(null);
    setReviewed(null);
    // Every balance on screen, not only this card's: the Money strip and the Agent wallets
    // card read the query (a server refresh does not reach it), and the top bar's cash is
    // where the money just went. Twice for cash, because a confirmation is not instant.
    const refreshAgent = () => void queryClient.invalidateQueries({ queryKey: walletBalancesKey(agent.id) });
    refreshAgent();
    void refreshCash();
    void refreshCash(12_000);
    if (status !== "succeeded") {
      for (const delay of LATE_BALANCE_CHECKS_MS) lateChecks.current.push(window.setTimeout(refreshAgent, delay));
    }
    // The Danger zone reads the server prop.
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <ArrowDownToLine aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Withdraw</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Move USDC out of this agent&apos;s wallet, back to your Tocker cash or to another address. The agent keeps
        trading with what is left. Every withdrawal is recorded in your{" "}
        <Link href="/settings/security" className="text-foreground underline underline-offset-2">
          audit log
        </Link>
        .
      </p>

      {reviewed ? (
        <div className="mt-3 space-y-3">
          <dl className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            {reviewed.breakdown ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Arrives</dt>
                  <dd className="tnum font-mono font-medium">{movedText(reviewed.breakdown.delivered, "usdc")} USDC</dd>
                </div>
                {reviewed.breakdown.tradingFeesUsdc > 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Tocker trading fees settled</dt>
                    <dd className="tnum font-mono">{movedText(reviewed.breakdown.tradingFeesUsdc, "usdc")} USDC</dd>
                  </div>
                ) : null}
                {reviewed.breakdown.accountFeeUsdc > 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">New account fee (one time)</dt>
                    <dd className="tnum font-mono">{movedText(reviewed.breakdown.accountFeeUsdc, "usdc")} USDC</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Leaves the agent</dt>
                  <dd className="tnum font-mono">{movedText(leavesAgent(reviewed.breakdown), "usdc")} USDC</dd>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="tnum font-mono font-medium">
                  {reviewed.amountText} {symbolOf(reviewed)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Network</dt>
              <dd>{chainLabelFor(reviewed.chain)}</dd>
            </div>
            {reviewed.asset === "native" && nativeKeptBack(reviewed.chain) > 0 ? (
              // The agent pays this fee itself, out of the SOL that stays behind — so the
              // row says what stays rather than claiming Tocker covered it.
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Stays in the agent</dt>
                <dd className="tnum font-mono">
                  {nativeKeptBack(reviewed.chain)} {NATIVE_SYMBOL[reviewed.chain]}
                </dd>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Network fee</dt>
                <dd>{NETWORK_WORDING[reviewed.chain].fees}</dd>
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">To</dt>
              <dd className="min-w-0 text-right">
                {/* Named, and still spelled out in full: "your cash" is an address too, and
                    this is the last look at it before the money moves. */}
                {reviewed.toOwnCash ? <span className="block">Your Tocker cash</span> : null}
                <FullAddress address={reviewed.to} className="justify-end" />
              </dd>
            </div>
          </dl>
          {reviewed.breakdown ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Worked out a moment ago. It is worked out again when you confirm, and the receipt shows what was
              settled.
            </p>
          ) : null}
          <p className="text-xs text-destructive">
            This sends real funds on-chain and cannot be undone. Check the address.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setReviewed(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void send()}
              className="inline-flex h-8 items-center rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-destructive/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {pending
                ? "Sending…"
                : reviewed.breakdown
                  ? `Confirm — send ${movedText(reviewed.breakdown.delivered, "usdc")} USDC`
                  : `Confirm — send ${reviewed.amountText} ${symbolOf(reviewed)}`}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void review();
          }}
          className="mt-3"
        >
          {/* Disabled as one while the server checks: Review must open on the inputs that
              were checked, not on something typed while the answer was on its way. */}
          <fieldset disabled={checking} className="min-w-0 space-y-3">
          <div className={cn("grid gap-2", offerNative && "grid-cols-2")}>
            <div>
              <label htmlFor="withdraw-chain" className="mb-1 block text-xs text-muted-foreground">
                Chain
              </label>
              <SimpleSelect
                id="withdraw-chain"
                value={chain}
                // Said outright as well: the select's trigger is not guaranteed to be an
                // element a disabled fieldset reaches.
                disabled={checking}
                options={agent.wallets.map((wallet) => ({
                  value: wallet.chain,
                  label: chainLabelFor(wallet.chain),
                  // What can leave from there, so the pick is made with the number in view.
                  hint: `${balanceText(assetAmount(balances, wallet.chain, "usdc") ?? 0, "usdc")} USDC`,
                }))}
                onChange={(next) => {
                  setChain(next as Chain);
                  // A leftover on one chain says nothing about the other, and neither does
                  // an address: back to the owner's own cash on the new chain.
                  setAsset("usdc");
                  setSendToChoice(null);
                  setToAddress("");
                }}
              />
            </div>
            {offerNative ? (
              <div>
                <label htmlFor="withdraw-asset" className="mb-1 block text-xs text-muted-foreground">
                  Asset
                </label>
                <SimpleSelect
                  id="withdraw-asset"
                  value={selected}
                  disabled={checking}
                  options={[
                    { value: "usdc", label: "USDC" },
                    { value: "native", label: `Leftover ${NATIVE_SYMBOL[chain]}` },
                  ]}
                  onChange={(next) => setAsset(next as Asset)}
                />
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="withdraw-amount" className="block text-xs text-muted-foreground">
                Amount
              </label>
              {available !== null ? (
                <button
                  type="button"
                  onClick={() => setAmount(String(available))}
                  className="tnum rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {selected === "native" ? "Leftover" : "Balance"} {balanceText(available, selected)} {assetLabel} · Max
                </button>
              ) : null}
            </div>
            <Input
              id="withdraw-amount"
              value={amount}
              inputMode="decimal"
              placeholder="100"
              aria-invalid={overBalance}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
            {overBalance ? (
              <p className="mt-1 text-xs text-destructive">
                More than the agent can withdraw ({available === null ? "" : balanceText(available, selected)}{" "}
                {assetLabel}).
              </p>
            ) : belowSolMinimum ? (
              <p className="mt-1 text-xs text-destructive">
                Send at least {MIN_SOL_SEND} SOL. Solana refuses less than that to a new wallet.
              </p>
            ) : keepsNative ? (
              <p className="mt-1 text-xs text-muted-foreground">
                The last {keptNative} {NATIVE_SYMBOL[chain]} stays in the agent&apos;s wallet to cover network fees.
              </p>
            ) : null}
            {overCap && perTxUsd !== null ? (
              // A hint, not a block: the server decides, and the cap may have just changed.
              <p className="tnum mt-1 text-xs leading-relaxed text-muted-foreground">
                Above this agent&apos;s {formatUsd(perTxUsd)} per-transfer limit, Tocker only sends to your own Tocker
                cash. {cashUnavailable ? "Send" : "Choose My Tocker cash, or send"} {formatUsd(perTxUsd)} or less.
              </p>
            ) : null}
            {positionsUsd >= POSITIONS_WORTH_MENTIONING_USD ? (
              <p className="tnum mt-1 text-xs leading-relaxed text-muted-foreground">
                {formatUsd(positionsUsd)} more is in {openPositions.length} open{" "}
                {openPositions.length === 1 ? "position" : "positions"}.{" "}
                <Link
                  href={`/agents/${agent.slug}`}
                  className="rounded underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Sell {openPositions.length === 1 ? "it" : "them"} on the agent page
                </Link>{" "}
                to withdraw that too.
              </p>
            ) : null}
          </div>

          <div>
            <span id="withdraw-send-to" className="mb-1 block text-xs text-muted-foreground">
              Send to
            </span>
            {/* The toggle from the Fund sheet. Two answers, and the first is the one nearly
                everyone wants: an agent's money goes back to the cash it came from. */}
            <div
              role="group"
              aria-labelledby="withdraw-send-to"
              className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/20 p-1"
            >
              {(
                [
                  { value: "cash", label: "My Tocker cash" },
                  { value: "address", label: "Another address" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === sendTo}
                  disabled={option.value === "cash" && cashUnavailable}
                  onClick={() => setSendToChoice(option.value)}
                  className={cn(
                    "h-8 rounded-lg text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                    option.value === sendTo ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {sendTo === "cash" ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Arrives in your Tocker cash on {chainLabelFor(chain)}. From there you can withdraw to any wallet.
              </p>
            ) : (
              <div className="mt-2">
                {cashUnavailable ? (
                  <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                    Your {chainLabelFor(chain)} wallet isn&apos;t on record yet. Open Deposit in the top bar and tap
                    Sync wallets, or paste an address.
                  </p>
                ) : null}
                <label htmlFor="withdraw-to" className="mb-1 block text-xs text-muted-foreground">
                  Destination address
                </label>
                <Input
                  id="withdraw-to"
                  value={toAddress}
                  placeholder={chain === "solana" ? "7xKX…MpTqL" : "0x9A3f…8d90"}
                  aria-invalid={!addressValid}
                  aria-describedby={addressProblem ? "withdraw-to-error" : undefined}
                  onChange={(event) => setToAddress(event.target.value)}
                  // Browser form history is where a poisoned look-alike address would be
                  // suggested from; addresses are pasted, never autocompleted.
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  // The primitive's size, not "text-xs": 16px on phones, where iOS zooms into
                  // any focused field smaller than that.
                  className="font-mono"
                />
                {addressProblem ? (
                  <p id="withdraw-to-error" className="mt-1 text-xs text-destructive">
                    {addressProblem}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {refused ? (
            <p role="alert" className="text-xs leading-relaxed text-destructive">
              {refused}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canReview}
            className={cn(
              "inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {checking ? "Checking…" : "Review withdrawal"}
          </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
