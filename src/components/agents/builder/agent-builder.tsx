"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { createAgentAction } from "@/components/agents/agent-actions";
import { agentSettingsHref } from "@/components/agents/settings/settings-href";
import { FundingStep } from "./steps";
import { useDraft } from "./use-draft";
import { validateDraft } from "./validate";
import type { StepView } from "./builder-stepper";
import { CommitBar } from "./commit-bar";
import { CommitSentence } from "./commit-sentence";
import { EASE, FOCUS, ReadyPips, TYPE } from "./look";
import { ReviewReady } from "./review-ready";
import { BUILDER_STEPS, type BuilderStepId } from "./contract";
import { firstErrorKey, firstErrorPlace, requestedStep, resumeStep, stepHref, stepStatus } from "./flow";
import { paperBalanceForCreate } from "./paper-balance";
import { AgentPreview } from "./preview/agent-preview";
import { PreviewPeek } from "./preview/preview-peek";
import { NowLine, StepPanel } from "./step-panel";
import { ConfigPanels, STATUS_WORDS, STEP_LABELS, STEP_NAMES, type StepContext } from "./step-registry";
import { StepShell } from "./step-shell";
import { commitShortLine, costFacts, fundingSummary, stillNeeded } from "./summaries";
import { useAgentCard } from "./use-agent-card";
import { useStepFlow } from "./use-step-flow";
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
import { AgentAvatar } from "@/components/common/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Chain, DataSourceInfo, LlmKeyRow } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Eight steps, none of them a gate: a name, a strategy, the four groups of rules (where it
 * hunts, the data it buys, its risk limits, its schedule), how it thinks, then a review
 * with the funding and the Create button. Only three things are the user's to decide (a
 * name, a strategy, a way to think) and the strategy is already written, so Next never
 * refuses and any step can be visited at any time. Every rule step opens on its defaults,
 * read back as one sentence above the controls. Beside the form sits a card of the agent
 * being made, filled in from the draft as the user goes.
 *
 * This file is what creating adds to the page of steps an agent's settings share: the
 * draft, the keys, the last step and the create itself. The page is `./step-shell`, which
 * step is showing is `./use-step-flow`, the seven config steps are `./step-registry`
 * (their controls `./steps`), the sentences every part quotes are `./summaries`, and
 * where an error or a link takes the user is `./flow`.
 *
 * What a draft needs before it can be created is decided in `./validate.ts`.
 */

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
  feeBps,
  payPerUseAllowed = false,
}: {
  userId: string;
  sources: DataSourceInfo[];
  initialKeys: LlmKeyRow[];
  /**
   * Tocker's fee in basis points of each fill, from the server (`platformFeeBps()`); 0
   * when the fee is off. The page reads it because the env it comes from never reaches
   * the browser.
   */
  feeBps: number;
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
  // A create in flight. Held here and not in the Create button, which unmounts whenever
  // the step changes: the ref is what refuses a second create, the state is what the page
  // shows while the first one runs.
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  /** An agent that exists whose funding did not go through: offered the signature again, here. */
  const [fundingRetry, setFundingRetry] = useState<FundingRetry | null>(null);

  const errors = useMemo(
    () => validateDraft(draft, keys, { payPerUseAllowed }),
    [draft, keys, payPerUseAllowed],
  );
  const visibleErrors = attempted ? errors : {};

  // Which step is showing, and the way from one to another: the address, the focus, the
  // browser's Back button. A restored draft resumes where something is still missing.
  const flow = useStepFlow({
    steps: BUILDER_STEPS,
    read: requestedStep,
    hrefOf: stepHref,
    // Nobody leaves the step while its agent is being created.
    locked: () => creatingRef.current,
    resume: { restored, step: () => resumeStep(errors) },
  });
  const { step, goTo, goFromCard } = flow;

  const payPerUse = shownSource(draft.config, payPerUseAllowed) === "usdc";
  // Every figure the bar and the read-back lines quote, worked out once (`./summaries`).
  const facts = costFacts(draft, sources, { payPerUseAllowed, feeBps });
  // The agent card, and the ready count the bar quotes beside it. A draft swapped whole
  // (restored, started over, undone) changes its rows without their tint.
  const { previewProps, ready, readyCount, cardDraft, announcement } = useAgentCard({
    draft,
    keys,
    sources,
    payPerUseAllowed,
    feeBps,
    quietKey: restored,
    currentStep: step,
    onGo: goFromCard,
    disabled: creating,
  });
  const firstMissing = ready.find((item) => !item.ready) ?? null;

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
    router.push(agentSettingsHref(slug, "wallets"));
  };

  const create = async () => {
    const allErrors = validateDraft(draft, keys, { payPerUseAllowed });
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true);
      // The earliest step with something wrong, then the control on it. The step is
      // shown before focus lands (`goTo`).
      const key = firstErrorKey(allErrors);
      const place = firstErrorPlace(allErrors, null);
      const stillMissing = () =>
        toast.error("Something is still missing", {
          description: key ? allErrors[key] : Object.values(allErrors)[0],
        });
      if (place) {
        // The focused field carries its own message; a toast repeating it only
        // covers the commit bar on a phone. A rule step has no one field to carry one.
        const hasField = (place.focusIds?.length ?? 0) > 0;
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
      // the money it is actually given (`paperBalanceForCreate`), and when it is headed
      // for the live checklist its schedule stays parked until the switch — no paper
      // ticks in between.
      paperStartingUsd: paperBalanceForCreate(draft),
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
      name: STEP_NAMES[id],
      status,
      statusLabel: STATUS_WORDS.create[status],
      // Red is for after a failed Create. Before one, a missing thing is simply needed.
      tone: attempted && (status === "needed" || status === "fix") ? "error" : "neutral",
    };
  });
  const { back, next } = flow;
  const fix = (id: BuilderStepId) => stepStatus(id, errors, statusCtx) === "fix";

  const stepProps = { draft, update, updateConfig, errors: visibleErrors, hideHeading: true };
  // What the seven config steps are drawn from. An error shows under its control only
  // after a failed Create; the sentence under a step's title reads all of them.
  const ctx: StepContext = {
    mode: "create",
    draft,
    update,
    updateConfig,
    errors: visibleErrors,
    allErrors: errors,
    facts,
    sources,
    feeBps,
    keys,
    onKeyAdded: (key) => setKeys((current) => [key, ...current]),
    payPerUseAllowed,
    fix,
  };

  return (
    <>
      {fundingRetry ? (
        <FundingRetryDialog retry={fundingRetry} onRetry={retryFunding} onSkip={skipFunding} />
      ) : null}
      <StepShell
        flow={flow}
        steps={steps}
        announcement={announcement}
        disabled={creating}
        panelMinHeight="min-h-[calc(100dvh-17rem)]"
        // The page's name is a label: the step's title below is the one large line.
        top={
          <div className="flex min-h-11 items-center justify-between gap-3 sm:min-h-7">
            <h1 className="flex items-center gap-2 text-[13px] leading-5 font-medium text-foreground">
              <Bot aria-hidden className="size-4 text-primary" />
              New agent
            </h1>
            {restored ? (
              // Say why the form is already filled in, next to the way out of it.
              <div className="flex items-center gap-1 sm:gap-2">
                <p className={cn(TYPE.caption, "text-muted-foreground")}>
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
                    setAttempted(false);
                    toast.success("Draft cleared", {
                      action: { label: "Undo", onClick: () => restore(previous) },
                    });
                    // This button unmounts with the draft, so focus goes to the first step's
                    // heading rather than falling back to the page.
                    goTo({ step: "name" }, "auto");
                  }}
                  // 44px tall on a phone, where it has no border to say so.
                  className={cn(
                    "inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground sm:h-7 sm:border sm:border-border",
                    "transition-[color,background-color,scale] duration-150",
                    EASE,
                    "hover:bg-muted hover:text-foreground active:scale-[0.97] motion-reduce:active:scale-100",
                    "disabled:pointer-events-none disabled:opacity-50",
                    FOCUS,
                  )}
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                  Start over
                </button>
              </div>
            ) : null}
          </div>
        }
        // On a phone the introduction is read once, on the first step: after that the
        // space is the form's.
        intro={
          <p className={cn("mt-1 text-[13px] leading-5 text-muted-foreground", step !== "name" && "max-sm:hidden")}>
            <span className="sm:hidden">A name, a strategy, a way to think. The rest is already set.</span>
            <span className="hidden sm:inline">
              Three things are yours to decide: a name, a strategy, a way to think. Everything else is already set.
            </span>
          </p>
        }
        panels={
          <ConfigPanels ctx={ctx} flow={flow}>
            <StepPanel
              id="create"
              active={step === "create"}
              direction={flow.direction}
              animate={flow.animate}
              title="Review and create"
              lead="Check the card, choose how to fund it, then create."
            >
              <div className="space-y-6">
                <ReviewReady items={previewProps.ready} onGo={goFromCard} disabled={creating} />

                {/* On the last step because it decides what the user signs when they press
                    Create, and that button is on this screen. */}
                <section aria-labelledby="step-create-funding" className="space-y-4">
                  <div>
                    <h3 id="step-create-funding" className={TYPE.heading}>
                      Funding
                    </h3>
                    <NowLine text={fundingSummary(draft, facts)} className="mt-2" />
                  </div>
                  <FundingStep {...stepProps} />
                </section>

                {/* Below lg the agent card has no column: this copy is the read-back
                    before Create. */}
                <div className="lg:hidden">
                  <AgentPreview {...previewProps} />
                </div>
              </div>
            </StepPanel>
          </ConfigPanels>
        }
        card={<AgentPreview {...previewProps} reveal />}
        bar={
          <CommitBar
            step={step}
            nextLabel={next ? STEP_NAMES[next] : null}
            onBack={back ? (via) => goTo({ step: back }, via) : null}
            onNext={(via) => {
              // Next never refuses: what is still missing is said by the stepper and the agent card.
              if (next) goTo({ step: next }, via);
            }}
            // Offered once the strategy and the way to think are ready: with a key on the
            // account that is on arrival, and the only thing that can still be missing is a name.
            onSkipToEnd={
              step !== "create" && ready.every((item) => item.ready || item.id === "name")
                ? (via) => goTo({ step: "create" }, via)
                : null
            }
            stillNeeded={stillNeeded(ready, errors)}
            onStillNeeded={() => {
              if (firstMissing) goFromCard(firstMissing.place);
            }}
            submit={submit}
            creating={creating}
            sentence={<CommitSentence draft={draft} facts={facts} />}
            signing={<CommitSentence draft={draft} facts={facts} part="signing" />}
            // The same words the strip carries on the other steps, where a signature is coming.
            signingShort={draft.funding.mode === "fund" ? commitShortLine(draft, facts) : null}
            // The agent beside Create, from lg. Hidden from a screen reader there: the card and
            // the tiles above already say all of it.
            identity={
              <span className="flex items-center gap-2.5">
                <AgentAvatar seed={cardDraft.avatarSeed} name={cardDraft.name.trim() || "Unnamed agent"} size="sm" />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block max-w-40 truncate text-sm leading-5 font-medium",
                      cardDraft.name.trim() ? null : "text-muted-foreground",
                    )}
                  >
                    {cardDraft.name.trim() || "Unnamed agent"}
                  </span>
                  <span className={cn(TYPE.caption, "flex items-center gap-2 text-muted-foreground")}>
                    {readyCount} of {ready.length} ready <ReadyPips ready={ready.map((item) => item.ready)} />
                  </span>
                </span>
              </span>
            }
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
        }
      />
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
