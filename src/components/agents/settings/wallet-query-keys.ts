/**
 * The query keys behind an agent's money on the client, in a module of their own so the
 * Fund drawer can invalidate them without importing the card that renders the drawer.
 */

/**
 * One key per agent, exported so whatever moves money in or out of the agent can
 * invalidate it: the query ignores new `initialData` after mount, so a server refresh
 * alone leaves the Money strip and the wallets card on the balance from before.
 */
export const walletBalancesKey = (agentId: string) => ["wallet-balances", agentId] as const;

/** The agent's funding history, as the Agent wallets card lists it. */
export const fundingIntentsKey = (agentId: string) => ["funding-intents", agentId] as const;
