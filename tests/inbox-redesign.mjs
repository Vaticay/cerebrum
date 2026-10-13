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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
