"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { recordAudit } from "@/lib/security/audit";
import { limiter, RATE_LIMITS } from "@/lib/security/rate-limit";
import { dbErrorForLog, looksLikeSecret, redactSecrets } from "@/lib/security/redact";
import { controlStop } from "@/lib/x402/inference-budget";
import { clearInferencePause, readInferenceControl, setInferenceHalt } from "@/lib/x402/inference-ledger";
import { probeInferenceSignature } from "@/lib/x402/paidFetch";
import { findAgentSolanaWallet, getAdminBalances, resetAdminBalanceCache } from "@/server/queries/admin";
import type { ActionResult } from "@/server/types";

/**
 * What every action here answers a non-admin with: the same nothing the route gives
 * them. A server action cannot 404, but it must not confirm the surface exists either.
 */
const NOT_FOUND = { ok: false as const, error: "Not found." };

/** How long a sentence that came from outside (a provider, the probe) may be once redacted. */
const OUTSIDE_TEXT_MAX = 300;

/**
 * Re-read every agent wallet from Privy and drop the cached snapshot.
 *
 * The dashboard shows balances "as of HH:MM" rather than pretending they are live,
 * because reading them costs two Privy calls per wallet. This is the button next to
 * that timestamp: it is the only way the page issues those calls outside the 60-second
 * cache, so an operator decides when to pay for a fresh reading.
 *
 * The error message for a non-admin is deliberately the same nothing the route gives
 * them. A server action cannot 404, but it must not confirm the surface exists either.
 */
export async function refreshAdminBalancesAction(): Promise<ActionResult<{ readAt: string }>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return NOT_FOUND;

  try {
    resetAdminBalanceCache();
    const snapshot = await getAdminBalances({ force: true });
    revalidatePath("/settings/admin");
    return { ok: true, data: { readAt: snapshot.readAt } };
  } catch (err) {
    // The message can be a provider's own (Privy, an RPC node). Scrubbed before it is shown.
    return {
      ok: false,
      error: err instanceof Error ? redactSecrets(err.message).slice(0, OUTSIDE_TEXT_MAX) : "Could not read the wallet balances.",
    };
  }
}

// ---------------------------------------------------------------- pay-per-use thinking

/** A halt has to say why, in enough words for whoever reads it next; and not an essay. */
const HALT_REASON_MIN = 4;
const HALT_REASON_MAX = 300;

/**
 * Halt pay-per-use thinking for every agent, or clear the halt.
 *
 * The halt is one row in the database that the ledger reads inside `reserve`, the step
 * before any signature. So it stops the very next payment on every server with no
 * deploy, which is the point: the environment switch (`INFERENCE_USDC`) needs a redeploy
 * to take effect, and this does not. It stops nothing already signed; a payment in
 * flight finishes and is recorded as usual.
 *
 * Halting needs a reason, because the next person to open the page (or the same one, a
 * week later) has to know whether it is safe to clear. Clearing is the action that lets
 * money move again, so it is as deliberate as halting and is written to the audit log
 * with the same care. Neither changes any cap, any agent or any wallet.
 */
export async function setInferenceHaltAction(input: {
  halted: boolean;
  reason?: string | null;
}): Promise<ActionResult<{ halted: boolean }>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return NOT_FOUND;

  if (typeof input?.halted !== "boolean") return { ok: false, error: "Say whether to halt or to clear the halt." };
  const typed = typeof input.reason === "string" ? input.reason.trim() : "";
  if (typed.length > HALT_REASON_MAX) return { ok: false, error: `Keep the reason under ${HALT_REASON_MAX} characters.` };
  if (input.halted && typed.length < HALT_REASON_MIN) {
    return { ok: false, error: "Say why, in a few words. Whoever clears this needs to know what was wrong." };
  }
  // The reason is shown on this page and kept in the audit log: no place for a key.
  if (looksLikeSecret(typed)) return { ok: false, error: "That reason looks like it contains a key or a secret. Leave it out." };
  const reason = typed === "" ? null : redactSecrets(typed);
  const by = `@${session.handle}`;

  try {
    await setInferenceHalt({ halted: input.halted, reason, by });
    // Read back rather than assumed: the page is about to say what the next payment will
    // be told, and that has to be what the ledger now holds.
    const control = await readInferenceControl();
    if (control.halted !== input.halted) {
      return { ok: false, error: "The switch was written but reads back differently. Reload and check before relying on it." };
    }
  } catch (err) {
    console.error(`[admin] could not set the pay-per-use halt: ${dbErrorForLog(err)}`);
    return {
      ok: false,
      error: input.halted
        ? "The halt could not be saved, so pay-per-use is NOT halted. Try again, or switch it off with INFERENCE_USDC."
        : "The halt could not be cleared. It is still on.",
    };
  }

  // The existing kinds, with a scope: the audit kind is a database enum, and this is a
  // kill switch in every sense but whose it is.
  await recordAudit({
    userId: session.userId,
    kind: input.halted ? "kill_switch_on" : "kill_switch_off",
    summary: input.halted
      ? `Halted pay-per-use thinking for every agent: ${reason}`
      : `Cleared the halt on pay-per-use thinking${reason ? `: ${reason}` : "."}`,
    metadata: { scope: "pay_per_use_thinking", halted: input.halted },
  });
  revalidatePath("/settings/admin");
  return { ok: true, data: { halted: input.halted } };
}

/**
 * End a breaker's pause now, instead of waiting for it to run out.
 *
 * A pause is set by the ledger on its own evidence (steps paid for and not answered, the
 * gateway or the wallet failing, a payment asked for in a way that is not the pinned
 * one) and clears itself in 15 to 30 minutes. Ending it early says "I have looked, and
 * what tripped it is dealt with": the ledger records this moment, and the same evidence
 * does not pause the platform again. It does not touch the admin halt.
 */
export async function clearInferencePauseAction(): Promise<ActionResult<{ cleared: true }>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return NOT_FOUND;

  try {
    // Only a pause that is in force can be ended. Without this the audit log would say
    // a pause was ended when none was on.
    const control = await readInferenceControl();
    if (!control.pausedUntil || control.pausedUntil.getTime() <= Date.now()) {
      return { ok: false, error: "No pause is in force, so there is nothing to end." };
    }
    await clearInferencePause(`@${session.handle}`);
    // Read back, as the halt is: this page is about to say payments can move again.
    if (controlStop({ halted: false, pausedUntil: (await readInferenceControl()).pausedUntil }, new Date()) === "paused") {
      return { ok: false, error: "The pause was written but reads back as still on. Reload and check." };
    }
  } catch (err) {
    console.error(`[admin] could not end the pay-per-use pause: ${dbErrorForLog(err)}`);
    return { ok: false, error: "The pause could not be ended. It is still on, and ends by itself." };
  }
  await recordAudit({
    userId: session.userId,
    kind: "kill_switch_off",
    summary: "Ended a breaker's pause on pay-per-use thinking early.",
    metadata: { scope: "pay_per_use_thinking", pause: "cleared" },
  });
  revalidatePath("/settings/admin");
  return { ok: true, data: { cleared: true } };
}

/**
 * "Test a signature (nothing is sent)", for one agent wallet.
 *
 * It asks the gateway for a real, unpaid quote, checks that quote against the pins, has
 * Privy sign the payment with the agent's own wallet under its real policy, and checks
 * the signed bytes (`probeInferenceSignature`). Then it throws the signed transaction
 * away: nothing is sent, nothing is recorded in the ledger and no cap is touched. It is
 * the no-money proof that the whole chain up to the payment works, and it runs with the
 * feature switched off.
 *
 * The wallet is looked up by id on the server and must be a real Solana agent wallet; the
 * browser never supplies an address. What comes back is plain sentences, each redacted
 * here again and cut short. The signature itself is never returned by the probe.
 */
export async function testInferenceSignatureAction(input: { walletId: string }): Promise<ActionResult<{ checks: string[]; agentName: string }>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return NOT_FOUND;

  // Each press is one request to the gateway and one signature from Privy.
  if (!limiter.consume(`admin:inference-probe:${session.userId}`, RATE_LIMITS.sensitive).ok) {
    return { ok: false, error: "Too many signature tests in a minute. Wait a moment and try again." };
  }

  const wallet = await findAgentSolanaWallet(typeof input?.walletId === "string" ? input.walletId : "").catch((err) => {
    console.error(`[admin] signature test: wallet lookup failed: ${dbErrorForLog(err)}`);
    return null;
  });
  if (!wallet) return { ok: false, error: "That is not a real Solana agent wallet. Nothing was signed." };

  let result: Awaited<ReturnType<typeof probeInferenceSignature>>;
  try {
    result = await probeInferenceSignature({ walletId: wallet.walletId, address: wallet.address });
  } catch (err) {
    // The probe reports its own failures; this is for one it did not foresee.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `The test failed before it finished: ${redactSecrets(message).slice(0, OUTSIDE_TEXT_MAX)}` };
  }

  // Who asked which wallet to sign, and how it went. Ids only: no address, no check text.
  console.info(`[admin] signature test by @${session.handle} on wallet ${wallet.walletId}: ${result.ok ? "passed" : "not passed"}`);
  if (!result.ok) return { ok: false, error: redactSecrets(result.reason).slice(0, OUTSIDE_TEXT_MAX) };
  return {
    ok: true,
    data: {
      checks: result.checks.slice(0, 12).map((check) => redactSecrets(String(check)).slice(0, OUTSIDE_TEXT_MAX)),
      agentName: wallet.agentName,
    },
  };
}
