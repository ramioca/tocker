import type { Metadata } from "next";
import Link from "next/link";
import {notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AgentSettingsForm } from "@/components/agents/settings/agent-settings-form";
import { DangerZone } from "@/components/agents/settings/danger-zone";
import { GoLiveCard } from "@/components/agents/settings/go-live-card";
import { WalletsCard } from "@/components/agents/settings/wallets-card";
import { WithdrawForm } from "@/components/agents/settings/withdraw-form";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { EmptyState } from "@/components/common/empty-state";
import { agentBySlug, agentWalletBudget, dataSources, llmKeys, viewerSession, walletBalances } from "@/components/common/data-access";
import { BudgetCard } from "@/components/agents/settings/budget-card";
import { HashScroll } from "@/components/agents/settings/hash-scroll";
import { MoneyStrip } from "@/components/agents/settings/money-strip";

type Params = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Agent settings" };

export default async function AgentSettingsPage({ params }: Params) {
  const { slug } = await params;
  const session = await viewerSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/agents/${slug}/settings`)}`);
  const agent = await agentBySlug(slug, session?.userId ?? null);
  if (!agent) notFound();

  if (!agent.isOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          title="These settings are not yours"
          description={`${agent.name} belongs to @${agent.owner.handle}. You can follow it and read its record, but only its owner can change how it trades.`}
          action={
            <Link
              href={`/agents/${agent.slug}`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-muted"
            >
              Back to the agent
            </Link>
          }
        />
      </div>
    );
  }

  // `isOwner` is decided server-side; `config` is non-null exactly when it is true.
  // Belt and braces: if the gate ever disagrees with itself, this 404s rather than
  // rendering an editor over someone else's strategy.
  if (!agent.config) notFound();

  const [balances, walletBudget, sources, keys] = await Promise.all([
    walletBalances(agent.id),
    agentWalletBudget(agent.id),
    dataSources(),
    llmKeys(session.userId),
  ]);
  const hasRealWallets = balances.some((wallet) => !wallet.walletId.startsWith("paper_"));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <Link
        href={`/agents/${agent.slug}`}
        className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {agent.name}
      </Link>

      <header className="mt-3 flex items-center gap-3">
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{agent.name}</h1>
          <p className="text-xs text-muted-foreground">
            Settings · {agent.llmKeyLabel ?? "no key attached"}
          </p>
        </div>
      </header>

      {/*
        Money first, then the strategy editor, then the rest of the money in full.

        The three things an operator opens this page to do — fund it, put it live, take
        it out — used to sit below eight cards of strategy editing. The strip at the top
        is the shortcut; the cards below are unchanged and still hold the detail, so
        there is one Fund sheet and one Withdraw form in the product, not two.

        Every card carries an `id` and `scroll-mt-20` so readiness, the live checklist
        and the strip can link straight at one (#wallets #risk #budget #mode #withdraw)
        and land clear of the sticky top bar.
      */}
      <div className="mt-6 space-y-6">
        <HashScroll />
        <MoneyStrip agent={agent} initialBalances={balances} />

        <AgentSettingsForm agent={agent} config={agent.config} sources={sources} llmKeys={keys} />

        <div id="wallets" className="scroll-mt-20">
          <WalletsCard agentId={agent.id} agentName={agent.name} initialBalances={balances} />
        </div>
        <div id="budget" className="scroll-mt-20">
          <BudgetCard
            agentId={agent.id}
            initialPerTxUsd={walletBudget?.perTxUsd ?? null}
            hasRealWallets={hasRealWallets}
          />
        </div>
        <div id="mode" className="scroll-mt-20">
          <GoLiveCard agent={agent} />
        </div>
        <div id="withdraw" className="scroll-mt-20">
          <WithdrawForm agent={agent} balances={balances} />
        </div>
        <DangerZone agent={agent} balances={balances} />
      </div>
    </div>
  );
}
