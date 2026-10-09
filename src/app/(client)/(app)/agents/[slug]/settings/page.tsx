import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canonicalSlug } from "@/app/(client)/(app)/agents/[slug]/canonical-slug";
import { SETTINGS_STEPS } from "@/components/agents/builder/contract";
import { AgentSettings } from "@/components/agents/settings/agent-settings";
import { agentSettingsHref } from "@/components/agents/settings/settings-href";
import { EmptyState } from "@/components/common/empty-state";
import {
  accountPaused,
  agentBySlug,
  agentWalletBudget,
  dataSources,
  llmKeys,
  viewerSession,
  walletBalances,
} from "@/components/common/data-access";
import { isAdminEmail } from "@/lib/admin";
import { platformFeeBps } from "@/lib/platform/fee";
import { readPaperBalanceLock } from "@/lib/trading/paper-history";
import { getSkippingRunsLine } from "@/server/queries/agent-status";
import { payPerUseAllowedFor } from "@/server/queries/agents";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The Withdraw form and the delete on the Manage step are server actions, and they take
// their time limit from this page (Next's route-segment-config/maxDuration). A Base
// withdrawal waits on its transfer and is followed by the sweep of the Tocker fees the
// agent owes, a second transfer; deleting sweeps them too. Neither may be cut off between
// money moving and the ledger hearing about it. 300 matches the agent page.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Agent settings" };

export default async function AgentSettingsPage({ params, searchParams }: Props) {
  // The query is handed on in both places that rebuild the address, so a link to one step
  // still lands on it after a mixed-case slug is corrected or a sign-in.
  const slug = await canonicalSlug(params, "/settings", searchParams);
  const session = await viewerSession();
  if (!session) {
    // Only a step this page has is carried through the sign-in. The `#anchor` of a link
    // is the browser's and never reaches the server.
    const { step } = await searchParams;
    const named = SETTINGS_STEPS.find((id) => id === step);
    const path = agentSettingsHref(slug);
    const back = named ? `${path}?${new URLSearchParams({ step: named }).toString()}` : path;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  const agent = await agentBySlug(slug, session?.userId ?? null);
  if (!agent) notFound();

  if (!agent.isOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        {/* EmptyState's title is a <p>; the page still needs a heading to navigate by. */}
        <h1 className="sr-only">{agent.name} settings</h1>
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

  const [balances, walletBudget, sources, keys, paused, payPerUseAllowed, skippingLine, balanceLock] = await Promise.all([
    walletBalances(agent.id),
    agentWalletBudget(agent.id),
    dataSources(),
    llmKeys(session.userId),
    accountPaused(session.userId),
    // The switch is the server's to read; the page only ever sees the answer.
    payPerUseAllowedFor(session),
    // Why nothing is running, for an agent set to skip scheduled runs with no room to
    // buy. Null for every other agent, and it never throws.
    getSkippingRunsLine(agent.id, session.userId),
    // Why its paper balance can no longer be changed, or null while it can: only while
    // it has not traded, on paper or with real money. Decided here, never in the browser,
    // and it never throws.
    readPaperBalanceLock(agent.id),
  ]);

  // The fee is read here, on the server, and handed down: the steps quote it beside the
  // trade size, and a figure typed into a component would outlive a change to it.
  //
  // The page reads `?step=` with `useSearchParams`, which wants a Suspense boundary above
  // it. This route is rendered per request (it reads the session), so the hook has the
  // address on the server, the step a link names is the first thing painted, and the
  // boundary never shows its fallback.
  //
  // Keyed by the agent: the edits in progress belong to one agent, and must never be
  // carried onto another's page.
  return (
    <Suspense fallback={null}>
      <AgentSettings
        key={agent.id}
        agent={agent}
        config={agent.config}
        sources={sources}
        llmKeys={keys}
        balances={balances}
        walletBudget={walletBudget}
        accountPaused={paused}
        isAdmin={isAdminEmail(session.email)}
        payPerUseAllowed={payPerUseAllowed}
        feeBps={platformFeeBps()}
        skippingLine={skippingLine}
        paperBalanceLock={balanceLock}
      />
    </Suspense>
  );
}
