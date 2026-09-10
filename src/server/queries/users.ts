import "server-only";
import type { UserProfile, LlmKeyRow, NotificationRow, Page } from "@/server/types";

export async function getUserProfile(_handle: string, _viewerId?: string | null): Promise<UserProfile | null> { throw new Error("not implemented: foundation workstream"); }
export async function getMyLlmKeys(_userId: string): Promise<LlmKeyRow[]> { throw new Error("not implemented: foundation workstream"); }
export async function getNotifications(_userId: string, _cursor?: string | null): Promise<Page<NotificationRow>> { throw new Error("not implemented: foundation workstream"); }
export async function getUnreadNotificationCount(_userId: string): Promise<number> { throw new Error("not implemented: foundation workstream"); }
