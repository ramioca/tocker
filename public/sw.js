/**
 * Tocker service worker — notifications only.
 *
 * It exists for one reason: a proposal can expire in five minutes, and the person who
 * has to answer is holding a phone with the screen off. A service worker is the only
 * thing in a browser that runs when there is no tab, so it is what receives the push
 * and what runs when someone taps Approve on a lock screen.
 *
 * Deliberately NOT a caching service worker. There is no `fetch` listener here, which
 * means navigation is never intercepted: no offline shell, no stale HTML after a
 * deploy, no cache to invalidate. A trading app showing yesterday's prices because a
 * service worker decided to be helpful is a far worse bug than being offline.
 *
 * Plain ES5-ish JavaScript, served straight from `public/`. No bundler touches this
 * file, so everything in it has to be what the browser understands.
 *
 * Approve and Reject POST to `/api/push/decide`. That endpoint has no session: the
 * signed token inside the notification payload is the credential, scoped to one trade,
 * one owner, one decision and the proposal's own expiry. The token is lifted out of
 * the URL and sent in the body so it does not end up in a server access log.
 */

/* global self */

var FALLBACK = {
  title: "Tocker",
  body: "A trade is waiting for your approval.",
  href: "/notifications",
  tag: "tocker-proposals",
};

// A new worker should take over immediately — the old one has no state worth keeping,
// and a notification handled by last week's code is how one-tap approval silently rots.
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/** Whatever the server sent, with every field we rely on guaranteed to exist. */
function readPayload(event) {
  var payload = {
    title: FALLBACK.title,
    body: FALLBACK.body,
    href: FALLBACK.href,
    tag: FALLBACK.tag,
  };
  if (!event.data) return payload;
  try {
    var parsed = event.data.json();
    if (parsed && typeof parsed === "object") {
      for (var key in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) payload[key] = parsed[key];
      }
    }
    return payload;
  } catch {
    // Not JSON. Show whatever text came through rather than a blank bubble.
    try {
      var text = event.data.text();
      if (text) payload.body = text;
    } catch {
      // Nothing readable at all; the fallback copy still says something true.
    }
    return payload;
  }
}

self.addEventListener("push", function (event) {
  var payload = readPayload(event);

  // `userVisibleOnly` is not a suggestion: a push that shows nothing gets the origin's
  // push permission revoked, so this always resolves to a visible notification.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: payload,
      icon: "/apple-icon.png",
      requireInteraction: true,
      actions: [
        { action: "approve", title: "Approve" },
        { action: "reject", title: "Reject" },
      ],
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  var action = event.action;
  var data = event.notification.data || {};
  event.notification.close();

  if (action === "approve" || action === "reject") {
    event.waitUntil(decide(action, action === "approve" ? data.approveUrl : data.rejectUrl, data));
    return;
  }

  event.waitUntil(openApp(data.href || FALLBACK.href));
});

/**
 * Send one decision and report what happened.
 *
 * The answer always comes back as a second notification, including when the network
 * failed — a tap that produces nothing visible reads as "it didn't register" and the
 * operator taps again, which is the last thing anyone wants on a trade.
 */
function decide(action, url, data) {
  if (!url) return openApp(data.href || FALLBACK.href);

  var target;
  try {
    target = new URL(url, self.location.origin);
  } catch {
    return openApp(data.href || FALLBACK.href);
  }

  var token = target.searchParams.get("t") || target.searchParams.get("token");

  return fetch(target.origin + target.pathname, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token: token }),
  })
    .then(function (response) {
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (body) {
          return {
            ok: Boolean(body && body.ok),
            message:
              body && typeof body.message === "string"
                ? body.message
                : "Tocker could not complete that (" + response.status + "). Open the app to check.",
          };
        });
    })
    .catch(function () {
      return { ok: false, message: "Could not reach Tocker. Open the app to decide — the proposal is still open." };
    })
    .then(function (result) {
      var title = result.ok ? (action === "approve" ? "Approved" : "Rejected") : "Not done";
      return self.registration.showNotification(title, {
        body: result.message,
        // A distinct tag from the proposal's, so the result does not silently replace
        // a *different* proposal's still-unanswered notification.
        tag: (data.tag || FALLBACK.tag) + ":result",
        data: { href: data.href || FALLBACK.href },
        icon: "/apple-icon.png",
      });
    });
}

/**
 * Focus an existing Tocker window when there is one, otherwise open a new one.
 *
 * Opening a second tab on an app the operator already has open is the classic
 * push-notification annoyance, so same-origin clients are reused and navigated to
 * where the notification pointed.
 */
function openApp(href) {
  var url;
  try {
    url = new URL(href || FALLBACK.href, self.location.origin);
  } catch {
    url = new URL(FALLBACK.href, self.location.origin);
  }

  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      var client = windows[i];
      var sameOrigin = false;
      try {
        sameOrigin = new URL(client.url).origin === url.origin;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin || typeof client.focus !== "function") continue;

      if (typeof client.navigate === "function") {
        return client
          .navigate(url.href)
          .then(function (navigated) {
            return (navigated || client).focus();
          })
          .catch(function () {
            // `navigate` throws for a window this worker does not control yet. Focusing
            // it is still better than opening a duplicate.
            return client.focus();
          });
      }
      return client.focus();
    }

    if (self.clients.openWindow) return self.clients.openWindow(url.href);
    return undefined;
  });
}

/**
 * A push service can rotate a subscription out from under us. The browser fires this
 * first; re-subscribing with the same key and telling the server keeps the device
 * reachable instead of silently going quiet until the operator next opens the app.
 */
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    (function () {
      var old = event.oldSubscription || null;
      var options = {
        userVisibleOnly: true,
        applicationServerKey: (old && old.options && old.options.applicationServerKey) || undefined,
      };
      if (!options.applicationServerKey) return Promise.resolve();

      return self.registration.pushManager
        .subscribe(options)
        .then(function (subscription) {
          return fetch("/api/push/subscribe", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(subscription.toJSON()),
          });
        })
        .catch(function () {
          // No session in the worker, or the push service refused. The app re-subscribes
          // on its next load; nothing here is worth failing loudly over.
        });
    })(),
  );
});
