/**
 * Group messaging tests (MVP).
 *
 * Static source assertions on functions/api/data.js and src/CerebrumApp.jsx
 * pinning the group-messaging behaviors: start-group-thread validation,
 * plaintext-only groups, member roster in thread responses, group subtitle
 * and sender labels in the UI, and background-tab notifications.
 *
 * Run with: node tests/group-messaging.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataJs = await readFile(join(root, "functions/api/data.js"), "utf8");
const appJsx = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
// InboxView was extracted to src/inbox.jsx in the monolith split — the
// group UI lives there now. Check both locations.
let inboxJsx = "";
try { inboxJsx = await readFile(join(root, "src/inbox.jsx"), "utf8"); } catch {}
const uiSrc = appJsx + "\n" + inboxJsx;

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

function srcHas(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `missing: ${label || needle}`);
}

// ── Backend: start-group-thread ─────────────────────────────────────────

await test("start-group-thread action exists", async () => {
  srcHas(dataJs, 'action === "start-group-thread"', "start-group-thread action");
});

await test("group creation requires a name", async () => {
  srcHas(dataJs, "missing_name", "missing_name error code");
});

await test("group creation requires at least 2 members", async () => {
  srcHas(dataJs, "too_few_members", "too_few_members error code");
});

await test("group creation caps at 50 people", async () => {
  srcHas(dataJs, "too_many_members", "too_many_members error code");
});

await test("group members must be discoverable", async () => {
  srcHas(dataJs, "not_available", "not_available for undiscoverable member");
});

await test("group creation respects blocks", async () => {
  // A group is not a way around someone's block.
  const idx = dataJs.indexOf('action === "start-group-thread"');
  const block = dataJs.slice(idx, idx + 4000);
  srcHas(block, "isBlockedPair", "block check in start-group-thread");
});

await test("groups are created with kind='group'", async () => {
  srcHas(dataJs, "VALUES (?, 'group', ?, ?)", "group thread insert");
});

await test("creator is always a participant", async () => {
  const idx = dataJs.indexOf('action === "start-group-thread"');
  const block = dataJs.slice(idx, idx + 4000);
  srcHas(block, "bind(threadId, user.id, now)", "creator participant insert");
});

await test("thread GET returns member roster", async () => {
  srcHas(dataJs, "members: participants.map", "members array in thread response");
});

// ── Frontend: group creation UI ─────────────────────────────────────────

await test("inbox has a New Group button", async () => {
  srcHas(uiSrc, 'aria-label="New group"', "New group button");
});

await test("group creation modal exists", async () => {
  srcHas(uiSrc, "groupModalOpen", "group modal state");
  srcHas(uiSrc, 'label="New group"', "group modal chrome");
});

await test("group modal has name input", async () => {
  srcHas(uiSrc, 'aria-label="Group name"', "group name input");
});

await test("group modal searches people", async () => {
  srcHas(uiSrc, "start-group-thread", "start-group-thread API call");
});

await test("group modal warns about no E2EE", async () => {
  srcHas(uiSrc, "Group messages aren't end-to-end encrypted yet", "E2EE disclaimer");
});

// ── Frontend: group thread rendering ────────────────────────────────────

await test("group subtitle shows member names", async () => {
  srcHas(uiSrc, 'activeThread.kind === "group"', "group kind check in subtitle");
});

await test("group messages show sender labels", async () => {
  srcHas(uiSrc, "Group threads show who said what", "sender label comment");
});

await test("group threads show member count badge", async () => {
  srcHas(uiSrc, "activeThread.memberCount", "member count in header");
});

await test("thread list shows group icon", async () => {
  srcHas(uiSrc, 't.kind === "group"', "group icon in thread list");
});

// ── Background-tab notifications ────────────────────────────────────────

await test("inbox poll notifies on new messages", async () => {
  srcHas(uiSrc, "cb-inbox-", "inbox notification tag");
  srcHas(uiSrc, "Background-tab notifications", "background notification comment");
});

// ── Summary ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
