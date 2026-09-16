import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Constant-time check of `Authorization: Bearer $CRON_SECRET`. A plain `===`
 * leaks the secret's length and a prefix via response timing; `timingSafeEqual`
 * does not. Returns false when the secret is unset so a misconfigured deploy
 * fails closed.
 */
export function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
