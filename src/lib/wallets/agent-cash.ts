import "server-only";
/**
 * What the user's agents hold of the user's money, for the top bar and the Cash panel.
 *
 * Money moved into an agent is still its owner's, and a total that drops it the moment
 * it leaves their wallet reads as a loss. Two kinds of agent hold it:
 *
 *  - **Live agents**: cash (net of the fees they owe) plus open positions at their marks.
 *  - **Funded agents that are not live yet** (`parked`): the USDC waiting in their
 *    wallets. Funding an agent is a real transfer whatever its mode, and until this was
 *    counted a user who funded a paper agent with everything they had watched the top
 *    bar go to $0.00 with no page saying where the money was.
 *
 * An agent is one or the other, by its mode, and its wallets are not the user's own, so
 * no dollar is counted twice.
 *
 * An agent whose wallet cannot be read is left out and reported as `unread`. It is never
 * listed at zero: that is the same lie as a wallet shown at $0.00.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { agentFundingIntents, agents, getDb } from "@/db";
import { netLiveCashUsd } from "@/lib/platform/fee";
import { accruedFeesUsd } from "@/lib/platform/fees";
import { STRANDED_USDC_MIN, type AgentCash } from "./funding";

export interface AgentCashRead {
  /** Every agent that could be read and holds something: live first, then parked. */
  agents: AgentCash[];
  /** True when at least one agent that should be here could not be read. */
  unread: boolean;
}

type AgentRef = { id: string; slug: string; name: string };
/** `null`: could not be read. `"empty"`: read, and nothing of the owner's is in it. */
type Read = AgentCash | "empty" | null;

async function readLive(agent: AgentRef): Promise<Read> {
  try {
    const { getPortfolio } = await import("@/lib/agent/portfolio");
    const portfolio = await getPortfolio(agent.id);
    if (portfolio.cashReadFailed) return null;
    const cashUsd = Math.max(0, portfolio.cashUsd);
    const positionsUsd = Math.max(0, portfolio.equityUsd - portfolio.cashUsd);
    return { ...agent, equityUsd: cashUsd + positionsUsd, cashUsd, positionsUsd };
  } catch {
    return null;
  }
}

async function readParked(agent: AgentRef): Promise<Read> {
  try {
    const { getAgentWalletBalances, isPaperWallet } = await import("./index");
    const wallets = (await getAgentWalletBalances(agent.id)).filter((w) => !isPaperWallet(w.walletId));
    if (wallets.some((w) => w.readFailed)) return null;
    const usdc = wallets.reduce((sum, wallet) => {
      const balance = wallet.balances.find((b) => b.asset.toLowerCase() === "usdc");
      return sum + (balance ? balance.amount : 0);
    }, 0);
    // Net of what it owes, as a live agent's cash is: an agent that went back to paper
    // can still carry fees from its live fills, and those dollars are not the owner's.
    const cashUsd = netLiveCashUsd(usdc, await accruedFeesUsd(agent.id));
    // Under a cent there is nothing to show or to withdraw.
    if (cashUsd < STRANDED_USDC_MIN) return "empty";
    return { ...agent, equityUsd: cashUsd, cashUsd, positionsUsd: 0, parked: true };
  } catch {
    return null;
  }
}

/**
 * The signed-in user's agents and what each holds. Session-scoped by the caller: every
 * query here filters on `agents.ownerId`.
 *
 * A user with only unfunded paper agents costs two small queries and no wallet read:
 * which non-live agents to read is decided by their funding record, never by trying each.
 */
export async function readAgentCash(userId: string): Promise<AgentCashRead> {
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id, slug: agents.slug, name: agents.name, mode: agents.mode })
    .from(agents)
    .where(eq(agents.ownerId, userId));
  if (rows.length === 0) return { agents: [], unread: false };

  const ref = ({ id, slug, name }: (typeof rows)[number]): AgentRef => ({ id, slug, name });
  const live = rows.filter((r) => r.mode === "live").map(ref);
  const notLive = rows.filter((r) => r.mode !== "live");

  // USDC was sent to it, or is being: `pending` is a transfer the browser signed and has
  // not reported back on, and the wallet read below is what says whether it landed.
  const fundedIds = notLive.length
    ? new Set(
        (
          await db
            .selectDistinct({ agentId: agentFundingIntents.agentId })
            .from(agentFundingIntents)
            .where(
              and(
                inArray(
                  agentFundingIntents.agentId,
                  notLive.map((r) => r.id),
                ),
                inArray(agentFundingIntents.status, ["sent", "pending"]),
                sql`lower(${agentFundingIntents.asset}) = 'usdc'`,
              ),
            )
        ).map((r) => r.agentId),
      )
    : new Set<string>();
  const parked = notLive.filter((r) => fundedIds.has(r.id)).map(ref);

  const read = await Promise.all([...live.map(readLive), ...parked.map(readParked)]);
  return {
    agents: read.filter((a): a is AgentCash => a !== null && a !== "empty"),
    unread: read.some((a) => a === null),
  };
}
