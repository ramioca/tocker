import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { base58 } from "@scure/base";
import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { limiter } from "@/lib/security/rate-limit";
import { budgetRules } from "./index";
import { AGENT_SOL_KEPT } from "./funding";
import { MIN_SPONSORED_WITHDRAWAL_USDC } from "./solana-sponsored";
import {
  AGENT_SOL_KEPT_LAMPORTS,
  AGENT_TRANSFER_SIGNERS,
  EMPTY_ACCOUNT_RENT_BAND,
  MAX_TRANSACTION_BYTES,
  MAX_TRANSFER_PIECES,
  MIN_AGENT_SOL_WITHDRAWAL_LAMPORTS,
  MIN_AGENT_USDC_WITHDRAWAL_BASE_UNITS,
  OWNER_WITHDRAWAL_BURST_LIMIT,
  OWNER_WITHDRAWALS_PER_DAY,
  RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS,
  TOKEN_ACCOUNT_RENT_BAND,
  TooLargeForOneTransaction,
  type AgentTransferPlan,
  agentSolTransferInstructions,
  agentUsdcTransferInstructions,
  buildAgentSolTransfer,
  buildAgentUsdcTransfer,
  fitUsdcWithdrawal,
  isAgentUsdcShort,
  isPolicyDenial,
  largestSplitThatFits,
  missingSignatures,
  overCapRefusal,
  planAgentTransferRoute,
  sameMessage,
  saneRentLamports,
  solWithdrawalProblem,
  solanaCapBaseUnits,
  splitUnderCap,
  sponsoredSolTransferBudget,
  transactionId,
  sponsoredUsdcTransferBudget,
  uncappedSolanaDestinations,
  waitSentence,
  withdrawFromAgentSolana,
  withdrawalForClient,
  withdrawalFromOutcome,
} from "./solana-agent-transfer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
} from "./solana-transfer";

const PLATFORM = "8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza";
const AGENT = "3XiU5e1cwsHB4V9tAeRvtsu4NSKN8pf5jW1t9aswohnY";
const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const ata = (owner: string) => associatedTokenAddress(new PublicKey(owner), SOLANA_USDC_MINT).toBase58();

/** The amount a `TransferChecked` carries, from its data bytes. */
function transferAmount(data: Uint8Array): bigint {
  expect(data[0]).toBe(12);
  expect(data[9]).toBe(6);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
}

function decode(bytes: Uint8Array) {
  const tx = VersionedTransaction.deserialize(bytes);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const instructions = tx.message.compiledInstructions.map((ix) => ({
    program: keys[ix.programIdIndex],
    accounts: ix.accountKeyIndexes.map((i) => ({
      key: keys[i],
      signer: tx.message.isAccountSigner(i),
      writable: tx.message.isAccountWritable(i),
    })),
    data: ix.data,
  }));
  return { tx, keys, instructions };
}

describe("sponsored USDC transfer out of an agent", () => {
  it("to an account that exists: one TransferChecked the agent authorises, the platform only pays", () => {
    const bytes = buildAgentUsdcTransfer({
      agent: AGENT,
      destinationOwner: OWNER,
      feePayer: PLATFORM,
      amountBaseUnits: BigInt(12_500_000),
      openAccount: null,
      blockhash: BLOCKHASH,
    });
    const { tx, keys, instructions } = decode(bytes);
    expect(tx.message.version).toBe(0);
    expect(tx.message.addressTableLookups).toHaveLength(0);
    expect(keys[0]).toBe(PLATFORM); // fee payer
    expect(tx.message.header.numRequiredSignatures).toBe(AGENT_TRANSFER_SIGNERS);
    expect(keys.slice(0, 2)).toEqual([PLATFORM, AGENT]);

    expect(instructions).toHaveLength(1);
    const [transfer] = instructions;
    expect(transfer.program).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(transfer.accounts.map((a) => a.key)).toEqual([ata(AGENT), SOLANA_USDC_MINT.toBase58(), ata(OWNER), AGENT]);
    expect(transfer.accounts[3]).toMatchObject({ signer: true, writable: false });
    expect(transferAmount(transfer.data)).toBe(BigInt(12_500_000));
    // The platform is in no instruction at all.
    expect(instructions.flatMap((ix) => ix.accounts.map((a) => a.key))).not.toContain(PLATFORM);
  });

  it("to a wallet that never held USDC: the platform opens the account, the agent reimburses it", () => {
    const { instructions } = decode(
      buildAgentUsdcTransfer({
        agent: AGENT,
        destinationOwner: OWNER,
        feePayer: PLATFORM,
        amountBaseUnits: BigInt(2_000_000),
        openAccount: { feeBaseUnits: BigInt(250_000) },
        blockhash: BLOCKHASH,
      }),
    );
    expect(instructions.map((ix) => ix.program)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
    ]);
    const [create, send, fee] = instructions;
    expect(create.accounts[0]).toMatchObject({ key: PLATFORM, signer: true, writable: true }); // rent payer
    expect(create.accounts[1].key).toBe(ata(OWNER));
    expect(create.accounts[2].key).toBe(OWNER);
    expect(Array.from(create.data)).toEqual([1]); // CreateIdempotent

    expect(send.accounts.map((a) => a.key)).toEqual([ata(AGENT), SOLANA_USDC_MINT.toBase58(), ata(OWNER), AGENT]);
    expect(transferAmount(send.data)).toBe(BigInt(2_000_000));
    expect(fee.accounts.map((a) => a.key)).toEqual([ata(AGENT), SOLANA_USDC_MINT.toBase58(), ata(PLATFORM), AGENT]);
    expect(transferAmount(fee.data)).toBe(BigInt(250_000));
    // Every transfer is authorised by the agent, never the platform.
    for (const ix of [send, fee]) expect(ix.accounts[3]).toMatchObject({ key: AGENT, signer: true });
  });

  it("a sweep to the platform's own new account opens it without charging the platform a fee", () => {
    const instructions = agentUsdcTransferInstructions({
      agent: AGENT,
      destinationOwner: PLATFORM,
      feePayer: PLATFORM,
      amountBaseUnits: BigInt(1_000_000),
      openAccount: { feeBaseUnits: BigInt(0) },
    });
    expect(instructions).toHaveLength(2);
    expect(instructions[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("refuses the shapes that would make the platform more than the fee payer", () => {
    const base = { agent: AGENT, destinationOwner: OWNER, feePayer: PLATFORM, amountBaseUnits: BigInt(1), openAccount: null };
    expect(() => agentUsdcTransferInstructions({ ...base, feePayer: AGENT })).toThrow(/fee payer/);
    expect(() => agentUsdcTransferInstructions({ ...base, destinationOwner: AGENT })).toThrow(/own wallet/);
    expect(() => agentUsdcTransferInstructions({ ...base, amountBaseUnits: BigInt(0) })).toThrow(/greater than zero/);
    expect(() => agentUsdcTransferInstructions({ ...base, openAccount: { feeBaseUnits: BigInt(0) } })).toThrow(/fee/);
  });

  it("splits an over-cap transfer home into pieces at or under the cap, and the fee too", () => {
    const { instructions } = decode(
      buildAgentUsdcTransfer({
        agent: AGENT,
        destinationOwner: OWNER,
        feePayer: PLATFORM,
        amountBaseUnits: BigInt(5_500_000),
        openAccount: { feeBaseUnits: BigInt(2_500_000) },
        capBaseUnits: BigInt(2_000_000),
        splitToDestination: true,
        blockhash: BLOCKHASH,
      }),
    );
    const [create, ...transfers] = instructions;
    expect(create.program).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    const toOwner = transfers.filter((ix) => ix.accounts[2].key === ata(OWNER));
    const toPlatform = transfers.filter((ix) => ix.accounts[2].key === ata(PLATFORM));
    expect(toOwner.map((ix) => transferAmount(ix.data))).toEqual([BigInt(2_000_000), BigInt(2_000_000), BigInt(1_500_000)]);
    expect(toPlatform.map((ix) => transferAmount(ix.data))).toEqual([BigInt(2_000_000), BigInt(500_000)]);
    for (const ix of transfers) expect(ix.accounts[3]).toMatchObject({ key: AGENT, signer: true });
  });

  it("never splits the transfer to the destination unless told to — only the fee to the platform", () => {
    const instructions = agentUsdcTransferInstructions({
      agent: AGENT,
      destinationOwner: OWNER,
      feePayer: PLATFORM,
      amountBaseUnits: BigInt(5_000_000),
      openAccount: { feeBaseUnits: BigInt(300_000) },
      capBaseUnits: BigInt(2_000_000),
    });
    // create, one 5 USDC transfer (over the cap: Privy would refuse it), one fee transfer
    expect(instructions).toHaveLength(3);
  });

  it("opens a recipient's account with no transfer at all, ahead of Privy's transfer", () => {
    const instructions = agentUsdcTransferInstructions({
      agent: AGENT,
      destinationOwner: OWNER,
      feePayer: PLATFORM,
      amountBaseUnits: BigInt(0),
      openAccount: { feeBaseUnits: BigInt(300_000) },
    });
    expect(instructions.map((ix) => ix.programId.toBase58())).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
    ]);
    // …but an open-only transaction to the platform, or one opening nothing, is refused.
    expect(() =>
      agentUsdcTransferInstructions({ agent: AGENT, destinationOwner: PLATFORM, feePayer: PLATFORM, amountBaseUnits: BigInt(0), openAccount: { feeBaseUnits: BigInt(0) } }),
    ).toThrow(/greater than zero/);
  });

  it("refuses a transaction that would not fit in one packet", () => {
    // Measured: 17 bytes a piece; 48 pieces to an existing account is 1,176 bytes.
    const fits = buildAgentUsdcTransfer({
      agent: AGENT,
      destinationOwner: OWNER,
      feePayer: PLATFORM,
      amountBaseUnits: BigInt(MAX_TRANSFER_PIECES),
      openAccount: null,
      capBaseUnits: BigInt(1),
      splitToDestination: true,
      blockhash: BLOCKHASH,
    });
    expect(fits.length).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
    expect(() =>
      buildAgentUsdcTransfer({
        agent: AGENT,
        destinationOwner: OWNER,
        feePayer: PLATFORM,
        amountBaseUnits: BigInt(45),
        openAccount: { feeBaseUnits: BigInt(1) },
        capBaseUnits: BigInt(1),
        splitToDestination: true,
        blockhash: BLOCKHASH,
      }),
    ).toThrow(TooLargeForOneTransaction);
  });
});

describe("splitUnderCap", () => {
  it("is one piece without a cap or within it, full pieces then the remainder over it", () => {
    expect(splitUnderCap(BigInt(7), null)).toEqual([BigInt(7)]);
    expect(splitUnderCap(BigInt(7), BigInt(7))).toEqual([BigInt(7)]);
    expect(splitUnderCap(BigInt(7), BigInt(3))).toEqual([BigInt(3), BigInt(3), BigInt(1)]);
    expect(splitUnderCap(BigInt(6), BigInt(3))).toEqual([BigInt(3), BigInt(3)]);
  });
  it("refuses zero, a zero cap, and more pieces than a transaction carries", () => {
    expect(() => splitUnderCap(BigInt(0), BigInt(1))).toThrow(/greater than zero/);
    expect(() => splitUnderCap(BigInt(2), BigInt(0))).toThrow(/cap/);
    expect(() => splitUnderCap(BigInt(MAX_TRANSFER_PIECES + 1), BigInt(1))).toThrow(TooLargeForOneTransaction);
  });
});

describe("sponsored SOL transfer out of an agent", () => {
  it("is one System transfer from the agent; the platform pays and appears nowhere else", () => {
    const { tx, keys, instructions } = decode(
      buildAgentSolTransfer({ agent: AGENT, destination: OWNER, feePayer: PLATFORM, lamports: BigInt(7_047_350), blockhash: BLOCKHASH }),
    );
    expect(keys[0]).toBe(PLATFORM);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].program).toBe(SystemProgram.programId.toBase58());
    expect(instructions[0].accounts.map((a) => a.key)).toEqual([AGENT, OWNER]);
    const data = instructions[0].data;
    expect(new DataView(data.buffer, data.byteOffset).getUint32(0, true)).toBe(2); // Transfer
    expect(new DataView(data.buffer, data.byteOffset).getBigUint64(4, true)).toBe(BigInt(7_047_350));
  });

  it("refuses the platform as the agent, a self-transfer and zero", () => {
    const base = { agent: AGENT, destination: OWNER, feePayer: PLATFORM, lamports: BigInt(1) };
    expect(() => agentSolTransferInstructions({ ...base, feePayer: AGENT })).toThrow(/fee payer/);
    expect(() => agentSolTransferInstructions({ ...base, destination: AGENT })).toThrow(/own wallet/);
    expect(() => agentSolTransferInstructions({ ...base, lamports: BigInt(0) })).toThrow(/greater than zero/);
  });
});

describe("what the platform agrees to lose", () => {
  // Measured by simulating these exact builders against mainnet (2026-09-23): a transfer
  // to an existing account cost the platform 10,000 lamports; one that opened the
  // recipient's account cost 1,498,440 (10,000 + the 1,488,440 live rent).
  it("is exact: two signatures, plus the rent only when an account is opened", () => {
    expect(sponsoredUsdcTransferBudget({ opensAccount: false, rentLamports: 1_488_440 })).toBe(10_000);
    expect(sponsoredUsdcTransferBudget({ opensAccount: true, rentLamports: 1_488_440 })).toBe(1_498_440);
    expect(sponsoredSolTransferBudget()).toBe(10_000);
  });
});

describe("fitUsdcWithdrawal", () => {
  const usdc = (n: number) => BigInt(Math.round(n * 1e6));
  it("sends what was asked when it fits alongside the fee", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(5), feeBaseUnits: usdc(0.25) })).toEqual({
      ok: true,
      amountBaseUnits: usdc(5),
      reducedBy: BigInt(0),
    });
  });
  it("takes the fee out of a withdraw-all", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(10), feeBaseUnits: usdc(0.25) })).toEqual({
      ok: true,
      amountBaseUnits: usdc(9.75),
      reducedBy: usdc(0.25),
    });
  });
  it("names the most it can send when a partial amount does not fit", () => {
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(9.9), feeBaseUnits: usdc(0.25) });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.problem).toContain("at most 9.75 USDC");
  });
  it("refuses more than the agent holds when there is no fee", () => {
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(3), amountBaseUnits: usdc(4), feeBaseUnits: BigInt(0) });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.problem).toContain("holds 3.00 USDC");
  });
  it("refuses when the fee alone is more than the agent holds", () => {
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(0.2), amountBaseUnits: usdc(0.2), feeBaseUnits: usdc(0.25) });
    expect(fit.ok).toBe(false);
  });
  it("never shrinks a typo into a withdraw-all: 400 against 40 is refused", () => {
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(40), amountBaseUnits: usdc(400), feeBaseUnits: usdc(0.25) });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.problem).toContain("holds 40.00 USDC");
  });
  it("reads a request within a cent above the balance as everything", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(40), amountBaseUnits: usdc(40.005), feeBaseUnits: BigInt(0) })).toEqual({
      ok: true,
      amountBaseUnits: usdc(40),
      reducedBy: usdc(0.005),
    });
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(40), amountBaseUnits: usdc(40.02), feeBaseUnits: BigInt(0) }).ok).toBe(false);
  });
  it("sends exactly the amount or nothing when exact — a fee sweep never moves less than it settles", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(1.195), amountBaseUnits: usdc(1.2), feeBaseUnits: BigInt(0), exact: true }).ok).toBe(false);
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(1.2), amountBaseUnits: usdc(1.2), feeBaseUnits: BigInt(0), exact: true })).toEqual({
      ok: true,
      amountBaseUnits: usdc(1.2),
      reducedBy: BigInt(0),
    });
  });
});

describe("solWithdrawalProblem", () => {
  it("lets the agent empty its wallet to exactly zero", () => {
    expect(solWithdrawalProblem({ balanceLamports: 7_047_350, lamports: BigInt(7_047_350) })).toBeNull();
    expect(solWithdrawalProblem({ balanceLamports: 7_047_350, lamports: BigInt(1_000_000) })).toBeNull();
  });
  it("refuses more than it holds, and a remainder under the rent-exempt minimum", () => {
    expect(solWithdrawalProblem({ balanceLamports: 1_000_000, lamports: BigInt(2_000_000) })).toMatch(/holds 0.001 SOL/);
    const sliver = solWithdrawalProblem({
      balanceLamports: 1_000_000,
      lamports: BigInt(1_000_000 - RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS + 1),
    });
    expect(sliver).toMatch(/Withdraw all 0.001 SOL/);
    expect(solWithdrawalProblem({ balanceLamports: 1, lamports: BigInt(0) })).toMatch(/greater than zero/);
  });
  it("keeps the agent's last SOL back — the drip-then-withdraw loop has nothing to take", () => {
    expect(AGENT_SOL_KEPT_LAMPORTS).toBe(Math.round(AGENT_SOL_KEPT * 1e9));
    // Right after a 0.01 SOL drip, with no SOL of the owner's in it: nothing to withdraw.
    const dripped = solWithdrawalProblem({ balanceLamports: 9_995_000, lamports: BigInt(9_995_000), keepLamports: AGENT_SOL_KEPT_LAMPORTS });
    expect(dripped).toMatch(/no SOL to spare/);
    // An owner who deposited 1 SOL gets all but the kept amount.
    const owner = 1_000_000_000;
    expect(solWithdrawalProblem({ balanceLamports: owner, lamports: BigInt(owner - AGENT_SOL_KEPT_LAMPORTS), keepLamports: AGENT_SOL_KEPT_LAMPORTS })).toBeNull();
    expect(solWithdrawalProblem({ balanceLamports: owner, lamports: BigInt(owner), keepLamports: AGENT_SOL_KEPT_LAMPORTS })).toMatch(
      /most it can send is 0.984 SOL/,
    );
  });
  it("refuses to open a never-used wallet with less than the rent-exempt minimum, in words", () => {
    const base = { balanceLamports: 1_000_000_000, keepLamports: AGENT_SOL_KEPT_LAMPORTS, rentExemptLamports: 890_880 };
    expect(solWithdrawalProblem({ ...base, lamports: BigInt(500_000), destinationLamports: 0 })).toMatch(/never held SOL.*0.00089088 SOL/);
    expect(solWithdrawalProblem({ ...base, lamports: BigInt(500_000), destinationLamports: 5 })).toBeNull();
    expect(solWithdrawalProblem({ ...base, lamports: BigInt(890_880), destinationLamports: 0 })).toBeNull();
  });
});

describe("the bytes the platform co-signs", () => {
  const agent = Keypair.generate();
  const platform = Keypair.generate();
  const build = (amount: number) =>
    buildAgentUsdcTransfer({
      agent: agent.publicKey.toBase58(),
      destinationOwner: OWNER,
      feePayer: platform.publicKey.toBase58(),
      amountBaseUnits: BigInt(amount),
      openAccount: null,
      blockhash: BLOCKHASH,
    });

  it("match only when the message is byte-for-byte the one this server built", () => {
    const built = build(1_000_000);
    const tx = VersionedTransaction.deserialize(built);
    tx.sign([agent]);
    expect(sameMessage(built, tx.serialize())).toBe(true);
    expect(sameMessage(built, build(1_000_001))).toBe(false);
    expect(sameMessage(built, new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("count the empty signature slots", () => {
    const tx = VersionedTransaction.deserialize(build(1));
    expect(missingSignatures(tx.serialize())).toBe(2);
    tx.sign([agent]);
    expect(missingSignatures(tx.serialize())).toBe(1);
    tx.sign([platform]);
    expect(missingSignatures(tx.serialize())).toBe(0);
    expect(missingSignatures(new Uint8Array([9]))).toBe(-1);
  });

  it("know their transaction id before it is sent: the fee payer's signature", () => {
    const tx = VersionedTransaction.deserialize(build(1));
    expect(transactionId(tx.serialize())).toBeNull();
    tx.sign([agent, platform]);
    expect(transactionId(tx.serialize())).toBe(base58.encode(tx.signatures[0]));
    expect(transactionId(new Uint8Array([1]))).toBeNull();
  });
});

describe("routing around the wallet policy's cap", () => {
  const usdc = (n: number) => BigInt(Math.round(n * 1e6));
  it("sponsors SOL, uncapped agents, and anything at or under the cap, unsplit", () => {
    expect(planAgentTransferRoute({ asset: "native", amountBaseUnits: usdc(1e6), capBaseUnits: usdc(1), destinationExempt: false })).toMatchObject({ route: "sponsored", split: false });
    expect(planAgentTransferRoute({ asset: "usdc", amountBaseUnits: usdc(40), capBaseUnits: null, destinationExempt: false })).toMatchObject({ route: "sponsored", split: false });
    expect(planAgentTransferRoute({ asset: "usdc", amountBaseUnits: usdc(5), capBaseUnits: usdc(5), destinationExempt: false })).toMatchObject({ route: "sponsored", split: false });
  });
  it("splits over-cap transfers home or to the platform", () => {
    expect(planAgentTransferRoute({ asset: "usdc", amountBaseUnits: usdc(40), capBaseUnits: usdc(5), destinationExempt: true })).toMatchObject({ route: "sponsored", split: true });
  });
  it("refuses an over-cap transfer to a guarded address — never the drip-funded Privy transfer", () => {
    // The drain: a $1 cap, $1.50 to a second wallet of the attacker's. That used to be
    // Privy's `transfer`, which dripped 0.01 SOL into the agent for a 5,000-lamport fee
    // and stranded the rest; repeat per agent. Now nothing is sent and nothing is dripped.
    const route = planAgentTransferRoute({ asset: "usdc", amountBaseUnits: usdc(1.5), capBaseUnits: usdc(1), destinationExempt: false });
    expect(route.route).toBe("refused");
    expect(overCapRefusal(usdc(1))).toMatch(/1\.00 USDC per-transaction limit.*your own Tocker wallet.*Nothing was sent/);
  });
  it("reads the cap exactly as applyAgentBudgetPolicy writes it, and only when a Solana policy is attached", () => {
    expect(solanaCapBaseUnits({ perTxUsd: 2.5, policyIds: { solana: "pol_1" } })).toBe(BigInt(2_500_000));
    expect(solanaCapBaseUnits({ perTxUsd: 2.5, policyIds: { base: "pol_2" } })).toBeNull();
    expect(solanaCapBaseUnits(null)).toBeNull();
  });
  it("exempts the platform's and the owner's USDC accounts, deduplicated, skipping junk", () => {
    expect(uncappedSolanaDestinations({ platformAddress: PLATFORM, ownerAddresses: [OWNER, OWNER, "not-an-address"] })).toEqual([
      ata(PLATFORM),
      ata(OWNER),
    ]);
  });
});

describe("isPolicyDenial", () => {
  const apiError = (status: number, message: string, error?: unknown) => Object.assign(new Error(message), { status, error });
  it("is a refusal only when Privy says so: a 403, or a 400/422 about the policy", () => {
    expect(isPolicyDenial(apiError(403, "403 Forbidden"))).toBe(true);
    expect(isPolicyDenial(apiError(400, "400 Transaction denied by policy"))).toBe(true);
    expect(isPolicyDenial(apiError(422, "422", { error: "Policy violation" }))).toBe(true);
  });
  it("is never a timeout, a rate limit, an outage or an unrelated bad request", () => {
    expect(isPolicyDenial(new Error("Request timed out."))).toBe(false);
    expect(isPolicyDenial(apiError(429, "429 Too Many Requests"))).toBe(false);
    expect(isPolicyDenial(apiError(500, "500 policy engine unavailable"))).toBe(false);
    expect(isPolicyDenial(apiError(400, "400 invalid transaction encoding"))).toBe(false);
    expect(isPolicyDenial(null)).toBe(false);
  });
});

describe("isAgentUsdcShort", () => {
  const refused = (message: string) => Object.assign(new Error(message), { name: "CosignRefused" });
  const token = TOKEN_PROGRAM_ID.toBase58();
  it("matches the token program's InsufficientFunds exactly, and nothing else", () => {
    expect(isAgentUsdcShort(refused(`would fail on chain: Program ${token} failed: custom program error: 0x1`))).toBe(true);
    expect(isAgentUsdcShort(refused(`Program ${token} failed: custom program error: 0x11`))).toBe(false);
    expect(isAgentUsdcShort(new Error(`Program ${token} failed: custom program error: 0x1`))).toBe(false);
  });
});

describe("budgetRules with the W8 exemption", () => {
  type Rule = ReturnType<typeof budgetRules>[number];
  const caps = (rules: Rule[]) => rules.filter((r) => r.action === "DENY" && r.name.startsWith("Cap "));

  it("writes the same rules as before when no exemption is passed", () => {
    const rules = budgetRules("solana", "5000000");
    expect(caps(rules)).toHaveLength(4);
    for (const rule of caps(rules)) {
      expect(rule.conditions).toEqual([
        expect.objectContaining({ field_source: "solana_token_program_instruction", operator: "gt", value: "5000000" }),
      ]);
    }
  });

  it("ANDs a `neq` on the destination into every Solana cap rule, so only transfers elsewhere are capped", () => {
    const exempt = uncappedSolanaDestinations({ platformAddress: PLATFORM, ownerAddresses: [OWNER] });
    const rules = budgetRules("solana", "5000000", { uncappedSolanaDestinations: exempt });
    expect(caps(rules).map((r) => r.method).sort()).toEqual(
      ["signAndSendTransaction", "signAndSendTransaction", "signTransaction", "signTransaction"],
    );
    for (const rule of caps(rules)) {
      const instruction = rule.name.startsWith("Cap TransferChecked") ? "TransferChecked" : "Transfer";
      expect(rule.conditions).toEqual([
        { field_source: "solana_token_program_instruction", field: `${instruction}.amount`, operator: "gt", value: "5000000" },
        ...exempt.map((account) => ({
          field_source: "solana_token_program_instruction",
          field: `${instruction}.destination`,
          operator: "neq",
          value: account,
        })),
      ]);
    }
    // Key exports stay denied; the catch-all and the transfer rule are untouched.
    expect(rules.filter((r) => r.method === "exportPrivateKey")[0]?.action).toBe("DENY");
    expect(rules.some((r) => r.method === "*" && r.action === "ALLOW")).toBe(true);
    expect(rules.some((r) => r.method === "transfer" && r.action === "ALLOW")).toBe(true);
  });

  it("leaves Base alone", () => {
    expect(budgetRules("base", "5000000", { uncappedSolanaDestinations: [ata(OWNER)] })).toEqual(budgetRules("base", "5000000"));
  });
});

describe("withdrawalFromOutcome", () => {
  const outcome = { signature: "5Uc9", feePayer: PLATFORM, budgetLamports: 10_000, delivered: 5, accountFeeUsdc: 0 };
  it("is succeeded only when confirmed, pending while in flight", () => {
    expect(withdrawalFromOutcome({ ...outcome, status: "confirmed" })).toMatchObject({ status: "succeeded", txHash: "5Uc9", route: "sponsored" });
    expect(withdrawalFromOutcome({ ...outcome, status: "pending", lastValidBlockHeight: 42 })).toMatchObject({
      status: "pending",
      txHash: "5Uc9",
      lastValidBlockHeight: 42,
    });
  });
  it("throws TransferNotSent for a transaction that failed or expired — nothing moved", () => {
    expect(() => withdrawalFromOutcome({ ...outcome, status: "failed" })).toThrow(/failed on chain/);
    try {
      withdrawalFromOutcome({ ...outcome, status: "expired" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).name).toBe("TransferNotSent");
      expect((err as Error).message).toMatch(/expired/);
    }
  });
  it("hands the client what arrived and any account fee, and none of the routing", () => {
    const sent = withdrawalFromOutcome({ ...outcome, status: "confirmed", delivered: 9.75, accountFeeUsdc: 0.25 });
    expect(withdrawalForClient(sent)).toEqual({
      txHash: "5Uc9",
      actionId: "solana-sponsored:5Uc9",
      status: "succeeded",
      delivered: 9.75,
      accountFeeUsdc: 0.25,
      tradingFeesUsdc: 0,
    });
    expect(withdrawalForClient(withdrawalFromOutcome({ ...outcome, status: "confirmed", tradingFeesUsdc: 0.3 })).tradingFeesUsdc).toBe(0.3);
  });
});

describe("an owner's withdrawal pays what the agent owes Tocker first", () => {
  const usdc = (n: number) => BigInt(Math.round(n * 1e6));

  it("takes accrued trading fees out of a withdraw-all — trade, withdraw everything, and the fees still reach Tocker", () => {
    // $10 in the agent, $0.30 of fees accrued since the last sweep (which waits for $1).
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(10), feeBaseUnits: BigInt(0), owedBaseUnits: usdc(0.3) });
    expect(fit).toEqual({ ok: true, amountBaseUnits: usdc(9.7), reducedBy: usdc(0.3) });
    if (!fit.ok) return;
    const instructions = decode(
      buildAgentUsdcTransfer({
        agent: AGENT,
        destinationOwner: OWNER,
        feePayer: PLATFORM,
        amountBaseUnits: fit.amountBaseUnits,
        openAccount: null,
        tockerFeesBaseUnits: usdc(0.3),
        blockhash: BLOCKHASH,
      }),
    ).instructions;
    const byDestination = (owner: string) =>
      instructions.filter((ix) => ix.accounts[2]?.key === ata(owner)).reduce((sum, ix) => sum + transferAmount(ix.data), BigInt(0));
    expect(byDestination(OWNER)).toBe(usdc(9.7));
    expect(byDestination(PLATFORM)).toBe(usdc(0.3));
    // Everything the agent held leaves it, and the fees are in the same transaction.
    expect(byDestination(OWNER) + byDestination(PLATFORM)).toBe(usdc(10));
  });

  it("makes a partial withdrawal fit beside the fees, and says so", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(9), feeBaseUnits: BigInt(0), owedBaseUnits: usdc(0.3) }).ok).toBe(true);
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(9.9), feeBaseUnits: BigInt(0), owedBaseUnits: usdc(0.3) });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.problem).toMatch(/0\.30 USDC it owes in Tocker trading fees.*at most 9\.70 USDC/);
    const both = fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(9.9), feeBaseUnits: usdc(0.25), owedBaseUnits: usdc(0.3) });
    if (!both.ok) expect(both.problem).toMatch(/trading fees and a one-time 0\.25 USDC.*at most 9\.45 USDC/);
    const owedAll = fitUsdcWithdrawal({ heldBaseUnits: usdc(0.2), amountBaseUnits: usdc(0.2), feeBaseUnits: BigInt(0), owedBaseUnits: usdc(0.3) });
    expect(owedAll.ok).toBe(false);
  });

  it("says fees that are not whole cents as they stand, and the most that can go to the same precision", () => {
    // Half a cent owed, the fee on a $1 fill. "0.00 USDC it owes" beside a refusal explains nothing.
    const fit = fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(9.999), feeBaseUnits: BigInt(0), owedBaseUnits: usdc(0.005) });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.problem).toMatch(/the 0\.005 USDC it owes in Tocker trading fees comes out first, so it can send at most 9\.995 USDC here/);
    // What fits beside them still goes, to the micro-USDC.
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(10), amountBaseUnits: usdc(9.995), feeBaseUnits: BigInt(0), owedBaseUnits: usdc(0.005) })).toMatchObject({
      ok: true,
      amountBaseUnits: usdc(9.995),
    });
  });

  it("puts the account fee and the trading fees in one transfer to the platform, split under the cap, and never on a sweep", () => {
    const instructions = agentUsdcTransferInstructions({
      agent: AGENT,
      destinationOwner: OWNER,
      feePayer: PLATFORM,
      amountBaseUnits: usdc(2),
      openAccount: { feeBaseUnits: usdc(0.25) },
      tockerFeesBaseUnits: usdc(1.9),
      capBaseUnits: usdc(2),
    });
    const toPlatform = instructions.filter((ix) => ix.keys[2]?.pubkey.toBase58() === ata(PLATFORM));
    expect(toPlatform.map((ix) => transferAmount(ix.data))).toEqual([usdc(2), usdc(0.15)]);
    expect(() =>
      agentUsdcTransferInstructions({ agent: AGENT, destinationOwner: PLATFORM, feePayer: PLATFORM, amountBaseUnits: usdc(1), openAccount: null, tockerFeesBaseUnits: usdc(0.1) }),
    ).toThrow(/no trading fees/);
    expect(() =>
      agentUsdcTransferInstructions({ agent: AGENT, destinationOwner: OWNER, feePayer: PLATFORM, amountBaseUnits: usdc(1), openAccount: null, tockerFeesBaseUnits: usdc(-1) }),
    ).toThrow(/negative/);
  });
});

describe("the owner's minimum", () => {
  const usdc = (n: number) => BigInt(Math.round(n * 1e6));
  const min = BigInt(MIN_AGENT_USDC_WITHDRAWAL_BASE_UNITS);

  it("is the user side's $1", () => {
    expect(MIN_AGENT_USDC_WITHDRAWAL_BASE_UNITS).toBe(Math.round(MIN_SPONSORED_WITHDRAWAL_USDC * 1e6));
  });

  it("refuses dust — the 0.000001 USDC loop the platform paid 10,000 lamports a turn for", () => {
    const dust = fitUsdcWithdrawal({ heldBaseUnits: usdc(50), amountBaseUnits: BigInt(1), feeBaseUnits: BigInt(0), minBaseUnits: min });
    expect(dust.ok).toBe(false);
    if (!dust.ok) expect(dust.problem).toMatch(/smallest withdrawal is 1\.00 USDC.*everything/);
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(50), amountBaseUnits: usdc(0.99), feeBaseUnits: BigInt(0), minBaseUnits: min }).ok).toBe(false);
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(50), amountBaseUnits: usdc(1), feeBaseUnits: BigInt(0), minBaseUnits: min }).ok).toBe(true);
  });

  it("always lets everything go, however little it is", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(0.4), amountBaseUnits: usdc(0.4), feeBaseUnits: BigInt(0), minBaseUnits: min })).toEqual({
      ok: true,
      amountBaseUnits: usdc(0.4),
      reducedBy: BigInt(0),
    });
  });

  it("does not apply to a fee sweep, which is exact and passes no minimum", () => {
    expect(fitUsdcWithdrawal({ heldBaseUnits: usdc(5), amountBaseUnits: usdc(0.3), feeBaseUnits: BigInt(0), exact: true }).ok).toBe(true);
  });

  it("refuses a SOL withdrawal under 0.001 SOL unless it is everything the agent can spare", () => {
    const base = { balanceLamports: 1_000_000_000, keepLamports: AGENT_SOL_KEPT_LAMPORTS, minLamports: MIN_AGENT_SOL_WITHDRAWAL_LAMPORTS };
    expect(solWithdrawalProblem({ ...base, lamports: BigInt(1) })).toMatch(/smallest SOL withdrawal is 0\.001 SOL/);
    expect(solWithdrawalProblem({ ...base, lamports: BigInt(MIN_AGENT_SOL_WITHDRAWAL_LAMPORTS) })).toBeNull();
    const spare = AGENT_SOL_KEPT_LAMPORTS + 500_000;
    expect(solWithdrawalProblem({ ...base, balanceLamports: spare, lamports: BigInt(500_000) })).toBeNull();
  });
});

describe("rent reads the platform will trust", () => {
  it("accepts mainnet's figures and the long-standing ones, and nothing ten times over", () => {
    expect(saneRentLamports(1_488_440, TOKEN_ACCOUNT_RENT_BAND)).toBe(1_488_440);
    expect(saneRentLamports(2_039_280, TOKEN_ACCOUNT_RENT_BAND)).toBe(2_039_280);
    expect(saneRentLamports(14_884_400, TOKEN_ACCOUNT_RENT_BAND)).toBeNull();
    expect(saneRentLamports(650_240, EMPTY_ACCOUNT_RENT_BAND)).toBe(650_240);
    expect(saneRentLamports(RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS, EMPTY_ACCOUNT_RENT_BAND)).toBe(RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS);
    expect(saneRentLamports(8_908_800, EMPTY_ACCOUNT_RENT_BAND)).toBeNull();
    expect(saneRentLamports("1488440", TOKEN_ACCOUNT_RENT_BAND)).toBeNull();
    expect(saneRentLamports(Number.NaN, TOKEN_ACCOUNT_RENT_BAND)).toBeNull();
  });
});

describe("largestSplitThatFits", () => {
  const usdc = (n: number) => BigInt(Math.round(n * 1e6));
  const plan = (over: Partial<AgentTransferPlan>): AgentTransferPlan => ({
    asset: "usdc",
    route: "sponsored",
    split: true,
    reason: "",
    agentAddress: AGENT,
    destination: OWNER,
    feePayer: PLATFORM,
    toPlatform: false,
    capBaseUnits: usdc(1),
    amountBaseUnits: usdc(100),
    feeBaseUnits: BigInt(0),
    owedBaseUnits: BigInt(0),
    opensAccount: false,
    rentLamports: 0,
    delivered: 100,
    accountFeeUsdc: 0,
    tradingFeesUsdc: 0,
    ...over,
  });

  it("names the most one withdrawal carries at the cap: whole pieces that fit beside everything else", () => {
    const most = largestSplitThatFits(plan({}));
    expect(most).toBe(usdc(MAX_TRANSFER_PIECES));
    const withFees = largestSplitThatFits(plan({ owedBaseUnits: usdc(0.3), opensAccount: true, feeBaseUnits: usdc(0.25), rentLamports: 1_488_440 }));
    expect(withFees).toBeGreaterThan(BigInt(0));
    expect(withFees).toBeLessThan(most);
    expect(withFees % usdc(1)).toBe(BigInt(0));
  });

  it("is zero without a cap", () => {
    expect(largestSplitThatFits(plan({ capBaseUnits: null }))).toBe(BigInt(0));
  });
});

describe("waitSentence", () => {
  it("reads as seconds, then minutes", () => {
    expect(waitSentence(40)).toBe("40 seconds");
    expect(waitSentence(0)).toBe("1 seconds");
    expect(waitSentence(420)).toBe("7 minutes");
  });
});

describe("withdrawFromAgentSolana's limits, before anything touches the chain", () => {
  let db: Db;
  beforeAll(async () => {
    db = await setupTestDb();
    // Only so "Privy is not configured" does not end the attempt before the limits run.
    // Every attempt here stops at the seeded paper wallet: nothing reaches Privy or the chain.
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-app");
    vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
  }, 120_000);
  afterAll(() => vi.unstubAllEnvs());
  beforeEach(() => limiter.reset());

  const attempt = (agentId: string, extra: Partial<Parameters<typeof withdrawFromAgentSolana>[0]> = {}) =>
    withdrawFromAgentSolana({ agentId, asset: "usdc", amount: 5, toAddress: OWNER, ...extra }).then(
      () => "sent",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

  it("rate-limits an owner's withdrawals — the dust loop has a ceiling even above the floor", async () => {
    const { agentId } = await seedAgent(db, { mode: "live" });
    const outcomes: string[] = [];
    for (let i = 0; i <= OWNER_WITHDRAWAL_BURST_LIMIT.limit; i += 1) outcomes.push(await attempt(agentId));
    // The seeded wallets are paper, so every allowed attempt stops at the wallet read.
    expect(outcomes.slice(0, OWNER_WITHDRAWAL_BURST_LIMIT.limit).every((m) => /Paper wallets/.test(m))).toBe(true);
    expect(outcomes.at(-1)).toMatch(/a lot of withdrawals in a short time/);
  });

  it("counts the day's withdrawals from the audit log, which every instance shares", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    await db.insert(schema.auditEvents).values(
      Array.from({ length: OWNER_WITHDRAWALS_PER_DAY }, (_, i) => ({
        id: `audit_${agentId}_${i}`,
        userId,
        kind: "withdraw" as const,
        agentId,
        summary: "Withdrew 5 USDC",
        metadata: { chain: "solana", route: "sponsored" },
      })),
    );
    expect(await attempt(agentId)).toMatch(/50 withdrawals out of your agents in the last 24 hours/);
    // Fee sweeps and rent recycles write `withdraw` rows too, with no route: they do not count.
    const other = await seedAgent(db, { mode: "live" });
    await db.insert(schema.auditEvents).values(
      Array.from({ length: OWNER_WITHDRAWALS_PER_DAY }, (_, i) => ({
        id: `audit_${other.agentId}_${i}`,
        userId: other.userId,
        kind: "withdraw" as const,
        agentId: other.agentId,
        summary: "Settled fees",
        metadata: { reason: "platform_fee_settlement" },
      })),
    );
    expect(await attempt(other.agentId)).toMatch(/Paper wallets/);
  });

  it("lets the platform's fee sweep through the owner's limits", async () => {
    const { agentId } = await seedAgent(db, { mode: "live" });
    for (let i = 0; i < OWNER_WITHDRAWAL_BURST_LIMIT.limit; i += 1) await attempt(agentId);
    expect(await attempt(agentId)).toMatch(/a lot of withdrawals/);
    expect(await attempt(agentId, { feeSweep: true, toAddress: PLATFORM, exact: true })).toMatch(/Paper wallets/);
  });

  it("runs one transfer out of an agent at a time — parallel withdrawals are not both co-signed", async () => {
    const { agentId } = await seedAgent(db, { mode: "live" });
    const [first, second] = await Promise.all([attempt(agentId), attempt(agentId)]);
    expect([first, second].sort()).toEqual([
      "A transfer out of this agent is already under way. Wait for it to finish, then try again.",
      "Paper wallets hold no real funds",
    ]);
  });
});
