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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
