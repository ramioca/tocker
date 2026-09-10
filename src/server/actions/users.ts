"use server";
import type { ActionResult } from "@/server/types";

export async function updateProfile(_input: { handle?: string; displayName?: string; bio?: string; avatarUrl?: string }): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
export async function addLlmKey(_input: { provider: "anthropic" | "openai" | "openrouter"; key: string; label?: string }): Promise<ActionResult<{ id: string; last4: string }>> { throw new Error("not implemented: foundation workstream"); }
export async function removeLlmKey(_id: string): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
export async function markNotificationsRead(): Promise<ActionResult> { throw new Error("not implemented: foundation workstream"); }
