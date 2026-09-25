import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canonicalSlug } from "@/app/(app)/agents/[slug]/canonical-slug";
import { EmptyState } from "@/components/common/empty-state";
import { LiveWizard } from "@/components/live/live-wizard";
import { agentBySlug, agentWalletBudget, viewerSession } from "@/components/common/data-access";
import { evaluateLiveReadiness } from "@/lib/security/live-readiness";

type Params = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "First live trade" };

/**
 * Owner-only, and gated the same way the settings page is: `isOwner` is decided
 * server-side and `config` is non-null exactly when it is true. The readiness
 * checks read the strategy's risk caps, so rendering this for a non-owner would
 * leak the one thing that is never public.
 */
export default async function LiveWizardPage({ params }: Params) {
  const slug = await canonicalSlug(params, "/live");
  const session = await viewerSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/agents/${slug}/live`)}`);
  const agent = await agentBySlug(slug, session?.userId ?? null);
  if (!agent) notFound();

  if (!agent.isOwner || !agent.config) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        {/* EmptyState's title is not a heading; the page still needs one to navigate by. */}
        <h1 className="sr-only">{agent.name} — go live</h1>
        <EmptyState
          title="This checklist is not yours"
          description={`${agent.name} belongs to @${agent.owner.handle}. Only its owner can put it live.`}
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

  const walletBudget = await agentWalletBudget(agent.id);
  const readiness = await evaluateLiveReadiness({
    agentId: agent.id,
    slug: agent.slug,
    ownerId: agent.owner.id,
    config: agent.config,
    walletBudget,
    capUsd: agent.config.risk.maxTradeUsd,
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <LiveWizard agent={agent} initialReadiness={readiness} />
    </div>
  );
}
