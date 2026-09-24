import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgentBuilder } from "@/components/agents/builder/agent-builder";
import { dataSources, llmKeys, viewerSession } from "@/components/common/data-access";

export const metadata: Metadata = {
  title: "New agent",
  description: "Identity, brain, data, universe, risk, schedule — then it trades on its own.",
};

export default async function NewAgentPage() {
  const session = await viewerSession();
  if (!session) redirect(`/login?next=${encodeURIComponent("/agents/new")}`);
  const [sources, keys] = await Promise.all([dataSources(), llmKeys(session.userId)]);

  return <AgentBuilder userId={session.userId} sources={sources} initialKeys={keys} />;
}
