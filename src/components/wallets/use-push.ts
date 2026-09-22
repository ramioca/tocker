"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Push, from the browser's side.
 *
 * The hook exists because "turn on alerts" is four separate asynchronous steps that
 * all fail differently — ask permission, register a worker, subscribe to a push
 * service, tell our server — and every one of them is unavailable somewhere. iOS
 * Safari has no `PushManager` outside an installed home-screen app. A desktop browser
 * in a private window may register a worker and then refuse to subscribe. A deployment
 * with no VAPID key cannot subscribe at all.
 *
 * So the hook answers one question honestly — *can this browser, right now, be
 * reached?* — and the UI has exactly one branch to take instead of five.
 *
 * Every `window` / `navigator` / `Notification` access is inside `useEffect` or a
 * handler. The first render is identical on the server and the client (`supported:
 * false`), so nothing here can mismatch on hydration.
 */

/** The VAPID public key this deployment signs with. Absent ⇒ push is off everywhere. */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushPermission = NotificationPermission | "unsupported";

export interface PushSubscriptionState {
  /** True only when this browser can actually be subscribed *and* keys are configured. */
  supported: boolean;
  permission: PushPermission;
  subscribed: boolean;
  /** An enable/disable round trip is in flight. */
  busy: boolean;
  /** Ask for permission, register the worker, subscribe, and record it. Resolves to whether it worked. */
  enable: () => Promise<boolean>;
  /** Unsubscribe this browser and forget it server-side. */
  disable: () => Promise<boolean>;
}

/**
 * base64url → bytes, for `applicationServerKey`.
 *
 * VAPID keys are published as unpadded base64url; `atob` only understands padded
 * base64 with `+` and `/`. Getting this wrong fails late and cryptically — the
 * subscribe call rejects with `InvalidAccessError` and nothing says why — which is
 * exactly why it is a named, exported, tested function rather than four lines inlined
 * into an event handler.
 */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64UrlString.trim();
  if (trimmed.length === 0) throw new Error("urlBase64ToUint8Array: empty key");

  const padding = "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, "+").replace(/_/g, "/");

  const raw = atob(base64);
  // Backed by a plain ArrayBuffer on purpose: `pushManager.subscribe` wants a
  // BufferSource, and a Uint8Array over a SharedArrayBuffer is not one to TypeScript.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Byte-for-byte comparison of two application server keys. */
function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const left = new Uint8Array(a);
  if (left.length !== b.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== b[i]) return false;
  }
  return true;
}

/** Everything the browser needs for push, checked in one place. */
function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function readPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

export function usePushSubscription(): PushSubscriptionState {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nothing is written to state after the component is gone: `enable` can be awaiting a
  // permission prompt the user leaves open for a minute.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // One pass on mount to answer "is this browser already subscribed?" — never a
  // registration and never a prompt, both of which need a user gesture behind them.
  useEffect(() => {
    if (!browserSupportsPush() || VAPID_PUBLIC_KEY.length === 0) return;

    let cancelled = false;
    void (async () => {
      // Every state write below sits behind an await: the answer comes from the
      // browser, and React's effect rule (no synchronous setState in an effect body)
      // is right that a mount-time write here would just be a second render.
      let existing: PushSubscription | null = null;
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        existing = (await registration?.pushManager.getSubscription()) ?? null;
      } catch {
        // A browser that refuses to look is a browser that is not subscribed.
      }
      if (cancelled || !alive.current) return;
      setSupported(true);
      setPermission(readPermission());
      setSubscribed(existing !== null);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!browserSupportsPush() || VAPID_PUBLIC_KEY.length === 0) return false;
    setBusy(true);
    try {
      const granted = await Notification.requestPermission();
      if (alive.current) setPermission(granted);
      if (granted !== "granted") return false;

      const registration = await navigator.serviceWorker.register("/sw.js");
      // `register` resolves before the worker is running; `subscribe` on a worker that
      // is still installing throws in Firefox.
      await navigator.serviceWorker.ready;

      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

      let subscription = await registration.pushManager.getSubscription();
      // A subscription made under a *previous* VAPID key cannot be reused — the push
      // service would reject our signatures — and `subscribe` refuses to replace it.
      // Dropping it first is the only way through a key rotation.
      if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
        try {
          await subscription.unsubscribe();
        } catch {
          // Keep going: `subscribe` below gives the real error if this mattered.
        }
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }),
      });
      if (!response.ok) {
        // The browser now has a subscription our server knows nothing about, which
        // would look "on" and deliver nothing. Undo it so the button stays honest.
        try {
          await subscription.unsubscribe();
        } catch {
          // Best effort.
        }
        return false;
      }

      if (alive.current) setSubscribed(true);
      return true;
    } catch (err) {
      console.warn("[push] enable failed:", err instanceof Error ? err.message : err);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    if (!browserSupportsPush()) return false;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = (await registration?.pushManager.getSubscription()) ?? null;

      // Server first: if the browser-side unsubscribe succeeds and the delete fails, we
      // keep sending to an endpoint nobody is listening on until a 410 retires it.
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      if (alive.current) setSubscribed(false);
      return true;
    } catch (err) {
      console.warn("[push] disable failed:", err instanceof Error ? err.message : err);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  return { supported, permission, subscribed, busy, enable, disable };
}
