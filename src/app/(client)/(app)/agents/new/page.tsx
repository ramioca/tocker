import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgentBuilder } from "@/components/agents/builder/agent-builder";
import { dataSources, llmKeys, viewerSession } from "@/components/common/data-access";
import { platformFeeBps } from "@/lib/platform/fee";
import { payPerUseAllowedFor } from "@/server/queries/agents";

export const metadata: Metadata = {
  title: "New agent",
  description:
    "Give it a name, a strategy and a way to think. Every other rule starts on a default you can change.",
};

export default async function NewAgentPage() {
  const session = await viewerSession();
  if (!session) redirect(`/login?next=${encodeURIComponent("/agents/new")}`);
  const [sources, keys, payPerUseAllowed] = await Promise.all([
    dataSources(),
    llmKeys(session.userId),
    // The switch is the server's to read; the builder only ever sees the answer.
    payPerUseAllowedFor(session),
  ]);

  // The fee is read here, on the server, and handed down: the builder states it before
  // the first fill, and a figure typed into a component would outlive a change to it.
  //
  // The builder reads `?step=` with `useSearchParams`, which wants a Suspense boundary
  // above it. This page is rendered per request (it reads the session), so the hook has
  // the address on the server and the boundary never shows its fallback.
  return (
    <Suspense fallback={null}>
      <AgentBuilder
        userId={session.userId}
        sources={sources}
        initialKeys={keys}
        feeBps={platformFeeBps()}
        payPerUseAllowed={payPerUseAllowed}
      />
    </Suspense>
  );
}
