/**
 * Ask the inference gateway what each pay-per-use model would cost, and check its answer
 * against the pins. Nothing is paid.
 *
 *   pnpm tsx scripts/inference-quote.ts [payer-address]
 *
 * For every model in `PAY_PER_USE_MODELS` it sends ONE unpaid request the size of a
 * typical run's opening prompt, reads the 402, runs the same pin check a paid step runs
 * (`pinInferenceRequirement`), and prints the gateway's quote beside our own estimate
 * (`estimateStepUsd`) and the most a step may cost (`stepCapUsd`). It exits non-zero if
 * any model fails a pin or quotes above its cap, so it can gate a switch-on.
 *
 * **This script cannot pay.** It imports no wallet, no signer, no Privy client, no x402
 * client and no part of the pay path (`paidFetch.ts`, `inference-fetch.ts`), and it reads
 * no secret from the environment. The only request it knows how to make is the one in
 * `askPrice` below, whose headers are a fixed pair with no payment header among them. A
 * test (`inference-pins.test.ts`) reads this file and fails if any of that changes.
 *
 * The prompt it sends is filler. No strategy, no key and no user data leaves the machine.
 * The optional payer address only lets the "fee payer is not the agent" pin be checked
 * against a real wallet; without one a neutral address stands in.
 */
import { redactSecrets } from "../src/lib/security/redact";
import { guardInferenceBody, pinInferenceRequirement, readPaymentRequired } from "../src/lib/x402/inference-pins";
import {
  estimateStepUsd,
  INFERENCE_GATEWAY,
  PAY_PER_USE_MODELS,
  QUOTE_TIMEOUT_MS,
  stepCapUsd,
  TYPICAL_RUN,
  type PayPerUseModel,
} from "../src/lib/x402/inference-types";
import { checkInferenceUrl } from "../src/lib/x402/url-policy";

const GATEWAY = INFERENCE_GATEWAY.solana;

/** The System Program's address: a real Solana address that is nobody's wallet. */
const NO_WALLET = "11111111111111111111111111111111";

/** The whole of what this script sends besides the body. There is no payment header to add. */
const HEADERS: Readonly<Record<string, string>> = Object.freeze({ accept: "application/json", "content-type": "application/json" });

interface Line {
  model: string;
  ok: boolean;
  quotedUsd: number | null;
  estimateUsd: number;
  capUsd: number;
  feePayer: string | null;
  note: string;
}

/** Text from the gateway or the network, made safe to print: secrets out, one line, short. */
function clean(text: unknown): string {
  return redactSecrets(String(text)).replace(/\s+/g, " ").trim().slice(0, 300);
}

/** One unpaid POST. Redirects are not followed, exactly as on the pay path. */
async function askPrice(body: string): Promise<Response> {
  const refused = checkInferenceUrl(GATEWAY.url, "POST");
  if (refused) throw new Error(`the gateway URL fails our own rule: ${refused}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    return await fetch(GATEWAY.url, { method: "POST", headers: { ...HEADERS }, body, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function quoteModel(model: PayPerUseModel, payer: string): Promise<Line> {
  // The shape of a run's first request: a long system prompt and a short user turn.
  const request = JSON.stringify({
    model: model.id,
    messages: [
      { role: "system", content: "filler ".repeat(Math.ceil(TYPICAL_RUN.openingChars / 7)).slice(0, TYPICAL_RUN.openingChars - 40) },
      { role: "user", content: "Reply with the single word OK. This is a pricing check." },
    ],
    temperature: 0,
  });
  const guarded = guardInferenceBody(request, model.id);
  if (!guarded.ok) throw new Error(guarded.reason);
  const estimateUsd = estimateStepUsd(model, guarded.contentChars, guarded.messages);
  const capUsd = stepCapUsd(estimateUsd);
  const line: Line = { model: model.id, ok: false, quotedUsd: null, estimateUsd, capUsd, feePayer: null, note: "" };

  let response: Response;
  try {
    response = await askPrice(guarded.body);
  } catch (err) {
    return { ...line, note: `no answer: ${clean(err instanceof Error ? err.message : err)}` };
  }
  const header = response.headers.get("payment-required");
  await response.body?.cancel().catch(() => {});
  if (response.status !== 402) {
    return { ...line, note: `HTTP ${response.status}, not a 402${response.status >= 200 && response.status < 300 ? " (answered without payment)" : ""}` };
  }
  const paymentRequired = readPaymentRequired(header);
  if (!paymentRequired) return { ...line, note: "the 402 carries no readable PAYMENT-REQUIRED header" };

  const pin = pinInferenceRequirement(paymentRequired, { address: payer });
  if (!pin.ok) return { ...line, note: `PIN MISMATCH: ${clean(pin.reason)}` };

  const quotedUsd = pin.pinned.amountUsd;
  const offered = clean(paymentRequired.accepts.map((offer) => String(offer.scheme)).join(", "));
  if (quotedUsd > capUsd) {
    return { ...line, quotedUsd, feePayer: pin.pinned.feePayer, note: `OVER THE STEP CAP (offers: ${offered})` };
  }
  const versus = quotedUsd > estimateUsd ? "above our estimate" : "at or under our estimate";
  return { ...line, ok: true, quotedUsd, feePayer: pin.pinned.feePayer, note: `pins pass, ${versus} (offers: ${offered})` };
}

function usd(value: number | null): string {
  return value === null ? "-".padStart(9) : `$${value.toFixed(6)}`;
}

async function main(): Promise<void> {
  const payer = process.argv[2] ?? NO_WALLET;
  console.log(`Unpaid quotes from ${GATEWAY.url}`);
  console.log(`Pins: exact, ${GATEWAY.network}, USDC ${GATEWAY.asset}, pay-to ${GATEWAY.payTo.join(" or ")}`);
  console.log(`Fee payer must not be ${payer === NO_WALLET ? "the agent (no wallet given, so a neutral address stands in)" : payer}\n`);
  console.log(`${"model".padEnd(32)} ${"quote".padStart(9)} ${"estimate".padStart(9)} ${"step cap".padStart(9)}  fee payer / verdict`);

  let failed = 0;
  for (const model of PAY_PER_USE_MODELS) {
    const line = await quoteModel(model, payer);
    if (!line.ok) failed += 1;
    console.log(`${line.model.padEnd(32)} ${usd(line.quotedUsd)} ${usd(line.estimateUsd)} ${usd(line.capUsd)}  ${line.feePayer ?? "-"}`);
    console.log(`${"".padEnd(32)} ${line.ok ? "ok" : "FAILED"}: ${line.note}`);
    // One request a model, unhurried: this is a price check, not a load test.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log(
    failed === 0
      ? `\nAll ${PAY_PER_USE_MODELS.length} models quote inside the pins and under their step cap. Nothing was paid.`
      : `\n${failed} of ${PAY_PER_USE_MODELS.length} models failed. Do not switch pay-per-use on until this is understood. Nothing was paid.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(clean(err instanceof Error ? err.message : err));
  process.exit(1);
});
