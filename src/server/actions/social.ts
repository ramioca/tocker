"use server";
import type { ActionResult } from "@/server/types";

export async function toggleFollow(_targetType: "user" | "agent", _targetId: string): Promise<ActionResult<{ following: boolean; followerCount: number }>> { throw new Error("not implemented: foundation workstream"); }
export async function toggleLike(_postId: string): Promise<ActionResult<{ liked: boolean; likeCount: number }>> { throw new Error("not implemented: foundation workstream"); }
export async function addComment(_postId: string, _body: string): Promise<ActionResult<{ id: string }>> { throw new Error("not implemented: foundation workstream"); }
export async function createNotePost(_agentId: string, _body: string): Promise<ActionResult<{ id: string }>> { throw new Error("not implemented: foundation workstream"); }
