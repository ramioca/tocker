"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { agentConfigSchema } from "@/lib/agent/config";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { createAgentAction } from "@/components/agents/agent-actions";
import {
  BrainStep,
  DataStep,
  FundingStep,
  IdentityStep,
  RiskStep,
  ScheduleStep,
  UniverseStep,
} from "./steps";
import { universeSentence } from "./universe-controls";
import { useDraft } from "./use-draft";
import { useFundingPlan } from "@/components/wallets/use-funding-plan";
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

/**
 * One page, not seven gates. Only three things are truly required — a name, a
 * key, a strategy — so those sit inline, and every rule domain (universe, data,
 * risk, schedule) is a summary card whose defaults you can read in a sentence
 * and open only if you want to tune them. Simplicity here is disclosure, not
 * removal: every control of the old wizard is still one tap away.
 */

function validate(draft: ReturnType<typeof useDraft>["draft"], keys: LlmKeyRow[]): Record<string, string> {
  const errors: Record<string, string> = {};

  if (draft.name.trim().length < 2) errors.name = "Give it a name — at least two characters.";
  if (!draft.llmKeyId) errors.llmKeyId = "Pick or add an API key. The agent cannot think without one.";
  // A restored draft can name a key that has since been removed, and a key for another
  // provider would be kept but could never be used: both fail every run, so neither passes.
  else if (!keys.some((key) => key.id === draft.llmKeyId && key.provider === draft.config.llm.provider)) {
    errors.llmKeyId = `Pick one of your ${draft.config.llm.provider} keys, or add one.`;
  }

  const parsed = agentConfigSchema.safeParse(draft.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "strategyPrompt") errors.strategyPrompt = issue.message;
      else if (key === "chains") errors.chains = issue.message;
      else if (typeof key === "string") errors[key] = issue.message;
    }
  }

  return errors;
}

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
}): Promise<{ sent: number; total: number; firstError: string | null }> {
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

  for (let i = 0; i < transfers.length; i += 1) {
    const transfer = transfers[i];
    if (firstError !== null) {
      if (ids[i]) {
        void settleFundingIntent({
          id: ids[i],
          status: "cancelled",
          error: "Skipped after the previous transfer was not signed.",
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
      if (ids[i]) void settleFundingIntent({ id: ids[i], status: "failed", error: firstError });
    }
  }

  return { sent, total: transfers.length, firstError };
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
        <div className="overflow-hidden">
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
}: {
  userId: string;
  sources: DataSourceInfo[];
  initialKeys: LlmKeyRow[];
}) {
  const router = useRouter();
  const { draft, update, updateConfig, clear, restored } = useDraft(userId);
  const [keys, setKeys] = useState(initialKeys);
  const [attempted, setAttempted] = useState(false);
  /** An agent that exists whose funding did not go through: offered the signature again, here. */
  const [fundingRetry, setFundingRetry] = useState<FundingRetry | null>(null);
  const [open, setOpen] = useState<Set<RuleId>>(new Set());
  const rulesRef = useRef<HTMLDivElement>(null);

  const errors = useMemo(() => validate(draft, keys), [draft, keys]);
  const visibleErrors = attempted ? errors : {};

  const toggle = (id: RuleId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = sources.filter((source) => draft.config.dataSources.includes(source.id));
  const costPerRun = chosen.reduce((sum, source) => sum + (source.priceUsd ?? 0.01), 0);
  const interval = draft.config.schedule.intervalMinutes;
  const runsPerDay = interval === 0 ? 0 : Math.round(1_440 / interval);
  const risk = draft.config.risk;
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

  const submit = async () => {
    const allErrors = validate(draft, keys);
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
        } else if (badRules.length > 0) {
          rulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      toast.error("Something is still missing", {
        description: Object.values(allErrors)[0],
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
      llmKeyId: draft.llmKeyId,
      // A funded agent has no paper book worth pretending about: its paper balance is
      // the money it is actually given, and when it is headed for the live checklist its
      // schedule stays parked until the switch — no paper ticks in between.
      paperStartingUsd: draft.funding.mode === "fund" ? draft.funding.amountUsd : draft.paperStartingUsd,
      activate: draft.activate,
      holdSchedule: draft.funding.mode === "fund" && draft.goLive,
      config: draft.config,
    });

    if (!result.ok) {
      toast.error("The agent was not created", { description: result.error });
      throw new Error(result.error);
    }

    // The agent exists from here on. Funding is signed by the user in their own
    // wallet, so it can fail on its own — and when it does, the agent stays.
    let funding: { sent: number; total: number; firstError: string | null } | null = null;
    if (draft.funding.mode === "fund" && fundingPlan?.ready) {
      funding = await runFundingPlan({ agentId: result.data.id, plan: fundingPlan, send });
      void refreshCash();
      void refreshCash(12_000);
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
      toast.success(draft.funding.mode === "fund" ? `${draft.name.trim()} is created` : `${draft.name.trim()} is live on paper`, {
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
                clear();
                setOpen(new Set());
                setAttempted(false);
                toast.success("Draft cleared");
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
        Three things are required: a name, a key, a strategy. Everything else ships with
        defaults you can read below — and open if you disagree.
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
            hideHeading
          />
        </section>

        <section ref={rulesRef} className="scroll-mt-20 space-y-3">
          <SectionLabel>Trading rules</SectionLabel>

          <RuleCard
            title="Where it hunts"
            summary={universeSentence(draft.config.universe as AgentConfig["universe"], draft.config.chains)}
            open={open.has("universe")}
            onToggle={() => toggle("universe")}
            hasError={attempted && RULE_ERROR_KEYS.universe.some((key) => errors[key])}
          >
            <UniverseStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>

          <RuleCard
            title="Data it buys"
            summary={
              chosen.length === 0
                ? "Free feeds only — nothing to pay for."
                : `${chosen.length} paid source${chosen.length === 1 ? "" : "s"} · up to ${formatUsd(costPerRun)} per run, paid by Tocker`
            }
            open={open.has("data")}
            onToggle={() => toggle("data")}
            hasError={attempted && RULE_ERROR_KEYS.data.some((key) => errors[key])}
          >
            <DataStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} sources={sources} hideHeading />
          </RuleCard>

          <RuleCard
            title="Risk limits"
            summary={`${formatUsd(risk.maxTradeUsd)}/trade · ${risk.maxDailyTrades}/day · ${risk.maxPositionPct}% max position · ${formatUsd(risk.maxDataSpendUsdPerRun)} data/run`}
            open={open.has("risk")}
            onToggle={() => toggle("risk")}
            hasError={attempted && RULE_ERROR_KEYS.risk.some((key) => errors[key])}
          >
            <RiskStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>

          <RuleCard
            title="Funding"
            summary={
              draft.funding.mode === "paper"
                ? "Paper only — its wallets are created empty, fund it whenever you like"
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
              draft.funding.mode === "fund"
                ? `${intervalLabel(interval)} · real money only · ${draft.goLive ? "live after the checklist" : "paper until you go live"}`
                : `${intervalLabel(interval)} · ${draft.activate ? "starts active" : "starts paused"} · ${paperLabel} paper`
            }
            open={open.has("schedule")}
            onToggle={() => toggle("schedule")}
            hasError={attempted && RULE_ERROR_KEYS.schedule.some((key) => errors[key])}
          >
            <ScheduleStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>
        </section>
      </div>

      {/* The commit bar: what it costs, then the one button. Sticky glass so the
          decision is always in reach, above the mobile tab bar on phones. */}
      <div
        data-sticky-actionbar
        // overflow-x-clip: the chrome ring's glow canvas is wider than the button and,
        // at the right edge of a phone, pushed the whole page 28px sideways.
        className="glass-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mt-8 -mx-4 flex items-center gap-3 overflow-x-clip border-t border-border/60 px-4 py-3 sm:-mx-6 sm:px-6 md:bottom-0"
      >
        <p className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
          {draft.funding.mode === "fund" ? (
            <>
              You will sign transfers of{" "}
              <span className="tnum font-mono">{formatUsd(draft.funding.amountUsd)}</span> USDC right after it is created.{" "}
            </>
          ) : null}
          {runsPerDay === 0 ? (
            <>Manual runs only — nothing is spent until you press Run now.</>
          ) : (
            <>
              ~<span className="tnum font-mono">{runsPerDay}</span> runs/day · up to{" "}
              <span className="tnum font-mono">{formatUsd(costPerRun)}</span> data each, capped at{" "}
              <span className="tnum font-mono">{formatUsd(risk.maxDataSpendUsdPerRun)}</span>/run —
              paper trades until you go live.
            </>
          )}
        </p>
        <LiquidMetal preset="chromatic" theme="dark" strength={0.85} className="shrink-0">
          {/* metal-fx strips the button's dark:bg-white, which would leave its
              dark:text-neutral-900 on the dark chrome at about 1.2:1. */}
          <MorphButton
            size="lg"
            onAction={submit}
            loadingLabel="Creating…"
            successLabel="Created"
            errorLabel="Check the form"
            className="text-foreground dark:text-foreground"
          >
            Create agent
          </MorphButton>
        </LiquidMetal>
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
              : `${retry.error} Nothing moved. Sign the transfer again and the agent starts funded; skip, and it stays on paper until you fund it from its settings page.`}
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
