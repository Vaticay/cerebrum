/**
 * Cerebrum service worker — push notifications for closed tabs.
 *
 * The in-app 15s inbox poll (src/inbox.jsx) and cbNotify only fire while a
 * tab is open. This worker is what reaches someone whose tab is closed:
 * the server POSTs an encrypted Web Push message to the browser vendor's
 * push service, the browser wakes this worker, and it shows the
 * notification. No page JavaScript is involved, which is the entire point.
 *
 * Payload (JSON, from functions/lib/webpush.js buildMessagePushPayload):
 *   { kind, threadId, title, body, url }
 *
 * If the payload is missing or undecryptable (e.g. the subscription's
 * keys rotated), fall back to a generic "New message" — a notification
 * with no body is worse than a vague one, and showing nothing at all
 * would silently drop the alert.
 */

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = null;
    try {
      data = event.data ? event.data.json() : null;
    } catch {
      data = null;
    }
    const title = (data && data.title) || "Cerebrum";
    const body = (data && data.body) || "New message";
    const url = (data && data.url) || "/";

    // If a tab is already visible, let the in-app notification path
    // (cbNotify / the inbox poll) handle it instead of double-notifying.
    // Post a message so the open page can refresh its thread list.
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = clients.find((c) => c.visibilityState === "visible");
      if (visible) {
        for (const c of clients) {
          try { c.postMessage({ type: "cb-push-message", threadId: data && data.threadId }); } catch { /* noop */ }
        }
        return;
      }
    } catch {
      // clients.matchAll can throw during install races; fall through and
      // show the notification rather than dropping it.
    }

    await self.registration.showNotification(title, {
      body,
      icon: "/favicon-32x32.png",
      badge: "/favicon-32x32.png",
      tag: "cb-" + ((data && data.kind) || "thread") + "-" + ((data && data.threadId) || "inbox"),
      renotify: false,
      // An incoming call is the one notification that must not auto-dismiss:
      // if the user is away from the desk, a 20-second toast means a missed
      // call they never knew about.
      requireInteraction: data && data.kind === "call",
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Prefer an already-open Cerebrum tab: focus it and navigate it to
    // the thread. The app consumes `?inbox-thread=` on load (see
    // CerebrumApp.jsx) and opens the conversation.
    for (const c of clients) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          await c.focus();
          try { await c.navigate(url); } catch { /* older browsers */ }
          return;
        }
      } catch { /* keep looking */ }
    }
    // No usable tab: open one.
    try { await self.clients.openWindow(url); } catch { /* noop */ }
  })());
});

// A service worker that does nothing on install/activate would still
// work, but claiming clients immediately keeps the first push after a
// deploy from racing an uncontrolled page.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
