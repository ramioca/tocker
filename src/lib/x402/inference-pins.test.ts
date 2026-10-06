import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { associatedTokenAddress, SOLANA_USDC_MINT, TOKEN_PROGRAM_ID } from "@/lib/wallets/solana-transfer";
import {
  guardInferenceBody,
  INFERENCE_MAX_REQUEST_BYTES,
  isSolanaAddress,
  measureChatMessages,
  pinInferenceRequirement,
  readPaymentRequired,
  SPL_TOKEN_PROGRAM,
  usdcAccountOf,
  verifySignedPayment,
  type PinnedRequirement,
} from "./inference-pins";
import {
  BLOCKRUN_FEE_PAYERS,
  blockrunBase402,
  blockrunSolana402,
  buildPayment,
  computeBudgetInstruction,
  Keypair,
  lamportTransfer,
  memoGateway402,
  memoInstruction,
  mintRpcAnswer,
  otherGateway402,
  TEST_BLOCKHASH,
  TEST_MEMO,
  TEST_RPC_URL,
  TOKEN_2022_PROGRAM,
  transferChecked,
  USDT_MINT,
} from "./inference-test-support";
import { INFERENCE_GATEWAY, INFERENCE_MAX_OUTPUT_TOKENS } from "./inference-types";

const SOLANA = INFERENCE_GATEWAY.solana;
const PAY_TO = SOLANA.payTo[0];
const FEE_PAYER = BLOCKRUN_FEE_PAYERS[0];

/** A fresh wallet for each test: it exists nowhere but this process. */
function wallet(): { keypair: Keypair; address: string } {
  const keypair = Keypair.generate();
  return { keypair, address: keypair.publicKey.toBase58() };
}

/** The real 402 with its `exact` offer changed, to try one wrong field at a time. */
function with402(change: (exact: Record<string, unknown>, all: Record<string, unknown>[]) => void): PaymentRequired {
  const paymentRequired = blockrunSolana402();
  const accepts = paymentRequired.accepts as unknown as Record<string, unknown>[];
  change(accepts[0], accepts);
  return paymentRequired;
}

describe("guardInferenceBody", () => {
  const model = "anthropic/claude-haiku-4.5";
  const request = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ model, messages: [{ role: "user", content: "hello" }], temperature: 0.2, ...extra });

  it("forces the output cap under the one name the gateway prices on", () => {
    const guarded = guardInferenceBody(request({ max_completion_tokens: 9000, max_tokens: 64_000 }), model);
    if (!guarded.ok) throw new Error(guarded.reason);
    const sent = JSON.parse(guarded.body) as Record<string, unknown>;
    expect(sent.max_tokens).toBe(INFERENCE_MAX_OUTPUT_TOKENS);
    expect("max_completion_tokens" in sent).toBe(false);
    // Everything else travels as the caller wrote it.
    expect(sent).toMatchObject({ model, temperature: 0.2, messages: [{ role: "user", content: "hello" }] });
  });

  it("adds the cap when the caller sent none (the gateway would price 8192 tokens)", () => {
    const guarded = guardInferenceBody(request(), model);
    if (!guarded.ok) throw new Error(guarded.reason);
    expect((JSON.parse(guarded.body) as { max_tokens: number }).max_tokens).toBe(INFERENCE_MAX_OUTPUT_TOKENS);
  });

  it("hashes the body that is sent, not the one that came in", () => {
    const guarded = guardInferenceBody(request({ max_completion_tokens: 1 }), model);
    if (!guarded.ok) throw new Error(guarded.reason);
    expect(guarded.requestHash).toBe(createHash("sha256").update(guarded.body, "utf8").digest("hex"));
    expect(guarded.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses another model, a stream, and a body that is not a chat request", () => {
    expect(guardInferenceBody(request(), "openai/gpt-4o-mini")).toMatchObject({ ok: false, reason: expect.stringContaining("names model") });
    expect(guardInferenceBody(request({ stream: true }), model)).toEqual({ ok: false, reason: "streamed answers are not paid for" });
    expect(guardInferenceBody(request({ stream: "yes" }), model)).toMatchObject({ ok: false });
    expect(guardInferenceBody(request({ stream: false }), model)).toMatchObject({ ok: true });
    expect(guardInferenceBody(request({ messages: [] }), model)).toEqual({ ok: false, reason: "the request has no messages" });
    expect(guardInferenceBody(request({ messages: "hi" }), model)).toMatchObject({ ok: false });
    expect(guardInferenceBody("", model)).toMatchObject({ ok: false });
    expect(guardInferenceBody("not json", model)).toEqual({ ok: false, reason: "the request body is not JSON" });
    expect(guardInferenceBody("[1,2]", model)).toEqual({ ok: false, reason: "the request body is not a JSON object" });
    expect(guardInferenceBody("null", model)).toMatchObject({ ok: false });
  });

  it("refuses a body over the size limit, counted in bytes", () => {
    const big = request({ messages: [{ role: "user", content: "x".repeat(INFERENCE_MAX_REQUEST_BYTES) }] });
    expect(guardInferenceBody(big, model)).toMatchObject({ ok: false, reason: expect.stringContaining("bytes") });
    // Under the limit in characters, over it in bytes.
    const wide = request({ messages: [{ role: "user", content: "é".repeat(INFERENCE_MAX_REQUEST_BYTES / 2 + 10) }] });
    expect(wide.length).toBeLessThan(INFERENCE_MAX_REQUEST_BYTES);
    expect(guardInferenceBody(wide, model)).toMatchObject({ ok: false, reason: expect.stringContaining("bytes") });
  });

  it("measures what the gateway prices: characters of content, and messages", () => {
    const messages = [
      { role: "system", content: "abc" },
      { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "!" }] },
      { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "f", arguments: "{\"long\":\"ignored\"}" } }] },
      { role: "tool", tool_call_id: "1", content: "result" },
    ];
    expect(measureChatMessages(messages)).toEqual({ contentChars: 3 + 5 + 1 + 6, messages: 4 });
    const guarded = guardInferenceBody(JSON.stringify({ model, messages }), model);
    expect(guarded).toMatchObject({ ok: true, contentChars: 15, messages: 4 });
    // A part that is not text is counted at its JSON length, so the estimate errs high.
    const image = { type: "image_url", image_url: { url: "data:..." } };
    expect(measureChatMessages([{ role: "user", content: [image] }]).contentChars).toBe(JSON.stringify(image).length);
  });
});

describe("readPaymentRequired", () => {
  it("decodes the header the gateway sends, and nothing else", () => {
    const paymentRequired = blockrunSolana402();
    expect(readPaymentRequired(encodePaymentRequiredHeader(paymentRequired))).toEqual(paymentRequired);
    expect(readPaymentRequired(null)).toBeNull();
    expect(readPaymentRequired("")).toBeNull();
    expect(readPaymentRequired("%%% not base64 %%%")).toBeNull();
    expect(readPaymentRequired(Buffer.from("[1]").toString("base64"))).toBeNull();
    expect(readPaymentRequired(Buffer.from("not json").toString("base64"))).toBeNull();
    expect(readPaymentRequired("A".repeat(70_000))).toBeNull();
  });
});

describe("pinInferenceRequirement", () => {
  const payer = wallet();

  it("takes BlockRun's real Solana 402: the exact offer, untouched", () => {
    const paymentRequired = blockrunSolana402();
    const pin = pinInferenceRequirement(paymentRequired, payer);
    if (!pin.ok) throw new Error(pin.reason);
    expect(pin.pinned).toMatchObject({
      network: SOLANA.network,
      asset: SOLANA.asset,
      payTo: PAY_TO,
      feePayer: FEE_PAYER,
      amount: "11961",
      amountUsd: 0.011961,
    });
    // The same object, not a copy: it is echoed back to the gateway as it was offered.
    expect(pin.pinned.requirement).toBe(paymentRequired.accepts[0]);
  });

  it("accepts either of the two fee payers the gateway alternates between", () => {
    for (const feePayer of BLOCKRUN_FEE_PAYERS) {
      const pin = pinInferenceRequirement(with402((exact) => Object.assign(exact.extra as object, { feePayer })), payer);
      expect(pin, feePayer).toMatchObject({ ok: true, pinned: { feePayer } });
    }
  });

  it("never takes the first offer just because it is first", () => {
    // The x402 client's own rule is `accepts[0]`. Here the deposit-backed scheme is first.
    const reordered = with402((_exact, all) => all.reverse());
    expect((reordered.accepts[0] as { scheme: string }).scheme).toBe("batch-settlement");
    const pin = pinInferenceRequirement(reordered, payer);
    if (!pin.ok) throw new Error(pin.reason);
    expect(pin.pinned.requirement.scheme).toBe("exact");
    expect(pin.pinned.amount).toBe("11961");
  });

  it("refuses a 402 with no exact offer, however well the rest matches", () => {
    const onlyBatch = with402((_exact, all) => all.shift());
    expect(pinInferenceRequirement(onlyBatch, payer)).toMatchObject({ ok: false, reason: expect.stringContaining("no exact payment") });
    for (const scheme of ["upto", "Exact", "exact ", "EXACT", "", null, undefined, 1]) {
      const pin = pinInferenceRequirement(with402((exact, all) => { exact.scheme = scheme; all.pop(); }), payer);
      expect(pin.ok, String(scheme)).toBe(false);
    }
  });

  it("refuses the wrong network: BlockRun's own Base 402, and a near miss", () => {
    expect(pinInferenceRequirement(blockrunBase402(), payer)).toMatchObject({ ok: false, reason: expect.stringContaining("not Solana mainnet") });
    for (const network of ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "solana", "solana:*", `${SOLANA.network} `, "eip155:8453"]) {
      expect(pinInferenceRequirement(with402((exact) => { exact.network = network; }), payer).ok, network).toBe(false);
    }
  });

  it("refuses the wrong asset: another stablecoin the x402 client would have paid", () => {
    // USDT is one of the client's five default Solana assets.
    const pin = pinInferenceRequirement(with402((exact) => { exact.asset = USDT_MINT; }), payer);
    expect(pin).toMatchObject({ ok: false, reason: expect.stringContaining("not USDC") });
    expect(pinInferenceRequirement(with402((exact) => { exact.asset = SOLANA.asset.toLowerCase(); }), payer).ok).toBe(false);
  });

  it("refuses the wrong pay-to: two other gateways' real 402s", () => {
    expect(pinInferenceRequirement(otherGateway402(), payer)).toMatchObject({ ok: false, reason: expect.stringContaining("not the gateway's published address") });
    expect(pinInferenceRequirement(memoGateway402(), payer)).toMatchObject({ ok: false, reason: expect.stringContaining("not the gateway's published address") });
    // The agent paying itself is not the gateway either.
    expect(pinInferenceRequirement(with402((exact) => { exact.payTo = payer.address; }), payer).ok).toBe(false);
  });

  it("refuses a 402 that dictates its own memo", () => {
    for (const memo of ["pi_0b8e", "", 0, TEST_MEMO]) {
      const pin = pinInferenceRequirement(with402((exact) => Object.assign(exact.extra as object, { memo })), payer);
      expect(pin, JSON.stringify(memo)).toEqual({ ok: false, reason: "the exact offer dictates its own memo" });
    }
  });

  it("refuses the agent as fee payer, and a fee payer that is not an address", () => {
    const own = pinInferenceRequirement(with402((exact) => Object.assign(exact.extra as object, { feePayer: payer.address })), payer);
    expect(own).toEqual({ ok: false, reason: "the exact offer makes the agent's own wallet the fee payer" });
    for (const feePayer of [undefined, null, "", "not-base58!", "0xe9030014F5DAe217d0A152f02A043567b16c1aBf", 7]) {
      const pin = pinInferenceRequirement(with402((exact) => Object.assign(exact.extra as object, { feePayer })), payer);
      expect(pin.ok, String(feePayer)).toBe(false);
    }
    expect(pinInferenceRequirement(with402((exact) => { delete exact.extra; }), payer).ok).toBe(false);
  });

  it("refuses an amount that is not a positive whole number of units", () => {
    for (const amount of ["0", "-5", "1e3", "12.5", " 1000", "0x10", "", 1000, null, "1".repeat(16)]) {
      expect(pinInferenceRequirement(with402((exact) => { exact.amount = amount; }), payer).ok, String(amount)).toBe(false);
    }
  });

  it("refuses two matching offers, another protocol version, and a 402 with nothing in it", () => {
    const twice = with402((exact, all) => all.push({ ...exact, amount: "5" }));
    expect(pinInferenceRequirement(twice, payer)).toEqual({ ok: false, reason: "the 402 makes more than one exact USDC offer to the gateway" });
    expect(pinInferenceRequirement({ ...blockrunSolana402(), x402Version: 1 }, payer).ok).toBe(false);
    expect(pinInferenceRequirement({ ...blockrunSolana402(), accepts: [] }, payer).ok).toBe(false);
    expect(pinInferenceRequirement({ ...blockrunSolana402(), accepts: "exact" }, payer).ok).toBe(false);
    expect(pinInferenceRequirement(null, payer).ok).toBe(false);
    expect(pinInferenceRequirement("402", payer).ok).toBe(false);
  });

  it("refuses when the paying wallet is not a Solana wallet", () => {
    expect(pinInferenceRequirement(blockrunSolana402(), { address: "PaperSolAddress" }).ok).toBe(false);
    expect(pinInferenceRequirement(blockrunSolana402(), { address: "0xe9030014F5DAe217d0A152f02A043567b16c1aBf" }).ok).toBe(false);
  });

  it("keeps what it quotes from the gateway short", () => {
    const pin = pinInferenceRequirement(with402((exact) => { exact.network = `evil ${"z".repeat(5000)}`; }), payer);
    if (pin.ok) throw new Error("expected a refusal");
    expect(pin.reason.length).toBeLessThan(200);
  });
});

describe("verifySignedPayment", () => {
  const pinnedFor = (overrides: Partial<PinnedRequirement> = {}): Pick<PinnedRequirement, "asset" | "payTo" | "feePayer" | "amount"> => ({
    asset: SOLANA.asset,
    payTo: PAY_TO,
    feePayer: FEE_PAYER,
    amount: "11961",
    ...overrides,
  });

  /** The instructions of a correct payment, to change one at a time. */
  function goodInstructions(payer: string) {
    return {
      limit: ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
      price: ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      transfer: transferChecked({ source: usdcAccountOf(payer), mint: SOLANA.asset, destination: usdcAccountOf(PAY_TO), authority: payer, amount: BigInt(11_961) }),
      memo: memoInstruction(TEST_MEMO),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives token accounts the way the rest of the app does", () => {
    const { address } = wallet();
    expect(usdcAccountOf(address)).toBe(associatedTokenAddress(new PublicKey(address), SOLANA_USDC_MINT).toBase58());
    expect(SPL_TOKEN_PROGRAM).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(SOLANA.asset).toBe(SOLANA_USDC_MINT.toBase58());
    expect(isSolanaAddress(address)).toBe(true);
    expect(isSolanaAddress("PaperSolAddress")).toBe(false);
  });

  it("passes the payment as priced, and reads the memo, blockhash and signature out of the bytes", () => {
    const payer = wallet();
    const { transaction, tx } = buildPayment({ payer: payer.keypair });
    const check = verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor() });
    if (!check.ok) throw new Error(check.reason);
    expect(check.memo).toBe(TEST_MEMO);
    expect(check.blockhash).toBe(TEST_BLOCKHASH);
    expect(check.feePayer).toBe(FEE_PAYER);
    expect(check.payerSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    // The agent's signature sits in the second slot; the fee payer's is still empty.
    expect(Buffer.from(tx.signatures[0]).every((byte) => byte === 0)).toBe(true);
  });

  it("passes what the installed x402 Solana scheme really builds from BlockRun's 402", async () => {
    // The drift alarm: if a new version of the scheme builds a different transaction,
    // this is the test that says so before a wallet is asked to sign it.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = mintRpcAnswer(input, init);
      if (!answer) throw new Error("unexpected network call in a test");
      return answer;
    });
    const [{ generateKeyPairSigner }, { ExactSvmScheme }] = await Promise.all([import("@solana/kit"), import("@x402/svm/exact/client")]);
    const signer = await generateKeyPairSigner();
    const paymentRequired = blockrunSolana402();
    const pin = pinInferenceRequirement(paymentRequired, { address: signer.address });
    if (!pin.ok) throw new Error(pin.reason);

    const scheme = new ExactSvmScheme(signer, { rpcUrl: TEST_RPC_URL });
    const built = await scheme.createPaymentPayload(2, pin.pinned.requirement);
    const transaction = (built.payload as { transaction: string }).transaction;
    const check = verifySignedPayment({ transaction, payer: signer.address, pinned: pin.pinned });
    if (!check.ok) throw new Error(check.reason);
    expect(check.memo).toMatch(/^[0-9a-f]{32}$/);
    // The scheme takes the blockhash from the 402; the ledger takes it from the bytes.
    expect(check.blockhash).toBe("2Etc9q7omPrAu16uFNbM3fwUH7ygCFKkToN4YCXym1nK");
    expect(check.feePayer).toBe(FEE_PAYER);

    // Two payments of the same price are still two different payments.
    const again = await scheme.createPaymentPayload(2, pin.pinned.requirement);
    const second = verifySignedPayment({ transaction: (again.payload as { transaction: string }).transaction, payer: signer.address, pinned: pin.pinned });
    expect(second.ok && second.memo).not.toBe(check.memo);
  });

  it("tells an unsigned payment from a wrong one", () => {
    const payer = wallet();
    const { transaction } = buildPayment({ payer: payer.keypair, signers: [] });
    expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor(), requireSignature: false })).toMatchObject({
      ok: true,
      payerSignature: null,
      memo: TEST_MEMO,
    });
    expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the transaction is not signed by the agent",
      signature: true,
    });
  });

  it("refuses a signature that is not the agent's over these bytes", () => {
    const payer = wallet();
    const other = wallet();
    const good = buildPayment({ payer: payer.keypair });
    // A real signature, lifted from a different payment.
    const elsewhere = buildPayment({ payer: payer.keypair, memo: "ffffffffffffffffffffffffffffffff" });
    good.tx.signatures[1] = elsewhere.tx.signatures[1];
    const swapped = Buffer.from(good.tx.serialize()).toString("base64");
    expect(verifySignedPayment({ transaction: swapped, payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the agent's signature does not match the transaction",
      signature: true,
    });
    // Somebody else's key in the agent's slot. Checked even when no signature is required.
    const forged = buildPayment({ payer: payer.keypair, signers: [] });
    forged.tx.signatures[1] = buildPayment({ payer: other.keypair }).tx.signatures[1];
    const forgedBytes = Buffer.from(forged.tx.serialize()).toString("base64");
    expect(verifySignedPayment({ transaction: forgedBytes, payer: payer.address, pinned: pinnedFor(), requireSignature: false })).toMatchObject({ ok: false, signature: true });
  });

  it("refuses the wrong amount, by one unit either way", () => {
    const payer = wallet();
    for (const amount of [BigInt(11_962), BigInt(11_960), BigInt(1_196_100), BigInt(0)]) {
      const { transaction } = buildPayment({ payer: payer.keypair, amount });
      expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor() }), String(amount)).toEqual({
        ok: false,
        reason: "the transfer is not for the quoted amount",
      });
    }
  });

  it("refuses the wrong destination", () => {
    const payer = wallet();
    const thief = wallet();
    const good = goodInstructions(payer.address);
    const destinations = {
      "another wallet's USDC account": usdcAccountOf(thief.address),
      // The pay-to's wallet address itself, not its token account.
      "the pay-to wallet rather than its token account": PAY_TO,
      "the agent's own account": usdcAccountOf(payer.address),
    };
    for (const [name, destination] of Object.entries(destinations)) {
      const transfer = transferChecked({ source: usdcAccountOf(payer.address), mint: SOLANA.asset, destination, authority: payer.address, amount: BigInt(11_961) });
      const { transaction } = buildPayment({ payer: payer.keypair, instructions: [good.limit, good.price, transfer, good.memo] });
      expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor() }).ok, name).toBe(false);
    }
    // A transaction that pays a different gateway correctly is still not this payment.
    const elsewhere = buildPayment({ payer: payer.keypair, payTo: "SoRaFGuCpgBqpXJ6KKeA5cx6zZZpUwaBKQzt7nsy5yq" });
    expect(verifySignedPayment({ transaction: elsewhere.transaction, payer: payer.address, pinned: pinnedFor() }).ok).toBe(false);
  });

  it("refuses the wrong mint, the wrong token program and the wrong decimals", () => {
    const payer = wallet();
    const good = goodInstructions(payer.address);
    const attempt = (transfer: ReturnType<typeof transferChecked>) =>
      verifySignedPayment({
        transaction: buildPayment({ payer: payer.keypair, instructions: [good.limit, good.price, transfer, good.memo] }).transaction,
        payer: payer.address,
        pinned: pinnedFor(),
      });
    const base = { source: usdcAccountOf(payer.address), mint: SOLANA.asset, destination: usdcAccountOf(PAY_TO), authority: payer.address, amount: BigInt(11_961) };

    // USDT, between USDT accounts: a well-formed transfer of the wrong token.
    expect(attempt(transferChecked({ ...base, mint: USDT_MINT, source: usdcAccountOf(payer.address, USDT_MINT), destination: usdcAccountOf(PAY_TO, USDT_MINT) })).ok).toBe(false);
    // The USDC accounts, but another mint named.
    expect(attempt(transferChecked({ ...base, mint: USDT_MINT })).ok).toBe(false);
    expect(attempt(transferChecked({ ...base, program: TOKEN_2022_PROGRAM })).ok).toBe(false);
    expect(attempt(transferChecked({ ...base, decimals: 9 }))).toEqual({ ok: false, reason: "the transfer does not use USDC's decimals" });
    // Accounts the payment does name, in the wrong places: each is caught by its own
    // check, not only by the list of accounts the message may hold.
    expect(attempt(transferChecked({ ...base, mint: usdcAccountOf(payer.address) }))).toEqual({ ok: false, reason: "the transfer is not of the USDC mint" });
    expect(attempt(transferChecked({ ...base, source: usdcAccountOf(PAY_TO) }))).toEqual({
      ok: false,
      reason: "the transfer does not spend from the agent's own USDC account",
    });
    expect(attempt(transferChecked({ ...base, destination: SOLANA.asset }))).toEqual({ ok: false, reason: "the transfer does not pay the gateway's USDC account" });
    // Plain `Transfer` (tag 3) checks neither the mint nor the decimals.
    expect(attempt(transferChecked({ ...base, tag: 3 }))).toEqual({ ok: false, reason: "the token instruction is not a TransferChecked" });
    // `Approve` would hand somebody an allowance instead of a payment.
    expect(attempt(transferChecked({ ...base, tag: 13 })).ok).toBe(false);
  });

  it("refuses a transfer that spends from, or is authorised by, somebody else", () => {
    const payer = wallet();
    const other = wallet();
    const good = goodInstructions(payer.address);
    const fromOther = transferChecked({ source: usdcAccountOf(other.address), mint: SOLANA.asset, destination: usdcAccountOf(PAY_TO), authority: payer.address, amount: BigInt(11_961) });
    const first = buildPayment({ payer: payer.keypair, instructions: [good.limit, good.price, fromOther, good.memo] });
    expect(verifySignedPayment({ transaction: first.transaction, payer: payer.address, pinned: pinnedFor() }).ok).toBe(false);

    const withCosigner = transferChecked({ source: usdcAccountOf(payer.address), mint: SOLANA.asset, destination: usdcAccountOf(PAY_TO), authority: payer.address, amount: BigInt(11_961), extraSigner: other.address });
    const second = buildPayment({ payer: payer.keypair, instructions: [good.limit, good.price, withCosigner, good.memo] });
    expect(verifySignedPayment({ transaction: second.transaction, payer: payer.address, pinned: pinnedFor() }).ok).toBe(false);
  });

  it("refuses the agent as fee payer, and a fee payer the 402 did not name", () => {
    const payer = wallet();
    const own = buildPayment({ payer: payer.keypair, feePayer: payer.address });
    // One signer only: the agent would pay the network fee itself.
    expect(own.tx.message.header.numRequiredSignatures).toBe(1);
    expect(verifySignedPayment({ transaction: own.transaction, payer: payer.address, pinned: pinnedFor() }).ok).toBe(false);
    expect(verifySignedPayment({ transaction: own.transaction, payer: payer.address, pinned: pinnedFor({ feePayer: payer.address }) })).toEqual({
      ok: false,
      reason: "the agent's own wallet is the fee payer",
    });

    const swapped = buildPayment({ payer: payer.keypair, feePayer: BLOCKRUN_FEE_PAYERS[1] });
    expect(verifySignedPayment({ transaction: swapped.transaction, payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the transaction's fee payer is not the one the gateway named",
    });
    expect(verifySignedPayment({ transaction: swapped.transaction, payer: payer.address, pinned: pinnedFor({ feePayer: BLOCKRUN_FEE_PAYERS[1] }) }).ok).toBe(true);
  });

  it("refuses any extra instruction", () => {
    const payer = wallet();
    const thief = wallet();
    const good = goodInstructions(payer.address);
    const extras = {
      "a lamport transfer out of the agent": lamportTransfer(payer.address, thief.address, 1_000_000),
      "a second token transfer": transferChecked({ source: usdcAccountOf(payer.address), mint: SOLANA.asset, destination: usdcAccountOf(thief.address), authority: payer.address, amount: BigInt(5_000_000) }),
      "a second transfer of the right amount to the right place": good.transfer,
      "a second memo": memoInstruction("ffffffffffffffffffffffffffffffff"),
      "a heap request": computeBudgetInstruction([1, 0, 0, 4, 0]),
      "a second unit limit": ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      "a second unit price": ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5 }),
      // An account the payment does name, called as if it were a program.
      "a call to the mint": new TransactionInstruction({ programId: new PublicKey(SOLANA.asset), keys: [], data: Buffer.from([1]) }),
      "a call to the fee payer": new TransactionInstruction({ programId: new PublicKey(FEE_PAYER), keys: [], data: Buffer.from([]) }),
    };
    for (const [name, extra] of Object.entries(extras)) {
      for (const instructions of [
        [good.limit, good.price, good.transfer, good.memo, extra],
        [extra, good.limit, good.price, good.transfer, good.memo],
      ]) {
        const { transaction } = buildPayment({ payer: payer.keypair, instructions });
        expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor() }).ok, name).toBe(false);
      }
    }
  });

  it("refuses a missing transfer, a missing memo, and a memo that is not the random nonce", () => {
    const payer = wallet();
    const good = goodInstructions(payer.address);
    const attempt = (instructions: Parameters<typeof buildPayment>[0]["instructions"]) =>
      verifySignedPayment({ transaction: buildPayment({ payer: payer.keypair, instructions }).transaction, payer: payer.address, pinned: pinnedFor() });

    // With no transfer the agent is not even a signer, so nobody signs this one.
    const noTransfer = buildPayment({ payer: payer.keypair, instructions: [good.limit, good.price, good.memo], signers: [] });
    expect(verifySignedPayment({ transaction: noTransfer.transaction, payer: payer.address, pinned: pinnedFor(), requireSignature: false }).ok).toBe(false);
    expect(attempt([good.limit, good.price, good.transfer])).toEqual({ ok: false, reason: "the transaction carries no memo" });
    for (const memo of ["pi_0b8e", "", "0123456789ABCDEF0123456789ABCDEF", `${TEST_MEMO}0`, "x".repeat(32)]) {
      expect(attempt([good.limit, good.price, good.transfer, memoInstruction(memo)]), memo).toEqual({ ok: false, reason: "the memo is not the payment's random nonce" });
    }
    // A memo that demands a signer would be asking the agent to vouch for the text.
    expect(attempt([good.limit, good.price, good.transfer, memoInstruction(TEST_MEMO, payer.address)])).toEqual({ ok: false, reason: "the memo names accounts" });
  });

  it("passes without compute-budget settings: they are the fee payer's cost, not the agent's", () => {
    const payer = wallet();
    const good = goodInstructions(payer.address);
    const { transaction } = buildPayment({ payer: payer.keypair, instructions: [good.transfer, good.memo] });
    expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor() }).ok).toBe(true);
  });

  it("refuses a third signer, a lookup table, a legacy transaction and trailing bytes", () => {
    const payer = wallet();
    const other = wallet();
    const good = goodInstructions(payer.address);

    // A hidden third signer: something else is being authorised by this transaction.
    const third = buildPayment({ payer: payer.keypair, instructions: [good.limit, good.price, good.transfer, memoInstruction(TEST_MEMO, other.address)] });
    expect(third.tx.message.header.numRequiredSignatures).toBe(3);
    expect(verifySignedPayment({ transaction: third.transaction, payer: payer.address, pinned: pinnedFor() }).ok).toBe(false);

    // A lookup table can stand in for any account the transfer names.
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [new PublicKey(usdcAccountOf(PAY_TO))] },
    });
    const viaTable = new VersionedTransaction(
      new TransactionMessage({ payerKey: new PublicKey(FEE_PAYER), recentBlockhash: TEST_BLOCKHASH, instructions: [good.limit, good.price, good.transfer, good.memo] }).compileToV0Message([table]),
    );
    expect(viaTable.message.addressTableLookups.length).toBe(1);
    viaTable.sign([payer.keypair]);
    expect(verifySignedPayment({ transaction: Buffer.from(viaTable.serialize()).toString("base64"), payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the transaction reads accounts from a lookup table",
    });

    const legacy = new VersionedTransaction(
      new TransactionMessage({ payerKey: new PublicKey(FEE_PAYER), recentBlockhash: TEST_BLOCKHASH, instructions: [good.limit, good.price, good.transfer, good.memo] }).compileToLegacyMessage(),
    );
    legacy.sign([payer.keypair]);
    expect(verifySignedPayment({ transaction: Buffer.from(legacy.serialize()).toString("base64"), payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the transaction is not a version 0 transaction",
    });

    const { tx } = buildPayment({ payer: payer.keypair });
    const padded = Buffer.concat([Buffer.from(tx.serialize()), Buffer.from([0, 1, 2, 3])]).toString("base64");
    expect(verifySignedPayment({ transaction: padded, payer: payer.address, pinned: pinnedFor() })).toEqual({ ok: false, reason: "the signed transaction could not be decoded" });
    for (const junk of ["", "not base64!", "AAAA", Buffer.from("hello").toString("base64")]) {
      expect(verifySignedPayment({ transaction: junk, payer: payer.address, pinned: pinnedFor() }).ok, junk).toBe(false);
    }
  });

  it("refuses an account that no instruction of the payment needs", () => {
    // No compiler emits this: the message is put together by hand, with one more
    // account on the end that nothing refers to.
    const payer = wallet();
    const { tx } = buildPayment({ payer: payer.keypair, signers: [] });
    const message = tx.message as MessageV0;
    const padded = new MessageV0({
      header: { ...message.header, numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts + 1 },
      staticAccountKeys: [...message.staticAccountKeys, Keypair.generate().publicKey],
      recentBlockhash: message.recentBlockhash,
      compiledInstructions: message.compiledInstructions,
      addressTableLookups: [],
    });
    const stray = new VersionedTransaction(padded);
    stray.sign([payer.keypair]);
    expect(verifySignedPayment({ transaction: Buffer.from(stray.serialize()).toString("base64"), payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the transaction names an account the payment does not need",
    });
  });

  it("refuses a third required signer even when every account is one the payment names", () => {
    // By hand again: the header claims three signers, which makes the agent's own token
    // account one of them. Every instruction still reads as the right payment.
    const payer = wallet();
    const { tx } = buildPayment({ payer: payer.keypair, signers: [] });
    const message = tx.message as MessageV0;
    expect(message.staticAccountKeys[2].toBase58()).toBe(usdcAccountOf(payer.address));
    const widened = new VersionedTransaction(
      new MessageV0({
        header: { ...message.header, numRequiredSignatures: 3 },
        staticAccountKeys: message.staticAccountKeys,
        recentBlockhash: message.recentBlockhash,
        compiledInstructions: message.compiledInstructions,
        addressTableLookups: [],
      }),
    );
    widened.sign([payer.keypair]);
    const check = verifySignedPayment({ transaction: Buffer.from(widened.serialize()).toString("base64"), payer: payer.address, pinned: pinnedFor() });
    expect(check).toMatchObject({ ok: false, reason: expect.stringContaining("asks for 3 signatures") });
  });

  it("refuses a signature in the fee payer's place", () => {
    const payer = wallet();
    const { tx } = buildPayment({ payer: payer.keypair });
    // Not the fee payer's real signature (nobody here holds that key), but something is there.
    tx.signatures[0] = tx.signatures[1];
    expect(verifySignedPayment({ transaction: Buffer.from(tx.serialize()).toString("base64"), payer: payer.address, pinned: pinnedFor() })).toEqual({
      ok: false,
      reason: "the transaction already carries a signature in the fee payer's place",
    });
  });

  it("refuses when the thing to check against is itself off the pins", () => {
    const payer = wallet();
    const { transaction } = buildPayment({ payer: payer.keypair });
    expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor({ asset: USDT_MINT }) }).ok).toBe(false);
    expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor({ payTo: payer.address }) }).ok).toBe(false);
    expect(verifySignedPayment({ transaction, payer: payer.address, pinned: pinnedFor({ amount: "-1" }) }).ok).toBe(false);
    expect(verifySignedPayment({ transaction, payer: "PaperSolAddress", pinned: pinnedFor() }).ok).toBe(false);
    // Another wallet's payment is not this wallet's payment.
    expect(verifySignedPayment({ transaction, payer: wallet().address, pinned: pinnedFor() }).ok).toBe(false);
  });
});

describe("what cannot pay", () => {
  /** Everything a file would have to import, or say, to be able to sign or send a payment. */
  const CAN_PAY = [
    /@privy-io/,
    /@x402\/core\/client/,
    /@x402\/fetch/,
    /@x402\/svm/,
    /@x402\/evm/,
    /lib\/privy/,
    /lib\/wallets/,
    /lib\/platform/,
    /paidFetch/,
    /inference-fetch/,
    /inference-ledger/,
    /PAYMENT-SIGNATURE/i,
    /X-PAYMENT\b/i,
    /signTransaction/,
    /Keypair/,
    /PRIVATE_KEY/,
    /process\.env/,
  ];
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  /** The code alone: what a comment says is not something a file can do. */
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the quote script has no way to sign or send a payment", () => {
    const source = code(read("scripts/inference-quote.ts"));
    for (const shape of CAN_PAY) expect(shape.test(source), String(shape)).toBe(false);
    // One request shape, with a fixed pair of headers.
    expect(source.match(/\bfetch\(/g)).toHaveLength(1);
    expect(source).toContain('Object.freeze({ accept: "application/json", "content-type": "application/json" })');
    expect(source).toContain('redirect: "manual"');
    // What it does import is this file's subject and other pure modules.
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).sort();
    expect(imports).toEqual(["../src/lib/security/redact", "../src/lib/x402/inference-pins", "../src/lib/x402/inference-types", "../src/lib/x402/url-policy"]);
  });

  it("the checks themselves reach no signer, no client, no database and no environment", () => {
    for (const file of ["src/lib/x402/inference-pins.ts", "src/lib/x402/inference-types.ts", "src/lib/x402/url-policy.ts"]) {
      const source = code(read(file));
      for (const shape of CAN_PAY) {
        // `inference-types.ts` reads the switches from the environment by design, and
        // nothing else in this list.
        if (file.endsWith("inference-types.ts") && shape.source === "process\\.env") continue;
        expect(shape.test(source), `${file} ${String(shape)}`).toBe(false);
      }
      expect(source).not.toMatch(/from "@\/db|drizzle/);
    }
  });
});
