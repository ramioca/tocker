import type { Metadata } from "next";
import { AgentBuilder } from "@/components/agents/builder/agent-builder";
import {
  dataSources,
  llmKeys,
  popularTokens,
  viewerSession,
} from "@/components/common/data-access";

export const metadata: Metadata = {
  title: "New agent",
  description: "Identity, brain, data, chains, risk, schedule — then it trades on its own.",
};

export default async function NewAgentPage() {
  const session = await viewerSession();
  const [sources, keys, tokens] = await Promise.all([
    dataSources(),
    llmKeys(session?.userId ?? null),
    popularTokens(),
  ]);

  return <AgentBuilder sources={sources} initialKeys={keys} popularTokens={tokens} />;
}
