import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { base58 } from "@scure/base";
import {
  JupiterError,
  JupiterExecutor,
  checkSwapShape,
  decodeJupiterRoute,
  fallsBackToAgentGas,
  isNoQuoteFailure,
  notSentNote,
  orderErrorHint,
  orderFeeLamports,
  orderNotionalUsd,
  orderPayerFor,
  parseUltraOrder,
  sameMessageBytes,
  sellBaseUnits,
  signatureOfSignedTransaction,
  sponsoredOrderProblem,
  sponsoredSwapsEnabled,
  swapExpectation,
  takerPaysGas,
  ultraOrderParams,
  venueFeeUsd,
  viewSwapTransaction,
  manualSlippageFor,
  isTransientOrderFailure,
  type JupiterExecutorOptions,
  type JupiterHandle,
  type OrderRoute,
} from "./jupiter";
import { clampToHeld, floorBaseUnits, isDustBaseUnits, type TradeRequest } from "./executor";
import { associatedTokenAddress, createAtaIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from "@/lib/wallets/solana-transfer";
import {
  ATA_RENT_LAMPORTS,
  MAX_SPONSORED_PRIORITY_LAMPORTS,
  SPONSORED_SWAP_MARGIN_LAMPORTS,
  SPONSORED_SWAP_RESERVE_LAMPORTS,
} from "@/lib/wallets/gas";

// The effectful edges of the executor, replaced for the flow tests at the bottom. The
// pure tests above them never reach any of these.
const edges = vi.hoisted(() => ({
  platformFeePayer: vi.fn(),
  signAsServerWallet: vi.fn(),
  cosignAsPlatform: vi.fn(),
  signAsPlatformTaker: vi.fn(),
  privySignTransaction: vi.fn(),
  ensureAgentGas: vi.fn(),
  ensureSponsorCapacity: vi.fn(),
  getPriceUsd: vi.fn(),
}));

vi.mock("@/lib/wallets/solana-cosign", () => {
  class CosignRefused extends Error {
    constructor(reason: string) {
      super(`Tocker will not pay for this transaction: ${reason}. Nothing was sent.`);
      this.name = "CosignRefused";
    }
  }
  return {
    CosignRefused,
    platformFeePayer: edges.platformFeePayer,
    signAsServerWallet: edges.signAsServerWallet,
    cosignAsPlatform: edges.cosignAsPlatform,
    signAsPlatformTaker: edges.signAsPlatformTaker,
  };
});

vi.mock("@/lib/wallets/solana-sponsored", () => ({
  FEE_WALLET_REFILLING: "Tocker's fee wallet is refilling — try again in a minute.",
  ensureSponsorCapacity: edges.ensureSponsorCapacity,
}));

vi.mock("@/lib/privy", () => ({
  privy: () => ({ wallets: () => ({ solana: () => ({ signTransaction: edges.privySignTransaction }) }) }),
  authorizationContext: () => ({ authorization_private_keys: [] }),
}));

vi.mock("@/lib/wallets/gas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wallets/gas")>()),
  ensureAgentGas: edges.ensureAgentGas,
}));

vi.mock("./prices", () => ({ getPriceUsd: edges.getPriceUsd }));

/**
 * The bodies below are verbatim shapes from live Ultra `/order` probes on 2026-09-21 —
 * one with a taker that cannot fill (random keypair), one with a funded taker.
 */
const TAKER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

const FUNDED_TAKER_ORDER = {
  swapType: "aggregator",
  router: "metis",
  requestId: "01a0c37e-3cf6-74a1-b6f5-4237ab591c05",
  inAmount: "1000000",
  outAmount: "8632667",
  swapMode: "ExactIn",
  slippageBps: 25,
  feeMint: "So11111111111111111111111111111111111111112",
  feeBps: 2,
  platformFee: { feeBps: 2, feeMint: "So11111111111111111111111111111111111111112" },
  taker: TAKER,
  gasless: false,
  signatureFeeLamports: 5000,
  signatureFeePayer: TAKER,
  prioritizationFeeLamports: 2047,
  prioritizationFeePayer: TAKER,
  rentFeeLamports: 0,
  rentFeePayer: TAKER,
  transaction: "AQAAA...",
  errorCode: null,
  errorMessage: null,
  mode: "ultra",
};

const CANNOT_FILL_ORDER = {
  router: "metis",
  requestId: "01a0c37e-3cf6-74a1-b6f5-4237ab591c06",
  inAmount: "1000000",
  outAmount: "8632667",
  slippageBps: 27,
  feeBps: 2,
  gasless: true,
  signatureFeeLamports: 0,
  signatureFeePayer: null,
  prioritizationFeeLamports: 0,
  prioritizationFeePayer: null,
  rentFeeLamports: 0,
  rentFeePayer: null,
  transaction: "AQAAA...",
  errorCode: 1,
  errorMessage: "Insufficient funds",
  error: "Insufficient funds",
  mode: "ultra",
};

describe("parseUltraOrder", () => {
  it("carries the fee-payer and error fields the old parser threw away", () => {
    const order = parseUltraOrder(FUNDED_TAKER_ORDER);
    expect(order).not.toBeNull();
    expect(order?.gasless).toBe(false);
    expect(order?.mode).toBe("ultra");
    expect(order?.router).toBe("metis");
    expect(order?.signatureFeePayer).toBe(TAKER);
    expect(order?.signatureFeeLamports).toBe(5000);
    expect(order?.prioritizationFeeLamports).toBe(2047);
    expect(order?.rentFeePayer).toBe(TAKER);
    expect(order?.feeBps).toBe(2);
    expect(order?.errorCode).toBeNull();
  });

  it("keeps Jupiter's own words for an order the taker cannot fill", () => {
    const order = parseUltraOrder(CANNOT_FILL_ORDER);
    expect(order?.errorCode).toBe(1);
    expect(order?.errorMessage).toBe("Insufficient funds");
    // A transaction is still present — which is exactly why the code used to sign it.
    expect(order?.transaction).toBe("AQAAA...");
  });

  it("falls back to platformFee.feeBps when the top-level field is missing", () => {
    const { feeBps: _dropped, ...withoutTopLevel } = FUNDED_TAKER_ORDER;
    expect(parseUltraOrder(withoutTopLevel)?.feeBps).toBe(2);
  });

  it("still refuses a body with no requestId or amounts", () => {
    expect(parseUltraOrder({ inAmount: "1", outAmount: "2" })).toBeNull();
    expect(parseUltraOrder(null)).toBeNull();
    expect(parseUltraOrder("nope")).toBeNull();
  });
});

describe("orderFeeLamports / takerPaysGas", () => {
  it("adds up what the fee payer must cover", () => {
    expect(orderFeeLamports(parseUltraOrder(FUNDED_TAKER_ORDER)!)).toBe(7047);
    expect(orderFeeLamports(parseUltraOrder(CANNOT_FILL_ORDER)!)).toBe(0);
  });

  it("says the taker pays when Jupiter named it as a fee payer", () => {
    expect(takerPaysGas(parseUltraOrder(FUNDED_TAKER_ORDER)!, TAKER)).toBe(true);
  });

  it("says the taker does not pay on a gasless order", () => {
    expect(takerPaysGas(parseUltraOrder(CANNOT_FILL_ORDER)!, TAKER)).toBe(false);
  });

  it("says the taker does not pay when somebody else is the fee payer", () => {
    const order = parseUltraOrder({ ...FUNDED_TAKER_ORDER, signatureFeePayer: "Platform", prioritizationFeePayer: "Platform", rentFeePayer: "Platform" })!;
    expect(takerPaysGas(order, TAKER)).toBe(false);
  });
});

describe("venueFeeUsd", () => {
  it("prices Jupiter's take instead of claiming the trade was free", () => {
    expect(venueFeeUsd(2, 10)).toBeCloseTo(0.002, 9);
    expect(venueFeeUsd(0, 10)).toBe(0);
    expect(venueFeeUsd(undefined, 10)).toBe(0);
    expect(venueFeeUsd(2, 0)).toBe(0);
  });
});

describe("floorBaseUnits", () => {
  it("floors rather than rounds — never ask for a unit the wallet does not hold", () => {
    expect(floorBaseUnits(1.9999999, 6)).toBe("1999999");
    expect(floorBaseUnits(0.5, 9)).toBe("500000000");
    expect(floorBaseUnits(0, 6)).toBe("0");
    expect(floorBaseUnits(-1, 6)).toBe("0");
    expect(floorBaseUnits(Number.NaN, 6)).toBe("0");
  });

  it("survives an 18-decimal amount that overflows an exact double", () => {
    // `(1234.5678).toFixed(20)` is "1234.56780000000003383" — the old shape of this
    // helper would have asked the venue for 33833 base units nobody holds.
    expect(floorBaseUnits(1234.5678, 18)).toBe("1234567800000000000000");
  });

  it("handles a sub-micro price in exponential notation", () => {
    expect(floorBaseUnits(1e-7, 9)).toBe("100");
    expect(floorBaseUnits(2.5e-7, 6)).toBe("0");
    expect(floorBaseUnits(2.6936e-6, 5)).toBe("0");
  });
});

describe("sellBaseUnits", () => {
  const decimals = 6;

  it("uses the exact held amount the caller passed, not amountUsd / price", () => {
    // The stop-loss case: mark 1.05, route price 1.00. Sizing by USD asks for 9.52
    // tokens when the agent holds 10 — the old path asked for more than it had.
    const amount = sellBaseUnits({
      amountToken: 10,
      amountUsd: 10,
      priceUsd: 1.05,
      decimals,
      heldBaseUnits: BigInt(10_000_000),
    });
    expect(amount).toBe("10000000");
  });

  it("clamps a request above the on-chain balance down to the balance", () => {
    const amount = sellBaseUnits({
      amountToken: 12,
      amountUsd: 12,
      priceUsd: 1,
      decimals,
      heldBaseUnits: BigInt(9_500_000),
    });
    expect(amount).toBe("9500000");
  });

  it("falls back to amountUsd / price only when no token amount is given", () => {
    const amount = sellBaseUnits({
      amountUsd: 5,
      priceUsd: 2,
      decimals,
      heldBaseUnits: BigInt(10_000_000),
    });
    expect(amount).toBe("2500000");
  });

  it("lets the request stand when the balance could not be read", () => {
    const amount = sellBaseUnits({ amountToken: 7, amountUsd: 7, priceUsd: 1, decimals, heldBaseUnits: null });
    expect(amount).toBe("7000000");
  });

  it("reports nothing to sell when the wallet is empty", () => {
    const amount = sellBaseUnits({ amountToken: 7, amountUsd: 7, priceUsd: 1, decimals, heldBaseUnits: BigInt(0) });
    expect(amount).toBe("0");
  });
});

describe("clampToHeld", () => {
  it("passes the request through when it fits", () => {
    expect(clampToHeld("100", BigInt(500))).toBe("100");
  });
  it("never invents a balance we could not read", () => {
    expect(clampToHeld("100", null)).toBe("100");
  });
});

describe("isDustBaseUnits", () => {
  it("treats a sub-cent residual as a closed position", () => {
    // 1000 base units of a 6-decimal token at $1 = $0.001.
    expect(isDustBaseUnits(BigInt(1000), 6, 1)).toBe(true);
  });
  it("does not close a position that is still worth something", () => {
    expect(isDustBaseUnits(BigInt(2_000_000), 6, 1)).toBe(false);
  });
  it("treats an empty balance as closed", () => {
    expect(isDustBaseUnits(BigInt(0), 6, 1)).toBe(true);
  });
  it("falls back to a single base unit when there is no price", () => {
    expect(isDustBaseUnits(BigInt(1), 6, 0)).toBe(true);
    expect(isDustBaseUnits(BigInt(5), 6, 0)).toBe(false);
  });
});

describe("manualSlippageFor", () => {
  it("asks for the ceiling only when Jupiter picked looser", () => {
    expect(manualSlippageFor(392, 100)).toBe(100);
    expect(manualSlippageFor(27, 100)).toBeNull();
    expect(manualSlippageFor(100, 100)).toBeNull();
  });
  it("leaves the order alone with no ceiling or no reported slippage", () => {
    expect(manualSlippageFor(392, 0)).toBeNull();
    expect(manualSlippageFor(undefined, 100)).toBeNull();
  });
});

describe("isTransientOrderFailure", () => {
  it("retries rate limits, server errors and Jupiter's momentary 'Failed to get quotes'", () => {
    expect(isTransientOrderFailure(429, "")).toBe(true);
    expect(isTransientOrderFailure(502, "bad gateway")).toBe(true);
    expect(isTransientOrderFailure(400, '{"requestId":"x","error":"Failed to get quotes"}')).toBe(true);
  });
  it("does not retry a real rejection", () => {
    expect(isTransientOrderFailure(400, '{"error":"invalid mint"}')).toBe(false);
    expect(isTransientOrderFailure(401, "")).toBe(false);
  });
});


// ------------------------------------------------------------------ sponsored swaps (W8)

describe("sponsoredSwapsEnabled (the kill switch)", () => {
  it("is on unless the operator says 0", () => {
    expect(sponsoredSwapsEnabled(undefined)).toBe(true);
    expect(sponsoredSwapsEnabled("")).toBe(true);
    expect(sponsoredSwapsEnabled("1")).toBe(true);
  });
  it("turns off on 0, false or off, however it is spelled", () => {
    expect(sponsoredSwapsEnabled("0")).toBe(false);
    expect(sponsoredSwapsEnabled(" 0 ")).toBe(false);
    expect(sponsoredSwapsEnabled("false")).toBe(false);
    expect(sponsoredSwapsEnabled("OFF")).toBe(false);
  });
});

describe("orderPayerFor / ultraOrderParams", () => {
  const PLATFORM = "8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza";
  const route = { inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: "Mint111", amount: "2000000" };

  it("names the platform as payer on an agent's order", () => {
    const payer = orderPayerFor({ agentId: "agent-1", enabled: true, platformAddress: PLATFORM, taker: TAKER });
    expect(payer).toBe(PLATFORM);
    expect(ultraOrderParams({ ...route, taker: TAKER, payer })).toEqual({ ...route, taker: TAKER, payer: PLATFORM });
  });

  it("never names a payer with the kill switch off", () => {
    const payer = orderPayerFor({ agentId: "agent-1", enabled: sponsoredSwapsEnabled("0"), platformAddress: PLATFORM, taker: TAKER });
    expect(payer).toBeNull();
    expect(ultraOrderParams({ ...route, taker: TAKER, payer })).not.toHaveProperty("payer");
  });

  it("never sponsors the platform's own refuel swap, or a platform that is the taker", () => {
    expect(orderPayerFor({ agentId: null, enabled: true, platformAddress: PLATFORM, taker: PLATFORM })).toBeNull();
    expect(orderPayerFor({ agentId: "agent-1", enabled: true, platformAddress: PLATFORM, taker: PLATFORM })).toBeNull();
    expect(orderPayerFor({ agentId: "agent-1", enabled: true, platformAddress: null, taker: TAKER })).toBeNull();
  });

  it("asks exactly what W7 asked when there is no payer — same keys, same order", () => {
    const query = new URLSearchParams(ultraOrderParams({ ...route, taker: TAKER, payer: null })).toString();
    expect(query).toBe(`inputMint=${route.inputMint}&outputMint=${route.outputMint}&amount=2000000&taker=${TAKER}`);
  });

  it("carries the manual-mode ceiling after the payer", () => {
    const params = ultraOrderParams({ ...route, taker: TAKER, payer: PLATFORM, slippageBps: 100 });
    expect(Object.keys(params)).toEqual(["inputMint", "outputMint", "amount", "taker", "payer", "slippageBps"]);
    expect(params.slippageBps).toBe("100");
  });
});

/** A live payer order, 2026-09-23: a buy into a new Token-2022 account, platform pays all. */
const PLATFORM_ADDRESS = "8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza";
const SPONSORED_ORDER = {
  ...FUNDED_TAKER_ORDER,
  slippageBps: 1000,
  feeBps: 10,
  gasless: true,
  signatureFeeLamports: 10000,
  signatureFeePayer: PLATFORM_ADDRESS,
  prioritizationFeeLamports: 26300,
  prioritizationFeePayer: PLATFORM_ADDRESS,
  rentFeeLamports: 1513840,
  rentFeePayer: PLATFORM_ADDRESS,
};

describe("sponsoredOrderProblem", () => {
  it("accepts an order where the platform pays every fee", () => {
    expect(sponsoredOrderProblem(parseUltraOrder(SPONSORED_ORDER)!, PLATFORM_ADDRESS, TAKER)).toBeNull();
  });
  it("refuses an order Jupiter did not build for our payer", () => {
    const order = parseUltraOrder({ ...SPONSORED_ORDER, signatureFeePayer: TAKER })!;
    expect(sponsoredOrderProblem(order, PLATFORM_ADDRESS, TAKER)).toMatch(/fee payer/);
  });
  it("refuses an order that leaves the rent on the agent", () => {
    const order = parseUltraOrder({ ...SPONSORED_ORDER, rentFeePayer: TAKER })!;
    expect(sponsoredOrderProblem(order, PLATFORM_ADDRESS, TAKER)).toMatch(/agent's wallet/);
  });
  it("refuses an order whose gas is past the per-swap cap", () => {
    const order = parseUltraOrder({ ...SPONSORED_ORDER, prioritizationFeeLamports: 3_000_000 })!;
    expect(sponsoredOrderProblem(order, PLATFORM_ADDRESS, TAKER)).toMatch(/over the 4000000/);
  });
  it("refuses a priority fee past what the trade's size allows (W8 review: $0.01 buys at 1.2M lamports)", () => {
    const order = parseUltraOrder({ ...SPONSORED_ORDER, prioritizationFeeLamports: 1_193_823 })!;
    expect(sponsoredOrderProblem(order, PLATFORM_ADDRESS, TAKER, 50_000)).toMatch(/1193823-lamport priority fee, more than the 50000/);
    expect(sponsoredOrderProblem(parseUltraOrder(SPONSORED_ORDER)!, PLATFORM_ADDRESS, TAKER, 50_000)).toBeNull();
  });
});

describe("orderNotionalUsd", () => {
  it("is the smaller of what was asked and what Jupiter quoted, so neither raises the allowance alone", () => {
    expect(orderNotionalUsd({ side: "buy", amountUsd: 10 }, { inAmount: "10000000", outAmount: "1" })).toBe(10);
    expect(orderNotionalUsd({ side: "sell", amountUsd: 0.005 }, { inAmount: "1", outAmount: "900000000" })).toBe(0.005);
    expect(orderNotionalUsd({ side: "sell", amountUsd: 50 }, { inAmount: "1", outAmount: "10000" })).toBeCloseTo(0.01, 9);
    expect(orderNotionalUsd({ side: "buy", amountUsd: 0 }, { inAmount: "2000000", outAmount: "1" })).toBe(2);
  });
});

describe("fallsBackToAgentGas", () => {
  it("does not retry what paying gas differently cannot fix", () => {
    expect(fallsBackToAgentGas(new JupiterError("Insufficient funds (code 1)", { errorCode: 1, kind: "funds" }))).toBe(false);
    expect(fallsBackToAgentGas(new JupiterError("too loose", { kind: "slippage" }))).toBe(false);
    expect(fallsBackToAgentGas(new JupiterError("429", { httpStatus: 429 }))).toBe(false);
  });
  it("does not retry a sponsor refusal: Jupiter misbehaved, or the trade is past what Tocker pays for (W8 review)", () => {
    // A compromised /order answering the payer request with another fee payer used to
    // fall back to the drip path, whose drip size came from the next order's JSON.
    expect(fallsBackToAgentGas(new JupiterError("fee payer mismatch", { kind: "sponsor" }))).toBe(false);
  });
  it("retries agent-paid when the payer order simply could not be built", () => {
    // Metis-only routing can have no quote where the full router set has one — checked
    // once more by the executor before the fallback runs (isNoQuoteFailure).
    expect(fallsBackToAgentGas(new JupiterError("Failed to get quotes", { httpStatus: 400 }))).toBe(true);
    expect(fallsBackToAgentGas(new JupiterError("no transaction"))).toBe(true);
    expect(fallsBackToAgentGas(new JupiterError("Top up 0.002 SOL for gas (code 2)", { errorCode: 2 }))).toBe(true);
    expect(fallsBackToAgentGas(new Error("platform wallet unavailable"))).toBe(true);
  });
});

describe("isNoQuoteFailure", () => {
  it("recognises Jupiter's 400 'Failed to get quotes', however fetchOrder worded around it", () => {
    expect(
      isNoQuoteFailure(
        new JupiterError('Jupiter Ultra /order failed (HTTP 400). {"error":"Failed to get quotes"}', { httpStatus: 400 }),
      ),
    ).toBe(true);
  });
  it("is not any other failure", () => {
    expect(isNoQuoteFailure(new JupiterError("Failed to get quotes", { httpStatus: 429 }))).toBe(false);
    expect(isNoQuoteFailure(new JupiterError("invalid mint", { httpStatus: 400 }))).toBe(false);
    expect(isNoQuoteFailure(new JupiterError("no transaction"))).toBe(false);
    expect(isNoQuoteFailure(new Error("Failed to get quotes"))).toBe(false);
  });
});

describe("notSentNote", () => {
  it("says nothing went out, without reading as an over-ask settle.ts would retry", () => {
    const note = notSentNote("the route pays out to an account the swap's owner does not own");
    expect(note).toMatch(/Nothing was sent/);
    expect(note).not.toMatch(/\(code\s*1\)|insufficient/i);
  });
});

describe("orderErrorHint", () => {
  it("never tells anyone to send SOL on a sponsored order", () => {
    const hint = orderErrorHint(1, { sponsored: true, address: TAKER, spends: "USDC" });
    expect(hint).toContain(TAKER);
    expect(hint).toContain("USDC");
    expect(hint).not.toMatch(/SOL\b/);
  });
  it("keeps the W7 advice on the agent-paid path", () => {
    expect(orderErrorHint(1, { sponsored: false, address: TAKER, spends: "USDC" })).toBe(
      ` The agent wallet (${TAKER}) must hold the USDC for this order plus about 0.0020 SOL for the token account; Tocker tops the SOL up from the platform Solana wallet when that wallet has any.`,
    );
  });
  it("adds nothing to other codes", () => {
    expect(orderErrorHint(2, { sponsored: true, address: TAKER, spends: "USDC" })).toBe("");
    expect(orderErrorHint(null, { sponsored: false, address: TAKER, spends: "USDC" })).toBe("");
  });
});

// ------------------------------------------------ the byte check, on real v0 transactions

const JUP6 = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const JUP_EVENT_AUTHORITY = new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
/** Anchor discriminators of the two route instructions Ultra builds (read off live orders). */
const ROUTE_V2 = [0xbb, 0x64, 0xfa, 0xcc, 0x31, 0xc4, 0xaf, 0x14];
const SHARED_ROUTE_V2 = [0xd1, 0x98, 0x53, 0x93, 0x7c, 0xfe, 0xd8, 0xe9];

interface RouteArgs {
  inAmount: bigint;
  quotedOut: bigint;
  slippageBps: number;
  feeBps: number;
}

function routeData(discriminator: number[], args: RouteArgs, id?: number): Buffer {
  const body = Buffer.alloc(8 + 8 + 2 + 2 + 2 + 4);
  body.writeBigUInt64LE(args.inAmount, 0);
  body.writeBigUInt64LE(args.quotedOut, 8);
  body.writeUInt16LE(args.slippageBps, 16);
  body.writeUInt16LE(args.feeBps, 18);
  body.writeUInt16LE(0, 20);
  body.writeUInt32LE(0, 22); // an empty route plan: the decoder never reads past its length
  return Buffer.concat([Buffer.from(id === undefined ? discriminator : [...discriminator, id]), body]);
}

const acct = (pubkey: PublicKey, isWritable = true, isSigner = false) => ({ pubkey, isSigner, isWritable });

/** `route_v2`: authority, source, destination, mints, token programs, redirect, event authority, program, legs. */
function routeV2(input: {
  authority: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  args: RouteArgs;
  redirect?: PublicKey;
  legs?: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>;
  discriminator?: number[];
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: JUP6,
    keys: [
      acct(input.authority, false, true),
      acct(input.source),
      acct(input.destination),
      acct(input.sourceMint, false),
      acct(input.destinationMint, false),
      acct(TOKEN, false),
      acct(TOKEN, false),
      acct(input.redirect ?? JUP6, false),
      acct(JUP_EVENT_AUTHORITY, false),
      acct(JUP6, false),
      ...(input.legs ?? []),
    ],
    data: routeData(input.discriminator ?? ROUTE_V2, input.args),
  });
}

/** `shared_accounts_route_v2`: program authority first, then the same roles at other slots. */
function sharedRouteV2(input: {
  authority: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  args: RouteArgs;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: JUP6,
    keys: [
      acct(Keypair.generate().publicKey, false),
      acct(input.authority, false, true),
      acct(input.source),
      acct(Keypair.generate().publicKey),
      acct(Keypair.generate().publicKey),
      acct(input.destination),
      acct(input.sourceMint, false),
      acct(input.destinationMint, false),
      acct(TOKEN, false),
      acct(TOKEN, false),
      acct(JUP_EVENT_AUTHORITY, false),
      acct(JUP6, false),
    ],
    data: routeData(SHARED_ROUTE_V2, input.args, 10),
  });
}

interface SwapFixture {
  feePayer: PublicKey;
  taker: PublicKey;
  inputMint?: PublicKey;
  outputMint?: PublicKey;
  amount?: bigint;
  args?: Partial<RouteArgs>;
  /** Replaces the route instruction. */
  route?: TransactionInstruction;
  /** Extra accounts inside the route (a pump.fun leg passes the payer here). */
  legs?: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>;
  /** Instructions before the route, after the account opening. */
  before?: TransactionInstruction[];
  /** Instructions after the route. */
  extra?: TransactionInstruction[];
  tables?: AddressLookupTableAccount[];
  /** The fee payer opens the taker's output account (a first buy). Default true. */
  openOutput?: boolean;
  computeUnitPrice?: number;
}

const DEFAULT_ARGS: RouteArgs = { inAmount: BigInt(10_000_000), quotedOut: BigInt(8_632_667), slippageBps: 300, feeBps: 10 };

/**
 * The shape of a live payer order: compute budget, the taker's new output account opened
 * by the fee payer, the route. Returns the transaction and what the order asked for.
 */
function swapTransaction(f: SwapFixture): { base64: string; route: OrderRoute; order: { slippageBps: number; feeBps: number; outAmount: string } } {
  const inputMint = f.inputMint ?? USDC_MINT;
  const outputMint = f.outputMint ?? Keypair.generate().publicKey;
  const args = { ...DEFAULT_ARGS, ...(f.amount === undefined ? {} : { inAmount: f.amount }), ...f.args };
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 210_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: f.computeUnitPrice ?? 6_386 }),
    ...(f.openOutput === false ? [] : [createAtaIdempotentInstruction({ payer: f.feePayer, owner: f.taker, mint: outputMint })]),
    ...(f.before ?? []),
    f.route ??
      routeV2({
        authority: f.taker,
        source: associatedTokenAddress(f.taker, inputMint),
        destination: associatedTokenAddress(f.taker, outputMint),
        sourceMint: inputMint,
        destinationMint: outputMint,
        args,
        legs: f.legs,
      }),
    ...(f.extra ?? []),
  ];
  const message = new TransactionMessage({
    payerKey: f.feePayer,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions,
  }).compileToV0Message(f.tables ?? []);
  return {
    base64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    route: { inputMint: inputMint.toBase58(), outputMint: outputMint.toBase58(), amount: args.inAmount.toString() },
    order: { slippageBps: 300, feeBps: 10, outAmount: "8632667" },
  };
}

function lookupTable(addresses: PublicKey[]): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: BigInt("18446744073709551615"),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });
}

describe("decodeJupiterRoute", () => {
  it("reads both live layouts: the roles at their slots and the five fixed arguments", async () => {
    const taker = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const args = { inAmount: BigInt(900_000), quotedOut: BigInt(26_163_537_056), slippageBps: 450, feeBps: 10 };
    for (const build of [routeV2, sharedRouteV2]) {
      const ix = build({
        authority: taker,
        source: associatedTokenAddress(taker, USDC_MINT),
        destination: associatedTokenAddress(taker, mint),
        sourceMint: USDC_MINT,
        destinationMint: mint,
        args,
      });
      const decoded = decodeJupiterRoute({ programId: JUP6.toBase58(), accounts: ix.keys.map((k) => k.pubkey.toBase58()), data: Uint8Array.from(ix.data) });
      expect(decoded).toMatchObject({
        authority: taker.toBase58(),
        source: associatedTokenAddress(taker, USDC_MINT).toBase58(),
        destination: associatedTokenAddress(taker, mint).toBase58(),
        sourceMint: USDC_MINT.toBase58(),
        destinationMint: mint.toBase58(),
        inAmount: args.inAmount,
        quotedOutAmount: args.quotedOut,
        slippageBps: 450,
        platformFeeBps: 10,
      });
    }
  });

  it("decodes the live route_v2 bytes of a sponsored pump.fun buy (2026-09-23)", () => {
    const data = Buffer.from("bb64facc31c4af14a0bb0d00000000000dba721706000000c2010a000000030000007400102700019701102701029310270203", "hex");
    const accounts = Array.from({ length: 12 }, () => Keypair.generate().publicKey.toBase58());
    const decoded = decodeJupiterRoute({ programId: JUP6.toBase58(), accounts, data: Uint8Array.from(data) });
    expect(decoded?.instruction).toBe("route_v2");
    expect(decoded?.inAmount).toBe(BigInt(900_000));
    expect(decoded?.slippageBps).toBe(450);
    expect(decoded?.platformFeeBps).toBe(10);
  });

  it("reads nothing it does not recognise", () => {
    const accounts = Array.from({ length: 12 }, () => Keypair.generate().publicKey.toBase58());
    // v1 `route`: its arguments start with the route plan, so the amounts cannot be read.
    const v1 = Buffer.concat([Buffer.from("e517cb977ae3ad2a", "hex"), Buffer.alloc(40)]);
    expect(decodeJupiterRoute({ programId: JUP6.toBase58(), accounts, data: Uint8Array.from(v1) })).toBeNull();
    expect(decodeJupiterRoute({ programId: JUP6.toBase58(), accounts, data: Uint8Array.from(ROUTE_V2) })).toBeNull();
    expect(decodeJupiterRoute({ programId: TOKEN.toBase58(), accounts, data: Uint8Array.from(routeData(ROUTE_V2, DEFAULT_ARGS)) })).toBeNull();
  });
});

describe("checkSwapShape", () => {
  const platform = Keypair.generate().publicKey;
  const agent = Keypair.generate().publicKey;
  const stranger = Keypair.generate().publicKey;
  const forbidden = [associatedTokenAddress(platform, USDC_MINT).toBase58(), associatedTokenAddress(platform, WSOL_MINT).toBase58()];
  const wsolAta = associatedTokenAddress(agent, WSOL_MINT);
  const agentUsdc = associatedTokenAddress(agent, USDC_MINT);

  /** Check a fixture as a sponsored swap (the platform pays) unless `payer` says otherwise. */
  const check = async (
    f: Partial<SwapFixture> & { feePayer?: PublicKey; taker?: PublicKey },
    opts: { payer?: string | null; order?: Partial<{ slippageBps: number; feeBps: number; outAmount: string }> } = {},
  ) => {
    const fixture: SwapFixture = { feePayer: platform, taker: agent, ...f };
    const { base64, route, order } = swapTransaction(fixture);
    const view = await viewSwapTransaction(base64, fixture.tables ?? []);
    const expect = await swapExpectation({
      taker: fixture.taker.toBase58(),
      payer: opts.payer === undefined ? platform.toBase58() : opts.payer,
      forbidden,
      route,
      order: { ...order, ...opts.order },
    });
    return checkSwapShape(view, expect);
  };
  const problemOf = async (...args: Parameters<typeof check>) => {
    const result = await check(...args);
    return result.ok ? null : result.problem;
  };

  // --------------------------------------------------------------- live shapes pass

  it("accepts the shape Jupiter builds for a payer order, and reads what it costs from the bytes", async () => {
    const result = await check({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape).toMatchObject({
      feePayer: platform.toBase58(),
      signatures: 2,
      computeUnitLimit: 210_000,
      microLamportsPerUnit: 6_386,
      priorityLamports: 1_342,
      payerFundedAccounts: 1,
      repaidToPayerLamports: 0,
    });
    expect(result.shape.route.instruction).toBe("route_v2");
  });

  it("accepts the shared-accounts layout, and a buy into an account the agent already has", async () => {
    const mint = Keypair.generate().publicKey;
    const route = sharedRouteV2({
      authority: agent,
      source: agentUsdc,
      destination: associatedTokenAddress(agent, mint, TOKEN_2022_PROGRAM_ID),
      sourceMint: USDC_MINT,
      destinationMint: mint,
      args: DEFAULT_ARGS,
    });
    const result = await check({ outputMint: mint, route, openOutput: false });
    expect(result.ok && result.shape.payerFundedAccounts).toBe(0);
  });

  it("accepts a pump.fun route that passes the platform to a leg as its payer", async () => {
    expect(await problemOf({ legs: [acct(platform, true, true)] })).toBeNull();
  });

  it("reads what the lookup tables contribute", async () => {
    const extra = Keypair.generate().publicKey;
    const table = lookupTable([extra, Keypair.generate().publicKey]);
    const { base64 } = swapTransaction({ feePayer: platform, taker: agent, legs: [acct(extra)], tables: [table] });
    const view = await viewSwapTransaction(base64, [table]);
    expect(view.lookupKeys).toContain(extra.toBase58());
    expect(view.staticKeys).not.toContain(extra.toBase58());
    expect(await problemOf({ legs: [acct(extra)], tables: [table] })).toBeNull();
  });

  /**
   * The live SOL-route shapes (read-only probes, 2026-09-23, taker holding USDC and no
   * wrapped-SOL account): the platform funds the agent's wSOL account, the route runs,
   * the account closes back to the agent, and the agent repays the platform the rent.
   */
  const closeWsol = new TransactionInstruction({
    programId: TOKEN,
    keys: [acct(wsolAta), acct(agent), acct(agent, false, true)],
    data: Buffer.from([9]),
  });
  const repayRent = SystemProgram.transfer({ fromPubkey: agent, toPubkey: platform, lamports: 1_488_440 });

  it("accepts a USDC→SOL buy: wSOL account on the platform, closed to the agent, rent repaid by the agent", async () => {
    const result = await check({ outputMint: WSOL_MINT, extra: [closeWsol, repayRent] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shape).toMatchObject({ payerFundedAccounts: 1, repaidToPayerLamports: 1_488_440 });
  });

  it("accepts a SOL→USDC sell: the agent wraps its own SOL, then the same close and repayment", async () => {
    const createWsol = createAtaIdempotentInstruction({ payer: platform, owner: agent, mint: WSOL_MINT });
    const wrap = SystemProgram.transfer({ fromPubkey: agent, toPubkey: wsolAta, lamports: 10_000_000 });
    const syncNative = new TransactionInstruction({ programId: TOKEN, keys: [acct(wsolAta)], data: Buffer.from([17]) });
    expect(
      await problemOf({ inputMint: WSOL_MINT, outputMint: USDC_MINT, openOutput: false, before: [createWsol, wrap, syncNative], extra: [closeWsol, repayRent] }),
    ).toBeNull();
  });

  it("accepts the agent paying its own gas (one signer), and Ultra's gasless relayer as account 0", async () => {
    const self = await check({ feePayer: agent }, { payer: null });
    expect(self.ok && self.shape).toMatchObject({ feePayer: agent.toBase58(), signatures: 1, payerFundedAccounts: 0 });
    const relayer = Keypair.generate().publicKey;
    const gasless = await check({ feePayer: relayer }, { payer: null });
    expect(gasless.ok && gasless.shape.feePayer).toBe(relayer.toBase58());
  });

  // ------------------------------------------------------------------ signers

  it("refuses a transaction whose fee payer is not the platform", async () => {
    expect(await problemOf({ feePayer: agent, taker: platform })).toMatch(/fee payer/);
  });

  it("refuses a third signer", async () => {
    const extra = new TransactionInstruction({ programId: JUP6, keys: [acct(stranger, false, true)], data: Buffer.alloc(0) });
    expect(await problemOf({ extra: [extra] })).toMatch(/3 signatures/);
  });

  // ------------------------------------------------ the platform's own accounts (W8)

  it("refuses a route that names the platform's own USDC account, even through a lookup table", async () => {
    const usdc = associatedTokenAddress(platform, USDC_MINT);
    expect(await problemOf({ legs: [acct(usdc)] })).toMatch(/own token accounts/);
    const table = lookupTable([usdc]);
    const { base64 } = swapTransaction({ feePayer: platform, taker: agent, legs: [acct(usdc)], tables: [table] });
    expect((await viewSwapTransaction(base64, [table])).staticKeys).not.toContain(usdc.toBase58());
    expect(await problemOf({ legs: [acct(usdc)], tables: [table] })).toMatch(/own token accounts/);
  });

  it("refuses the platform as the authority of a token instruction", async () => {
    const drain = new TransactionInstruction({
      programId: TOKEN,
      keys: [acct(Keypair.generate().publicKey), acct(stranger), acct(platform, false, true)],
      data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]),
    });
    expect(await problemOf({ extra: [drain] })).toMatch(/token instruction/);
  });

  it("refuses rent for an account the agent does not own", async () => {
    const other = createAtaIdempotentInstruction({ payer: platform, owner: stranger, mint: Keypair.generate().publicKey });
    expect(await problemOf({ extra: [other] })).toMatch(/does not own/);
  });

  /** W8 review: the "tip" allowance let any transfer out of the platform through, bounded only by a budget Jupiter set. */
  it("refuses every transfer out of the platform — there is no tip", async () => {
    const tip = SystemProgram.transfer({ fromPubkey: platform, toPubkey: stranger, lamports: 1_000 });
    expect(await problemOf({ extra: [tip] })).toMatch(/other than its owner's/);
    const toItself = SystemProgram.transfer({ fromPubkey: platform, toPubkey: platform, lamports: 1 });
    expect(await problemOf({ extra: [toItself] })).toMatch(/other than its owner's/);
  });

  /** W8 review: the platform in a route's fixed slots (the authority above all) — invisible to a lamport simulation. */
  it("refuses the platform in any of the route's own accounts", async () => {
    const mint = Keypair.generate().publicKey;
    const route = routeV2({
      authority: agent,
      source: agentUsdc,
      destination: associatedTokenAddress(agent, mint),
      sourceMint: USDC_MINT,
      destinationMint: mint,
      args: DEFAULT_ARGS,
      redirect: platform,
    });
    expect(await problemOf({ outputMint: mint, route })).toMatch(/sends its output somewhere else|fee wallet in one of its own accounts/);
  });

  // ------------------------------------- the agent's own funds (W8 review: theft vectors)

  it("refuses an agent-signed SetAuthority, Approve, Transfer or TransferChecked on its own token account", async () => {
    const setAuthority = new TransactionInstruction({
      programId: TOKEN,
      keys: [acct(agentUsdc), acct(agent, false, true)],
      data: Buffer.concat([Buffer.from([6, 2, 1]), stranger.toBuffer()]),
    });
    const approve = new TransactionInstruction({
      programId: TOKEN,
      keys: [acct(agentUsdc), acct(stranger, false), acct(agent, false, true)],
      data: Buffer.from([4, 255, 255, 255, 255, 255, 255, 255, 255]),
    });
    const transfer = new TransactionInstruction({
      programId: TOKEN,
      keys: [acct(agentUsdc), acct(associatedTokenAddress(stranger, USDC_MINT)), acct(agent, false, true)],
      data: Buffer.from([3, 64, 66, 15, 0, 0, 0, 0, 0]),
    });
    const transferChecked = new TransactionInstruction({
      programId: TOKEN,
      keys: [acct(agentUsdc), acct(USDC_MINT, false), acct(associatedTokenAddress(stranger, USDC_MINT)), acct(agent, false, true)],
      data: Buffer.from([12, 64, 66, 15, 0, 0, 0, 0, 0, 6]),
    });
    for (const ix of [setAuthority, approve, transfer, transferChecked]) {
      expect(await problemOf({ extra: [ix] })).toMatch(/token instruction other than wrapping or unwrapping/);
      // The same on the agent-paid path, where nothing used to be checked at all.
      expect(await problemOf({ feePayer: agent, extra: [ix] }, { payer: null })).toMatch(/token instruction/);
    }
  });

  it("refuses closing any account but the agent's wrapped SOL, or closing it to someone else", async () => {
    const closeUsdc = new TransactionInstruction({ programId: TOKEN, keys: [acct(agentUsdc), acct(agent), acct(agent, false, true)], data: Buffer.from([9]) });
    expect(await problemOf({ extra: [closeUsdc] })).toMatch(/token instruction/);
    const closeToStranger = new TransactionInstruction({ programId: TOKEN, keys: [acct(wsolAta), acct(stranger), acct(agent, false, true)], data: Buffer.from([9]) });
    expect(await problemOf({ outputMint: WSOL_MINT, extra: [closeToStranger] })).toMatch(/token instruction/);
  });

  it("refuses the agent's SOL going anywhere but its wrapped-SOL account or one bounded rent repayment", async () => {
    const toStranger = SystemProgram.transfer({ fromPubkey: agent, toPubkey: stranger, lamports: 5_000_000 });
    expect(await problemOf({ extra: [toStranger] })).toMatch(/somewhere other than its own wrapped-SOL/);
    expect(await problemOf({ feePayer: agent, extra: [toStranger] }, { payer: null })).toMatch(/somewhere other than/);
    const overRepay = SystemProgram.transfer({ fromPubkey: agent, toPubkey: platform, lamports: ATA_RENT_LAMPORTS + 1 });
    expect(await problemOf({ extra: [overRepay] })).toMatch(/somewhere other than/);
    expect(await problemOf({ outputMint: WSOL_MINT, extra: [closeWsol, repayRent, repayRent] })).toMatch(/somewhere other than/);
    // A stranger's transfer cannot be here at all: it would need the stranger's signature.
    const fromStranger = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [acct(stranger), acct(platform)],
      data: repayRent.data,
    });
    expect(await problemOf({ extra: [fromStranger] })).toMatch(/other than its owner's/);
  });

  /** W8 review: an AdvanceNonceAccount makes a co-signed swap valid forever, for someone to land at a moment of their choosing. */
  it("refuses a durable-nonce advance, and any System instruction that is not a plain transfer", async () => {
    const nonce = SystemProgram.nonceAdvance({ noncePubkey: Keypair.generate().publicKey, authorizedPubkey: agent });
    expect(await problemOf({ before: [nonce] })).toMatch(/not a plain transfer/);
    const assign = SystemProgram.assign({ accountPubkey: platform, programId: stranger });
    expect(await problemOf({ extra: [assign] })).toMatch(/not a plain transfer/);
    const createAt = SystemProgram.createAccount({ fromPubkey: agent, newAccountPubkey: platform, lamports: 1, space: 0, programId: stranger });
    expect(await problemOf({ extra: [createAt] })).toMatch(/not a plain transfer/);
    const padded = new TransactionInstruction({ programId: SystemProgram.programId, keys: repayRent.keys, data: Buffer.concat([repayRent.data, Buffer.from([0])]) });
    expect(await problemOf({ extra: [padded] })).toMatch(/not a plain transfer/);
  });

  it("refuses a route that spends from, or pays out to, anyone but the agent", async () => {
    const mint = Keypair.generate().publicKey;
    const base = { authority: agent, source: agentUsdc, destination: associatedTokenAddress(agent, mint), sourceMint: USDC_MINT, destinationMint: mint, args: DEFAULT_ARGS };
    const cases: Array<[Partial<typeof base> & { redirect?: PublicKey }, RegExp]> = [
      [{ destination: associatedTokenAddress(stranger, mint) }, /pays out to an account the swap's owner does not own/],
      [{ redirect: associatedTokenAddress(stranger, mint) }, /sends its output somewhere else/],
      [{ source: associatedTokenAddress(stranger, USDC_MINT) }, /spends from an account/],
      // The platform as the route's authority: a lamport simulation cannot see what that spends.
      [{ authority: platform }, /spends from a wallet other than/],
      [{ destinationMint: Keypair.generate().publicKey }, /different tokens/],
    ];
    // A memo the agent signs keeps it a signer when the route's authority is someone else.
    const agentSigns = new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [acct(agent, false, true)],
      data: Buffer.from("tocker"),
    });
    for (const [override, message] of cases) {
      expect(await problemOf({ outputMint: mint, before: [agentSigns], route: routeV2({ ...base, ...override }) })).toMatch(message);
    }
  });

  it("refuses a route whose amount, slippage, fee or quoted output is not the order's", async () => {
    const mint = Keypair.generate().publicKey;
    const route = (args: Partial<RouteArgs>) =>
      routeV2({ authority: agent, source: agentUsdc, destination: associatedTokenAddress(agent, mint), sourceMint: USDC_MINT, destinationMint: mint, args: { ...DEFAULT_ARGS, ...args } });
    // The order asked for 10 USDC; the route spends more.
    const { base64, order } = swapTransaction({ feePayer: platform, taker: agent, outputMint: mint, route: route({ inAmount: BigInt(50_000_000) }) });
    const expect10 = await swapExpectation({
      taker: agent.toBase58(),
      payer: platform.toBase58(),
      forbidden,
      route: { inputMint: USDC_MINT.toBase58(), outputMint: mint.toBase58(), amount: "10000000" },
      order,
    });
    const spent = checkSwapShape(await viewSwapTransaction(base64), expect10);
    expect(!spent.ok && spent.problem).toMatch(/spends 50000000 base units, not the 10000000/);
    expect(await problemOf({ outputMint: mint, route: route({ slippageBps: 9_000 }) })).toMatch(/9000 bps of slippage/);
    expect(await problemOf({ outputMint: mint, route: route({ feeBps: 255 }) })).toMatch(/255 bps fee/);
    // A quoted output far under the order's makes the on-chain minimum near zero.
    expect(await problemOf({ outputMint: mint, route: route({ quotedOut: BigInt(1) }) })).toMatch(/less output than the order promised/);
    // Within 1% of the order's number is Jupiter's own rounding.
    expect(await problemOf({ outputMint: mint, route: route({ quotedOut: BigInt(8_600_000) }) })).toBeNull();
  });

  it("refuses a route it cannot read, a second route, or none", async () => {
    const mint = Keypair.generate().publicKey;
    const unknown = routeV2({ authority: agent, source: agentUsdc, destination: associatedTokenAddress(agent, mint), sourceMint: USDC_MINT, destinationMint: mint, args: DEFAULT_ARGS, discriminator: [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a] });
    expect(await problemOf({ outputMint: mint, route: unknown })).toMatch(/not one Tocker can read/);
    const second = routeV2({ authority: agent, source: agentUsdc, destination: associatedTokenAddress(agent, mint), sourceMint: USDC_MINT, destinationMint: mint, args: DEFAULT_ARGS });
    expect(await problemOf({ outputMint: mint, extra: [second] })).toMatch(/more than one route/);
    const memo = new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [acct(agent, false, true)],
      data: Buffer.from("hi"),
    });
    expect(await problemOf({ route: memo })).toMatch(/no route/);
  });

  it("refuses a program a Jupiter route never calls", async () => {
    const odd = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) });
    expect(await problemOf({ extra: [odd] })).toMatch(/never does/);
  });

  it("prices a missing compute-unit limit at the runtime's ceiling", async () => {
    const mint = Keypair.generate().publicKey;
    const route = routeV2({ authority: agent, source: agentUsdc, destination: associatedTokenAddress(agent, mint), sourceMint: USDC_MINT, destinationMint: mint, args: DEFAULT_ARGS });
    const message = new TransactionMessage({
      payerKey: platform,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), route],
    }).compileToV0Message();
    const base64 = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
    const expect_ = await swapExpectation({
      taker: agent.toBase58(),
      payer: platform.toBase58(),
      forbidden,
      route: { inputMint: USDC_MINT.toBase58(), outputMint: mint.toBase58(), amount: "10000000" },
      order: { slippageBps: 300, feeBps: 10, outAmount: "8632667" },
    });
    const result = checkSwapShape(await viewSwapTransaction(base64), expect_);
    expect(result.ok && result.shape.priorityLamports).toBe(1_400_000);
  });
});

describe("sameMessageBytes / signatureOfSignedTransaction on a two-signer swap", () => {
  const platform = Keypair.generate();
  const agent = Keypair.generate();
  const { base64: unsigned } = swapTransaction({ feePayer: platform.publicKey, taker: agent.publicKey });
  const sign = (base64: string, signer: Keypair) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    tx.sign([signer]);
    return Buffer.from(tx.serialize()).toString("base64");
  };

  it("sees a signature as the same message, and a different transaction as not", async () => {
    expect(await sameMessageBytes(unsigned, sign(unsigned, agent))).toBe(true);
    expect(await sameMessageBytes(unsigned, swapTransaction({ feePayer: platform.publicKey, taker: agent.publicKey }).base64)).toBe(false);
    expect(await sameMessageBytes(unsigned, "not a transaction")).toBe(false);
  });

  it("has no id until the platform signs, then the platform's signature is the id", async () => {
    const agentSigned = sign(unsigned, agent);
    expect(await signatureOfSignedTransaction(agentSigned)).toBeNull();
    const both = sign(agentSigned, platform);
    const id = await signatureOfSignedTransaction(both);
    expect(id).toBe(base58.encode(VersionedTransaction.deserialize(Buffer.from(both, "base64")).signatures[0]));
  });
});

describe("requiredSignerIndex (solana-cosign)", () => {
  it("finds the platform among the signers from the static keys alone", async () => {
    const { requiredSignerIndex } = await vi.importActual<typeof import("@/lib/wallets/solana-cosign")>("@/lib/wallets/solana-cosign");
    const platform = Keypair.generate().publicKey;
    const agent = Keypair.generate().publicKey;
    const { base64 } = swapTransaction({ feePayer: platform, taker: agent });
    expect(await requiredSignerIndex(base64, platform.toBase58())).toBe(0);
    expect(await requiredSignerIndex(base64, agent.toBase58())).toBe(1);
    // Named in the transaction (the output mint is a key) but not a signer.
    expect(await requiredSignerIndex(base64, USDC_MINT.toBase58())).toBeNull();
    expect(await requiredSignerIndex("junk", platform.toBase58())).toBeNull();
  });
});

// --------------------------------------------------------- the flow, with the edges mocked

describe("JupiterExecutor", () => {
  const platformKp = Keypair.generate();
  const agentKp = Keypair.generate();
  const platform = platformKp.publicKey.toBase58();
  const agent = agentKp.publicKey.toBase58();
  const wallet = { chain: "solana" as const, walletId: "agent-wallet", address: agent };
  const mint = Keypair.generate().publicKey;
  const request: TradeRequest = {
    chain: "solana",
    side: "buy",
    tokenId: `solana:${mint.toBase58()}`,
    tokenAddress: mint.toBase58(),
    symbol: "PUMP",
    decimals: 6,
    amountUsd: 10,
    slippageBps: 500,
  };

  let events: string[];
  let orderUrls: URL[];
  let executeBodies: Array<{ signedTransaction: string; requestId: string }>;
  let sponsoredOrder: Record<string, unknown>;
  let executeAnswers: Array<Record<string, unknown>>;
  /** Replaces the agent-paid order the fetch mock answers with, when set. */
  let agentPaidOverride: Record<string, unknown> | null;
  /** Which `/order` calls answer Jupiter's 400 "Failed to get quotes". */
  let noQuotes: { sponsored: boolean; agentPaid: boolean };
  let failures: ReturnType<typeof vi.fn<(agentId: string, since: Date) => Promise<number>>>;

  const signWith = (base64: string, signer: Keypair) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    tx.sign([signer]);
    return Buffer.from(tx.serialize()).toString("base64");
  };
  const executor = (agentId: string | undefined = "agent-1", options: JupiterExecutorOptions = {}, w = wallet) =>
    new JupiterExecutor(w, agentId, { countOnChainFailures: failures, ...options });
  const tx = (f: Partial<SwapFixture> & { feePayer: PublicKey; taker?: PublicKey }) =>
    swapTransaction({ taker: agentKp.publicKey, outputMint: mint, ...f }).base64;
  /** What the sponsored fixture costs the platform: 2 signatures, 210k × 6,386 µ-lamports, one account. */
  const SPONSORED_BUDGET = 10_000 + 1_342 + 1_513_840 + SPONSORED_SWAP_MARGIN_LAMPORTS;

  function agentPaidOrder(): Record<string, unknown> {
    return {
      ...FUNDED_TAKER_ORDER,
      requestId: "agent-paid",
      inAmount: "10000000",
      taker: agent,
      signatureFeePayer: agent,
      prioritizationFeePayer: agent,
      rentFeePayer: agent,
      transaction: tx({ feePayer: agentKp.publicKey, args: { slippageBps: 25, feeBps: 2 } }),
    };
  }

  beforeEach(() => {
    events = [];
    orderUrls = [];
    executeBodies = [];
    executeAnswers = [];
    agentPaidOverride = null;
    noQuotes = { sponsored: false, agentPaid: false };
    failures = vi.fn(async (_agentId: string, _since: Date) => 0);
    sponsoredOrder = {
      ...SPONSORED_ORDER,
      requestId: "sponsored",
      inAmount: "10000000",
      taker: agent,
      signatureFeePayer: platform,
      prioritizationFeePayer: platform,
      rentFeePayer: platform,
      slippageBps: 300,
      transaction: tx({ feePayer: platformKp.publicKey }),
    };
    vi.stubEnv("SOLANA_SPONSORED_SWAPS", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    edges.platformFeePayer.mockReset().mockResolvedValue({ walletId: "platform-wallet", address: platform });
    edges.signAsServerWallet.mockReset().mockImplementation(async (_id: string, t: string) => {
      events.push("agent-signed");
      return signWith(t, agentKp);
    });
    edges.cosignAsPlatform.mockReset().mockImplementation(async ({ transactionBase64 }: { transactionBase64: string }) => {
      events.push("platform-signed");
      return signWith(transactionBase64, platformKp);
    });
    edges.signAsPlatformTaker.mockReset().mockImplementation(async ({ transactionBase64 }: { transactionBase64: string }) => {
      events.push("platform-signed-own");
      return signWith(transactionBase64, platformKp);
    });
    edges.privySignTransaction.mockReset().mockImplementation(async (_id: string, { transaction }: { transaction: string }) => {
      events.push("agent-signed-alone");
      return { encoding: "base64", signed_transaction: signWith(transaction, agentKp) };
    });
    edges.ensureAgentGas.mockReset().mockResolvedValue({ dripped: false, signature: null, balanceSol: 0.02 });
    edges.ensureSponsorCapacity.mockReset().mockResolvedValue({ ok: true, walletId: "platform-wallet", address: platform });
    edges.getPriceUsd.mockReset().mockResolvedValue(117.37);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/ultra/v1/order")) {
          orderUrls.push(url);
          const sponsoredCall = url.searchParams.has("payer");
          if (sponsoredCall ? noQuotes.sponsored : noQuotes.agentPaid) {
            return Response.json({ error: "Failed to get quotes" }, { status: 400 });
          }
          return Response.json(sponsoredCall ? sponsoredOrder : (agentPaidOverride ?? agentPaidOrder()));
        }
        if (url.pathname.endsWith("/ultra/v1/execute")) {
          const body = JSON.parse(String(init?.body)) as { signedTransaction: string; requestId: string };
          executeBodies.push(body);
          events.push("execute");
          const answer = executeAnswers.shift() ?? {};
          const id = await signatureOfSignedTransaction(body.signedTransaction);
          return Response.json({
            status: "Success",
            signature: id,
            code: 0,
            inputAmountResult: "10000000",
            outputAmountResult: "8632667",
            ...answer,
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const onSigned = () =>
    vi.fn(async (sig: string) => {
      events.push(`onSigned:${sig.slice(0, 6)}`);
    });
  const fallbackLines = () => vi.mocked(console.warn).mock.calls.filter((c) => /Falling back/.test(String(c[0])));

  // ------------------------------------------------------------------ the happy path

  it("orders with the platform as payer, never drips, and has the platform co-sign within the budget the bytes allow", async () => {
    const ex = executor();
    const quote = await ex.quote(request);

    expect(orderUrls).toHaveLength(1);
    expect(orderUrls[0].searchParams.get("payer")).toBe(platform);
    expect(orderUrls[0].searchParams.get("slippageBps")).toBeNull();
    expect((quote.handle as JupiterHandle).sponsorPayer).toBe(platform);
    // $10 at $117.37: 30 bps of the trade.
    expect((quote.handle as JupiterHandle).priorityAllowanceLamports).toBe(255_601);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();

    const hook = onSigned();
    const fill = await ex.execute(quote, { onSigned: hook });

    expect(fill.status).toBe("filled");
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
    expect(edges.cosignAsPlatform).toHaveBeenCalledWith({
      transactionBase64: expect.any(String),
      maxOutflowLamports: SPONSORED_BUDGET,
      purpose: "swap",
    });

    // The id is the platform's slot-0 signature, handed over before /execute.
    const sent = VersionedTransaction.deserialize(Buffer.from(executeBodies[0].signedTransaction, "base64"));
    expect(sent.signatures.every((s) => s.some((byte) => byte !== 0))).toBe(true);
    const id = base58.encode(sent.signatures[0]);
    expect(hook).toHaveBeenCalledWith(id);
    expect(events).toEqual(["agent-signed", "platform-signed", `onSigned:${id.slice(0, 6)}`, "execute"]);
    expect(executeBodies[0].requestId).toBe("sponsored");
    expect(fill.txHash).toBe(id);
  });

  it("re-quotes the manual-mode ceiling with the payer too", async () => {
    sponsoredOrder.slippageBps = 900;
    const ex = executor();
    let calls = 0;
    const base = sponsoredOrder;
    vi.mocked(fetch).mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      orderUrls.push(url);
      calls += 1;
      return Response.json({ ...base, slippageBps: calls === 1 ? 900 : 500, mode: calls === 1 ? "ultra" : "manual" });
    });
    await ex.quote(request);
    expect(orderUrls).toHaveLength(2);
    expect(orderUrls[1].searchParams.get("payer")).toBe(platform);
    expect(orderUrls[1].searchParams.get("slippageBps")).toBe("500");
  });

  // ----------------------------------------- W8 review: failed and sub-cent swaps

  it("does not send a manual-mode order under the 30 bps floor, and neither falls back nor drips", async () => {
    const ex = executor();
    const err = await ex.quote({ ...request, slippageBps: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JupiterError);
    expect((err as JupiterError).kind).toBe("slippage");
    expect((err as JupiterError).message).toMatch(/at least 0\.3%/);
    expect(orderUrls).toHaveLength(1);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
  });

  it("refuses a sponsored order whose priority fee is past what the trade's size allows", async () => {
    // A $0.01 ticket carrying the 1.19M-lamport manual-mode priority seen live.
    sponsoredOrder = { ...sponsoredOrder, inAmount: "10000", prioritizationFeeLamports: 1_193_823, rentFeeLamports: 0 };
    const err = await executor().quote({ ...request, amountUsd: 0.01 }).catch((e: unknown) => e);
    expect((err as JupiterError).kind).toBe("sponsor");
    expect((err as JupiterError).message).toMatch(/1193823-lamport priority fee, more than the 150000/);
    expect(orderUrls).toHaveLength(1);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
  });

  it("refuses a sub-$2 buy that opens a token account, and sponsors the same buy into an existing one", async () => {
    sponsoredOrder = { ...sponsoredOrder, inAmount: "1000000" };
    const err = await executor().quote({ ...request, amountUsd: 1 }).catch((e: unknown) => e);
    expect((err as JupiterError).kind).toBe("sponsor");
    expect((err as JupiterError).message).toMatch(/\$2 or more/);
    expect(orderUrls).toHaveLength(1);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();

    sponsoredOrder = { ...sponsoredOrder, rentFeeLamports: 0 };
    const quote = await executor().quote({ ...request, amountUsd: 1 });
    expect((quote.handle as JupiterHandle).sponsorPayer).toBe(platform);
  });

  it("stops sponsoring an agent after five on-chain failures in the hour, before asking Jupiter anything", async () => {
    failures.mockResolvedValue(5);
    const err = await executor().quote(request).catch((e: unknown) => e);
    expect((err as JupiterError).kind).toBe("sponsor");
    expect((err as JupiterError).message).toMatch(/5 of this agent's trades failed on chain/);
    expect(failures).toHaveBeenCalledWith("agent-1", expect.any(Date));
    const since = failures.mock.calls[0][1] as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(3_600_000 - 1_000);
    expect(orderUrls).toHaveLength(0);
    expect(edges.ensureSponsorCapacity).not.toHaveBeenCalled();
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
  });

  it("a co-sign refusal (the simulation fails) is a failed fill: no agent-paid retry, no drip, nothing sent", async () => {
    const { CosignRefused } = await import("@/lib/wallets/solana-cosign");
    edges.cosignAsPlatform.mockRejectedValueOnce(new CosignRefused("the swap would fail on chain"));
    const ex = executor();
    const quote = await ex.quote(request);
    const hook = onSigned();
    const fill = await ex.execute(quote, { onSigned: hook });

    expect(fill.status).toBe("failed");
    expect(fill.txHash).toBeNull();
    expect(fill.error).toMatch(/would fail on chain/);
    expect(orderUrls.map((u) => u.searchParams.get("payer"))).toEqual([platform]);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
    expect(executeBodies).toHaveLength(0);
    expect(hook).not.toHaveBeenCalled();
    expect(fallbackLines()).toHaveLength(0);
  });

  // --------------------------------- W8 review: /execute is not trusted to say "not sent"

  it("an /execute that says the sponsored swap was refused unsent is a failed fill on the sponsored id — never a second swap", async () => {
    executeAnswers.push({ status: "Failed", code: -3, error: "Invalid message bytes", signature: undefined });
    const ex = executor();
    const hook = onSigned();
    const fill = await ex.execute(await ex.quote(request), { onSigned: hook });

    expect(fill.status).toBe("failed");
    const id = hook.mock.calls[0][0];
    // settle.ts asks the chain about this id; had Jupiter sent it after all, it shows up.
    expect(fill.txHash).toBe(id);
    expect(executeBodies).toHaveLength(1);
    expect(orderUrls).toHaveLength(1);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
  });

  it("keeps its own id when /execute names a different transaction", async () => {
    executeAnswers.push({ status: "Failed", code: -1000, error: "Failed to land", signature: "SomebodyElsesTransaction" });
    const ex = executor();
    const hook = onSigned();
    const fill = await ex.execute(await ex.quote(request), { onSigned: hook });
    expect(fill.txHash).toBe(hook.mock.calls[0][0]);
  });

  it("does not fall back on a failure that may have been broadcast", async () => {
    executeAnswers.push({ status: "Failed", code: -1005, error: "Transaction expired" });
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(/expired/);
    expect(fill.txHash).not.toBeNull();
    expect(executeBodies).toHaveLength(1);
    expect(orderUrls).toHaveLength(1);
  });

  // ----------------------------------- W8 review: the bytes are checked before anyone signs

  it("refuses a sponsored route that pays out to someone else, before the agent or the platform signs", async () => {
    const stranger = Keypair.generate().publicKey;
    sponsoredOrder.transaction = swapTransaction({
      feePayer: platformKp.publicKey,
      taker: agentKp.publicKey,
      outputMint: mint,
      route: routeV2({
        authority: agentKp.publicKey,
        source: associatedTokenAddress(agentKp.publicKey, USDC_MINT),
        destination: associatedTokenAddress(stranger, mint),
        sourceMint: USDC_MINT,
        destinationMint: mint,
        args: DEFAULT_ARGS,
      }),
    }).base64;
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toBe(notSentNote("the route pays out to an account the swap's owner does not own"));
    expect(edges.signAsServerWallet).not.toHaveBeenCalled();
    expect(edges.cosignAsPlatform).not.toHaveBeenCalled();
    expect(executeBodies).toHaveLength(0);
    expect(orderUrls).toHaveLength(1);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
  });

  it("refuses a sponsored transfer out of the platform even when Jupiter declared a fee that would cover it", async () => {
    sponsoredOrder = {
      ...sponsoredOrder,
      prioritizationFeeLamports: 250_000,
      transaction: tx({
        feePayer: platformKp.publicKey,
        extra: [SystemProgram.transfer({ fromPubkey: platformKp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 240_000 })],
      }),
    };
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(/moves SOL out of a wallet other than its owner's/);
    expect(edges.cosignAsPlatform).not.toHaveBeenCalled();
  });

  it("prices the co-sign from the bytes: a priority fee over the allowance is refused though the JSON under-declares it", async () => {
    // 210,000 CU at 5,000,000 µ-lamports: 1.05M lamports of priority, JSON says 26,300.
    sponsoredOrder.transaction = tx({ feePayer: platformKp.publicKey, computeUnitPrice: 5_000_000 });
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(/1050000 lamports, over the 255601/);
    expect(edges.signAsServerWallet).not.toHaveBeenCalled();
    expect(edges.cosignAsPlatform).not.toHaveBeenCalled();
  });

  it("refuses a sponsored order that advances a durable nonce", async () => {
    sponsoredOrder.transaction = tx({
      feePayer: platformKp.publicKey,
      before: [SystemProgram.nonceAdvance({ noncePubkey: Keypair.generate().publicKey, authorizedPubkey: agentKp.publicKey })],
    });
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(/not a plain transfer/);
    expect(edges.cosignAsPlatform).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------ quote-time fallbacks that remain

  it("falls back at quote time when Jupiter builds no sponsored transaction", async () => {
    sponsoredOrder = { ...sponsoredOrder, transaction: null };
    const quote = await executor().quote(request);
    expect(orderUrls.map((u) => u.searchParams.get("payer"))).toEqual([platform, null]);
    expect((quote.handle as JupiterHandle).sponsorPayer).toBeNull();
    expect(edges.ensureAgentGas).toHaveBeenCalledWith(expect.objectContaining({ requiredLamports: 6_000_000, purpose: "swap" }));
  });

  it("does not fall back when Jupiter names someone else as the fee payer", async () => {
    sponsoredOrder = { ...sponsoredOrder, signatureFeePayer: agent };
    const err = await executor().quote(request).catch((e: unknown) => e);
    expect((err as JupiterError).kind).toBe("sponsor");
    expect(orderUrls.map((u) => u.searchParams.get("payer"))).toEqual([platform]);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
  });

  it("does not fall back on code 1, and does not mention SOL", async () => {
    sponsoredOrder = { ...sponsoredOrder, transaction: null, errorCode: 1, errorMessage: "Insufficient funds" };
    const err = await executor().quote(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JupiterError);
    expect((err as JupiterError).message).toMatch(/\(code 1\)/);
    expect((err as JupiterError).message).not.toMatch(/SOL\b/);
    expect(orderUrls).toHaveLength(1);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ the agent-paid path

  it("with SOLANA_SPONSORED_SWAPS=0 behaves as W7: no payer, pre-quote top-up, the agent signs alone", async () => {
    vi.stubEnv("SOLANA_SPONSORED_SWAPS", "0");
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("filled");
    expect(edges.ensureSponsorCapacity).not.toHaveBeenCalled();
    expect(failures).not.toHaveBeenCalled();
    expect(orderUrls.every((u) => !u.searchParams.has("payer"))).toBe(true);
    expect(edges.ensureAgentGas).toHaveBeenCalledWith(expect.objectContaining({ requiredLamports: 6_000_000, purpose: "swap" }));
    expect(edges.cosignAsPlatform).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).toHaveBeenCalledTimes(1);
  });

  it("checks the agent-paid bytes too: an order that sends the agent's SOL to a stranger is not signed", async () => {
    vi.stubEnv("SOLANA_SPONSORED_SWAPS", "0");
    agentPaidOverride = {
      ...agentPaidOrder(),
      transaction: tx({
        feePayer: agentKp.publicKey,
        args: { slippageBps: 25, feeBps: 2 },
        extra: [SystemProgram.transfer({ fromPubkey: agentKp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 10_000_000 })],
      }),
    };
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(/somewhere other than its own wrapped-SOL account/);
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
    expect(executeBodies).toHaveLength(0);
  });

  it("caps the priority fee an agent-paid order may spend of the agent's (dripped) SOL", async () => {
    vi.stubEnv("SOLANA_SPONSORED_SWAPS", "0");
    agentPaidOverride = { ...agentPaidOrder(), transaction: tx({ feePayer: agentKp.publicKey, args: { slippageBps: 25, feeBps: 2 }, computeUnitPrice: 50_000_000 }) };
    const ex = executor();
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(new RegExp(`over the ${MAX_SPONSORED_PRIORITY_LAMPORTS}`));
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
  });

  /** W8 review: the drip was sized by the order's own fee fields, so a compromised /order set it. */
  it("refuses an agent-paid order declaring more fees than one trade is allowed, before any drip sized by it", async () => {
    vi.stubEnv("SOLANA_SPONSORED_SWAPS", "0");
    agentPaidOverride = { ...agentPaidOrder(), prioritizationFeeLamports: 40_000_000 };
    const err = await executor().quote(request).catch((e: unknown) => e);
    expect((err as JupiterError).kind).toBe("sponsor");
    expect(edges.ensureAgentGas).toHaveBeenCalledTimes(1);
    expect(edges.ensureAgentGas).toHaveBeenCalledWith(expect.objectContaining({ requiredLamports: 6_000_000 }));
  });

  it("still throws a signing failure on the plain agent-paid path, as W7 did", async () => {
    vi.stubEnv("SOLANA_SPONSORED_SWAPS", "0");
    edges.privySignTransaction.mockRejectedValueOnce(new Error("policy denied"));
    const ex = executor();
    await expect(ex.execute(await ex.quote(request))).rejects.toThrow(/policy denied/);
  });

  // ------------------------------------------- W8 review: the platform's own refuel swap

  const platformWallet = { chain: "solana" as const, walletId: "platform-wallet", address: platform };
  const refuelRequest: TradeRequest = { ...request, tokenId: `solana:${WSOL_MINT.toBase58()}`, tokenAddress: WSOL_MINT.toBase58(), symbol: "SOL", decimals: 9, amountUsd: 10, slippageBps: 100 };
  const refuelOrder = (f: Partial<SwapFixture> = {}): Record<string, unknown> => ({
    ...FUNDED_TAKER_ORDER,
    requestId: "refuel",
    inAmount: "10000000",
    taker: platform,
    signatureFeePayer: platform,
    prioritizationFeePayer: platform,
    rentFeePayer: platform,
    transaction: swapTransaction({ feePayer: platformKp.publicKey, taker: platformKp.publicKey, outputMint: WSOL_MINT, args: { slippageBps: 25, feeBps: 2 }, ...f }).base64,
  });

  it("the platform's refuel is checked and signed through signAsPlatformTaker, within the fee it pays — never a raw Privy signature", async () => {
    agentPaidOverride = refuelOrder();
    const ex = new JupiterExecutor(platformWallet);
    const fill = await ex.execute(await ex.quote(refuelRequest));
    expect(fill.status).toBe("filled");
    expect(edges.ensureSponsorCapacity).not.toHaveBeenCalled();
    expect(orderUrls.every((u) => !u.searchParams.has("payer"))).toBe(true);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
    expect(edges.signAsPlatformTaker).toHaveBeenCalledWith({
      transactionBase64: expect.any(String),
      maxOutflowLamports: 5_000 + 1_342,
      purpose: "refuel swap",
    });
  });

  it("refuses a refuel whose route pays the SOL to someone else, or that carries a transfer out of the platform's USDC", async () => {
    const stranger = Keypair.generate().publicKey;
    agentPaidOverride = refuelOrder({
      route: routeV2({
        authority: platformKp.publicKey,
        source: associatedTokenAddress(platformKp.publicKey, USDC_MINT),
        destination: associatedTokenAddress(stranger, WSOL_MINT),
        sourceMint: USDC_MINT,
        destinationMint: WSOL_MINT,
        args: { ...DEFAULT_ARGS, slippageBps: 25, feeBps: 2 },
      }),
    });
    const ex = new JupiterExecutor(platformWallet);
    const diverted = await ex.execute(await ex.quote(refuelRequest));
    expect(diverted.status).toBe("failed");
    expect(diverted.error).toMatch(/pays out to an account the swap's owner does not own/);

    const drain = new TransactionInstruction({
      programId: TOKEN,
      keys: [
        acct(associatedTokenAddress(platformKp.publicKey, USDC_MINT)),
        acct(USDC_MINT, false),
        acct(associatedTokenAddress(stranger, USDC_MINT)),
        acct(platformKp.publicKey, false, true),
      ],
      data: Buffer.from([12, 0, 45, 49, 1, 0, 0, 0, 0, 6]),
    });
    agentPaidOverride = refuelOrder({ extra: [drain] });
    const drained = await ex.execute(await ex.quote(refuelRequest));
    expect(drained.status).toBe("failed");
    expect(drained.error).toMatch(/token instruction/);
    expect(edges.signAsPlatformTaker).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
  });

  it("an executor with no agent signs nothing for any wallet but the platform's", async () => {
    agentPaidOverride = agentPaidOrder();
    const ex = new JupiterExecutor(wallet);
    const fill = await ex.execute(await ex.quote(request));
    expect(fill.status).toBe("failed");
    expect(fill.error).toMatch(/only for Tocker's own fee wallet/);
    expect(edges.signAsPlatformTaker).not.toHaveBeenCalled();
    expect(edges.privySignTransaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------- platform capacity (review round 2)

  it("confirms the platform can pay a whole swap before naming it as payer", async () => {
    await executor().quote(request);
    expect(edges.ensureSponsorCapacity).toHaveBeenCalledTimes(1);
    expect(edges.ensureSponsorCapacity).toHaveBeenCalledWith({
      needLamports: SPONSORED_SWAP_RESERVE_LAMPORTS,
      why: expect.any(String),
    });
    expect(orderUrls[0].searchParams.get("payer")).toBe(platform);
  });

  it("does not put an unfunded platform on the order; the agent-paid path runs instead, logged once", async () => {
    edges.ensureSponsorCapacity.mockResolvedValue({ ok: false, error: "Tocker's fee wallet is refilling — try again in a minute." });
    const quote = await executor().quote(request);
    expect(orderUrls.every((u) => !u.searchParams.has("payer"))).toBe(true);
    expect((quote.handle as JupiterHandle).sponsorPayer).toBeNull();
    expect(edges.ensureAgentGas).toHaveBeenCalledWith(expect.objectContaining({ requiredLamports: 6_000_000, purpose: "swap" }));
    const lines = fallbackLines();
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toMatch(/refilling/);
  });

  // -------------------------------------------- "Failed to get quotes" (review round 2)

  /** fetchOrder's 0.9 s and 2.5 s backoffs, run at once. */
  const skipBackoff = () =>
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

  it("on a sponsored 'Failed to get quotes' for a dead pool, asks once without the payer and never drips", async () => {
    skipBackoff();
    noQuotes = { sponsored: true, agentPaid: true };
    const err = await executor().quote(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JupiterError);
    expect(isNoQuoteFailure(err)).toBe(true);
    // Three sponsored tries, then one plain probe with no retries.
    expect(orderUrls.map((u) => u.searchParams.get("payer"))).toEqual([platform, platform, platform, null]);
    expect(edges.ensureAgentGas).not.toHaveBeenCalled();
    expect(fallbackLines()).toHaveLength(0);
  });

  it("falls back agent-paid when only the payer order has no quote", async () => {
    skipBackoff();
    noQuotes = { sponsored: true, agentPaid: false };
    const quote = await executor().quote(request);
    expect(orderUrls.map((u) => u.searchParams.get("payer"))).toEqual([platform, platform, platform, null, null]);
    expect((quote.handle as JupiterHandle).sponsorPayer).toBeNull();
    // The W7 pre-quote top-up runs only for the real agent-paid attempt, after the probe.
    expect(edges.ensureAgentGas).toHaveBeenCalledWith(expect.objectContaining({ requiredLamports: 6_000_000 }));
  });
});
