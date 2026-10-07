"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { createAgentAction } from "@/components/agents/agent-actions";
import { providerLabel as providerLabelFor } from "@/lib/agent/providers";
import {
  DataStep,
  FundingStep,
  IdentityStep,
  RiskStep,
  ScheduleStep,
  StrategyStep,
  ThinkStep,
  UniverseStep,
  ttlLabel,
} from "./steps";
import { universeSummary } from "./universe-controls";
import { useDraft } from "./use-draft";
import { validateDraft } from "./validate";
import { BuilderStepper, type StepView } from "./builder-stepper";
import { CommitBar } from "./commit-bar";
import { CommitSentence } from "./commit-sentence";
import {
  BUILDER_STEPS,
  CARD_STEP,
  parseCard,
  type BuilderStepId,
  type CardId,
  type Place,
  type StepStatus,
  type SummaryLabels,
  type Via,
} from "./contract";
import { firstErrorKey, firstErrorPlace, neighbours, placeOfError, stepStatus } from "./flow";
import { AgentPreview } from "./preview/agent-preview";
import { PreviewPeek } from "./preview/preview-peek";
import { RuleCard } from "./rule-card";
import { StepPanel } from "./step-panel";
import {
  commitShortLine,
  costFacts,
  costLines,
  dataSummary,
  fundingSummary,
  previewRows,
  readyItems,
  riskSummary,
  runLine,
  scheduleSummary,
  stillNeeded,
} from "./summaries";
import { useBuilderStep } from "./use-builder-step";
import { shownSource, stripPayPerUse } from "@/components/agents/thinking";
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
 * Four steps, none of them a gate: Strategy, Rules, Brain, Name and create. Only three
 * things are the user's to decide (a strategy, a way to think, a name) and the strategy
 * is already written, so Next never refuses and any step can be visited at any time.
 * Every rule domain (universe, data, risk, schedule, funding) is still a card whose
 * defaults read as one sentence and open only to be changed. Beside the form sits a card
 * of the agent being made, filled in from the draft as the user goes.
 *
 * This file is the shell: the draft, the keys, which step is showing, which cards are
 * open, and the create itself. The steps' controls are `./steps`, the sentences every
 * part quotes are `./summaries`, and where an error or a link takes the user is `./flow`.
 *
 * What a draft needs before it can be created is decided in `./validate.ts`.
 */

/** The two labels the summaries cannot import themselves: they live in `.tsx` files. */
const LABELS: SummaryLabels = { interval: intervalLabel, ttl: ttlLabel };

const STEP_LABELS: Record<BuilderStepId, string> = {
  strategy: "Strategy",
  rules: "Rules",
  brain: "Brain",
  create: "Create",
};

/** What the Next button calls the step it leads to. */
const NEXT_LABELS: Record<BuilderStepId, string> = {
  strategy: "Strategy",
  rules: "Rules",
  brain: "Brain",
  create: "Name and create",
};

const STATUS_WORDS: Record<StepStatus, string> = {
  needed: "Needed",
  ready: "Ready",
  defaults: "Defaults",
  edited: "Edited",
  fix: "Fix",
};

/**
 * A move the page has been asked to make, kept until the render that makes it has
 * committed: only then is the step showing and the card open, so only then can a control
 * on it take focus.
 */
interface PendingMove {
  place: Place;
  /** Arriving on an `?open=` link: bring the card into view, leave focus where it is. */
  scrollOnly?: boolean;
  /** Called when none of the place's controls is on the page. */
  missing?: () => void;
}

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
  const searchParams = useSearchParams();
  const [keys, setKeys] = useState(initialKeys);
  // The draft starts on a key the account already has, so it needs to know them.
  const { draft, update, updateConfig, clear, restore, restored } = useDraft(userId, keys, payPerUseAllowed);
  const [attempted, setAttempted] = useState(false);
  // A create in flight. Held here and not in the Create button, which unmounts whenever
  // the step changes: the ref is what refuses a second create, the state is what the page
  // shows while the first one runs.
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  /** An agent that exists whose funding did not go through: offered the signature again, here. */
  const [fundingRetry, setFundingRetry] = useState<FundingRetry | null>(null);
  // `?open=risk` opens that card once, on arrival. Toggling cards afterwards is local:
  // it does not touch the address or the history.
  const [open, setOpen] = useState<Set<CardId>>(() => {
    const card = parseCard(searchParams.get("open"));
    return new Set(card ? [card] : []);
  });

  const errors = useMemo(
    () => validateDraft(draft, keys, { payPerUseAllowed }),
    [draft, keys, payPerUseAllowed],
  );
  const visibleErrors = attempted ? errors : {};

  const nav = useBuilderStep({ restored, errors });
  const step = nav.step;

  const toggle = (id: CardId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pendingPlace = useRef<PendingMove | null>(null);
  /** The step the effect below last saw, to tell a step change it was not told about. */
  const shownStep = useRef<BuilderStepId | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  // Counted so a move to a place that is already showing (the same step, a card already
  // open) still reaches the effect.
  const [moves, setMoves] = useState(0);
  // How the user last touched the page. The agent card reports a click on a row without
  // saying how it was made, and a keyboard move must not animate the step.
  const lastInput = useRef<Via>("pointer");

  /** Go to a place: show its step, open its card, then put focus on its control. */
  const goTo = (place: Place, via: Via, missing?: () => void) => {
    // Nobody leaves the step while its agent is being created.
    if (creatingRef.current) return;
    pendingPlace.current = { place, missing };
    const card = place.card;
    if (card) setOpen((current) => (current.has(card) ? current : new Set([...current, card])));
    setMoves((count) => count + 1);
    nav.go(place, via);
  };
  const goFromCard = (place: Place) => goTo(place, lastInput.current);

  // After the commit that un-hides the panel and opens the card, so focus can never land
  // on a hidden control and the focused control already carries its error when a screen
  // reader announces it.
  useEffect(() => {
    const arriving = shownStep.current === null;
    const stepChanged = shownStep.current !== step;
    shownStep.current = step;
    let move = pendingPlace.current;
    pendingPlace.current = null;
    if (arriving) {
      const [card] = open;
      move =
        card && CARD_STEP[card] === step
          ? { place: { step, card, focusIds: [`rule-card-${card}`] }, scrollOnly: true }
          : null;
    } else if (!move && stepChanged) {
      // The browser's Back or Forward button, or a restored draft resuming: the step
      // changed without a place, so focus goes to its heading.
      move = { place: { step } };
    }
    if (!move || move.place.step !== step) return;

    const target = move.place.focusIds?.map((id) => document.getElementById(id)).find((el) => el !== null);
    if (target) {
      const smooth = !move.scrollOnly && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const reveal = () => target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
      reveal();
      if (!move.scrollOnly) target.focus({ preventScroll: true });
      // A control inside a card that is still opening is not where it will be: once the
      // card has finished, bring it into view again.
      const panel = target.closest<HTMLElement>('[id^="rule-panel-"]');
      if (panel) {
        // Transitions of the controls inside bubble up here too; only the panel's own counts.
        const settle = (event: TransitionEvent) => {
          if (event.target !== panel) return;
          panel.removeEventListener("transitionend", settle);
          reveal();
        };
        panel.addEventListener("transitionend", settle);
        window.setTimeout(() => panel.removeEventListener("transitionend", settle), 400);
      }
      return;
    }
    move.missing?.();
    // A plain step change: the top of the form, at once, with focus on the step's heading.
    columnRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    document.getElementById(`step-${step}-title`)?.focus({ preventScroll: true });
  }, [step, open, moves]);

  const providerLabel = providerLabelFor(draft.config.llm.provider);
  const payPerUse = shownSource(draft.config, payPerUseAllowed) === "usdc";
  // Every figure the bar and the closed cards quote, worked out once (`./summaries`).
  const facts = costFacts(draft, sources, { payPerUseAllowed, feeUsd });
  const ready = readyItems(draft, errors, keys, { payPerUseAllowed });
  const readyCount = ready.filter((item) => item.ready).length;
  // The one line that speaks the ready count, whichever copies of the agent card are on
  // screen. Spoken only when the count moves, and empty until it first does.
  const [counted, setCounted] = useState(readyCount);
  const [announcement, setAnnouncement] = useState("");
  if (counted !== readyCount) {
    setCounted(readyCount);
    setAnnouncement(`${readyCount} of ${ready.length} ready`);
  }
  const firstMissing = ready.find((item) => !item.ready) ?? null;

  // The agent card reads a deferred copy of the draft, so typing in an 8,000-character
  // prompt never waits on it. Derived, never stored: no effect and no second draft.
  const cardDraft = useDeferredValue(draft);
  // Deferred with it, so the card learns that the draft was swapped whole (restored,
  // started over, undone) in the same render as its rows change.
  const cardRestored = useDeferredValue(restored);
  const card = useMemo(() => {
    const cardErrors = validateDraft(cardDraft, keys, { payPerUseAllowed });
    const cardFacts = costFacts(cardDraft, sources, { payPerUseAllowed, feeUsd });
    return {
      ready: readyItems(cardDraft, cardErrors, keys, { payPerUseAllowed }),
      rows: previewRows(cardDraft, cardFacts, cardErrors, {
        hunts: universeSummary(cardDraft.config.universe as AgentConfig["universe"], cardDraft.config.chains),
        labels: LABELS,
        payPerUseAllowed,
      }),
      costs: costLines(cardDraft, cardFacts),
      runLine: runLine(cardDraft.config),
      // No figure on a manual schedule, or while a funded agent waits for the checklist:
      // the Runs line then stands as text.
      runsPerDay:
        cardFacts.intervalMinutes === 0 || cardFacts.heldForLive
          ? null
          : (cardFacts.thinking?.runsPerDay ?? cardFacts.runsPerDay),
    };
  }, [cardDraft, keys, sources, payPerUseAllowed, feeUsd]);

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

  const create = async () => {
    const allErrors = validateDraft(draft, keys, { payPerUseAllowed });
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true);
      // The earliest step with something wrong, then the control on it. The step is
      // shown and its card opened before focus lands (`goTo`).
      const key = firstErrorKey(allErrors);
      const place = firstErrorPlace(allErrors, null);
      const stillMissing = () =>
        toast.error("Something is still missing", {
          description: key ? allErrors[key] : Object.values(allErrors)[0],
        });
      if (place) {
        // The focused field carries its own message; a toast repeating it only
        // covers the commit bar on a phone. A card has no field of its own to carry one.
        const hasField = !place.card && (place.focusIds?.length ?? 0) > 0;
        goTo(place, "auto", hasField ? stillMissing : undefined);
        if (!hasField) stillMissing();
      }
      throw new Error("invalid");
    }

    // Funding never quietly sends less than asked, so a blocked plan stops the
    // create rather than creating an agent that gets a fraction of the money.
    if (fundingBlocker) {
      setAttempted(true);
      goTo(firstErrorPlace({}, fundingBlocker) ?? { step: "create" }, "auto");
      toast.error("Funding is not ready", { description: fundingBlocker });
      throw new Error("funding-blocked");
    }

    creatingRef.current = true;
    setCreating(true);
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

  /**
   * One create at a time. The flag goes up inside `create`, once the draft has passed its
   * checks and just before the agent is made, and comes down here however that ends.
   */
  const submit = async () => {
    if (creatingRef.current) return;
    try {
      await create();
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
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

  const statusCtx = { config: draft.config, attempted, fundingBlocked: fundingBlocker !== null };
  const steps: StepView[] = BUILDER_STEPS.map((id) => {
    const status = stepStatus(id, errors, statusCtx);
    return {
      id,
      label: STEP_LABELS[id],
      status,
      statusLabel: STATUS_WORDS[status],
      // Red is for after a failed Create. Before one, a missing thing is simply needed.
      tone: attempted && (status === "needed" || status === "fix") ? "error" : "neutral",
    };
  });
  const { back, next } = neighbours(step);
  /** A card is marked only after a failed Create, and only for an error that lives in it. */
  const cardHasError = (id: CardId) =>
    attempted && Object.keys(errors).some((key) => errors[key] && placeOfError(key).card === id);

  const stepProps = { draft, update, updateConfig, errors: visibleErrors, hideHeading: true };
  const previewProps = {
    draft: cardDraft,
    ready: card.ready,
    rows: card.rows,
    costs: card.costs,
    runLine: card.runLine,
    runsPerDay: card.runsPerDay,
    onGo: goFromCard,
    quietKey: cardRestored,
    disabled: creating,
  };
  const panel = (id: BuilderStepId) => ({
    id,
    active: step === id,
    direction: nav.direction,
    animate: nav.animate,
  });

  return (
    <>
    {fundingRetry ? (
      <FundingRetryDialog retry={fundingRetry} onRetry={retryFunding} onSkip={skipFunding} />
    ) : null}
    <div
      className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6"
      onPointerDownCapture={() => {
        lastInput.current = "pointer";
      }}
      onKeyDownCapture={() => {
        lastInput.current = "keyboard";
      }}
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-10">
        {/* The form. 672px is the width every control in it was built for. */}
        <div ref={columnRef} className="mx-auto w-full max-w-2xl min-w-0 scroll-mt-20 lg:mx-0">
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
                  disabled={creating}
                  onClick={() => {
                    // A hand-written strategy is the one thing here that cannot be retyped from
                    // memory, so clearing it gets the same Undo the preset cards have.
                    const previous = draft;
                    clear();
                    setOpen(new Set());
                    setAttempted(false);
                    toast.success("Draft cleared", {
                      action: { label: "Undo", onClick: () => restore(previous) },
                    });
                    // This button unmounts with the draft, so focus goes to the first step's
                    // heading rather than falling back to the page.
                    goTo({ step: "strategy" }, "auto");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RotateCcw aria-hidden className="size-3" />
                  Start over
                </button>
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="sm:hidden">A strategy, a way to think, a name. The rest is already set.</span>
            <span className="hidden sm:inline">
              Three things are yours to decide: a strategy, a way to think, a name. Everything else is already set.
            </span>
          </p>

          <div className="mt-6">
            <BuilderStepper
              steps={steps}
              current={step}
              onGo={(id, via) => goTo({ step: id }, via)}
              disabled={creating}
            />
          </div>

          {/* A minimum height, so a short step never makes the page shorter than the
              viewport and the bar below does not jump between steps. */}
          <div className="mt-8 min-h-[calc(100dvh-16rem)]">
            <StepPanel
              {...panel("strategy")}
              title="What should it do?"
              lead={
                errors.strategyPrompt ? (
                  "Pick a starting point or write your own."
                ) : (
                  <>
                    Pick a starting point or write your own. One is already written
                    <span className="hidden sm:inline">, so you can press Next</span>.
                  </>
                )
              }
            >
              <StrategyStep {...stepProps} feeUsd={feeUsd} />
            </StepPanel>

            <StepPanel
              {...panel("rules")}
              title="The rules it cannot break"
              lead={
                stepStatus("rules", errors, statusCtx) === "fix"
                  ? "Enforced in code before any trade. One of them needs a look before you can create."
                  : "Enforced in code before any trade. All four are already set. Open one only to change it."
              }
            >
              <div className="space-y-3">
                <RuleCard
                  id="universe"
                  title="Where it hunts"
                  summary={universeSummary(draft.config.universe as AgentConfig["universe"], draft.config.chains)}
                  open={open.has("universe")}
                  onToggle={() => toggle("universe")}
                  hasError={cardHasError("universe")}
                >
                  <UniverseStep {...stepProps} />
                </RuleCard>

                <RuleCard
                  id="data"
                  title="Data it buys"
                  summary={dataSummary(facts)}
                  open={open.has("data")}
                  onToggle={() => toggle("data")}
                  hasError={cardHasError("data")}
                >
                  <DataStep {...stepProps} sources={sources} />
                </RuleCard>

                <RuleCard
                  id="risk"
                  title="Risk limits"
                  // The fee closes the line: this is the one sentence about trades that is on
                  // screen without opening anything, and nothing in the builder named the fee.
                  summary={riskSummary(draft.config.risk, feeUsd)}
                  open={open.has("risk")}
                  onToggle={() => toggle("risk")}
                  hasError={cardHasError("risk")}
                >
                  <RiskStep {...stepProps} feeUsd={feeUsd} />
                </RuleCard>

                <RuleCard
                  id="schedule"
                  title="Schedule & mode"
                  summary={scheduleSummary(draft, facts, LABELS)}
                  open={open.has("schedule")}
                  onToggle={() => toggle("schedule")}
                  hasError={cardHasError("schedule")}
                >
                  <ScheduleStep {...stepProps} payPerUseAllowed={payPerUseAllowed} />
                </RuleCard>
              </div>
            </StepPanel>

            <StepPanel
              {...panel("brain")}
              title="How it thinks"
              lead={
                payPerUse
                  ? "Paying per run in USDC from the agent's own wallet. No key needed."
                  : errors.llmKeyId
                    ? payPerUseAllowed
                      ? "The one thing we cannot decide for you. Add a key from any provider, or choose pay per use below."
                      : "The one thing we cannot decide for you. Add a key from any provider, or press Next and come back to it later."
                    : errors.llm
                      ? "Check the model settings below."
                      : `Using your ${providerLabel} key. Nothing to do here unless you want a different model.`
              }
            >
              <ThinkStep
                {...stepProps}
                llmKeys={keys}
                onKeyAdded={(key) => setKeys((current) => [key, ...current])}
                payPerUseAllowed={payPerUseAllowed}
              />
            </StepPanel>

            <StepPanel
              {...panel("create")}
              title="Name it and create"
              lead="The name sits above every trade it posts. Everything else on this screen is optional."
            >
              <div className="space-y-6">
                <IdentityStep {...stepProps} />

                {/* On the last step because it is the one card that decides what the user
                    signs when they press Create, and that button is on this screen. */}
                <RuleCard
                  id="funding"
                  title="Funding"
                  summary={fundingSummary(draft, facts)}
                  open={open.has("funding")}
                  onToggle={() => toggle("funding")}
                  hasError={attempted && Boolean(fundingBlocker)}
                >
                  <FundingStep {...stepProps} />
                </RuleCard>

                {/* Below lg the agent card has no column: this copy is the read-back
                    before Create. */}
                <div className="lg:hidden">
                  <AgentPreview {...previewProps} />
                </div>
              </div>
            </StepPanel>
          </div>
        </div>

        {/* The agent card, in its own column from lg, so nothing the form does moves it.
            The height stops it sliding under the bar below. */}
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto">
            <AgentPreview {...previewProps} reveal />
          </div>
        </div>
      </div>

      <CommitBar
        step={step}
        nextLabel={next ? NEXT_LABELS[next] : null}
        onBack={back ? (via) => goTo({ step: back }, via) : null}
        onNext={(via) => {
          // Next never refuses: what is still missing is said by the stepper and the agent card.
          if (next) goTo({ step: next }, via);
        }}
        // Offered once the strategy and the way to think are ready: with a key on the
        // account that is on arrival, and all that is left is a name.
        onSkipToEnd={
          step !== "create" && ready.every((item) => item.ready || item.id === "name")
            ? (via) => goTo({ step: "create" }, via)
            : null
        }
        stillNeeded={stillNeeded(ready, errors)}
        onStillNeeded={() => {
          if (firstMissing) goTo(firstMissing.place, lastInput.current);
        }}
        submit={submit}
        creating={creating}
        sentence={<CommitSentence draft={draft} facts={facts} />}
        signing={<CommitSentence draft={draft} facts={facts} part="signing" />}
        // The same words the strip carries on the other steps, where a signature is coming.
        signingShort={draft.funding.mode === "fund" ? commitShortLine(draft, facts) : null}
        peek={
          <PreviewPeek
            draft={cardDraft}
            readyCount={readyCount}
            shortLine={commitShortLine(draft, facts)}
            compact={step === "create"}
            disabled={creating}
          >
            <AgentPreview {...previewProps} />
          </PreviewPeek>
        }
      />
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
