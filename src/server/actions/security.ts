"use server";
/**
 * Security actions: the kill switch, the MFA-gated money actions, and the
 * first-live-trade wizard's writes.
 *
 * Every one of these begins with `getSession()`, re-checks ownership against the
 * database, and writes an audit row. The two that move real money
 * (`goLiveAction`, `secureWithdrawAction`) also call `secondFactorBlock()` first
 * and fail closed if Privy cannot be reached.
 *
 * `agent-actions.ts` still exposes the older `setAgentModeAction` /
 * `withdrawAction`, which are not gated. The UI in this workstream no longer
 * calls them for live-mode or withdrawal; folding the gate into those actions is
 * a one-line change in files this workstream does not own.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { agents, getDb } from "@/db";
import { getSession } from "@/lib/auth";
import { agentConfigSchema } from "@/lib/agent/config";
import { withdrawFromAgent as sendWithdrawal, type WithdrawResult } from "@/lib/wallets";
import { recordAudit, listAuditEvents, type AuditRow } from "@/lib/security/audit";
import { getKillSwitch, setTradingPaused } from "@/lib/security/kill-switch";
import { getMfaStatus, rememberMfaStatus, secondFactorBlock, type MfaStatus } from "@/lib/security/mfa";
import {
  evaluateLiveReadiness,
  withFirstTradePreset,
  type LiveReadiness,
} from "@/lib/security/live-readiness";
import type { ActionResult, Chain } from "@/server/types";
import type { AgentConfig, TradeReceiptData } from "@/db/schema";

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
  if (!status.available) return fail(status.blockedReason ?? "Could not reach Privy");

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
 * Refuses unless, at this moment: the caller owns the agent, a second factor is
 * enrolled, and every readiness check passes. The checks are re-run here rather
 * than trusted from the wizard's last render — the browser could be showing a
 * checklist from five minutes and one withdrawal ago.
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
  if (!agent.llmKeyId) return fail("Attach an LLM API key before going live");

  const blocked = await secondFactorBlock(session.userId);
  if (blocked) return fail(blocked);

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

/** Back to paper. No second factor required — stopping is never the dangerous direction. */
export async function backToPaperAction(agentId: string): Promise<ActionResult<{ mode: "paper" }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent, db } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  await db.update(agents).set({ mode: "paper", updatedAt: new Date() }).where(eq(agents.id, agent.id));
  await recordAudit({
    userId: session.userId,
    kind: "go_paper",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Switched ${agent.name} back to paper. Open positions stay on the books and are marked at live prices.`,
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
 * Withdraw from an agent wallet, behind the second-factor gate and the audit log.
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
}): Promise<ActionResult<WithdrawResult>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  if (!(input.amount > 0)) return fail("Enter an amount greater than zero");
  const to = input.toAddress?.trim();
  if (!to) return fail("Enter a destination address");
  if (input.chain === "base" && !/^0x[a-fA-F0-9]{40}$/.test(to)) return fail("That is not a valid Base address");
  if (input.chain === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
    return fail("That is not a valid Solana address");
  }

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

    revalidateAgent(agent.slug);
    return { ok: true, data: result };
  } catch (err) {
    console.error("[secureWithdrawAction]", err);
    return fail(err instanceof Error ? err.message : "Withdrawal failed");
  }
}

// --------------------------------------------------------------- budget audit

/** Called by the agent settings form when the risk caps change, so the change is on the record. */
export async function noteBudgetChangeAction(input: {
  agentId: string;
  before: { maxTradeUsd: number; maxDailyTrades: number; maxPositionPct: number; maxDataSpendUsdPerRun: number };
  after: { maxTradeUsd: number; maxDailyTrades: number; maxPositionPct: number; maxDataSpendUsdPerRun: number };
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent } = await ownedAgent(input.agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const changed = (Object.keys(input.after) as Array<keyof typeof input.after>).filter(
    (key) => input.before[key] !== input.after[key],
  );
  if (changed.length === 0) return { ok: true, data: undefined };

  await recordAudit({
    userId: session.userId,
    kind: "budget_change",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Changed ${agent.name}'s spend caps: ${changed
      .map((key) => `${key} ${input.before[key]} → ${input.after[key]}`)
      .join(", ")}.`,
    metadata: { before: input.before, after: input.after },
  });

  return { ok: true, data: undefined };
}

/**
 * The execution receipt for one of the caller's own trades, for the wizard's final
 * step. Ownership is checked against the agent before the receipt is read, so this
 * is not a second path onto someone else's fill detail.
 */
export async function tradeReceiptAction(
  agentId: string,
  tradeId: string,
): Promise<ActionResult<TradeReceiptData | null>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  const { receiptsFor } = await import("@/server/queries/trading");
  const receipts = await receiptsFor([tradeId]);
  return { ok: true, data: receipts.get(tradeId) ?? null };
}

/** The manual "run one tick now" from the wizard, on the record like everything else. */
export async function noteManualRunAction(agentId: string, runId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const { error, agent } = await ownedAgent(agentId, session.userId);
  if (error || !agent) return fail(error ?? "Agent not found");

  await recordAudit({
    userId: session.userId,
    kind: "manual_run",
    agentId: agent.id,
    agentName: agent.name,
    summary: `Triggered a run of ${agent.name} by hand in ${agent.mode} mode.`,
    metadata: { runId, mode: agent.mode },
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
