"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { createAgentAction } from "@/components/agents/agent-actions";
import {
  BrainStep,
  DataStep,
  FundingStep,
  IdentityStep,
  PROVIDER_LABELS,
  RiskStep,
  ScheduleStep,
  UniverseStep,
  ttlLabel,
} from "./steps";
import { universeSummary } from "./universe-controls";
import { PAID_LAUNCH_RADAR_USD_PER_CHAIN, launchRadarUsdPerRun } from "./types";
import { useDraft } from "./use-draft";
import { validateDraft } from "./validate";
import { shownSource, stripPayPerUse, usdcEstimate, walletNeedUsd } from "@/components/agents/thinking";
import { useFundingPlan } from "@/components/wallets/use-funding-plan";
import { isTransferStatusUnknown } from "@/components/wallets/funding-attempt";
import { useRefreshCash } from "@/components/wallets/use-cash";
import { useTransfer } from "@/components/wallets/use-transfer";
import {
  chainLabelFor,
  transferLabel,
  transfersFor,
  type FundingPlan,
} from "@/lib/wallets/funding";
import {
  getAgentFundingTargets,
  recordFundingIntents,
  settleFundingIntent,
} from "@/server/actions/wallets";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentConfig } from "@/db/schema";
import type { Chain, DataSourceInfo, LlmKeyRow } from "@/server/types";
import { stickyActionbarRef } from "@/hooks/root-flag";

/**
 * One page, not seven gates. Only three things are truly required — a name, a
 * key, a strategy — so those sit inline, and every rule domain (universe, data,
 * risk, schedule) is a summary card whose defaults you can read in a sentence
 * and open only if you want to tune them. Simplicity here is disclosure, not
 * removal: every control of the old wizard is still one tap away.
 *
 * What a draft needs before it can be created is decided in `./validate.ts`.
 */

type RuleId = "universe" | "data" | "risk" | "funding" | "schedule";

/**
 * The three required fields, in page order, and the control an error on each should
 * take focus to. The commit bar is sticky, so people submit from the bottom of a long
 * page; a toast alone leaves them hunting for a field 1,400px up.
 */
const FIELD_TARGETS: Array<{ key: string; ids: string[] }> = [
  { key: "name", ids: ["agent-name"] },
  // The key select when there is a key to choose; otherwise the way to add one.
  { key: "llmKeyId", ids: ["llm-key", "llm-key-add"] },
  // A pay-per-use draft has no key field; what can be wrong is its model or its limits.
  { key: "thinking", ids: ["builder-usdc-model"] },
  { key: "strategyPrompt", ids: ["strategy-prompt"] },
];

const RULE_ERROR_KEYS: Record<RuleId, string[]> = {
  universe: ["chains", "universe"],
  data: ["dataSources"],
  risk: ["risk"],
  // Funding is checked against live balances, not the config schema — see
  // `useFundingPlan` in the component below.
  funding: [],
  schedule: ["schedule"],
};

/**
 * Sign every transfer in the plan, in order, recording each outcome.
 *
 * Deliberately best-effort and honest about it: the agent already exists by the
 * time this runs, so a rejected signature leaves a real, unfunded agent rather
 * than an error. It stops at the first refusal — a second wallet popup right
 * after someone closed one is nagging, not helpfulness — and marks the rest so
 * the settings page can offer to finish the job.
 */
async function runFundingPlan(input: {
  agentId: string;
  plan: FundingPlan;
  send: ReturnType<typeof useTransfer>["send"];
}): Promise<{ sent: number; total: number; firstError: string | null; unknown?: boolean }> {
  const transfers = transfersFor(input.plan);
  if (transfers.length === 0) return { sent: 0, total: 0, firstError: null };

  const targets = await getAgentFundingTargets(input.agentId);
  if (!targets.ok) return { sent: 0, total: transfers.length, firstError: targets.error };

  const recorded = await recordFundingIntents({
    agentId: input.agentId,
    onCreate: true,
    transfers: transfers.map((transfer) => ({
      chain: transfer.chain,
      asset: transfer.asset,
      amount: transfer.amount,
      amountUsd: transfer.asset === "usdc" ? transfer.amount : undefined,
    })),
  });
  const ids = recorded.ok ? recorded.data.ids : [];

  let sent = 0;
  let firstError: string | null = null;
  let unknown = false;

  for (let i = 0; i < transfers.length; i += 1) {
    const transfer = transfers[i];
    if (firstError !== null) {
      if (ids[i]) {
        void settleFundingIntent({
          id: ids[i],
          status: "cancelled",
          error: unknown
            ? "Skipped because the previous transfer was not confirmed."
            : "Skipped after the previous transfer was not signed.",
        });
      }
      continue;
    }
    const to = targets.data.find((t) => t.chain === transfer.chain)?.address;
    if (!to) {
      firstError = `The agent has no ${chainLabelFor(transfer.chain)} wallet.`;
      if (ids[i]) void settleFundingIntent({ id: ids[i], status: "failed", error: firstError });
      continue;
    }
    try {
      const result = await input.send({
        chain: transfer.chain,
        asset: transfer.asset,
        amount: transfer.amount,
        to,
      });
      sent += 1;
      if (ids[i]) void settleFundingIntent({ id: ids[i], status: "sent", txHash: result.hash });
    } catch (error) {
      firstError = error instanceof Error ? error.message : "Your wallet rejected the transfer.";
      // No answer to the submit is not a refusal: the transfer may have gone. Its intent
      // stays as recorded rather than "failed", and the caller does not offer it again.
      if (isTransferStatusUnknown(error)) unknown = true;
      else if (ids[i]) void settleFundingIntent({ id: ids[i], status: "failed", error: firstError });
    }
  }

  return { sent, total: transfers.length, firstError, unknown };
}

/** A heading that looks like a label, so heading navigation finds the builder's sections. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/**
 * A rule domain: closed, it is one readable sentence; open, it is the full
 * control surface. The grid-rows transition keeps the reveal smooth without
 * measuring heights.
 */
function RuleCard({
  title,
  summary,
  open,
  onToggle,
  hasError,
  children,
}: {
  title: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  hasError: boolean;
  children: React.ReactNode;
}) {
  const panelId = `rule-panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section
      className={cn(
        "rounded-xl border bg-card/30 transition-colors duration-150",
        hasError ? "border-destructive/60" : "border-border/70",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {title}
            {hasError ? (
              <TriangleAlert aria-label="has an error" className="size-3.5 shrink-0 text-destructive" />
            ) : null}
          </span>
          <span className={cn("mt-0.5 line-clamp-2 text-xs text-muted-foreground", open && "sr-only")}>
            {summary}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            open && "rotate-180",
          )}
        />
      </button>
      {/* `inert` while closed: the panel is 0px tall but its controls would otherwise
          stay in the Tab order and the accessibility tree, and arrow keys could move a
          risk limit nobody can see. It keeps the grid-rows transition intact. */}
      <div
        id={panelId}
        role="region"
        aria-label={title}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* relative: sr-only notes inside are position:absolute; without a positioned
            ancestor here they escape the 0fr clip and stretch the page. */}
        <div className="relative overflow-hidden">
          <div className="border-t border-border/50 px-4 pt-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function AgentBuilder({
  userId,
  sources,
  initialKeys,
  feeUsd,
  payPerUseAllowed = false,
}: {
  userId: string;
  sources: DataSourceInfo[];
  initialKeys: LlmKeyRow[];
  /**
   * Tocker's flat fee per fill, from the server (`platformFeeUsd()`); 0 when the fee is
   * off. The page reads it because the env it comes from never reaches the browser.
   */
  feeUsd: number;
  /**
   * Whether this viewer may build an agent that pays for its own thinking, decided on the
   * server (`payPerUseAllowedFor`). False, the default, and this page is the one it was
   * before pay-per-use existed: no choice is shown and only a key agent can be made.
   */
  payPerUseAllowed?: boolean;
}) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  // The draft starts on a key the account already has, so it needs to know them.
  const { draft, update, updateConfig, clear, restore, restored } = useDraft(userId, keys, payPerUseAllowed);
  const [attempted, setAttempted] = useState(false);
  /** An agent that exists whose funding did not go through: offered the signature again, here. */
  const [fundingRetry, setFundingRetry] = useState<FundingRetry | null>(null);
  const [open, setOpen] = useState<Set<RuleId>>(new Set());
  const rulesRef = useRef<HTMLDivElement>(null);
  // The chrome ring runs only under the pointer or keyboard focus, as in the top bar:
  // the commit bar is on screen the whole time someone writes a strategy, and a ring
  // that redraws every frame for all of it is a phone's battery for no reason.
  const [metalHovered, setMetalHovered] = useState(false);
  const [metalFocused, setMetalFocused] = useState(false);

  const errors = useMemo(
    () => validateDraft(draft, keys, { payPerUseAllowed }),
    [draft, keys, payPerUseAllowed],
  );
  const visibleErrors = attempted ? errors : {};

  const toggle = (id: RuleId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = sources.filter((source) => draft.config.dataSources.includes(source.id));
  const sourcesPerRun = chosen.reduce((sum, source) => sum + (source.priceUsd ?? 0.01), 0);
  const radarPerRun = launchRadarUsdPerRun(draft.config.universe.discovery, draft.config.chains);
  // An estimate, not a ceiling: the cap below is the ceiling, so never show more than it.
  const costPerRun = Math.min(sourcesPerRun + radarPerRun, draft.config.risk.maxDataSpendUsdPerRun);
  const interval = draft.config.schedule.intervalMinutes;
  const runsPerDay = interval === 0 ? 0 : Math.round(1_440 / interval);
  const risk = draft.config.risk;
  const execution = draft.config.execution;
  const providerLabel = PROVIDER_LABELS[draft.config.llm.provider];
  // Pay per use: the run count and the cost are the panel's own estimate, so the commit
  // bar and the Brain section never quote two different numbers for the same schedule.
  const payPerUse = shownSource(draft.config, payPerUseAllowed) === "usdc";
  const thinking = payPerUse ? usdcEstimate(draft.config.llm.usdc?.model, interval) : null;
  const thinkingNeedUsd = payPerUse && draft.config.llm.usdc ? walletNeedUsd(draft.config.llm.usdc) : null;
  // "Ask me first" is the default, and an agent in it never fills until you approve; with
  // the Schedule card collapsed, nothing else on the page said so.
  const executionLabel =
    execution.mode === "approve"
      ? `asks before each trade (${ttlLabel(execution.proposalTtlMinutes)} to decide)`
      : "trades on its own";
  // Funded and headed for the checklist: the create holds its schedule until the switch.
  const heldForLive = draft.funding.mode === "fund" && draft.goLive;
  // The same short form as the balance buttons in the Schedule card.
  const paperLabel =
    draft.paperStartingUsd >= 1_000 ? `$${draft.paperStartingUsd / 1_000}K` : formatUsd(draft.paperStartingUsd);

  // Funding cannot be validated from the draft alone — it depends on what the
  // user holds right now — so it gets its own gate, checked at submit time.
  const { send } = useTransfer();
  const refreshCash = useRefreshCash();
  const { plan: fundingPlan } = useFundingPlan({
    mode: draft.funding.mode,
    amountUsd: draft.funding.amountUsd,
    gasUsd: draft.funding.gasUsd,
    chains: draft.config.chains as Chain[],
    split: draft.funding.split,
  });
  const fundingBlocker =
    draft.funding.mode === "fund" && !fundingPlan?.ready
      ? (fundingPlan?.blockers[0]?.message ?? "Still reading your wallet balances.")
      : null;

  // The request that submits a signed transfer got no answer, so the money may have
  // moved. No retry dialog: "Sign the funding again" there is an invitation to fund twice.
  // The agent's wallets card is where the balance shows what arrived.
  const leaveFundingUnconfirmed = (name: string, slug: string) => {
    clear();
    setFundingRetry(null);
    toast.warning(`${name} is created. Funding not confirmed yet`, {
      description:
        "The connection dropped while the transfer was being sent, so it may still arrive. Check the agent's balance in two minutes before funding again.",
      duration: 15_000,
    });
    router.push(`/agents/${slug}/settings#wallets`);
  };

  const submit = async () => {
    const allErrors = validateDraft(draft, keys, { payPerUseAllowed });
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true);
      const badRules = (Object.keys(RULE_ERROR_KEYS) as RuleId[]).filter((id) =>
        RULE_ERROR_KEYS[id].some((key) => allErrors[key]),
      );
      if (badRules.length > 0) setOpen((current) => new Set([...current, ...badRules]));
      const field = FIELD_TARGETS.find((target) => allErrors[target.key]);
      // After the render that marks it invalid (and opens any card), so the focused
      // control already carries its error when a screen reader announces it.
      requestAnimationFrame(() => {
        const target = field?.ids.map((id) => document.getElementById(id)).find((el) => el !== null);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.focus({ preventScroll: true });
          // The focused field carries its own message; a toast repeating it only
          // covers the commit bar on a phone.
          return;
        }
        if (badRules.length > 0) {
          rulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        toast.error("Something is still missing", {
          description: Object.values(allErrors)[0],
        });
      });
      throw new Error("invalid");
    }

    // Funding never quietly sends less than asked, so a blocked plan stops the
    // create rather than creating an agent that gets a fraction of the money.
    if (fundingBlocker) {
      setAttempted(true);
      setOpen((current) => new Set([...current, "funding"] as RuleId[]));
      rulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast.error("Funding is not ready", { description: fundingBlocker });
      throw new Error("funding-blocked");
    }

    const result = await createAgentAction({
      name: draft.name.trim(),
      tagline: draft.tagline.trim() || undefined,
      avatarSeed: draft.avatarSeed,
      isPublic: draft.isPublic,
      // A pay-per-use agent is created with no key attached, whatever key the draft had
      // chosen before the mode was switched.
      llmKeyId: payPerUse ? null : draft.llmKeyId,
      // A funded agent has no paper book worth pretending about: its paper balance is
      // the money it is actually given, and when it is headed for the live checklist its
      // schedule stays parked until the switch — no paper ticks in between.
      paperStartingUsd: draft.funding.mode === "fund" ? draft.funding.amountUsd : draft.paperStartingUsd,
      activate: draft.activate,
      holdSchedule: draft.funding.mode === "fund" && draft.goLive,
      // A viewer who may not use pay-per-use never sends a config that asks for it.
      config: payPerUseAllowed ? draft.config : stripPayPerUse(draft.config),
    });

    if (!result.ok) {
      toast.error("The agent was not created", { description: result.error });
      throw new Error(result.error);
    }

    // The agent exists from here on. Funding is signed by the user in their own
    // wallet, so it can fail on its own — and when it does, the agent stays.
    let funding: { sent: number; total: number; firstError: string | null; unknown?: boolean } | null = null;
    if (draft.funding.mode === "fund" && fundingPlan?.ready) {
      funding = await runFundingPlan({ agentId: result.data.id, plan: fundingPlan, send });
      void refreshCash();
      void refreshCash(12_000);
    }

    if (funding?.unknown) {
      leaveFundingUnconfirmed(draft.name.trim(), result.data.slug);
      return;
    }

    if (funding?.firstError) {
      // The agent exists; the money did not move. Stay on this page and offer the
      // signature again, rather than sending the owner to a red checklist to find out.
      setFundingRetry({
        agentId: result.data.id,
        slug: result.data.slug,
        name: draft.name.trim(),
        plan: fundingPlan!,
        sent: funding.sent,
        total: funding.total,
        error: funding.firstError,
        busy: false,
      });
      return;
    }

    clear();

    if (funding && funding.sent > 0) {
      toast.success(`${draft.name.trim()} is funded`, {
        description: draft.goLive
          ? `${transfersFor(fundingPlan!).map(transferLabel).join(", ")} on the way. Next: the live checklist — hold to switch it to real money once every check is green.`
          : `${transfersFor(fundingPlan!).map(transferLabel).join(", ")} on the way. Balances update once they confirm.`,
      });
    } else {
      // Never "live on paper": live is this product's word for real money.
      const created =
        draft.funding.mode === "fund" ? "is created" : draft.activate ? "is running on paper" : "is created on paper";
      toast.success(`${draft.name.trim()} ${created}`, {
        description: draft.activate
          ? "It will take its first tick on schedule. You can also run it now from its page."
          : "It is paused. Activate it from settings when you are ready.",
      });
    }

    // A funded agent whose owner asked for live goes straight to the checklist; the
    // switch itself still happens there, behind the server's checks and a hold.
    const fundedAndWantsLive = draft.goLive && funding !== null && funding.sent > 0 && !funding.firstError;
    router.push(fundedAndWantsLive ? `/agents/${result.data.slug}/live` : `/agents/${result.data.slug}`);
  };

  const retryFunding = async () => {
    if (!fundingRetry || fundingRetry.busy) return;
    setFundingRetry({ ...fundingRetry, busy: true });
    const again = await runFundingPlan({ agentId: fundingRetry.agentId, plan: fundingRetry.plan, send });
    void refreshCash();
    void refreshCash(12_000);
    if (again.unknown) {
      leaveFundingUnconfirmed(fundingRetry.name, fundingRetry.slug);
      return;
    }
    if (again.firstError) {
      setFundingRetry({ ...fundingRetry, error: again.firstError, sent: again.sent, total: again.total, busy: false });
      return;
    }
    clear();
    toast.success(`${fundingRetry.name} is funded`, {
      description: draft.goLive ? "Next: the live checklist." : "Balances update as the transfer confirms.",
    });
    const slug = fundingRetry.slug;
    setFundingRetry(null);
    router.push(draft.goLive ? `/agents/${slug}/live` : `/agents/${slug}`);
  };

  const skipFunding = () => {
    if (!fundingRetry) return;
    clear();
    toast.warning(`${fundingRetry.name} is on paper until it is funded`, {
      description: "Fund it any time from its settings page.",
    });
    const slug = fundingRetry.slug;
    setFundingRetry(null);
    router.push(`/agents/${slug}`);
  };

  return (
    <>
    {fundingRetry ? (
      <FundingRetryDialog retry={fundingRetry} onRetry={retryFunding} onSkip={skipFunding} />
    ) : null}
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">New agent</h1>
        {restored ? (
          // Say why the form is already filled in, next to the way out of it.
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="sm:hidden">Draft restored</span>
              <span className="hidden sm:inline">Restored your unsaved draft</span>
            </p>
            <button
              type="button"
              onClick={() => {
                // A hand-written strategy is the one thing here that cannot be retyped from
                // memory, so clearing it gets the same Undo the preset chips have.
                const previous = draft;
                clear();
                setOpen(new Set());
                setAttempted(false);
                toast.success("Draft cleared", {
                  action: { label: "Undo", onClick: () => restore(previous) },
                });
                // This button unmounts with the draft, so focus goes to the first field
                // rather than falling back to the page.
                requestAnimationFrame(() => document.getElementById("agent-name")?.focus());
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw aria-hidden className="size-3" />
              Start over
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {payPerUseAllowed
          ? "Three things are required: a name, a way to think (your own key, or pay per use), a strategy. "
          : "Three things are required: a name, a key, a strategy. "}
        Everything else ships with defaults you can read below — and open if you disagree.
      </p>

      <div className="mt-8 space-y-8">
        <section className="space-y-5">
          <SectionLabel>Identity</SectionLabel>
          <IdentityStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
        </section>

        <section className="space-y-5">
          <SectionLabel>Brain</SectionLabel>
          <BrainStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
            llmKeys={keys}
            onKeyAdded={(key) => setKeys((current) => [key, ...current])}
            feeUsd={feeUsd}
            payPerUseAllowed={payPerUseAllowed}
            hideHeading
          />
        </section>

        <section ref={rulesRef} className="scroll-mt-20 space-y-3">
          <SectionLabel>Trading rules</SectionLabel>

          <RuleCard
            title="Where it hunts"
            summary={universeSummary(draft.config.universe as AgentConfig["universe"], draft.config.chains)}
            open={open.has("universe")}
            onToggle={() => toggle("universe")}
            hasError={attempted && RULE_ERROR_KEYS.universe.some((key) => errors[key])}
          >
            <UniverseStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>

          <RuleCard
            title="Data it buys"
            summary={
              chosen.length === 0 && radarPerRun === 0
                ? // Not "nothing to pay for": every sweep buys the launch radar whatever
                  // the feed list says (`discover_tokens`), and Tocker pays for it.
                  `No paid sources. Each sweep still buys the launch radar (about ${formatUsd(PAID_LAUNCH_RADAR_USD_PER_CHAIN)} a chain), paid by Tocker.`
                : `${[
                    chosen.length > 0 ? `${chosen.length} paid source${chosen.length === 1 ? "" : "s"}` : null,
                    radarPerRun > 0 ? "launch radar" : null,
                  ]
                    .filter(Boolean)
                    .join(" + ")} · ≈${formatUsd(costPerRun)} per run, paid by Tocker`
            }
            open={open.has("data")}
            onToggle={() => toggle("data")}
            hasError={attempted && RULE_ERROR_KEYS.data.some((key) => errors[key])}
          >
            <DataStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} sources={sources} hideHeading />
          </RuleCard>

          <RuleCard
            title="Risk limits"
            // The fee closes the line: this is the one sentence about trades that is on
            // screen without opening anything, and nothing in the builder named the fee.
            summary={`${formatUsd(risk.maxTradeUsd)}/trade · ${risk.maxDailyTrades}/day · ${risk.maxPositionPct}% max position · ${formatUsd(risk.maxDataSpendUsdPerRun)} data/run${
              feeUsd > 0 ? ` · ${formatUsd(feeUsd)} Tocker fee per fill` : ""
            }`}
            open={open.has("risk")}
            onToggle={() => toggle("risk")}
            hasError={attempted && RULE_ERROR_KEYS.risk.some((key) => errors[key])}
          >
            <RiskStep
              draft={draft}
              update={update}
              updateConfig={updateConfig}
              errors={visibleErrors}
              feeUsd={feeUsd}
              hideHeading
            />
          </RuleCard>

          <RuleCard
            title="Funding"
            summary={
              draft.funding.mode === "paper"
                ? thinkingNeedUsd !== null
                  ? // Paper trades need no money; pay-per-use thinking does, from the first run.
                    `Paper only. Its wallets are created empty, and it cannot think until its Solana wallet holds ${formatUsd(thinkingNeedUsd)} of USDC`
                  : "Paper only — its wallets are created empty, fund it whenever you like"
                : `${formatUsd(draft.funding.amountUsd)} USDC, signed by you on create`
            }
            open={open.has("funding")}
            onToggle={() => toggle("funding")}
            hasError={attempted && Boolean(fundingBlocker)}
          >
            <FundingStep
              draft={draft}
              update={update}
              updateConfig={updateConfig}
              errors={visibleErrors}
              hideHeading
            />
          </RuleCard>

          <RuleCard
            title="Schedule & mode"
            summary={
              heldForLive
                ? `${intervalLabel(interval)} · ${executionLabel} · real money only, live after the checklist`
                : draft.funding.mode === "fund"
                  ? `${intervalLabel(interval)} · ${executionLabel} · paper on the funded amount until you go live`
                  : `${intervalLabel(interval)} · ${executionLabel} · ${draft.activate ? "starts active" : "starts paused"} · ${paperLabel} paper`
            }
            open={open.has("schedule")}
            onToggle={() => toggle("schedule")}
            hasError={attempted && RULE_ERROR_KEYS.schedule.some((key) => errors[key])}
          >
            <ScheduleStep
              draft={draft}
              update={update}
              updateConfig={updateConfig}
              errors={visibleErrors}
              payPerUseAllowed={payPerUseAllowed}
              hideHeading
            />
          </RuleCard>
        </section>
      </div>

      {/* The commit bar: what it costs, then the one button. Sticky glass so the
          decision is always in reach, above the mobile tab bar on phones. */}
      <div
        data-sticky-actionbar
        // Holds the flag on <html> that adds this bar to the scroll padding (globals.css) and
        // lifts the toasts above it on a phone.
        ref={stickyActionbarRef}
        // overflow-x-clip: the chrome ring's glow canvas is wider than the button and,
        // at the right edge of a phone, pushed the whole page 28px sideways.
        // py-2 on a phone: with the text on one line the 48px button sets the height, and
        // every pixel of this bar is a pixel of form it covers.
        className="glass-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mt-8 -mx-4 flex items-center gap-3 overflow-x-clip border-t border-border/60 px-4 py-2 sm:-mx-6 sm:px-6 sm:py-3 md:bottom-0"
      >
        <p className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
          {/* One line on a phone: the full sentence wrapped to five and made the bar a
              third of the screen. The money being signed stays in it. */}
          <span className="tnum block truncate sm:hidden">
            {draft.funding.mode === "fund"
              ? `Signs ${formatUsd(draft.funding.amountUsd)} USDC · ${runsPerDay === 0 ? "manual runs" : `~${runsPerDay}/day`}`
              : runsPerDay === 0
                ? "Manual runs only"
                : thinking
                  ? thinking.model
                    ? `~${thinking.runsPerDay} runs/day · ≈${formatUsd(thinking.dayUsd)} thinking`
                    : "Pick a model to see the cost"
                  : // Whose bill the runs are, in the room one line has. The data estimate
                    // that used to sit here is the part Tocker pays.
                    `~${runsPerDay} runs/day on your key`}
          </span>
          <span className="hidden sm:inline">
            {draft.funding.mode === "fund" ? (
              <>
                You will sign transfers of{" "}
                <span className="tnum font-mono">{formatUsd(draft.funding.amountUsd)}</span> USDC right after it is created.{" "}
              </>
            ) : null}
            {runsPerDay === 0 ? (
              <>Manual runs only — nothing is spent until you press Run now.</>
            ) : thinking && !thinking.model ? (
              // No listed model, no price: saying "$0.00 a day" would be a number nobody stands behind.
              <>Pick a model for pay-per-use thinking to see what a day of runs is expected to cost.</>
            ) : thinking ? (
              // Pay per use: the thinking is the agent's own bill, in USDC, on every run.
              <>
                {heldForLive ? "No ticks until you switch it live on the checklist. Then ~" : "~"}
                <span className="tnum font-mono">{thinking.runsPerDay}</span> runs/day. Each run pays for its own
                thinking in USDC from the agent&rsquo;s wallet (≈
                <span className="tnum font-mono">{formatUsd(thinking.runUsd)}</span>, about{" "}
                <span className="tnum font-mono">{formatUsd(thinking.dayUsd)}</span> a day); its data (≈
                <span className="tnum font-mono">{formatUsd(costPerRun)}</span>) is paid by Tocker.
                {heldForLive
                  ? null
                  : execution.mode === "approve"
                    ? " Proposes paper trades for you to approve."
                    : " Paper trades until you go live."}
              </>
            ) : heldForLive ? (
              // The Mode card promises it never trades paper, so this line cannot count
              // paper runs: nothing ticks until the hold-to-confirm on the checklist.
              <>
                No ticks until you switch it live on the checklist. Then ~
                <span className="tnum font-mono">{runsPerDay}</span> runs/day, each billing model tokens to your{" "}
                {providerLabel} key; its data (≈<span className="tnum font-mono">{formatUsd(costPerRun)}</span>) is
                paid by Tocker.
              </>
            ) : (
              // The run count used to stand next to the data estimate alone, which is the
              // part Tocker pays. The model bill is the owner's, on every run, traded or not.
              <>
                ~<span className="tnum font-mono">{runsPerDay}</span> runs/day. Each run bills model tokens to your{" "}
                {providerLabel} key; its data (≈<span className="tnum font-mono">{formatUsd(costPerRun)}</span>,
                capped at <span className="tnum font-mono">{formatUsd(risk.maxDataSpendUsdPerRun)}</span>) is paid by
                Tocker.{" "}
                {execution.mode === "approve" ? "Proposes paper trades for you to approve." : "Paper trades until you go live."}
              </>
            )}
          </span>
        </p>
        <div
          className="shrink-0"
          onPointerEnter={() => setMetalHovered(true)}
          onPointerLeave={() => setMetalHovered(false)}
          // Keyboard focus only: a click also focuses the button, and the ring would then
          // keep running for as long as nothing else took the focus.
          onFocus={(event) => setMetalFocused(event.target.matches(":focus-visible"))}
          onBlur={() => setMetalFocused(false)}
        >
          {/* Paused keeps the last frame on screen: at rest the ring is still chrome, just still. */}
          <LiquidMetal
            preset="chromatic"
            theme="dark"
            strength={0.85}
            paused={!(metalHovered || metalFocused)}
            className="shrink-0"
          >
            {/* metal-fx strips the button's fill, which would leave its dark:text-neutral-900
                on the dark chrome at about 1.2:1, so inside the ring the label takes the
                foreground colour. Only inside the ring (`.metal-fx-content` is its wrapper
                around the child): before hydration, and wherever WebGL2 is missing, there is
                no ring and the button keeps its own fills, and a forced foreground label was
                near-white on the white pill, idle and while creating. There it now wears the
                button's own colours in every state. The `dark:` copy is there to outrank the
                button's `dark:text-neutral-900` by specificity, not by order. */}
            <MorphButton
              size="lg"
              onAction={submit}
              loadingLabel="Creating…"
              successLabel="Created"
              errorLabel="Check the form"
              className={cn(
                "[.metal-fx-content>&]:text-foreground dark:[.metal-fx-content>&]:text-foreground",
                MORPH_FOCUS,
              )}
            >
              Create agent
            </MorphButton>
          </LiquidMetal>
        </div>
      </div>
    </div>
    </>
  );
}

interface FundingRetry {
  agentId: string;
  slug: string;
  name: string;
  plan: FundingPlan;
  sent: number;
  total: number;
  error: string;
  busy: boolean;
}

/**
 * The agent was created and the funding was not signed, or did not land. The owner
 * asked for a funded agent, so the question is asked again right here — one tap —
 * instead of being deferred to a red row on the live checklist.
 */
function FundingRetryDialog({
  retry,
  onRetry,
  onSkip,
}: {
  retry: FundingRetry;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const partial = retry.sent > 0;
  return (
    <Dialog open onOpenChange={(next) => (next ? null : onSkip())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{retry.name} is created — the funding did not go through</DialogTitle>
          <DialogDescription>
            {partial
              ? `${retry.sent} of ${retry.total} transfers landed. ${retry.error} Finish the rest from the agent's settings page.`
              : // The error's own sentence says whether anything moved; this one must not add a claim.
                `${retry.error} Sign the transfer again and the agent starts funded; skip, and it stays on paper until you fund it from its settings page.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onSkip} disabled={retry.busy}>
            {partial ? "Go to the agent" : "Skip for now"}
          </Button>
          {partial ? null : (
            <Button onClick={onRetry} disabled={retry.busy}>
              {retry.busy ? "Waiting for your signature…" : "Sign the funding again"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
