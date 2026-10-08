// Push notification dispatch — the last mile of Web Push.
//
// The crypto (functions/lib/webpush.js), the service worker (public/sw.js),
// and the subscription storage helpers all existed before this file. What
// was missing: anything that actually SENDS a push. This module is the
// dispatch layer — called from callsignal.js (incoming calls) and data.js
// (new messages), fire-and-forget via context.waitUntil so signaling and
// messaging never block on push delivery.
//
// Privacy contract:
// - Payloads never contain message content. DMs may be E2EE (the server
//   can't read them) or plaintext (the server chooses not to). Either way
//   the push carries only routing metadata: who it's from and which thread.
// - The service worker shows the notification; if a tab is already visible
//   it forwards the event to the page instead (see public/sw.js).
// - Dead subscriptions (push service returns 404/410) are deleted so we
//   stop paying for them.

import {
  PUSH_SUBSCRIPTIONS_DDL,
  getPushSubscriptionsForUsers,
  sendPushMessage,
  buildMessagePushPayload,
} from "./webpush.js";

const TE = new TextEncoder();

/**
 * Best-effort display name for a user id. Falls back through name ->
 * username -> email local part -> "Someone".
 */
export async function getPushDisplayName(env, userId) {
  try {
    const row = await env.DB.prepare(
      "SELECT name, username, email FROM users WHERE id = ?"
    ).bind(userId).first();
    if (!row) return "Someone";
    if (row.name && String(row.name).trim()) return String(row.name).trim().slice(0, 40);
    if (row.username && String(row.username).trim()) return String(row.username).trim().slice(0, 40);
    if (row.email && String(row.email).includes("@")) return String(row.email).split("@")[0].slice(0, 40);
    return "Someone";
  } catch {
    return "Someone";
  }
}

/**
 * Send a push to a list of user ids. No-ops gracefully when VAPID is not
 * configured, the table is missing, or nobody has subscriptions. Dead
 * subscriptions are pruned. Never throws — push is best-effort.
 */
export async function sendPushToUsers(env, userIds, buildPayload) {
  if (!env || !env.DB || !Array.isArray(userIds) || !userIds.length) return;
  const vapidPublic = (env.VAPID_PUBLIC_KEY || "").trim();
  const vapidPrivate = (env.VAPID_PRIVATE_KEY || "").trim();
  if (!vapidPublic || !vapidPrivate) return; // not configured — silent no-op
  try {
    await env.DB.exec(PUSH_SUBSCRIPTIONS_DDL);
    const subs = await getPushSubscriptionsForUsers(env.DB, userIds);
    if (!subs.length) return;
    const payloadBytes = buildPayload();
    const dead = [];
    await Promise.all(subs.map(async (sub) => {
      try {
        const res = await sendPushMessage(env, sub, payloadBytes, { urgency: "high" });
        if (res && res.gone) dead.push(sub);
      } catch { /* one bad subscription never fails the batch */ }
    }));
    // Prune dead endpoints so we stop paying push services for them.
    for (const sub of dead) {
      try {
        await env.DB.prepare(
          "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
        ).bind(sub.user_id, sub.endpoint).run();
      } catch { /* noop */ }
    }
  } catch { /* push never breaks the request that triggered it */ }
}

/**
 * Build the payload for an incoming call push.
 */
export function buildCallPushPayload({ callerName }) {
  const payload = {
    kind: "call",
    title: "Incoming call",
    body: `${callerName} is calling you`,
    url: "/?inbox-open=true",
  };
  return TE.encode(JSON.stringify(payload));
}

/**
 * Build the payload for a new message push. Content is never included —
 * see the privacy contract above.
 */
export function buildNewMessagePushPayload({ threadId, senderName, encrypted }) {
  return buildMessagePushPayload({
    threadId,
    title: senderName,
    body: "New message",
    encrypted: !!encrypted,
  });
}
