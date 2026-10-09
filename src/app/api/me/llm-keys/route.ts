/**
 * Whether the signed-in user has any LLM keys, for the key prompt
 * (`src/components/onboarding/key-prompt.tsx`).
 *
 * Deliberately returns only metadata (id, provider, label, last4) — the same shape
 * `LlmKeyRow` already exposes. No secret ever crosses this boundary.
 *
 * OWNER: ui-social. Foundation may fold this into its own /api/me route at merge.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMyLlmKeys } from "@/server/queries/users";
import { withMock } from "@/lib/data";
import { mockLlmKeys, mockSession } from "@/mocks/social";
import type { LlmKeyRow } from "@/server/types";

/** Key metadata is the owner's: no shared cache, and none in the browser. */
const PRIVATE = { "cache-control": "private, no-store" } as const;

export async function GET() {
  const session = await withMock(getSession, mockSession);
  if (!session) return NextResponse.json({ keys: [] as LlmKeyRow[] }, { status: 401, headers: PRIVATE });

  const keys = await withMock(
    () => getMyLlmKeys(session.userId),
    () => mockLlmKeys(),
  );

  return NextResponse.json({ keys }, { headers: PRIVATE });
}
