"use server";
import type { ActionResult, WalletBalance, Chain } from "@/server/types";

export async function getAgentWalletBalances(_agentId: string): Promise<ActionResult<WalletBalance[]>> { throw new Error("not implemented: foundation workstream"); }
/** Move funds from the agent server wallet back to the owner's embedded wallet. */
export async function withdrawFromAgent(_input: { agentId: string; chain: Chain; asset: "usdc" | "native"; amount: number; toAddress: string }): Promise<ActionResult<{ txHash: string }>> { throw new Error("not implemented: foundation workstream"); }
