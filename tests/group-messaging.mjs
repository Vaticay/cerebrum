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

// ── Backend: group member management ────────────────────────────────────

await test("add-group-members action exists", async () => {
  srcHas(dataJs, 'action === "add-group-members"', "add-group-members action");
});

await test("add-group-members guards on kind='group' and membership", async () => {
  const idx = dataJs.indexOf('action === "add-group-members"');
  const block = dataJs.slice(idx, idx + 5000);
  srcHas(block, "not_group", "kind='group' guard");
  srcHas(block, "not_member", "caller-membership guard");
});

await test("add-group-members validates invitees like creation", async () => {
  const idx = dataJs.indexOf('action === "add-group-members"');
  const block = dataJs.slice(idx, idx + 5000);
  srcHas(block, "not_available", "discoverable check");
  srcHas(block, "isBlockedPair(env, user.id, mid)", "block check against the adder");
  srcHas(block, "already_member", "already-a-member rejection");
});

await test("add-group-members enforces the 50-person cap", async () => {
  const idx = dataJs.indexOf('action === "add-group-members"');
  const block = dataJs.slice(idx, idx + 5000);
  srcHas(block, "> 50", "50-person cap check");
  srcHas(block, "too_many_members", "too_many_members error code");
});

await test("remove-group-member action exists", async () => {
  srcHas(dataJs, 'action === "remove-group-member"', "remove-group-member action");
});

await test("remove-group-member guards on kind='group' and membership", async () => {
  const idx = dataJs.indexOf('action === "remove-group-member"');
  const block = dataJs.slice(idx, idx + 4000);
  srcHas(block, "not_group", "kind='group' guard");
  srcHas(block, "not_member", "caller-membership guard");
  srcHas(block, "target_not_member", "target membership check");
});

await test("remove-group-member supports leave (no member_id defaults to caller)", async () => {
  const idx = dataJs.indexOf('action === "remove-group-member"');
  const block = dataJs.slice(idx, idx + 4000);
  srcHas(block, "safeId(body.member_id) || user.id", "self default for leave");
  srcHas(block, "left:", "left flag in response");
});

await test("rename-group action exists with 80-char cap", async () => {
  srcHas(dataJs, 'action === "rename-group"', "rename-group action");
  const idx = dataJs.indexOf('action === "rename-group"');
  const block = dataJs.slice(idx, idx + 3000);
  srcHas(block, "slice(0, 80)", "80-char rename cap");
  srcHas(block, "missing_name", "empty name rejected");
  srcHas(block, "not_member", "caller-membership guard");
  srcHas(block, "UPDATE threads SET name", "rename write");
});

// ── Frontend: group info panel ──────────────────────────────────────────

await test("group name/member count opens the info panel", async () => {
  srcHas(uiSrc, "openGroupInfo", "openGroupInfo handler");
  srcHas(uiSrc, "aria-label={`Group info for", "group header button");
});

await test("group info panel state exists", async () => {
  srcHas(uiSrc, "groupInfoOpen", "group info panel state");
  srcHas(uiSrc, 'label="Group info"', "group info modal chrome");
});

await test("group info panel lists members with remove buttons", async () => {
  srcHas(uiSrc, "removeGroupMember", "remove handler");
  srcHas(uiSrc, "aria-label={`Remove ${m.name || m.username}`}", "remove button label");
});

await test("group info panel has Add people search", async () => {
  srcHas(uiSrc, "ADD PEOPLE", "add people section");
  srcHas(uiSrc, "addGroupMembers", "add handler");
});

await test("group info panel has rename field", async () => {
  srcHas(uiSrc, "renameGroup", "rename handler");
  srcHas(uiSrc, "GROUP NAME", "rename section");
});

await test("group info panel has leave button", async () => {
  srcHas(uiSrc, "leaveGroup", "leave handler");
  srcHas(uiSrc, "Leave group", "leave button text");
});

await test("group info panel keeps the honest disclaimer", async () => {
  srcHas(uiSrc, "There are no admins — any member can rename the group or remove people", "no-admins honesty line");
  srcHas(uiSrc, "Group messages aren't end-to-end encrypted yet", "plaintext disclaimer in panel");
});

await test("thread list and header refresh after roster changes", async () => {
  srcHas(uiSrc, "refreshGroupThread", "thread refetch after roster edit");
});

// ── Background-tab notifications ────────────────────────────────────────

await test("inbox poll notifies on new messages", async () => {
  srcHas(uiSrc, "cb-inbox-", "inbox notification tag");
  srcHas(uiSrc, "Background-tab notifications", "background notification comment");
});

// ── Group read receipts ─────────────────────────────────────────────────

await test("backend exposes lastReadAt per group member", async () => {
  srcHas(dataJs, "lastReadAt: toEpochMs(p.last_read_at)", "member lastReadAt in response");
});

await test("frontend computes group seen count", async () => {
  srcHas(uiSrc, "groupSeenCount", "group seen count variable");
  srcHas(uiSrc, 'Seen by ${groupSeenCount}', "seen-by label");
});

await test("group seen shows names on hover", async () => {
  srcHas(uiSrc, "groupSeenNames", "seen names for tooltip");
});

// ── Summary ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
