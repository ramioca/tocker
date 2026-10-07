import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgentBuilder } from "@/components/agents/builder/agent-builder";
import { dataSources, llmKeys, viewerSession } from "@/components/common/data-access";
import { feeEnabled, platformFeeUsd } from "@/lib/platform/fee";
import { payPerUseAllowedFor } from "@/server/queries/agents";

export const metadata: Metadata = {
  title: "New agent",
  description: "A name, a key and a strategy. It starts on paper and asks before each trade.",
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
  return (
    <AgentBuilder
      userId={session.userId}
      sources={sources}
      initialKeys={keys}
      feeUsd={feeEnabled() ? platformFeeUsd() : 0}
      payPerUseAllowed={payPerUseAllowed}
    />
  );
}
