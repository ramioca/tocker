import { describe, expect, it } from "vitest";
import {
  AGENT_SOL_KEPT,
  FEES_COVERED,
  LEFTOVER_NATIVE_MIN,
  MIN_FUND_USD,
  MIN_SOL_SEND,
  NETWORK_WORDING,
  STRANDED_TOKEN_MIN_USD,
  STRANDED_USDC_MIN,
  cashOn,
  defaultSplit,
  depositTargets,
  describeStranded,
  feeFailureKind,
  feeFailureSentence,
  gasBlockerFor,
  hasLeftoverNative,
  isNetworkFeeFailure,
  nativeKeptBack,
  planFunding,
  preferredDepositChain,
  splitProportional,
  strandedHoldings,
  transferLabel,
  transfersFor,
  unifiedCash,
  userFacingTransferError,
  withdrawableNative,
} from "./funding";
import { GAS_DRIP_SOL, MIN_AGENT_SOL, agentTransferLamports, gasDripPlan } from "./gas";
import type { WalletBalance } from "@/server/types";

function wallet(
  chain: "base" | "solana",
  usdc: number,
  native: number,
  nativeUsd: number | null = null,
): WalletBalance {
  return {
    chain,
    address: chain === "base" ? "0xuser" : "SoLuser",
    walletId: `w_${chain}`,
    balances: [
      { asset: "usdc", amount: usdc, usd: usdc },
      { asset: chain === "base" ? "eth" : "sol", amount: native, usd: nativeUsd },
    ],
  };
}

describe("unifiedCash", () => {
  it("adds USDC across chains into one number and keeps native out of it", () => {
    const cash = unifiedCash([wallet("base", 40, 0.01, 30), wallet("solana", 60, 0.5, 75)]);
    expect(cash.totalUsd).toBe(100);
    expect(cash.gasUsd).toBe(105);
    expect(cash.perChain.map((c) => c.chain)).toEqual(["base", "solana"]);
  });

  it("still lists a chain the user has no wallet for, at zero", () => {
    const cash = unifiedCash([wallet("base", 10, 0)]);
    expect(cash.perChain).toHaveLength(2);
    expect(cashOn(cash, "solana").usdc).toBe(0);
    expect(cashOn(cash, "solana").address).toBeNull();
  });

  it("falls back to face value when Privy omits the USD quote for USDC", () => {
    const cash = unifiedCash([
      { chain: "base", address: "0x", walletId: "w", balances: [{ asset: "usdc", amount: 12.5, usd: null }] },
    ]);
    expect(cash.totalUsd).toBe(12.5);
  });
});

describe("splitProportional", () => {
  it("splits in proportion to the weights and adds up exactly", () => {
    const legs = splitProportional(100, [
      { chain: "base", weight: 25 },
      { chain: "solana", weight: 75 },
    ]);
    expect(legs).toEqual([
      { chain: "base", amount: 25 },
      { chain: "solana", amount: 75 },
    ]);
  });

  it("gives the rounding remainder to the heaviest chain", () => {
    const legs = splitProportional(10, [
      { chain: "base", weight: 1 },
      { chain: "solana", weight: 2 },
    ]);
    expect(legs[0].amount + legs[1].amount).toBe(10);
    expect(legs[1].amount).toBeGreaterThan(legs[0].amount);
  });

  it("splits evenly when there is no weight anywhere", () => {
    const legs = splitProportional(10, [
      { chain: "base", weight: 0 },
      { chain: "solana", weight: 0 },
    ]);
    expect(legs).toEqual([
      { chain: "base", amount: 5 },
      { chain: "solana", amount: 5 },
    ]);
  });

  it("puts everything on the only chain", () => {
    expect(splitProportional(37.5, [{ chain: "base", weight: 0 }])).toEqual([
      { chain: "base", amount: 37.5 },
    ]);
  });
});

describe("planFunding", () => {
  const twoChains = unifiedCash([wallet("base", 40, 0.01, 30), wallet("solana", 60, 0.5, 75)]);

  it("has nothing to do in paper mode", () => {
    const plan = planFunding({
      mode: "paper",
      amountUsd: 0,
      chains: ["solana"],
      cash: twoChains,
    });
    expect(plan.paper).toBe(true);
    expect(plan.ready).toBe(true);
    expect(plan.legs).toEqual([]);
  });

  it("puts the whole amount on a single-chain agent", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      chains: ["solana"],
      cash: twoChains,
    });
    expect(plan.ready).toBe(true);
    expect(plan.legs).toHaveLength(1);
    // USDC and nothing else: a leg is a chain and an amount of USDC.
    expect(plan.legs[0]).toEqual({ chain: "solana", usdc: 25 });
  });

  it("splits a two-chain agent proportionally to the user's balances", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      chains: ["base", "solana"],
      cash: twoChains,
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.legs.map((l) => l.usdc)).toEqual([20, 30]);
    expect(plan.totalUsdc).toBe(50);
  });

  it("honours an explicit split the user dragged", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      chains: ["base", "solana"],
      cash: twoChains,
      split: { base: 40, solana: 10 },
    });
    expect(plan.legs.map((l) => l.usdc)).toEqual([40, 10]);
    expect(plan.ready).toBe(true);
  });

  it("blocks a split that does not add up to the amount", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      chains: ["base", "solana"],
      cash: twoChains,
      split: { base: 10, solana: 10 },
    });
    expect(plan.ready).toBe(false);
    expect(plan.blockers[0].kind).toBe("over-available");
  });

  it("blocks below the minimum", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: MIN_FUND_USD - 1,
      chains: ["solana"],
      cash: twoChains,
    });
    expect(plan.ready).toBe(false);
    expect(plan.blockers.some((b) => b.kind === "below-minimum")).toBe(true);
  });

  it("blocks with a deposit CTA when a chain has no USDC — never funds less", () => {
    const cash = unifiedCash([wallet("base", 0, 0.01, 30), wallet("solana", 100, 0.5, 75)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      chains: ["base", "solana"],
      cash,
      split: { base: 25, solana: 25 },
    });
    expect(plan.ready).toBe(false);
    const blocker = plan.blockers.find((b) => b.kind === "chain-short-usdc");
    expect(blocker?.chain).toBe("base");
    expect(blocker?.deposit).toEqual({ chain: "base", asset: "usdc" });
  });

  it("never blocks on native: a wallet with USDC and no SOL or ETH at all is ready", () => {
    const cash = unifiedCash([wallet("solana", 100, 0), wallet("base", 100, 0)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      chains: ["base", "solana"],
      cash,
    });
    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
  });

  it("no blocker it raises ever mentions SOL, ETH or gas", () => {
    const cases = [
      unifiedCash([]),
      unifiedCash([wallet("solana", 0, 0)]),
      unifiedCash([wallet("base", 1, 0), wallet("solana", 2, 0)]),
    ];
    for (const cash of cases) {
      for (const chains of [["solana"], ["base"], ["base", "solana"], []] as const) {
        const plan = planFunding({ mode: "fund", amountUsd: 25, chains: [...chains], cash });
        for (const blocker of plan.blockers) {
          expect(blocker.message).not.toMatch(/\b(SOL|ETH)\b|\bgas\b|lamport/i);
          if (blocker.deposit) expect(blocker.deposit.asset).toBe("usdc");
        }
      }
    }
  });

  it("blocks when the total exceeds what the enabled chains hold", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 500,
      chains: ["base", "solana"],
      cash: twoChains,
    });
    expect(plan.blockers.some((b) => b.kind === "over-available")).toBe(true);
    expect(plan.ready).toBe(false);
  });

  it("blocks with no chains chosen", () => {
    const plan = planFunding({ mode: "fund", amountUsd: 10, chains: [], cash: twoChains });
    expect(plan.blockers[0].kind).toBe("no-chains");
  });

  it("flags a chain the user has no embedded wallet on", () => {
    const cash = unifiedCash([wallet("solana", 100, 1, 150)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 10,
      chains: ["base"],
      cash,
    });
    expect(plan.blockers.some((b) => b.kind === "no-wallet" || b.kind === "over-available")).toBe(true);
  });
});

describe("transfersFor", () => {
  it("sends only USDC — no native transfer is ever queued, even for a wallet that holds some", () => {
    const cash = unifiedCash([wallet("solana", 100, 1, 150)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      chains: ["solana"],
      cash,
    });
    expect(transfersFor(plan).map((t) => t.asset)).toEqual(["usdc"]);
  });

  it("skips zero legs", () => {
    const cash = unifiedCash([wallet("base", 100, 1, 3_000)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 10,
      chains: ["base", "solana"],
      cash,
      split: { base: 10, solana: 0 },
    });
    expect(transfersFor(plan)).toEqual([{ chain: "base", asset: "usdc", amount: 10 }]);
  });

  it("labels a transfer in USDC, never in a native unit", () => {
    expect(transferLabel({ chain: "solana", asset: "usdc", amount: 25 })).toBe("25 USDC on Solana");
  });
});

describe("depositTargets", () => {
  it("collapses two blockers that point at the same deposit into one", () => {
    // No Solana wallet at all: the plan raises both "over available" and
    // "no wallet", and both are fixed by the same deposit.
    const cash = unifiedCash([]);
    const plan = planFunding({ mode: "fund", amountUsd: 25, chains: ["solana"], cash });
    expect(plan.blockers.length).toBeGreaterThan(1);
    expect(depositTargets(plan)).toEqual([{ chain: "solana", asset: "usdc" }]);
  });

  it("asks only for USDC on an empty wallet — never for gas", () => {
    const cash = unifiedCash([wallet("solana", 0, 0)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      chains: ["solana"],
      cash,
    });
    expect(depositTargets(plan)).toEqual([{ chain: "solana", asset: "usdc" }]);
  });

  it("is empty for a plan with nothing blocking it", () => {
    const cash = unifiedCash([wallet("base", 100, 1, 3_000)]);
    const plan = planFunding({ mode: "fund", amountUsd: 25, chains: ["base"], cash });
    expect(plan.ready).toBe(true);
    expect(depositTargets(plan)).toEqual([]);
  });
});

describe("defaultSplit", () => {
  it("is proportional to held balances", () => {
    const cash = unifiedCash([wallet("base", 10, 0), wallet("solana", 90, 0)]);
    expect(defaultSplit(100, ["base", "solana"], cash)).toEqual([
      { chain: "base", amount: 10 },
      { chain: "solana", amount: 90 },
    ]);
  });
});

describe("preferredDepositChain", () => {
  it("opens on the chain the user already keeps cash on", () => {
    expect(preferredDepositChain(unifiedCash([wallet("solana", 10, 0), wallet("base", 0, 0)]))).toBe(
      "solana",
    );
    expect(preferredDepositChain(unifiedCash([wallet("solana", 0, 0), wallet("base", 10, 0)]))).toBe(
      "base",
    );
  });

  it("defaults to Solana for a user with nothing anywhere — that is where agents trade", () => {
    expect(preferredDepositChain(unifiedCash([]))).toBe("solana");
    expect(preferredDepositChain(undefined)).toBe("solana");
  });

  it("breaks a tie towards Solana rather than Base", () => {
    expect(preferredDepositChain(unifiedCash([wallet("solana", 5, 0), wallet("base", 5, 0)]))).toBe(
      "solana",
    );
  });
});

/**
 * W8: every network fee is Tocker's. A transfer that fails on its fee is a problem on
 * Tocker's side — the platform fee wallet mid-refuel on Solana, sponsorship refusing on
 * Base — so the reaction to it names Tocker, tells the user their USDC did not move, and
 * never opens a deposit sheet for SOL or ETH.
 */
describe("gasBlockerFor", () => {
  it("names Tocker's fee wallet and has no deposit target", () => {
    const blocker = gasBlockerFor("solana");
    expect(blocker.kind).toBe("fee-wallet");
    expect(blocker.chain).toBe("solana");
    expect(blocker.deposit).toBeNull();
    expect(blocker.message).toContain("Tocker");
    expect(blocker.message).toContain("fee wallet");
    expect(blocker.message).toContain("Your USDC has not moved");
  });

  it("never asks for SOL or ETH, on either chain, for either kind", () => {
    for (const chain of ["solana", "base"] as const) {
      for (const kind of ["refuel", "unavailable"] as const) {
        expect(gasBlockerFor(chain, kind).message).not.toMatch(/\b(SOL|ETH)\b|deposit|\bgas\b/i);
      }
    }
  });

  it("promises a retry only for a refuel", () => {
    expect(gasBlockerFor("solana", "refuel").message).toMatch(/try again/);
    expect(gasBlockerFor("base", "refuel").message).toMatch(/try again/);
    expect(gasBlockerFor("solana", "unavailable").message).not.toMatch(/try again|topping up|minute/i);
    expect(gasBlockerFor("base", "unavailable").message).not.toMatch(/try again|topping up|minute/i);
  });

  it("contributes nothing to depositTargets", () => {
    const plan = {
      paper: false,
      legs: [],
      totalUsdc: 0,
      ready: false,
      blockers: [gasBlockerFor("solana"), gasBlockerFor("base"), gasBlockerFor("solana", "unavailable")],
    };
    expect(depositTargets(plan)).toEqual([]);
  });
});

/**
 * The exact sentences the fee path produces today, copied from their producers so a
 * rewording there shows up here: `submitSponsoredFunding` in `src/server/actions/wallets.ts`,
 * `transferErrorMessage` in `src/components/wallets/use-transfer.ts`,
 * `FEE_WALLET_REFILLING` / `validateSponsoredUsdcTransfer` in `solana-sponsored.ts`,
 * `cosignAsPlatform` in `solana-cosign.ts` and `ensureAgentGas` in `gas.ts`.
 */
const PRODUCED = {
  networkRejectedNoCredit:
    "The network rejected this transfer: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.. Your USDC did not move.",
  networkRejectedLamports:
    "The network rejected this transfer: Transaction simulation failed: Transfer: insufficient lamports 1204, need 2039280. Your USDC did not move.",
  networkRejectedUsdcShort:
    "The network rejected this transfer: Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1. Your USDC did not move.",
  feeWalletRefilling: "Tocker's fee wallet is refilling — try again in a minute.",
  baseFeeShortfall: "Tocker couldn't cover the network fee this time. Nothing was sent — try again in a minute.",
  platformCannotDrip:
    "The agent's Solana wallet holds 0.000000 SOL and this trade needs 0.002054 SOL, but the platform Solana wallet (8LZj…hwyza) holds only 0.001000 SOL and cannot top it up. It refuels itself from its own USDC, but that did not happen. Send a little USDC or 0.02 SOL to that address.",
  baseSponsorshipOff:
    "Tocker couldn't cover this network fee: fee sponsorship is not enabled for this app yet. Nothing was sent and nothing is wrong with your wallet — the operator has to switch it on.",
  cosignOverAllowance:
    "the sponsored funding transfer would take 0.004000 SOL from Tocker's fee wallet, over its 0.000010 SOL allowance",
  cosignWrongPayer: "its fee payer is 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU, not Tocker's fee wallet",
  validatorWrongPayer:
    "Tocker will not sign this transaction because its fee payer is 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU, not the platform wallet 8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza. Nothing was sent. Start the transfer again.",
  cancelled: "You cancelled the signature. Nothing was sent.",
  nativeTooMuch:
    "That's more SOL than this wallet can send once the network fee is set aside. Try a slightly smaller amount.",
} as const;

describe("feeFailureKind", () => {
  it("reads a fee payer that is short right now as a refuel — including the network's own rejection", () => {
    for (const message of [
      PRODUCED.networkRejectedNoCredit,
      PRODUCED.networkRejectedLamports,
      PRODUCED.feeWalletRefilling,
      PRODUCED.baseFeeShortfall,
      PRODUCED.platformCannotDrip,
      "Transaction simulation failed: InsufficientFundsForFee",
      "Your Solana wallet has no SOL for the network fee. Deposit about 0.01 SOL and try again.",
      "insufficient funds for gas * price + value",
    ]) {
      expect(feeFailureKind(message), message).toBe("refuel");
    }
  });

  it("reads configuration and co-sign refusals as unavailable, never as a refuel", () => {
    for (const message of [
      PRODUCED.baseSponsorshipOff,
      PRODUCED.cosignOverAllowance,
      PRODUCED.cosignWrongPayer,
      PRODUCED.validatorWrongPayer,
      "Sponsoring transactions is only supported for wallets on the TEE stack",
    ]) {
      expect(feeFailureKind(message), message).toBe("unavailable");
    }
  });

  it("is null for a cancellation, a USDC shortfall, an over-large native send or a bad address", () => {
    for (const message of [
      PRODUCED.cancelled,
      PRODUCED.networkRejectedUsdcShort,
      PRODUCED.nativeTooMuch,
      "You cancelled the transfer in your wallet.",
      "User rejected the request.",
      "Your wallet rejected the request.",
      "Error processing Instruction 1: custom program error: 0x1 — insufficient funds",
      "You don't have that much USDC on Solana. Nothing was sent.",
      "The agent has no Solana wallet.",
      "Invalid address for Solana.",
      "",
    ]) {
      expect(feeFailureKind(message), message).toBeNull();
    }
    expect(feeFailureKind(null)).toBeNull();
    expect(feeFailureKind(undefined)).toBeNull();
  });
});

describe("isNetworkFeeFailure", () => {
  it("is true for either kind of fee failure", () => {
    expect(isNetworkFeeFailure(PRODUCED.networkRejectedLamports)).toBe(true);
    expect(isNetworkFeeFailure(PRODUCED.baseSponsorshipOff)).toBe(true);
  });

  it("is false for a cancellation or a USDC shortfall", () => {
    expect(isNetworkFeeFailure(PRODUCED.cancelled)).toBe(false);
    expect(isNetworkFeeFailure(PRODUCED.networkRejectedUsdcShort)).toBe(false);
    expect(isNetworkFeeFailure(null)).toBe(false);
  });
});

describe("userFacingTransferError", () => {
  it("turns a refuel into the fee-wallet sentence for that chain", () => {
    expect(userFacingTransferError("Insufficient lamports 0, need 5000", "solana")).toBe(feeFailureSentence("solana"));
    expect(userFacingTransferError(PRODUCED.networkRejectedNoCredit, "solana")).toBe(feeFailureSentence("solana"));
    expect(userFacingTransferError(PRODUCED.baseFeeShortfall, "base")).toBe(feeFailureSentence("base"));
  });

  it("turns a refusal into a sentence that does not promise a retry", () => {
    const text = userFacingTransferError(PRODUCED.baseSponsorshipOff, "base");
    expect(text).toBe(feeFailureSentence("base", "unavailable"));
    expect(text).not.toMatch(/try again|minute/i);
    expect(userFacingTransferError(PRODUCED.cosignOverAllowance, "solana")).toBe(
      feeFailureSentence("solana", "unavailable"),
    );
  });

  it("never lets the server's 'send SOL to that address' reach a withdrawal toast", () => {
    for (const asset of ["usdc", "native"] as const) {
      const text = userFacingTransferError(PRODUCED.platformCannotDrip, "solana", asset);
      expect(text).not.toMatch(/\bSOL\b|send a little|address/i);
    }
    expect(userFacingTransferError(PRODUCED.platformCannotDrip, "solana", "native")).toContain("Nothing was sent");
  });

  it("passes anything else through untouched", () => {
    expect(userFacingTransferError("You cancelled the transfer in your wallet.", "solana")).toBe(
      "You cancelled the transfer in your wallet.",
    );
  });
});

describe("fee wording", () => {
  it("says fees are covered, on both networks", () => {
    expect(NETWORK_WORDING.base.fees).toBe(FEES_COVERED);
    expect(NETWORK_WORDING.solana.fees).toBe(FEES_COVERED);
    expect(FEES_COVERED).toBe("Covered by Tocker");
  });
});

describe("hasLeftoverNative", () => {
  it("offers leftover SOL/ETH only above the dust line", () => {
    expect(hasLeftoverNative(0.5)).toBe(true);
    expect(hasLeftoverNative(LEFTOVER_NATIVE_MIN * 2)).toBe(true);
    expect(hasLeftoverNative(LEFTOVER_NATIVE_MIN)).toBe(false);
    expect(hasLeftoverNative(0.0004)).toBe(false);
    expect(hasLeftoverNative(0)).toBe(false);
    expect(hasLeftoverNative(null)).toBe(false);
    expect(hasLeftoverNative(Number.NaN)).toBe(false);
  });
});

/**
 * The withdraw form offers an agent's SOL as the owner's "leftover" only above what
 * Tocker's own drips can have put there — otherwise a withdraw-a-cent-then-withdraw-the-SOL
 * loop drains the platform wallet one drip at a time.
 */
describe("withdrawableNative", () => {
  it("keeps Tocker's float back on Solana, in whole lamports", () => {
    expect(nativeKeptBack("solana")).toBe(AGENT_SOL_KEPT);
    expect(withdrawableNative("solana", 0.05)).toBe(0.034);
    expect(withdrawableNative("solana", 0.123456789)).toBe(0.107456789);
    expect(withdrawableNative("solana", AGENT_SOL_KEPT)).toBe(0);
    expect(withdrawableNative("solana", 0.0099)).toBe(0);
  });

  it("keeps nothing back on Base, where nothing drips ETH into an agent", () => {
    expect(nativeKeptBack("base")).toBe(0);
    expect(withdrawableNative("base", 0.004)).toBe(0.004);
  });

  it("is zero for a missing or nonsensical balance", () => {
    for (const chain of ["solana", "base"] as const) {
      expect(withdrawableNative(chain, null)).toBe(0);
      expect(withdrawableNative(chain, undefined)).toBe(0);
      expect(withdrawableNative(chain, Number.NaN)).toBe(0);
      expect(withdrawableNative(chain, -1)).toBe(0);
    }
  });

  it("never offers SOL that a drip put there, whatever the agent held before it", () => {
    expect(AGENT_SOL_KEPT).toBeGreaterThanOrEqual(GAS_DRIP_SOL + MIN_AGENT_SOL);
    // Every requirement that triggers a drip today: a withdrawal to an existing or a new
    // token account, and the 0.006 SOL pre-quote top-up in trading/jupiter.ts.
    const requirements = [
      agentTransferLamports({ ataExists: true }),
      agentTransferLamports({ ataExists: false }),
      6_000_000,
    ];
    for (const requiredLamports of requirements) {
      for (let lamports = 0; lamports < requiredLamports; lamports += 50_000) {
        const balanceSol = lamports / 1e9;
        const plan = gasDripPlan({ balanceSol, requiredLamports });
        expect(plan.drip).toBe(true);
        const afterDrip = balanceSol + plan.amountSol;
        expect(hasLeftoverNative(withdrawableNative("solana", afterDrip)), `${requiredLamports}/${lamports}`).toBe(false);
      }
    }
  });

  it("sends at least Solana's rent-exempt minimum for a fresh account", () => {
    expect(MIN_SOL_SEND * 1e9).toBeGreaterThanOrEqual(890_880);
  });
});

describe("strandedHoldings / describeStranded (deleting an agent)", () => {
  const none = { wallets: [], tokens: [] };

  it("counts SOL by amount: a Solana read carries no dollar value, and 5 SOL is not $0", () => {
    // The old check summed `usd ?? 0`, and the on-chain Solana read reports SOL with
    // usd: null — so an agent holding 5 SOL passed as empty and could be deleted.
    const held = strandedHoldings({ wallets: [{ chain: "solana", usdc: 0, native: 5 }], tokens: [] });
    expect(held).toEqual([{ kind: "native", chain: "solana", symbol: "SOL", amount: 5 - AGENT_SOL_KEPT }]);
    expect(describeStranded(held)).toMatch(/4\.9840 SOL/);
    expect(describeStranded(held)).toMatch(/Withdraw it first/);
  });

  it("never holds a deletion up over SOL the withdraw form will not offer", () => {
    // Up to AGENT_SOL_KEPT may be Tocker's own drip. It is not withdrawable, so blocking on
    // it would make every agent that was ever topped up undeletable.
    for (const native of [0, 0.00089088, 0.011, AGENT_SOL_KEPT, AGENT_SOL_KEPT + LEFTOVER_NATIVE_MIN]) {
      expect(strandedHoldings({ wallets: [{ chain: "solana", usdc: 0, native }], tokens: [] })).toEqual([]);
    }
    expect(strandedHoldings({ wallets: [{ chain: "solana", usdc: 0, native: AGENT_SOL_KEPT + 0.002 }], tokens: [] })).toHaveLength(1);
  });

  it("counts ETH on Base in full, since nothing drips ETH into an agent", () => {
    const held = strandedHoldings({ wallets: [{ chain: "base", usdc: 0, native: 0.01 }], tokens: [] });
    expect(held).toEqual([{ kind: "native", chain: "base", symbol: "ETH", amount: 0.01 }]);
  });

  it("counts USDC from a cent up, on every chain, and says the total", () => {
    expect(strandedHoldings({ wallets: [{ chain: "solana", usdc: STRANDED_USDC_MIN / 2, native: 0 }], tokens: [] })).toEqual([]);
    const held = strandedHoldings({
      wallets: [
        { chain: "solana", usdc: 12.3, native: 0 },
        { chain: "base", usdc: 0.5, native: 0 },
      ],
      tokens: [],
    });
    expect(held.map((h) => h.kind)).toEqual(["usdc", "usdc"]);
    expect(describeStranded(held)).toMatch(/^This agent still holds 12\.80 USDC\. Withdraw it first/);
  });

  it("counts a token position worth a dollar or more, and one with no price at all", () => {
    const held = strandedHoldings({
      wallets: [],
      tokens: [
        { chain: "solana", symbol: "BONK", amountToken: 1_000_000, valueUsd: 27 },
        { chain: "solana", symbol: "DUST", amountToken: 3, valueUsd: STRANDED_TOKEN_MIN_USD / 10 },
        { chain: "solana", symbol: "NOPRICE", amountToken: 42, valueUsd: null },
        { chain: "solana", symbol: "ZERO", amountToken: 0, valueUsd: 50 },
      ],
    });
    expect(held.map((h) => (h.kind === "token" ? h.symbol : h.kind))).toEqual(["BONK", "NOPRICE"]);
    const sentence = describeStranded(held) ?? "";
    expect(sentence).toMatch(/NOPRICE and BONK \(about \$27\.00\)/);
    expect(sentence).toMatch(/Sell them first/);
  });

  it("names two tokens, counts the rest, and asks to sell before withdrawing", () => {
    const held = strandedHoldings({
      wallets: [{ chain: "solana", usdc: 3, native: 1 }],
      tokens: [
        { chain: "solana", symbol: "AAA", amountToken: 1, valueUsd: 5 },
        { chain: "solana", symbol: "BBB", amountToken: 1, valueUsd: 50 },
        { chain: "solana", symbol: "CCC", amountToken: 1, valueUsd: 2 },
        { chain: "solana", symbol: "DDD", amountToken: 1, valueUsd: 3 },
      ],
    });
    const sentence = describeStranded(held) ?? "";
    expect(sentence).toMatch(/3\.00 USDC, 0\.9840 SOL, BBB \(about \$50\.00\), AAA \(about \$5\.00\) and 2 more tokens\./);
    expect(sentence).toMatch(/Sell its positions and withdraw the rest first/);
    expect(sentence).toMatch(/can't reach its wallet/);
  });

  it("is null when nothing would be stranded", () => {
    expect(strandedHoldings(none)).toEqual([]);
    expect(describeStranded([])).toBeNull();
  });
});
