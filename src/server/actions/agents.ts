"use server";
import type { ActionResult, AgentMode, AgentStatus } from "@/server/types";
import type { AgentConfigInput } from "@/lib/agent/config";

export interface CreateAgentInput { name: string; tagline?: string; avatarSeed?: string; isPublic: boolean; isForkable: boolean; llmKeyId: string | null; config: AgentConfigInput; paperStartingUsd?: number }

export async function createAgent(_input: CreateAgentInput): Promise<ActionResult<{ id: string; slug: string }>> { throw new Error("not implemented: foundation workstream"); }
export async function updateAgent(_id: string, _input: Partial<CreateAgentInput>): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
export async function setAgentStatus(_id: string, _status: Exclude<AgentStatus, "error">): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
export async function setAgentMode(_id: string, _mode: AgentMode): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
export async function forkAgent(_id: string): Promise<ActionResult<{ id: string; slug: string }>> { throw new Error("not implemented: foundation workstream"); }
export async function deleteAgent(_id: string): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
/** Kick off a manual run; returns the run id immediately (run continues server-side). */
export async function triggerRun(_id: string): Promise<ActionResult<{ runId: string }>> { throw new Error("not implemented: foundation workstream"); }
