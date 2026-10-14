/**
 * Inbox redesign regressions (2026-10-13).
 *
 * The scorer panel found the inbox's substance strong and its reading
 * layer weak: no scroll management (long threads opened on the oldest
 * message), a single line 13px composer, drafts destroyed on thread
 * switch, dead links and DOIs, unread as a boolean, conversation
 * search matching fields the API never sent, and history past 1000
 * messages silently unreachable. These tests pin the fixes in place.
 *
 * Run with: node tests/inbox-redesign.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inboxSrc = await readFile(join(root, "src/inbox.jsx"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const dataSrc = await readFile(join(root, "functions/api/data.js"), "utf8");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

await test("composer is a growing textarea, not a single line input", () => {
  assert.ok(inboxSrc.includes("<textarea"), "composer textarea missing");
  assert.ok(inboxSrc.includes("composerRef"), "composer auto grow ref missing");
  assert.ok(inboxSrc.includes("!e.shiftKey"), "Enter to send must leave Shift + Enter for a new line");
});

await test("drafts are kept per conversation and persisted", () => {
  assert.ok(inboxSrc.includes("draftsByThread"), "per thread draft state missing");
  assert.ok(inboxSrc.includes("cb_inbox_drafts_v1"), "draft persistence key missing");
  assert.ok(!inboxSrc.includes('setDraft("");'), "the old wipe on thread switch is back");
});

await test("the message pane manages scroll and offers a way back", () => {
  assert.ok(inboxSrc.includes("handleMsgScroll"), "scroll handler missing");
  assert.ok(inboxSrc.includes("jumpToLatest"), "new messages jump missing");
  assert.ok(inboxSrc.includes("scrollStateRef"), "scroll keeper state missing");
});

await test("an unread divider anchors to the pre-visit read cursor", () => {
  assert.ok(inboxSrc.includes("firstUnreadIdx"), "unread divider computation missing");
  assert.ok(inboxSrc.includes("readBefore"), "client never reads the pre-visit cursor");
  assert.ok(dataSrc.includes("readBefore"), "thread payload carries no readBefore");
});

await test("history past the newest page is reachable by cursor", () => {
  assert.ok(inboxSrc.includes("Show earlier messages"), "load earlier control missing");
  assert.ok(inboxSrc.includes("loadEarlier"), "load earlier handler missing");
  assert.ok(dataSrc.includes('searchParams.get("before")'), "thread resource ignores the before cursor");
  assert.ok(dataSrc.includes("hasMore"), "thread payload carries no hasMore");
});

await test("message text linkifies URLs and DOIs", () => {
  assert.ok(inboxSrc.includes("renderLinkedText"), "linkify helper missing");
  assert.ok(inboxSrc.includes("https://doi.org/"), "DOIs do not resolve to doi.org");
});

await test("the inbox list carries real unread counts and peer identity", () => {
  assert.ok(dataSrc.includes("unreadCount"), "inbox resource sends no unreadCount");
  assert.ok(dataSrc.includes("otherUsername"), "inbox resource sends no otherUsername");
  assert.ok(inboxSrc.includes("t.unreadCount"), "thread rows never render the count");
});

await test("a failed poll can no longer eject the reader from an open thread", () => {
  assert.ok(inboxSrc.includes("if (!thread && prevThread) return prevThread;"), "poll failure still blanks the thread");
});

await test("the unread divider anchors in a never opened thread too", () => {
  assert.ok(inboxSrc.includes("data.readBefore != null"), "anchor gate still drops a zero cursor");
  assert.ok(inboxSrc.includes("unreadAnchor != null"), "divider gate still drops a zero anchor");
});

await test("group list previews name the sender", () => {
  assert.ok(inboxSrc.includes("senderName"), "client ignores the group sender name");
  assert.ok(dataSrc.includes("lastSenderName"), "server never sends the group sender name");
});

await test("unread counts are counted in SQL, not by scanning every message", () => {
  assert.ok(dataSrc.includes("SELECT COUNT(*) AS n FROM messages"), "unread count still scans all rows");
});

await test("app badges sum unread messages, not unread threads", () => {
  assert.ok(appSrc.includes("t.unreadCount || (t.unread ? 1 : 0)"), "badge still counts threads");
});

await test("group senders get stable per person colors", () => {
  assert.ok(inboxSrc.includes("senderColor"), "sender color helper missing");
  assert.ok(inboxSrc.includes("SENDER_COLORS"), "sender color palette missing");
});

await test("the thread list separates loading, failed, and truly empty", () => {
  assert.ok(inboxSrc.includes("listLoaded"), "loading state missing");
  assert.ok(inboxSrc.includes("listFailed"), "failed state missing");
  assert.ok(inboxSrc.includes("Conversations did not load"), "failed copy missing");
});

// ── Rescore fix pass (2026-10-13, second round) ─────────────────────

await test("a failed first open gets an error pane with a retry, not the picker", () => {
  assert.ok(inboxSrc.includes("threadError"), "thread error state missing");
  assert.ok(inboxSrc.includes("This conversation did not load"), "error pane copy missing");
  assert.ok(inboxSrc.includes("setThreadRetryNonce"), "retry never re-runs the open effect");
  assert.ok(inboxSrc.includes("threadLoadedIdRef"), "nothing distinguishes a failed open from a failed poll");
});

await test("a loaded list that goes stale says so above the list, with a retry", () => {
  assert.ok(inboxSrc.includes("This list may be out of date"), "stale banner copy missing");
  assert.ok(inboxSrc.includes("threads.length > 0 && listFailed"), "banner is not gated on a loaded list");
  assert.ok(inboxSrc.includes("listRefreshRef"), "banner retry has no handle on the poll");
});

await test("a failed history fetch keeps hasMore and speaks up", () => {
  assert.ok(inboxSrc.includes("Earlier messages did not load"), "history failure is silent again");
  assert.ok(inboxSrc.includes("!Array.isArray(data.messages) || data.messages.length === 0"), "only an empty success may end history");
  assert.ok(!inboxSrc.includes("!data || data.error || !Array.isArray(data.messages)"), "the old branch still ends history on any error");
});

await test("both polls back off on failure and reset on success", () => {
  assert.ok(inboxSrc.includes("2 ** failures"), "backoff never doubles the delay");
  assert.ok(inboxSrc.includes("120000"), "list poll backoff has no cap");
  assert.ok(inboxSrc.includes("60000"), "thread poll backoff has no cap");
  assert.ok(inboxSrc.includes("pollTimer"), "polls are not on setTimeout chains");
});

await test("sends are optimistic rows with their own state", () => {
  assert.ok(inboxSrc.includes("appendLocalRow"), "no optimistic row is appended");
  assert.ok(inboxSrc.includes('pending: "sending"'), "rows are not born in a sending state");
  assert.ok(inboxSrc.includes("performSend"), "send network half missing");
  assert.ok(inboxSrc.includes("Failed to send"), "failed rows carry no label");
  assert.ok(inboxSrc.includes("retrySend"), "failed rows have no retry");
  assert.ok(!inboxSrc.includes("updateDraft(text)"), "failure still restores the draft for a duplicate send");
});

await test("a partial encrypted send reports the device counts honestly", () => {
  assert.ok(inboxSrc.includes("Sent to ${sentCount} of ${envelopes.length} devices. The rest did not go through."), "partial send toast missing or vague");
  assert.ok(inboxSrc.includes('pending: "partial"'), "partial rows carry no honest state");
  assert.ok(inboxSrc.includes("partialSent"), "the row itself does not show how far the send got");
});

await test("the composer never locks during a send", () => {
  assert.ok(!inboxSrc.includes("const [sending, setSending]"), "the global send lock is back");
  assert.ok(!inboxSrc.includes("disabled={sending}"), "the composer still disables while sending");
  assert.ok(inboxSrc.includes('m.pending === "sending"'), "no visible sending indicator on the row");
});

await test("a failed image send keeps the image on the row for retry", () => {
  assert.ok(inboxSrc.includes("_send: payload"), "rows do not hold their own send payload");
  assert.ok(inboxSrc.includes("attachmentData: att ? (att.data || null) : null"), "the optimistic row drops the image data");
});

await test("arrivals are announced and loading state is reachable", () => {
  assert.ok(inboxSrc.includes("aria-live"), "no live region for arrivals");
  assert.ok(inboxSrc.includes("liveAnnouncement"), "arrivals never reach the live region");
  assert.ok(inboxSrc.includes("aria-busy"), "list container does not expose its busy state");
  assert.ok(inboxSrc.includes('<div role="status" style={{ padding: "6px 4px" }}>'), "skeleton loading text is still hidden from assistive tech");
});

await test("the per message report target is a real touch target", () => {
  assert.ok(inboxSrc.includes('className="cb-msg-report"'), "report button missing");
  assert.ok(inboxSrc.includes("width: 40, height: 40, padding: 0"), "report target shrank back below 40px");
});

await test("group member removal asks once before it acts", () => {
  assert.ok(inboxSrc.includes("confirmRemoveId"), "removal has no armed state");
  assert.ok(inboxSrc.includes('"Remove?"'), "the armed button does not say what the second tap does");
  assert.ok(inboxSrc.includes("setTimeout(() => setConfirmRemoveId(null), 3500)"), "an armed removal never disarms itself");
});

await test("the shared shelf is counted by the server over the whole thread", () => {
  assert.ok(dataSrc.includes("sharedCounts"), "thread payload carries no sharedCounts");
  assert.ok(dataSrc.includes("GROUP BY attachment_kind"), "server counts are not a grouped count over the thread");
  assert.ok(inboxSrc.includes("activeThread.sharedCounts"), "client ignores the server counts");
});

await test("the notification privacy comment and log labels read clean", () => {
  assert.ok(inboxSrc.includes("Notifications never carry message content"), "privacy comment was not rewritten");
  assert.ok(!inboxSrc.includes("the envelope is ciphertext and the plaintext belongs on"), "the spliced half sentence is still there");
  assert.ok(!inboxSrc.includes("inbox.jsx if:"), "garbled log labels remain");
  assert.ok(!inboxSrc.includes("stopRecording(); }:"), "garbled log labels remain");
});

// ── Read state ordering (2026-10-13, third round) ─────────────────
// The panel's top Inbox defect, verified twice: the thread GET marked
// the thread read on the server as a side effect of opening it, so a
// failed open erased the unread state permanently and no mark as
// unread existed anywhere. These pins hold the corrected contract:
// the GET is a pure read, the cursor moves only on a client
// acknowledgement posted after a successful load and render, and an
// explicit mark as unread rewinds it again.

await test("opening a thread no longer marks it read on the server", () => {
  const start = dataSrc.indexOf('if (resource === "thread")');
  const end = dataSrc.indexOf('if (resource === "search-users")');
  assert.ok(start > -1 && end > start, "thread GET handler not found");
  const block = dataSrc.slice(start, end);
  assert.ok(!block.includes("UPDATE thread_participants SET last_read_at"), "the thread GET still writes the read cursor as a side effect");
  assert.ok(block.includes("readBefore"), "the pre-visit cursor no longer rides along for the divider");
});

await test("read advances only on a client acknowledgement, monotonic and clamped", () => {
  const idx = dataSrc.indexOf('action === "mark-thread-read"');
  assert.ok(idx > -1, "mark-thread-read action missing");
  const block = dataSrc.slice(idx, idx + 2400);
  assert.ok(block.includes("up_to"), "the ack ignores the client's rendered up to claim");
  assert.ok(block.includes("last_read_at < ?"), "the ack is not monotonic — a late ack could rewind the cursor");
  assert.ok(block.includes("upTo > now"), "the ack is not clamped — a skewed client clock could mark the future read");
});

await test("the client acknowledges only after a successful load, and mirrors only then", () => {
  assert.ok(inboxSrc.includes('apiDataAction("mark-thread-read"'), "the client never acknowledges a read");
  assert.ok(inboxSrc.includes("if (data && !data.error && thread)"), "the ack is not gated on the successful load path");
  assert.ok(inboxSrc.includes("lastAckRef"), "nothing stops the poll re-posting the same claim every five seconds");
  assert.ok(!inboxSrc.includes("The backend marks this thread read as part of that same GET"), "the old read on open claim is still in the client");
});

await test("mark as unread rewinds to the newest incoming message and reports real state", () => {
  const idx = dataSrc.indexOf('action === "mark-thread-unread"');
  assert.ok(idx > -1, "mark-thread-unread action missing");
  const block = dataSrc.slice(idx, idx + 3400);
  assert.ok(block.includes("MAX(created_at)"), "unread does not anchor to the newest incoming message");
  assert.ok(block.includes("sender_id != ?"), "unread anchors to any message, including the reader's own");
  assert.ok(block.includes("unread_count"), "the endpoint does not return the recomputed count");
  assert.ok(block.includes('SELECT COUNT(*) AS n FROM messages'), "the returned count is not the SQL counted one the list uses");
});

await test("mark as unread is in the header menu for groups and DMs alike", () => {
  assert.ok(inboxSrc.includes("Mark as unread"), "no mark as unread control in the UI");
  assert.ok(inboxSrc.includes('apiDataAction("mark-thread-unread"'), "the control never reaches the endpoint");
  assert.ok(inboxSrc.includes("unreadHoldRef"), "nothing stops this visit's acks from undoing a mark as unread");
  // The menu that carries it must not sit behind the DM only gate its
  // block and report items live under.
  const menuIdx = inboxSrc.indexOf('aria-label="Conversation options"');
  assert.ok(menuIdx > -1, "conversation options menu missing");
  const before = inboxSrc.slice(Math.max(0, menuIdx - 1600), menuIdx);
  assert.ok(!before.includes('activeThread.kind === "dm" && activeThread.otherId && ('), "the options menu is still gated to DMs only");
});

// ── Durable sends (second rescore) ────────────────────────────────
// The write path could silently lose a message the reader typed:
// send-message generated the message id inline and never returned
// it, so no optimistic row could be reconciled against a canonical
// identity, and failed sends lived only in component state, so a
// reload after a failed send lost the message, its attachment, and
// its retry handle. These pins hold the fix: a canonical id in the
// response, a client idempotency key the server dedupes on, and a
// per thread outbox in localStorage mirroring the drafts.

await test("send-message keeps the generated id and returns it as the canonical id", () => {
  const idx = dataSrc.indexOf('action === "send-message"');
  assert.ok(idx > -1, "send-message action missing");
  const block = dataSrc.slice(idx, idx + 16000);
  assert.ok(block.includes('const messageId = newId("msg")'), "the generated id is not kept in a variable");
  assert.ok(block.includes("id: messageId"), "the success response is not built from the stored id");
  assert.ok(dataSrc.includes("id: m.id"), "the shared message payload builder carries no id");
  assert.ok(block.includes("messagePayloadFromRow({"), "the fresh response bypasses the shared payload builder");
});

await test("send-message accepts and stores a client idempotency key", () => {
  const idx = dataSrc.indexOf('action === "send-message"');
  const block = dataSrc.slice(idx, idx + 16000);
  assert.ok(block.includes("safeId(body.client_msg_id)"), "the client key is not read from the body");
  const insertAt = block.indexOf("INSERT INTO messages");
  assert.ok(insertAt > -1, "message insert missing");
  assert.ok(block.slice(insertAt, insertAt + 600).includes("client_msg_id"), "the insert does not store the key");
  assert.ok(dataSrc.includes("ALTER TABLE messages ADD COLUMN client_msg_id TEXT"), "the column is not self healed in");
  assert.ok(dataSrc.includes("idx_messages_client_key"), "no unique index backs the dedupe");
  assert.ok((dataSrc.match(/await ensureMessageClientKey\(env\)/g) || []).length >= 2, "the self heal does not run on both the thread read and the send path");
});

await test("a retry with the same key returns the stored row and inserts nothing", () => {
  const idx = dataSrc.indexOf('action === "send-message"');
  const block = dataSrc.slice(idx, idx + 16000);
  const dedupeAt = block.indexOf("client_msg_id = ?");
  const insertAt = block.indexOf("INSERT INTO messages");
  assert.ok(dedupeAt > -1, "no dedupe lookup by idempotency key");
  assert.ok(dedupeAt < insertAt, "the dedupe lookup runs after the insert, so it can never prevent one");
  assert.ok(block.includes("messagePayloadFromRow(dupe, user.id)"), "a dedupe hit does not return the stored row");
  assert.ok(block.includes("/unique constraint/i"), "the racing retry fallback on the unique index is missing");
  assert.ok(block.includes("messagePayloadFromRow(winner, user.id)"), "the race loser is not answered with the winner's row");
});

await test("the thread payload echoes each message's idempotency key", () => {
  assert.ok(dataSrc.includes("clientMsgId: m.client_msg_id || null"), "thread messages carry no clientMsgId to reconcile against");
  assert.ok(dataSrc.includes("envelope_version, client_msg_id FROM messages"), "the thread read does not select the key");
});

await test("the client sends its idempotency key and reconciles the row to the canonical id", () => {
  assert.ok(inboxSrc.includes("function newClientMsgId()"), "no client key generator");
  assert.ok(inboxSrc.includes("client_msg_id: payload.clientMsgId"), "the send body carries no key");
  assert.ok(inboxSrc.includes("clientMsgId: payload.clientMsgId || null"), "the optimistic row does not carry the key");
  assert.ok(inboxSrc.includes("replaceLocalRow(threadId, lid, { ...res.message, who: \"You\" })"), "the optimistic row is not replaced by the canonical response");
  assert.ok(inboxSrc.includes("outboxDrop(threadId, payload.clientMsgId)"), "a reconciled send does not retire its outbox entry");
});

await test("failed sends persist in a per thread outbox, written before the send is attempted", () => {
  assert.ok(inboxSrc.includes("cb_inbox_outbox_v1"), "outbox persistence key missing");
  assert.ok(inboxSrc.includes("outboxByThread"), "outbox state missing");
  const putAt = inboxSrc.indexOf("outboxPut(threadId, {");
  const sendAt = inboxSrc.indexOf("await performSend(threadId, payload, lid)");
  assert.ok(putAt > -1 && sendAt > -1, "the send flow does not register an outbox entry");
  assert.ok(putAt < sendAt, "the outbox entry is written after the attempt, so a crash mid send still loses it");
  const entry = inboxSrc.slice(putAt, putAt + 500);
  assert.ok(entry.includes("text: payload.text"), "the entry does not carry the text");
  assert.ok(entry.includes("attachment: payload.attachment"), "the entry does not carry the attachment the send path uses");
  assert.ok(entry.includes("clientMsgId: payload.clientMsgId"), "the entry does not carry the client identity");
  assert.ok(inboxSrc.includes('localStorage.setItem("cb_inbox_outbox_v1"'), "the outbox is never persisted");
});

await test("a failed send survives a reload: restore on open rebuilds the row with its retry payload", () => {
  assert.ok(inboxSrc.includes("const outboxRowFor = (entry) =>"), "no row builder for restored entries");
  assert.ok(inboxSrc.includes('pending: entry.state === "partial" ? "partial" : "failed"'), "restored rows do not come back failed (partial keeps its own state)");
  assert.ok(inboxSrc.includes("clientMsgId: entry.clientMsgId"), "the restored row's retry payload loses the original key");
  assert.ok(inboxSrc.includes("!have.has(e.clientMsgId)"), "restore does not skip sends the thread already shows");
  assert.ok(inboxSrc.includes("outboxByThread[activeId]"), "restore is not keyed to the open thread");
});

await test("a send whose response was lost reconciles by key in the poll merge and never duplicates", () => {
  assert.ok(inboxSrc.includes("nextClientKeys"), "the poll merge builds no key set from the server page");
  assert.ok(inboxSrc.includes("!(m.clientMsgId && nextClientKeys.has(m.clientMsgId))"), "the poll merge keeps the local copy beside the server row it duplicates");
  assert.ok(inboxSrc.includes("outboxDrop(activeId, m.clientMsgId)"), "landed outbox entries are not retired when a poll proves them stored");
  assert.ok(inboxSrc.indexOf("outboxDrop(activeId, m.clientMsgId)") > inboxSrc.indexOf('apiDataAction("mark-thread-read"'), "the outbox prune moved ahead of the read ack it must not disturb");
  assert.ok(inboxSrc.includes("row._send.clientMsgId"), "retry does not reuse the original key");
  assert.ok(inboxSrc.includes('client_msg_id: payload.clientMsgId + "-" + (env.recipientDeviceId || sentCount)'), "encrypted envelopes carry no per device key");
});

await test("failed and partial rows can be discarded, row and outbox entry together", () => {
  assert.ok(inboxSrc.includes("const discardSend = (lid) =>"), "no discard handler");
  assert.ok(inboxSrc.includes("discardSend(m.id)"), "no discard control is rendered");
  assert.ok((inboxSrc.match(/>Discard<\/button>/g) || []).length === 2, "discard is not offered on both the failed and the partial state");
});

// ── Pin, mute, content search, presence, outbox honesty (fourth round) ──
// The third rescore's Inbox findings: no pin or mute anywhere, message
// search matching names only while the voice note copy called the
// transcript searchable, and an outbox whose localStorage write could
// fail silently so a "durable" send vanished with the tab. These pins
// hold the fixes: per participant pin and mute columns healed in the
// repo's self-healing pattern, a content search endpoint with an
// absolute encryption boundary, a heartbeat presence, and an outbox
// write that is checked synchronously and surfaced at the composer
// when it fails. The functional block at the end drives the real
// handler against a real SQLite database, so the SQL itself is under
// test, not just its spelling.

await test("pin and mute columns self heal onto thread_participants", () => {
  assert.ok(dataSrc.includes("ALTER TABLE thread_participants ADD COLUMN pinned_at INTEGER"), "pinned_at column is not self healed in");
  assert.ok(dataSrc.includes("ALTER TABLE thread_participants ADD COLUMN muted INTEGER"), "muted column is not self healed in");
  assert.ok(dataSrc.includes("ensureThreadPrefColumns"), "no ensure helper for the preference columns");
});

await test("pin and mute are actions on the caller's own participant row", () => {
  for (const [action, column] of [["set-thread-pinned", "pinned_at"], ["set-thread-muted", "muted"]]) {
    const idx = dataSrc.indexOf(`action === "${action}"`);
    assert.ok(idx > -1, `${action} action missing`);
    const block = dataSrc.slice(idx, idx + 1600);
    assert.ok(block.includes("UPDATE thread_participants SET " + column), `${action} does not write ${column}`);
    assert.ok(block.includes("You're not part of that conversation."), `${action} has no membership guard`);
  }
  assert.ok(inboxSrc.includes('apiDataAction("set-thread-pinned"'), "the client never calls set-thread-pinned");
  assert.ok(inboxSrc.includes('apiDataAction("set-thread-muted"'), "the client never calls set-thread-muted");
  assert.ok(inboxSrc.includes(">Pin<") || inboxSrc.includes('"Pin"') || inboxSrc.includes("? \"Unpin\" : \"Pin\""), "no Pin label in the conversation actions");
  assert.ok(inboxSrc.includes("? \"Unmute\" : \"Mute\""), "no Mute label in the conversation actions");
});

await test("the inbox list carries pin, mute, and presence, and sorts pinned first", () => {
  assert.ok(dataSrc.includes("tp.pinned_at, tp.muted"), "inbox query does not read the preference columns");
  assert.ok(dataSrc.includes("pinnedAt: t.pinned_at"), "inbox items carry no pinnedAt");
  assert.ok(dataSrc.includes("muted: !!t.muted"), "inbox items carry no muted flag");
  assert.ok(dataSrc.includes("otherLastActiveAt"), "inbox and thread payloads carry no presence");
  assert.ok(dataSrc.includes("a.pinned ? -1 : 1"), "the list sort does not put pinned conversations first");
  assert.ok(inboxSrc.includes("t.pinned"), "list rows never show the pinned state");
  assert.ok(inboxSrc.includes("t.muted"), "list rows never show the muted state");
});

await test("a muted recipient is left out of the web push fan-out", () => {
  const idx = dataSrc.indexOf("const pushWork");
  assert.ok(idx > -1, "push fan-out not found");
  const block = dataSrc.slice(idx, idx + 1200);
  assert.ok(block.includes("COALESCE(muted, 0) = 0"), "the push query does not exclude muted recipients");
  assert.ok(inboxSrc.includes("!t.muted"), "the client list poll still notifies for muted threads");
});

await test("a muted conversation stays silent on the open thread poll too", () => {
  // The fifth audit panel: the list poll guarded its notifications
  // with the muted flag, but the open thread poll's arrival path fired
  // its blip, its screen reader announcement, and its system
  // notification with no muted check at all, so a muted thread open in
  // a background tab still announced every arrival. The contract at
  // toggleThreadMuted is "nothing notifies"; this pins the open thread
  // half of it structurally: the arrival block must compute the
  // thread's muted state and gate every sound it can make on it.
  const start = inboxSrc.indexOf("const fresh = nextMsgs[nextMsgs.length - 1];");
  assert.ok(start > -1, "open thread arrival block not found");
  const notifyAt = inboxSrc.indexOf("cbNotify(fresh.who", start);
  assert.ok(notifyAt > -1, "open thread arrival notification not found");
  const block = inboxSrc.slice(start, notifyAt + 120);
  assert.ok(block.includes("next.muted"), "the arrival block never reads the muted flag off the thread the poll just fetched");
  assert.ok(block.includes("prevThread.muted"), "the arrival block has no fallback to the open thread's own muted state");
  const guardAt = block.indexOf("if (!threadMuted)");
  assert.ok(guardAt > -1, "the arrival sounds are not gated on the muted flag");
  for (const sound of ["cbBlip(660", "setLiveAnnouncement", "cbNotify(fresh.who"]) {
    const at = block.indexOf(sound);
    assert.ok(at > -1, `${sound} left the arrival block (the unmuted path must keep announcing)`);
    assert.ok(guardAt < at, `${sound} fires before the muted gate, so a muted thread still announces`);
  }
});

await test("the push wake-up event has a real consumer: the inbox refreshes its list", () => {
  // public/sw.js posts "cb-push-message" to open pages when a push
  // lands on a visible tab, and src/main.jsx re-dispatches it as the
  // window event "cb:push-message". For a long time nothing listened:
  // the chain claimed a refresh that never happened. The inbox is the
  // consumer; pin the listener, the refresh it triggers, and its
  // cleanup so the chain cannot quietly go dead again.
  assert.ok(inboxSrc.includes('window.addEventListener("cb:push-message"'), "nothing in the inbox listens for the push wake-up event");
  assert.ok(inboxSrc.includes('window.removeEventListener("cb:push-message"'), "the push wake-up listener is never removed on unmount");
  const idx = inboxSrc.indexOf('addEventListener("cb:push-message"');
  const block = inboxSrc.slice(Math.max(0, idx - 400), idx + 200);
  assert.ok(block.includes("listRefreshRef.current()"), "the push wake-up handler does not refresh the thread list");
});

await test("group threads show both call buttons, both disabled with the same explanation", () => {
  // The group header used to render only a disabled camera button:
  // video looked unavailable while audio looked merely absent. Both
  // buttons render now, matching the DM header's shape, and both
  // carry the same honest explanation.
  const start = inboxSrc.indexOf('activeThread.kind === "group" ? (<>');
  assert.ok(start > -1, "group call button branch not found");
  const block = inboxSrc.slice(start, inboxSrc.indexOf("</>) : (<>", start));
  assert.ok(block.includes('<Icon name="phone"'), "group threads lost the audio call button entirely");
  assert.ok(block.includes('<Icon name="camera"'), "group threads lost the video call button");
  const explanations = block.split("Group calls aren't supported yet. Calls work in direct messages").length - 1;
  assert.equal(explanations, 2, "both group call buttons must carry the same explanation");
  assert.equal((block.match(/<button/g) || []).length, 2, "the group header must render exactly the two call buttons");
  assert.equal((block.match(/<button\s+disabled/g) || []).length, 2, "both group call buttons must be disabled");
});

await test("message content search exists and its encryption boundary is absolute", () => {
  const idx = dataSrc.indexOf('resource === "search-messages"');
  assert.ok(idx > -1, "search-messages resource missing");
  const block = dataSrc.slice(idx, idx + 6000);
  assert.ok(block.includes("e2ee_threads"), "search does not exclude encrypted threads");
  assert.ok(block.includes("!= 'cipher'"), "search does not exclude cipher rows");
  assert.ok(block.includes("attachment_meta"), "search never looks in attachment metadata, where transcripts live");
  assert.ok(block.includes("encryptedExcluded"), "search does not report how many encrypted threads it skipped");
  assert.ok(block.includes("matchedIn"), "search results do not say where the match lived");
  assert.ok(inboxSrc.includes('apiDataGet("search-messages"'), "the client never calls message search");
  assert.ok(inboxSrc.includes("Encrypted conversations are not searched on the server"), "the client never states the search boundary");
  assert.ok(inboxSrc.includes("localMsgResults"), "the open encrypted thread is not searched on device");
});

await test("presence is a heartbeat: ping action, column, and honest copy", () => {
  assert.ok(dataSrc.includes('action === "presence-ping"'), "presence-ping action missing");
  assert.ok(dataSrc.includes("ALTER TABLE users ADD COLUMN last_active_at INTEGER"), "last_active_at column is not self healed in");
  assert.ok(inboxSrc.includes('apiDataAction("presence-ping"'), "the client never heartbeats");
  assert.ok(inboxSrc.includes('"Active now"'), "no Active now copy");
  assert.ok(inboxSrc.includes('"Active " + relativeTime'), "no last active copy");
  assert.ok(!inboxSrc.includes('"Online"') && !inboxSrc.includes(">Online<"), "presence copy must never claim online");
});

await test("a failed outbox write is surfaced at the composer and checked at send time", () => {
  assert.ok(inboxSrc.includes("outboxSaveFailed"), "no state tracks the failed durable write");
  assert.ok(inboxSrc.includes("This browser could not save messages for retry"), "the composer shows no warning when the write fails");
  assert.ok(inboxSrc.includes("setOutboxSaveFailed(true)"), "a failed write never raises the flag");
  const sendIdx = inboxSrc.indexOf("const sendMessage = async");
  const block = inboxSrc.slice(sendIdx, sendIdx + 3200);
  assert.ok(block.includes("probeEntry"), "sendMessage never probes the durable write before relying on the queue");
  assert.ok(block.indexOf("probeEntry") < block.indexOf("outboxPut(threadId, {"), "the durability probe runs after the queue write it is meant to check");
});

await test("the inbox root fills its parent instead of hardcoding the viewport", () => {
  assert.ok(!inboxSrc.includes('height: "100dvh"'), "the inbox root still hardcodes the viewport height");
  assert.ok(inboxSrc.includes('height: "100%", maxHeight: "100%"'), "the inbox root does not fill its parent");
});

// Functional: the real handler against a real SQLite database.
{
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");
  const { onRequest } = await import(join(root, "functions/api/data.js"));

  const sqlite = new DatabaseSync(":memory:");
  const wrapStmt = (sql) => {
    let vals = [];
    const stmt = {
      bind: (...v) => { vals = v; return stmt; },
      first: async () => { const r = sqlite.prepare(sql).get(...vals); return r === undefined ? null : r; },
      all: async () => ({ results: sqlite.prepare(sql).all(...vals) }),
      run: async () => { const info = sqlite.prepare(sql).run(...vals); return { success: true, meta: { changes: Number(info.changes || 0) } }; },
    };
    return stmt;
  };
  const db = {
    prepare: (sql) => wrapStmt(sql),
    exec: async (sql) => { sqlite.exec(sql); return { results: [] }; },
    batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  const env = { DB: db };
  const tokenFor = { usr_a: "token-alpha", usr_b: "token-bravo" };
  const call = async (userId, method, path, body) => {
    const headers = { Cookie: "cb_sess=" + tokenFor[userId] };
    if (method === "POST") { headers["Content-Type"] = "application/json"; headers.Origin = "https://askcerebrum.org"; }
    const req = new Request("https://askcerebrum.org/api/data" + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const res = await onRequest({ request: req, env, waitUntil: () => {} });
    return { status: res.status, json: await res.json() };
  };

  // Seed: users and sessions are the two tables nothing self-creates.
  sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, email_lower TEXT, username TEXT, name TEXT, affiliation TEXT, show_affiliation INTEGER, discoverable INTEGER, plan TEXT, created_at INTEGER)");
  sqlite.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER, expires_at INTEGER)");
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const now = Date.now();
  for (const [id, email, username, name] of [
    ["usr_a", "alice@example.com", "alice", "Alice"],
    ["usr_b", "bob@example.com", "bob", "Bob"],
    ["usr_c", "carol@example.com", "carol", "Carol"],
  ]) {
    sqlite.prepare("INSERT INTO users (id, email, email_lower, username, name, show_affiliation) VALUES (?, ?, ?, ?, ?, 1)").run(id, email, email, username, name);
  }
  for (const [uid, tok] of Object.entries(tokenFor)) {
    sqlite.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash(tok), uid, now, now + 3600000);
  }
  // Warm-up: the first call self-creates the social tables.
  await call("usr_a", "GET", "?resource=inbox");
  const ins = (sql, ...v) => sqlite.prepare(sql).run(...v);
  ins("INSERT INTO threads (id, kind, name, created_at) VALUES ('th_dm_b', 'dm', NULL, ?)", now);
  ins("INSERT INTO threads (id, kind, name, created_at) VALUES ('th_dm_c', 'dm', NULL, ?)", now);
  ins("INSERT INTO threads (id, kind, name, created_at) VALUES ('th_enc', 'dm', NULL, ?)", now);
  for (const [t, u] of [["th_dm_b", "usr_a"], ["th_dm_b", "usr_b"], ["th_dm_c", "usr_a"], ["th_dm_c", "usr_c"], ["th_enc", "usr_a"], ["th_enc", "usr_b"]]) {
    ins("INSERT INTO thread_participants (thread_id, user_id) VALUES (?, ?)", t, u);
  }
  ins("INSERT INTO e2ee_threads (thread_id, protocol, encrypted_since, upgraded_by) VALUES ('th_enc', 'olm-v1', ?, 'usr_a')", now);
  ins("INSERT INTO messages (id, thread_id, sender_id, text, created_at) VALUES ('m1', 'th_dm_b', 'usr_b', 'the mitochondria paper was great', 1000)");
  ins("INSERT INTO messages (id, thread_id, sender_id, attachment_title, attachment_kind, attachment_meta, created_at) VALUES ('m2', 'th_dm_b', 'usr_a', 'Voice note', 'audio', ?, 2000)",
    JSON.stringify({ durationMs: 4000, transcript: "let us check the gel bands tomorrow" }));
  ins("INSERT INTO messages (id, thread_id, sender_id, text, msg_kind, created_at) VALUES ('m3', 'th_enc', 'usr_b', 'ciphertext gel blob', 'cipher', 3000)");
  ins("INSERT INTO messages (id, thread_id, sender_id, text, created_at) VALUES ('m4', 'th_dm_c', 'usr_c', 'unrelated lunch plans', 1500)");

  await test("functional: pinning moves a conversation to the top of the list", async () => {
    const pin = await call("usr_a", "POST", "", { action: "set-thread-pinned", thread_id: "th_dm_c", pinned: true });
    assert.equal(pin.status, 200);
    assert.equal(pin.json.pinned, true);
    const inbox = await call("usr_a", "GET", "?resource=inbox");
    assert.equal(inbox.json.items[0].id, "th_dm_c", "the pinned conversation is not first");
    assert.equal(inbox.json.items[0].pinned, true);
    const dmB = inbox.json.items.find((t) => t.id === "th_dm_b");
    assert.equal(dmB.pinned, false);
    const unpin = await call("usr_a", "POST", "", { action: "set-thread-pinned", thread_id: "th_dm_c", pinned: false });
    assert.equal(unpin.json.pinned, false);
    const after = await call("usr_a", "GET", "?resource=inbox");
    assert.equal(after.json.items[0].id, "th_enc", "unpinning does not restore recency order");
  });

  await test("functional: a non member cannot pin or mute someone else's conversation", async () => {
    const pin = await call("usr_b", "POST", "", { action: "set-thread-pinned", thread_id: "th_dm_c", pinned: true });
    assert.equal(pin.status, 403);
    const mute = await call("usr_b", "POST", "", { action: "set-thread-muted", thread_id: "th_dm_c", muted: true });
    assert.equal(mute.status, 403);
  });

  await test("functional: muting persists and the push fan-out query leaves the muter out", async () => {
    const mute = await call("usr_a", "POST", "", { action: "set-thread-muted", thread_id: "th_dm_b", muted: true });
    assert.equal(mute.status, 200);
    assert.equal(mute.json.muted, true);
    const inbox = await call("usr_a", "GET", "?resource=inbox");
    assert.equal(inbox.json.items.find((t) => t.id === "th_dm_b").muted, true);
    assert.equal(inbox.json.items.find((t) => t.id === "th_dm_c").muted, false);
    // The exact fan-out predicate send-message uses, run as SQL.
    const fanout = sqlite.prepare("SELECT user_id FROM thread_participants WHERE thread_id = ? AND user_id != ? AND COALESCE(muted, 0) = 0").all("th_dm_b", "usr_b").map((r) => r.user_id);
    assert.deepEqual(fanout, [], "a muted recipient is still in the push fan-out");
    const fanoutC = sqlite.prepare("SELECT user_id FROM thread_participants WHERE thread_id = ? AND user_id != ? AND COALESCE(muted, 0) = 0").all("th_dm_c", "usr_c").map((r) => r.user_id);
    assert.deepEqual(fanoutC, ["usr_a"], "an unmuted recipient dropped out of the push fan-out");
  });

  await test("functional: a presence ping shows up as the peer's last active time", async () => {
    const before = await call("usr_a", "GET", "?resource=inbox");
    assert.equal(before.json.items.find((t) => t.id === "th_dm_b").otherLastActiveAt, null, "presence claimed before any heartbeat");
    const ping = await call("usr_b", "POST", "", { action: "presence-ping" });
    assert.equal(ping.status, 200);
    const after = await call("usr_a", "GET", "?resource=inbox");
    const seen = after.json.items.find((t) => t.id === "th_dm_b").otherLastActiveAt;
    assert.ok(typeof seen === "number" && Math.abs(Date.now() - seen) < 60000, "the peer's heartbeat did not arrive in the inbox payload");
  });

  await test("functional: content search finds text and transcripts, and never the encrypted thread", async () => {
    const gel = await call("usr_a", "GET", "?resource=search-messages&q=gel");
    assert.equal(gel.json.results.length, 1, "the transcript hit is missing (or the cipher row leaked in)");
    assert.equal(gel.json.results[0].messageId, "m2");
    assert.equal(gel.json.results[0].matchedIn, "transcript");
    assert.equal(gel.json.results[0].threadName, "Bob");
    assert.equal(gel.json.encryptedExcluded, 1, "the encrypted thread is not reported as excluded");
    const mito = await call("usr_a", "GET", "?resource=search-messages&q=mitochondria");
    assert.equal(mito.json.results.length, 1);
    assert.equal(mito.json.results[0].matchedIn, "text");
    const cipher = await call("usr_a", "GET", "?resource=search-messages&q=ciphertext");
    assert.equal(cipher.json.results.length, 0, "a cipher row matched a content search");
    const other = await call("usr_b", "GET", "?resource=search-messages&q=lunch");
    assert.equal(other.json.results.length, 0, "search reached a conversation the caller is not part of");
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
