"use server";
/**
 * Security actions: the kill switch, the MFA status reads, the audited money
 * actions, and the first-live-trade wizard's writes.
 *
 * Every one of these begins with `getSession()`, re-checks ownership against the
 * database, and writes an audit row. The two that move real money
 * (`goLiveAction`, `secureWithdrawAction`) also call `secondFactorBlock()`, but that
 * is NOT a gate: it always returns `null` and only records enrolment, because a second
 * factor is optional by product decision (see `src/lib/security/mfa.ts` and DEPLOY.md).
 * Neither action is refused for a missing second factor, and nothing here fails closed
 * on Privy's MFA read.
 *
 * These two are the only ways an agent changes mode, and `secureWithdrawAction` is the
 * only way its money leaves: the older, ungated mode and withdraw actions are gone.
 */
import { revalidatePath } from "next/cache";
import { thinkSource, usdcChoiceProblem } from "@/lib/agent/inference";
import { z } from "zod";
import { and, eq, gt, inArray } from "drizzle-orm";
import { agents, getDb, positions, trades, type Db } from "@/db";
import { getSession } from "@/lib/auth";
import { agentConfigSchema, chainSchema } from "@/lib/agent/config";
import { withdrawFromAgent as sendWithdrawal, type WithdrawResult } from "@/lib/wallets";
import { destinationProblemForChain, normalizeAddressForChain } from "@/lib/wallet-address";
import { recordAudit, listAuditEvents, type AuditRow } from "@/lib/security/audit";
import { getKillSwitch, setTradingPaused } from "@/lib/security/kill-switch";
import { getMfaStatus, rememberMfaStatus, secondFactorBlock, type MfaStatus } from "@/lib/security/mfa";
import {
  evaluateLiveReadiness,
  withFirstTradePreset,
  type LiveReadiness,
} from "@/lib/security/live-readiness";
// Shared with the live checklist, so its row and this file's refusal count the same thing.
import { simulatedOpenPositions } from "@/lib/security/paper-positions";
import type { ActionResult, Chain } from "@/server/types";
import type { AgentConfig, TradeReceiptData } from "@/db/schema";
import { ACTION_LIMITS, slowDown, transferErrorMessage } from "./_shared";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Load an agent and prove the caller owns it. Every action below starts here. */
async function ownedAgent(agentId: string, userId: string) {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return { error: "Agent not found" as const, agent: null, db };
  if (agent.ownerId !== userId) return { error: "You do not own this agent" as const, agent: null, db };
  return { error: null, agent, db };
}

function revalidateAgent(slug: string) {
  revalidatePath(`/agents/${slug}`);
  revalidatePath(`/agents/${slug}/settings`);
  revalidatePath(`/agents/${slug}/live`);
  revalidatePath("/agents");
}

/**
 * How many of an agent's open positions are in a token it has filled a real order in:
 * the ones a wallet backs. The mirror of `simulatedOpenPositions`.
 */
async function liveOpenPositions(db: Db, agentId: string): Promise<number> {
  const open = await db
    .select({ tokenId: positions.tokenId })
    .from(positions)
    .where(and(eq(positions.agentId, agentId), gt(positions.amountToken, "0")));
  if (open.length === 0) return 0;

  const tradedLive = await db
    .selectDistinct({ tokenId: trades.tokenId })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.isPaper, false),
        eq(trades.status, "filled"),
        inArray(
          trades.tokenId,
          open.map((position) => position.tokenId),
        ),
      ),
    );
  return tradedLive.length;
}

/**
 * A proposal belongs to the mode it was made in. One made on paper says "simulated" on
 * its card and takes a single tap; approved after the switch it would sign a real swap.
 * So a change of mode retires every proposal still waiting, and `decideProposal` refuses
 * any that slip through. The agent proposes again on its next run.
 */
async function expireOpenProposals(db: Db, agentId: string): Promise<void> {
  await db
    .update(trades)
    .set({
      status: "expired",
      decidedAt: new Date(),
      decidedBy: "expiry",
      error: "The agent changed between paper and live, so this was not traded. It will propose again on its next run.",
    })
    .where(and(eq(trades.agentId, agentId), eq(trades.status, "proposed")));
}

// ------------------------------------------------------------------ kill switch

export async function setTradingPausedAction(paused: boolean): Promise<ActionResult<{ paused: boolean }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  await setTradingPaused(session.userId, paused);
  await recordAudit({
    userId: session.userId,
    kind: paused ? "kill_switch_on" : "kill_switch_off",
    summary: paused
      ? "Paused all trading. Scheduled runs are skipped for every agent; exits still run."
      : "Resumed trading. Agents run on their schedules again.",
  });

  revalidatePath("/settings/security");
  revalidatePath("/agents");
  return { ok: true, data: { paused } };
}

export async function getKillSwitchAction(): Promise<ActionResult<{ paused: boolean; pausedAt: string | null }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  return { ok: true, data: await getKillSwitch(session.userId) };
}

// ------------------------------------------------------------------------- MFA

/** Re-read enrolment from Privy. The security page calls this after the enrolment modal closes. */
export async function refreshMfaStatusAction(): Promise<ActionResult<MfaStatus>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const status = await getMfaStatus(session.userId);
  if (status.available) await rememberMfaStatus(session.userId, status.userMethods);

  revalidatePath("/settings/security");
  return { ok: true, data: status };
}

/**
 * Record an MFA change in the audit log.
 *
 * The browser tells us *that* something changed; the server then asks Privy what
 * is actually true and audits that answer, so a client cannot write a fiction
 * into the log.
 */
export async function noteMfaChangeAction(): Promise<ActionResult<MfaStatus>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const before = await import("@/lib/security/mfa").then((m) => m.lastKnownMfaMethods(session.userId));
  const status = await getMfaStatus(session.userId);
  if (!status.available) return fail(status.blockedReason ?? "Could not check your second factor right now");

  await rememberMfaStatus(session.userId, status.userMethods);

  const added = status.userMethods.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !status.userMethods.includes(m));
  if (added.length > 0) {
    await recordAudit({
      userId: session.userId,
      kind: "mfa_enrolled",
      summary: `Enrolled a second factor (${added.join(", ")}).`,
      metadata: { methods: status.userMethods },
    });
  }
  if (removed.length > 0) {
    await recordAudit({
      userId: session.userId,
      kind: "mfa_unenrolled",
      summary: `Removed a second factor (${removed.join(", ")}). Nothing is blocked — a second factor is optional.`,
      metadata: { methods: status.userMethods },
    });
  }

  revalidatePath("/settings/security");
  return { ok: true, data: status };
}

// ------------------------------------------------------------------ audit log

export async function getAuditLogAction(limit = 60): Promise<ActionResult<AuditRow[]>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  return { ok: true, data: await listAuditEvents(session.userId, limit) };
}

// ------------------------------------------------------------- live readiness

export async function checkLiveReadinessAction(
  agentId: string,
  capUsd?: number,
): Promise<ActionResult<LiveReadiness>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  return {
    ok: true,
    data: await evaluateLiveReadiness({
      agentId: agent.id,
      slug: agent.slug,
      ownerId: agent.ownerId,
      config: agent.config,
      walletBudget: agent.walletBudget,
      capUsd,
    }),
  };
}

/** Clamp the agent into the first-trade shape: one chain, tiny size, one trade a day, a stop. */
export async function applyFirstTradePresetAction(agentId: string): Promise<ActionResult<LiveReadiness>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent, db } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const before = agent.config;
  const next: AgentConfig = withFirstTradePreset(before);
  const parsed = agentConfigSchema.safeParse(next);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The preset produced an invalid config");
  // The preset changes an agent's chains, and an agent that pays for its own thinking
  // pays from its Solana wallet. `withFirstTradePreset` keeps Solana for such an agent;
  // this is the same check every other save of a config makes (`createAgent`,
  // `updateAgent`), made here too so the rule does not rest on that function alone. Only
  // a problem the preset itself would introduce is refused: a config that already had
  // one is no worse for a smaller trade cap, and its run is refused where it starts.
  const brokenByPreset = usdcChoiceProblem(before) === null ? usdcChoiceProblem(parsed.data) : null;
  if (brokenByPreset) return fail(brokenByPreset);

  /**
   * The preset lowers `maxTradeUsd`, and the wallet policy has to come down with it.
   *
   * Two layers enforce spend, and the readiness checklist requires both to sit at or
   * under the cap the operator typed: `riskGuard()` in this app, and a Privy policy on
   * the agent's own wallets underneath it. This action used to move only the first. The
   * result was a button, offered on the go-live screen as the fix, that made the screen
   * *less* ready than before — the budget step then failed with "the wallet policy caps
   * transfers at $100, above the $2 you entered" and `goLiveAction` refused.
   *
   * Best-effort on purpose. Privy can be down, and an agent whose app-layer cap came
   * down but whose wallet policy did not is strictly safer than one where neither did;
   * refusing the whole preset over it would leave the operator with the original problem
   * and no button. The failure is audited and the readiness check below reports it
   * honestly, because the budget step re-reads what is actually attached.
   */
  let walletBudget = agent.walletBudget;
  let policyError: string | null = null;
  try {
    const { applyAgentBudgetPolicy } = await import("@/lib/wallets");
    walletBudget =
      (await applyAgentBudgetPolicy({
        agentId: agent.id,
        agentName: agent.name,
        perTxUsd: parsed.data.risk.maxTradeUsd,
        existing: agent.walletBudget,
      })) ?? agent.walletBudget;
  } catch (err) {
    policyError = err instanceof Error ? err.message : String(err);
    console.error("[applyFirstTradePresetAction] wallet policy", err);
  }

  await db
    .update(agents)
    .set({ config: parsed.data, walletBudget, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));

  await recordAudit({
    userId: session.userId,
    kind: "first_trade_preset",
    agentId: agent.id,
    agentName: agent.name,
    summary:
      `Applied the first-trade preset to ${agent.name}: $${parsed.data.risk.maxTradeUsd} a trade, ` +
      `${parsed.data.risk.maxDailyTrades} a day, ${parsed.data.chains.join(" and ")} only.` +
      (policyError
        ? ` The wallet policy could not be lowered to match: ${policyError}`
        : walletBudget
          ? ` Its wallet policy now refuses any USDC transfer above $${walletBudget.perTxUsd}.`
          : ""),
    metadata: {
      before: {
        maxTradeUsd: before.risk.maxTradeUsd,
        maxDailyTrades: before.risk.maxDailyTrades,
        chains: before.chains,
        walletPerTxUsd: agent.walletBudget?.perTxUsd ?? null,
      },
      after: {
        maxTradeUsd: parsed.data.risk.maxTradeUsd,
        maxDailyTrades: parsed.data.risk.maxDailyTrades,
        chains: parsed.data.chains,
        walletPerTxUsd: walletBudget?.perTxUsd ?? null,
      },
      ...(policyError ? { walletPolicyError: policyError } : {}),
    },
  });

  revalidateAgent(agent.slug);
  return {
    ok: true,
    data: await evaluateLiveReadiness({
      agentId: agent.id,
      slug: agent.slug,
      ownerId: agent.ownerId,
      config: parsed.data,
      walletBudget,
      capUsd: parsed.data.risk.maxTradeUsd,
    }),
  };
}

// ------------------------------------------------------------------ go live

/**
 * Switch an agent to live mode.
 *
 * Refuses unless, at this moment: the caller owns the agent, it holds no simulated
 * position (see `simulatedOpenPositions`) and every readiness check passes. A second
 * factor is not required — `secondFactorBlock` only records it. The checks are re-run
 * here rather than trusted from the wizard's last render — the browser could be showing
 * a checklist from five minutes and one withdrawal ago.
 */
export async function goLiveAction(input: {
  agentId: string;
  capUsd: number;
}): Promise<ActionResult<{ mode: "live" }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent, db } = await ownedAgent(input.agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");
  if (agent.mode === "live") return { ok: true, data: { mode: "live" } };
  // An agent that pays per use thinks without a key; every other agent still needs one.
  if (thinkSource(agent.config) !== "usdc" && !agent.llmKeyId) return fail("Attach an LLM API key before going live");

  const blocked = await secondFactorBlock(session.userId);
  if (blocked) return fail(blocked);

  // Paper positions do not follow an agent into a live book. The switch only changes
  // which executor fills the next order, so a simulated holding would be counted in live
  // equity and offered a Sell button that can never fill: the wallet does not hold it.
  const simulated = await simulatedOpenPositions(db, agent.id);
  if (simulated > 0) {
    return fail(
      `Sell this agent's ${simulated} paper position${simulated === 1 ? "" : "s"} before going live. They are simulated, so they can't be sold for real money and would sit in the live book as holdings the wallet doesn't have.`,
    );
  }

  const readiness = await evaluateLiveReadiness({
    agentId: agent.id,
    slug: agent.slug,
    ownerId: agent.ownerId,
    config: agent.config,
    walletBudget: agent.walletBudget,
    capUsd: input.capUsd,
  });
  if (!readiness.ready) {
    const failing = readiness.steps.filter((s) => s.state === "fail").map((s) => s.title);
    return fail(`Not ready: ${failing.join(", ")}. Re-check the list.`);
  }

  // An agent created "real money only" has had its schedule parked since creation so it
  // never took a paper tick; the switch is what starts the clock.
  const interval = agent.config.schedule.intervalMinutes;
  const startSchedule = agent.status === "active" && agent.nextRunAt === null && interval > 0;
  await db
    .update(agents)
    .set({ mode: "live", updatedAt: new Date(), ...(startSchedule ? { nextRunAt: new Date() } : {}) })
    .where(eq(agents.id, agent.id));
  await expireOpenProposals(db, agent.id);

  // The first live point, so the curve and the "vs start" baseline exist from the
  // switch rather than from the next marks pass. Best-effort: a balance read that fails
  // here is skipped by snapshotEquity itself, and the cron writes the point later.
  try {
    const { getPortfolio, snapshotEquity } = await import("@/lib/agent/portfolio");
    await snapshotEquity(await getPortfolio(agent.id));
  } catch (err) {
    console.warn("[goLiveAction] first live snapshot skipped:", err instanceof Error ? err.message : err);
  }

  await recordAudit({
    userId: session.userId,
    kind: "go_live",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Switched ${agent.name} to live mode. It now signs real transactions from its own wallet, up to $${agent.config.risk.maxTradeUsd} a trade.`,
    metadata: {
      maxTradeUsd: agent.config.risk.maxTradeUsd,
      maxDailyTrades: agent.config.risk.maxDailyTrades,
      chains: agent.config.chains,
      capUsd: input.capUsd,
    },
  });

  revalidateAgent(agent.slug);
  return { ok: true, data: { mode: "live" } };
}

/**
 * Back to paper. Owner-only, and refused while the agent holds tokens it bought with
 * real money: on paper every sale goes to the simulator, the stop loss included, so the
 * book would close while the tokens stayed in the wallet with nothing left to sell them
 * from. Pausing is the way to stop an agent that is holding; its exits keep running.
 */
export async function backToPaperAction(agentId: string): Promise<ActionResult<{ mode: "paper" }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent, db } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  if (agent.mode === "live" && (await liveOpenPositions(db, agent.id)) > 0) {
    return fail(
      "Sell this agent's live positions first, or pause it instead. On paper they could only be sold in the simulator, and the real tokens would stay in its wallet.",
    );
  }

  await db.update(agents).set({ mode: "paper", updatedAt: new Date() }).where(eq(agents.id, agent.id));
  await expireOpenProposals(db, agent.id);
  await recordAudit({
    userId: session.userId,
    kind: "go_paper",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Switched ${agent.name} back to paper. Fills are simulated from here.`,
  });

  revalidateAgent(agent.slug);
  return { ok: true, data: { mode: "paper" } };
}

/** Pause the agent outright — the button on the trade receipt. */
export async function pauseAgentAction(agentId: string): Promise<ActionResult<{ status: "paused" }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent, db } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  await db
    .update(agents)
    .set({ status: "paused", nextRunAt: null, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));

  await recordAudit({
    userId: session.userId,
    kind: "agent_paused",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Paused ${agent.name}. It keeps its positions and history; it just stops waking up. Exits still run.`,
  });

  revalidateAgent(agent.slug);
  return { ok: true, data: { status: "paused" } };
}

// ------------------------------------------------------------------ withdraw

/**
 * Withdraw from an agent wallet, on the audit log. `secondFactorBlock` is called for
 * the record only; it never refuses (a second factor is optional).
 *
 * The address is validated per chain before anything is signed: a Base address
 * pasted into a Solana withdrawal is an irrecoverable loss, and the shape check
 * is the only defence we have against it.
 */
export async function secureWithdrawAction(input: {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
  // W7 H12 (workstream A): a Privy transfer is a wallet *action*. It can still be
  // `pending` when this returns, and its hash is null until a step broadcasts — so the
  // result carries the status and the action id rather than pretending to be a receipt.
}): Promise<ActionResult<WithdrawResult & { delivered?: number; accountFeeUsdc?: number; tradingFeesUsdc?: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  // `chain` picks the address check below and the wallet that signs; the type is gone at
  // the wire, and an unknown value would skip both address regexes.
  if (!chainSchema.safeParse(input.chain).success) return fail("Unknown chain");
  if (input.asset !== "usdc" && input.asset !== "native") return fail("Unknown asset");
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return fail("Enter an amount greater than zero");
  const raw = input.toAddress?.trim();
  if (!raw) return fail("Enter a destination address");
  // The same check the form runs, checksum included: a mixed-case Base address with a
  // typo is refused here in words, not later by the signer in its own. So are the other
  // chain's address, a .sol or .eth name, the USDC token itself, and the address
  // pay-per-use thinking is paid to (a transfer there that no paid step explains is
  // treated as a fault in the thinking ledger: see `destinationProblemForChain`).
  const problem = destinationProblemForChain(input.chain, raw);
  if (problem) return fail(problem);
  const to = normalizeAddressForChain(input.chain, raw);

  const { error, agent } = await ownedAgent(input.agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const blocked = await secondFactorBlock(session.userId);
  if (blocked) return fail(blocked);

  try {
    if (input.chain === "solana") {
      // W8: Tocker's fee wallet pays the network fee; nothing is dripped into the agent.
      // Not inside `@/lib/wallets`' `withdrawFromAgent`: the Privy-transfer fallback calls it.
      const solana = await import("@/lib/wallets/solana-agent-transfer");
      const sent = await solana.withdrawFromAgentSolana({
        agentId: input.agentId,
        asset: input.asset,
        amount: input.amount,
        toAddress: to,
      });
      await solana.recordAgentSolanaWithdrawal({ userId: session.userId, agent, asset: input.asset, requested: input.amount, to, sent });
      revalidateAgent(agent.slug);
      return { ok: true, data: solana.withdrawalForClient(sent) };
    }

    // Base gas is Privy-sponsored and billed to the app, so this path gets the burst
    // limit the Solana one enforces inside `withdrawFromAgentSolana`.
    const { limiter } = await import("@/lib/security/rate-limit");
    const { OWNER_WITHDRAWAL_BURST_LIMIT, waitSentence } = await import("@/lib/wallets/solana-agent-transfer");
    const verdict = limiter.consume(`agent-withdraw:${input.chain}:${session.userId}`, OWNER_WITHDRAWAL_BURST_LIMIT);
    if (!verdict.ok) {
      return fail(`That's a lot of withdrawals in a short time. Try again in ${waitSentence(verdict.retryAfterSeconds)}.`);
    }

    // The Solana path pays the agent's accrued Tocker fees in the withdrawal's own
    // transaction. Here the transfer is Privy's, so the fees are held back instead (a
    // USDC withdrawal may not take them with it) and swept straight after it.
    const { collectFeesOwed, holdBaseFees } = await import("@/lib/platform/withdrawal-fees");
    const hold = input.asset === "usdc" ? await holdBaseFees({ agentId: agent.id, amount: input.amount }) : null;
    if (hold && !hold.ok) return fail(hold.error);

    const result = await sendWithdrawal({
      agentId: input.agentId,
      chain: input.chain,
      asset: input.asset,
      amount: input.amount,
      toAddress: to,
    });

    await recordAudit({
      userId: session.userId,
      kind: "withdraw",
      agentId: agent.id,
      agentName: agent.name,
      summary: `Withdrew ${input.amount} ${input.asset === "usdc" ? "USDC" : "native"} from ${agent.name} on ${input.chain} to ${to.slice(0, 6)}…${to.slice(-4)}.`,
      metadata: { chain: input.chain, asset: input.asset, amount: input.amount, to, txHash: result.txHash },
    });

    // Never throws, and never changes what the owner is told: their withdrawal is sent
    // either way, and fees a sweep could not collect stay owed for the next pass.
    if (hold && hold.owedUsd > 0) await collectFeesOwed(agent);

    revalidateAgent(agent.slug);
    return { ok: true, data: result };
  } catch (err) {
    console.error("[secureWithdrawAction]", err);
    return fail(
      transferErrorMessage(err, "The withdrawal did not go through. Nothing was sent — try again in a minute.", input.chain, input.asset),
    );
  }
}

/**
 * What a withdrawal out of an agent's Solana wallet would do, for the Review step: what
 * arrives, and what the same transaction takes besides it (a one-time fee when the
 * recipient has never held USDC, and the Tocker trading fees the agent owes). A refusal
 * the withdrawal would hit (over the wallet cap to an outside address, a token account,
 * under the minimum, nothing left after fees) comes back here in the same sentence, so
 * the owner reads it before confirming rather than after.
 *
 * Same checks as `secureWithdrawAction`, in the same order. It signs nothing and takes
 * neither a withdrawal rate-limit slot nor the per-agent lock; it has its own limit,
 * because every call reads the chain. Like a withdrawal, the planner first settles fee
 * sweeps that have already landed. The figures are a preview: the withdrawal works
 * everything out again, and its result is what the receipt reports.
 */
export async function previewAgentWithdrawalAction(input: {
  agentId: string;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
}): Promise<ActionResult<{ delivered: number; accountFeeUsdc: number; tradingFeesUsdc: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  if (input.asset !== "usdc" && input.asset !== "native") return fail("Unknown asset");
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return fail("Enter an amount greater than zero");
  const raw = input.toAddress?.trim();
  if (!raw) return fail("Enter a destination address");
  const problem = destinationProblemForChain("solana", raw);
  if (problem) return fail(problem);
  const to = normalizeAddressForChain("solana", raw);

  const { error, agent } = await ownedAgent(input.agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const limited = slowDown("agent-withdraw-preview", session.userId, ACTION_LIMITS.preview);
  if (limited) return fail(limited);

  try {
    const { planAgentSolanaWithdrawal } = await import("@/lib/wallets/solana-agent-transfer");
    const plan = await planAgentSolanaWithdrawal({
      agentId: agent.id,
      asset: input.asset,
      amount: input.amount,
      toAddress: to,
    });
    // Three figures and nothing else: the route, the cap and the wallets stay on the server.
    return {
      ok: true,
      data: { delivered: plan.delivered, accountFeeUsdc: plan.accountFeeUsdc, tradingFeesUsdc: plan.tradingFeesUsdc },
    };
  } catch (err) {
    console.error("[previewAgentWithdrawalAction]", err);
    return fail(
      transferErrorMessage(err, "Couldn't check this withdrawal just now. Try again in a moment.", "solana", input.asset),
    );
  }
}

// --------------------------------------------------------------- budget audit

/**
 * The four caps a budget note may name, as numbers and nothing else (zod refuses NaN
 * and the infinities). Strict at both levels, so no other key gets as far as the log.
 */
const CAP_KEYS = ["maxTradeUsd", "maxDailyTrades", "maxPositionPct", "maxDataSpendUsdPerRun"] as const;
const capsSchema = z.strictObject({
  maxTradeUsd: z.number(),
  maxDailyTrades: z.number(),
  maxPositionPct: z.number(),
  maxDataSpendUsdPerRun: z.number(),
});
const budgetChangeSchema = z.strictObject({
  agentId: z.string().min(1).max(64),
  before: capsSchema,
  after: capsSchema,
});

/**
 * How often one account may write a note into its own audit log. The two note actions
 * below are called once per save and once per manual run; a loop of them would push the
 * events that matter (a withdrawal, a mode change) off the first page of the log.
 */
const AUDIT_NOTE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/**
 * Called by the agent settings form when the risk caps change, so the change is on the record.
 *
 * The parameter type is erased at the wire: this is a public endpoint and `input` is
 * whatever was sent. Its keys and values used to go into the audit sentence as they
 * came, at any length, and the operator's dashboard prints that sentence for every
 * user. So the input is parsed first, and the sentence is built from the four fixed
 * names and the numbers beside them.
 */
export async function noteBudgetChangeAction(input: {
  agentId: string;
  before: { maxTradeUsd: number; maxDailyTrades: number; maxPositionPct: number; maxDataSpendUsdPerRun: number };
  after: { maxTradeUsd: number; maxDailyTrades: number; maxPositionPct: number; maxDataSpendUsdPerRun: number };
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const parsed = budgetChangeSchema.safeParse(input);
  if (!parsed.success) return fail("Nothing to record");
  const { agentId, before, after } = parsed.data;
  const limited = slowDown("audit-note", session.userId, AUDIT_NOTE_LIMIT);
  if (limited) return fail(limited);

  const { error, agent } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const changed = CAP_KEYS.filter((key) => before[key] !== after[key]);
  if (changed.length === 0) return { ok: true, data: undefined };

  await recordAudit({
    userId: session.userId,
    kind: "budget_change",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Changed ${agent.name}'s spend caps: ${changed
      .map((key) => `${key} ${before[key]} → ${after[key]}`)
      .join(", ")}.`,
    metadata: { before, after },
  });

  return { ok: true, data: undefined };
}

/**
 * The execution receipt for one of the caller's own trades, for the wizard's final
 * step. Ownership is checked against the agent, and the trade against that agent,
 * before the receipt is read — owning *an* agent must not open any trade id's receipt.
 */
export async function tradeReceiptAction(
  agentId: string,
  tradeId: string,
): Promise<ActionResult<TradeReceiptData | null>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const db = await getDb();
  const [trade] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.agentId, agentId)))
    .limit(1);
  if (!trade) return fail("Trade not found");

  const { receiptsFor } = await import("@/server/queries/trading");
  // The owner, checked above, so the receipt comes back whole.
  const receipts = await receiptsFor([tradeId], session.userId);
  return { ok: true, data: receipts.get(tradeId) ?? null };
}

/**
 * The manual "run one tick now" from the wizard, on the record like everything else.
 *
 * Only for a run that exists: started by hand, on this agent. The run id used to be
 * stored as sent, so the log could say a run happened that never did.
 */
export async function noteManualRunAction(agentId: string, runId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  // A public endpoint: the arguments are whatever the caller sent.
  if (typeof agentId !== "string" || typeof runId !== "string" || runId.length === 0 || runId.length > 64) {
    return fail("Run not found");
  }
  const limited = slowDown("audit-note", session.userId, AUDIT_NOTE_LIMIT);
  if (limited) return fail(limited);

  const { error, agent, db } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const { agentRuns } = await import("@/db");
  const [run] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.agentId, agent.id), eq(agentRuns.trigger, "manual")))
    .limit(1);
  if (!run) return fail("Run not found");

  await recordAudit({
    userId: session.userId,
    kind: "manual_run",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Triggered a run of ${agent.name} by hand in ${agent.mode} mode.`,
    metadata: { runId: run.id, mode: agent.mode },
  });
  return { ok: true, data: undefined };
}

/** Used by the settings page to render the agent's current mode without a second query path. */
export async function agentModeAction(agentId: string): Promise<ActionResult<{ mode: "paper" | "live" }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  const db = await getDb();
  const [row] = await db
    .select({ mode: agents.mode })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.ownerId, session.userId)))
    .limit(1);
  if (!row) return fail("Agent not found");
  return { ok: true, data: { mode: row.mode } };
}
