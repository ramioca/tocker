import { describe, expect, it } from "vitest";
import { orderFeeLamports, parseUltraOrder, sellBaseUnits, takerPaysGas, venueFeeUsd, manualSlippageFor, isTransientOrderFailure } from "./jupiter";
import { clampToHeld, floorBaseUnits, isDustBaseUnits } from "./executor";

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
