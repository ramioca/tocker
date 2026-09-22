import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, pushSubscriptions } from "@/db";

/**
 * Web Push — reaching the operator when there is no tab.
 *
 * Approval mode's whole promise is that a human answers in minutes, and some agents
 * now expire a proposal in five. A `Notification` fired from an open tab cannot keep
 * that promise: the operator is on a phone, the screen is off, and Tocker is not the
 * foreground app. Web Push is the only transport that survives that, so this module
 * exists to hand a push service an encrypted envelope and let the operating system
 * wake the device.
 *
 * Four things are worth knowing before changing anything here.
 *
 * **1. It is optional, always.** `pushEnabled()` is false until all three VAPID
 * variables are set, and every entry point returns quietly when it is. A deployment
 * without keys behaves exactly as it did before this file existed — no throw, no error
 * notification, no half-sent state. The same is true per user: an operator who never
 * granted permission simply has no rows in `push_subscriptions`.
 *
 * **2. The push service is not trusted with the content.** `web-push` encrypts the
 * payload to the subscription's own `p256dh`/`auth` key material (RFC 8291), so Apple,
 * Google and Mozilla relay ciphertext they cannot read. That matters more here than in
 * most apps: a proposal body is the agent's rationale, which is public, but the
 * approve token inside the same envelope is a bearer credential for spending money.
 *
 * **3. The one-tap token IS the authorisation.** `/api/push/decide` has no session —
 * a notification action button runs in the service worker, which may have no cookie
 * jar the operator ever consented to send cross-context, and asking someone to log in
 * before they can reject a trade defeats the point. So the token carries the whole
 * decision, signed with HMAC-SHA256 under a key derived from `ENCRYPTION_KEY`, and it
 * is scoped three ways: to one trade, to one owner, and to one decision, expiring at
 * the proposal's own `expiresAt`. It authorises exactly one thing, for five minutes,
 * and `decideProposal` still re-scores, re-guards and re-quotes before any money moves
 * — the token buys a tap, not a trade.
 *
 * **4. A device that has gone away is marked, not deleted.** A push service answers
 * 404 or 410 for an endpoint it has dropped (app deleted, permission revoked,
 * subscription rotated). Those two statuses — and only those two — set `disabledAt`,
 * so the next proposal does not pay a round trip for a phone that no longer exists. A
 * 429 or a 500 is the push service having a bad minute and changes nothing.
 */

// --------------------------------------------------------------- configuration

/** True when this deployment can actually send. False means every send is a silent no-op. */
export function pushEnabled(): boolean {
  return vapidDetails() !== null;
}

interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * The three variables, or null. Read on every send rather than cached at import: a
 * module-level snapshot would make "I set the keys in Vercel" require a redeploy of a
 * warm lambda to take effect.
 */
function vapidDetails(): VapidDetails | null {
  const subject = process.env.VAPID_SUBJECT?.trim();
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  // The spec allows a `https:` contact URL too, but a mailto: is what a push service
  // actually uses to reach an operator whose app is misbehaving, so that is what we
  // document and what the health check should look for.
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) return null;
  return { subject, publicKey, privateKey };
}

// --------------------------------------------------------------- decision tokens

export type PushDecision = "approve" | "reject";

export interface DecisionClaims {
  tradeId: string;
  ownerId: string;
  decision: PushDecision;
  /** Expiry, epoch **seconds** — the proposal's own `expiresAt`. */
  exp: number;
}

export type VerifyDecisionResult =
  | { ok: true; claims: DecisionClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "unconfigured" };

/**
 * Derivation label. Changing this string invalidates every token in flight, which is
 * the intended emergency lever: bump the version and no outstanding notification can
 * approve anything.
 */
const DECISION_KEY_INFO = "tocker/push-decision/v1";

/** Tokens are `<base64url(claims json)>.<base64url(hmac)>`. */
const TOKEN_SEPARATOR = ".";

/**
 * Clock skew allowance, seconds. The signer and the verifier are different lambda
 * instances; a proposal with a five-minute life should not be refused because one of
 * them is a second ahead. `decideProposal` re-checks expiry against the database
 * anyway, so this leniency can never fill something the runtime considers dead.
 */
const SKEW_SECONDS = 30;

/**
 * The signing key, derived from `ENCRYPTION_KEY` rather than being it.
 *
 * `ENCRYPTION_KEY` is 32 raw bytes, base64 — the same variable and the same validation
 * as `src/lib/crypto.ts` and `src/lib/security/llm-keys.ts`, read directly here because
 * that module keeps its own reader private. HMAC is used as the KDF: one secret, two
 * uses that can never be confused for each other, and no second variable for the
 * operator to lose.
 */
function decisionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ENCRYPTION_KEY missing (32 bytes base64 — see .env.example)");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  return createHmac("sha256", key).update(DECISION_KEY_INFO).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** The wire shape. Short keys because the whole payload has to fit a 4KB envelope. */
interface WireClaims {
  v: 1;
  t: string;
  o: string;
  d: PushDecision;
  e: number;
}

/**
 * Sign one decision. Pure: same claims and same `ENCRYPTION_KEY` give the same token,
 * with no randomness and no clock read, which is what makes it testable.
 */
export function signDecision(claims: DecisionClaims): string {
  if (!claims.tradeId || !claims.ownerId) throw new Error("signDecision: tradeId and ownerId are required");
  if (claims.decision !== "approve" && claims.decision !== "reject") {
    throw new Error(`signDecision: unknown decision ${String(claims.decision)}`);
  }
  if (!Number.isFinite(claims.exp)) throw new Error("signDecision: exp must be a finite epoch-seconds number");

  const wire: WireClaims = {
    v: 1,
    t: claims.tradeId,
    o: claims.ownerId,
    d: claims.decision,
    e: Math.floor(claims.exp),
  };
  const body = b64url(Buffer.from(JSON.stringify(wire), "utf8"));
  // Signed over the ENCODED body, never the object: verification then never has to
  // re-serialise, so no JSON key-order or unicode-escaping difference can ever make a
  // token we minted fail to verify.
  const signature = b64url(createHmac("sha256", decisionKey()).update(body).digest());
  return `${body}${TOKEN_SEPARATOR}${signature}`;
}

/**
 * Verify a token and return its claims.
 *
 * Order matters and is deliberate: parse, recompute, compare in constant time, and
 * only then look at `exp`. Nothing about the claims is trusted — not even read — until
 * the signature holds, so an attacker cannot learn anything by feeding us shapes.
 */
export function verifyDecision(token: unknown, now: Date = new Date()): VerifyDecisionResult {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: "malformed" };
  }
  const separator = token.lastIndexOf(TOKEN_SEPARATOR);
  if (separator <= 0 || separator === token.length - 1) return { ok: false, reason: "malformed" };

  const body = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1), "base64url");

  let expected: Buffer;
  try {
    expected = createHmac("sha256", decisionKey()).update(body).digest();
  } catch {
    // No usable ENCRYPTION_KEY: this deployment cannot verify anything. Distinct from
    // "bad signature" so the route can say so instead of accusing the caller.
    return { ok: false, reason: "unconfigured" };
  }

  // timingSafeEqual throws on a length mismatch, and a wrong-length signature is
  // trivially invalid — there is no secret to leak by refusing it early.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "signature" };
  }

  let wire: WireClaims;
  try {
    wire = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as WireClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    wire?.v !== 1 ||
    typeof wire.t !== "string" ||
    typeof wire.o !== "string" ||
    (wire.d !== "approve" && wire.d !== "reject") ||
    typeof wire.e !== "number" ||
    !Number.isFinite(wire.e)
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (wire.e + SKEW_SECONDS < Math.floor(now.getTime() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims: { tradeId: wire.t, ownerId: wire.o, decision: wire.d, exp: wire.e } };
}

// --------------------------------------------------------------- payload

/** What `createProposal` knows about the thing it wants a human to look at. */
export interface ProposalPushInput {
  tradeId: string;
  agentName: string;
  agentSlug: string;
  side: "buy" | "sell";
  requestedUsd: number;
  symbol: string;
  rationale: string | null;
  expiresAt: Date;
}

/**
 * The JSON the service worker receives.
 *
 * Every URL here is **origin-relative on purpose**. The service worker resolves them
 * against its own origin, which is by definition the origin it was installed on — so a
 * preview deployment, a custom domain and localhost all work without the payload
 * having to guess at `NEXT_PUBLIC_APP_URL`, and a stale env var can never point an
 * approve tap at the wrong host.
 */
export interface ProposalPushPayload {
  title: string;
  body: string;
  /** Where a plain tap on the notification goes. */
  href: string;
  tradeId: string;
  /** POST here to approve. The signed token rides in the `t` parameter. */
  approveUrl: string;
  /** POST here to reject. */
  rejectUrl: string;
  /** The trade id, so a repeat for the same proposal replaces the bubble rather than stacking. */
  tag: string;
  expiresAt: string;
}

const MAX_BODY_CHARS = 180;
/** A push envelope is 4096 bytes of ciphertext; stay well clear of the edge. */
const MAX_PAYLOAD_BYTES = 3_000;

function usdLabel(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * The first sentence of a rationale, for the notification body.
 *
 * A rationale is written for the feed and can run several sentences; a lock screen
 * shows one or two lines. Two details keep this from mangling trading prose: a
 * terminator only counts when whitespace or the end of the string follows it (so
 * `$0.0012.` is not a sentence break), and a break is ignored when it would leave
 * fewer than a dozen characters (so `e.g.` and `Mr.` do not become the whole body).
 */
export function firstSentence(text: string | null | undefined, maxChars: number = MAX_BODY_CHARS): string {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return "";

  let sentence = trimmed;
  const terminator = /[.!?](\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = terminator.exec(trimmed)) !== null) {
    const end = match.index + 1;
    if (end >= 12) {
      sentence = trimmed.slice(0, end);
      break;
    }
  }

  if (sentence.length <= maxChars) return sentence;
  // Cut on a word boundary when there is one within reach, so the ellipsis does not
  // land mid-ticker.
  const cut = sentence.slice(0, maxChars - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars - 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "Alpha wants to buy $2 of DOVE" — agent, side, size, token, in that order. */
export function proposalTitle(input: Pick<ProposalPushInput, "agentName" | "side" | "requestedUsd" | "symbol">): string {
  return `${input.agentName} wants to ${input.side} ${usdLabel(input.requestedUsd)} of ${input.symbol}`;
}

/**
 * Build the payload, including both signed one-tap tokens. Pure apart from reading
 * `ENCRYPTION_KEY`, and it throws when that is missing — the caller treats that as
 * "cannot push", never as "cannot propose".
 */
export function buildProposalPayload(ownerId: string, proposal: ProposalPushInput): ProposalPushPayload {
  const exp = Math.floor(proposal.expiresAt.getTime() / 1000);
  const token = (decision: PushDecision): string =>
    signDecision({ tradeId: proposal.tradeId, ownerId, decision, exp });

  const payload: ProposalPushPayload = {
    title: proposalTitle(proposal),
    body: firstSentence(proposal.rationale) || "Approve it or let it expire — the quote is re-taken when you approve.",
    href: `/agents/${proposal.agentSlug}?proposal=${proposal.tradeId}`,
    tradeId: proposal.tradeId,
    approveUrl: `/api/push/decide?t=${encodeURIComponent(token("approve"))}`,
    rejectUrl: `/api/push/decide?t=${encodeURIComponent(token("reject"))}`,
    tag: proposal.tradeId,
    expiresAt: proposal.expiresAt.toISOString(),
  };

  // Belt and braces: an over-long body is the only field that can grow without bound,
  // and a payload the push service rejects for size is a notification nobody gets.
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) {
    payload.body = firstSentence(payload.body, 80);
  }
  return payload;
}

// --------------------------------------------------------------- send

/**
 * How long the push service should hold the message for a device that is offline,
 * in seconds. Exactly the life of the proposal: a notification that arrives after the
 * proposal expired is worse than no notification, because it invites a tap that can
 * only fail.
 */
function ttlSeconds(expiresAt: Date, now: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.min(86_400, Math.max(0, seconds));
}

/** A push-service `topic` must be ≤32 URL-safe base64 characters. nanoid ids already are. */
function topicFor(tradeId: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,32}$/.test(tradeId) ? tradeId : undefined;
}

/**
 * Tell every device this owner has registered that a proposal is waiting.
 *
 * Never throws and never rejects: it is called from the proposal path, and a push that
 * fails must leave a perfectly good proposal behind. Returns how many devices accepted
 * the message, which is `0` for a deployment with no VAPID keys, an owner with no
 * devices, or a total failure — all three being the same thing from the caller's side.
 */
export async function sendProposalPush(ownerId: string, proposal: ProposalPushInput): Promise<number> {
  const vapid = vapidDetails();
  if (!vapid) return 0;

  try {
    const db = await getDb();
    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, ownerId), isNull(pushSubscriptions.disabledAt)));
    if (subs.length === 0) return 0;

    const now = new Date();
    const payload = JSON.stringify(buildProposalPayload(ownerId, proposal));
    const options = {
      TTL: ttlSeconds(proposal.expiresAt, now),
      urgency: "high" as const,
      topic: topicFor(proposal.tradeId),
      vapidDetails: vapid,
      // A push service that hangs must not hold a run loop open.
      timeout: 10_000,
    };

    const { sendNotification } = await import("web-push");

    const delivered: string[] = [];
    const gone: string[] = [];

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            options,
          );
          delivered.push(sub.id);
        } catch (err) {
          // Read the status defensively rather than with `instanceof WebPushError`: the
          // class comes from a lazily imported CJS module, and a network error has no
          // status at all.
          const status = (err as { statusCode?: unknown }).statusCode;
          if (status === 404 || status === 410) {
            gone.push(sub.id);
            return;
          }
          console.warn(
            `[push] send failed for ${ownerId} (${String(status ?? "no status")}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    );

    if (delivered.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: now })
        .where(inArray(pushSubscriptions.id, delivered));
    }
    if (gone.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({ disabledAt: now })
        .where(inArray(pushSubscriptions.id, gone));
    }

    return delivered.length;
  } catch (err) {
    console.warn(`[push] proposal push failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

// --------------------------------------------------------------- subscriptions

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * Register (or re-register) one device.
 *
 * The endpoint is the device's identity — the browser mints it, it is unguessable, and
 * calling `pushManager.subscribe()` twice on the same device returns the same one — so
 * a repeat is an update, not a second row. The update deliberately re-points `userId`:
 * a browser profile handed to a different Tocker account keeps its endpoint, and the
 * device belongs to whoever most recently asked for alerts on it. `disabledAt` is
 * cleared, because a fresh subscribe is proof the device is back.
 */
export async function saveSubscription(userId: string, input: PushSubscriptionInput): Promise<void> {
  const db = await getDb();
  await db
    .insert(pushSubscriptions)
    .values({
      id: randomUUID(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        disabledAt: null,
      },
    });
}

/**
 * Forget one device. Scoped to the owner so one account can never unsubscribe
 * another's phone by guessing an endpoint, and idempotent: unsubscribing twice, or
 * unsubscribing something that was never registered, is a success.
 */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}
