/**
 * Account lane regression tests (2026-11-06 site wide debug).
 *
 * Defect 1: account deletion did not delete everything the Privacy
 * page promises. The delete handler purged 17 tables while the
 * Private Vault, the e2ee key material, push subscriptions, the Pro
 * usage ledger, student verifications, answer votes, and more stayed
 * in D1 keyed to a user id that no longer existed. This suite
 * enumerates EVERY user keyed table from schema.sql plus every table
 * created in code (functions/**), and asserts the delete path deals
 * with each one: its rows deleted by one of its user key columns, or
 * every user key column on it anonymised, or a named exemption below.
 * A future table that keys rows to a user fails this suite until the
 * delete path handles it. That is the point.
 *
 * Defect 2: the server sends aiQuota.gated "lite-cap" when a Lite
 * member exhausts 500 AI answers; the answer renderer branched only
 * on "free-cap" and "signin-required", so Lite exhaustion rendered
 * silence. The client must render a branch for every gated value the
 * server can emit, and the Lite branch must carry the count, the
 * refill, and the way forward.
 *
 * Defect 3: the Plan page's "Switch to Free" button opened the Pro
 * modal, which has no downgrade action, and lifetime members dead
 * ended. The Free column must now be truthful per member state:
 * lifetime gets no action, a subscription member gets the billing
 * portal route, and the lying label is gone.
 *
 * Run with: node tests/account-delete-coverage.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function group(name) {
  console.log(`\n${name}`);
}

// ══════════════════════════════════════════════════════════════════
group("Defect 1 — every user keyed table is dealt with at delete-account");

// Columns that tie a row to a person. A table carrying any of these is
// user keyed and the delete path owes it an answer.
const USER_KEY_COLUMNS = [
  "user_id", "sender_id", "follower_id", "following_id",
  "blocker_id", "blocked_id", "reporter_id", "reported_user_id",
  "upgraded_by", "created_by", "granted_by", "email", "email_lower",
];

// The only two user keyed tables the delete path may leave standing,
// each with its reason. Anything else must be deleted or anonymised.
const EXEMPTIONS = {
  // The account row itself: the handler's final statement removes it,
  // asserted separately below.
  users: "the account row, deleted by the handler's final DELETE FROM users",
  // bumpSessionEpoch writes this row DURING deletion, on purpose: it
  // is the tombstone that refuses the deleted account's outstanding
  // JWTs. It holds only the id, an epoch counter, and a timestamp.
  session_epochs: "the deletion tombstone, written by the delete path itself",
};

const tables = new Map(); // name -> Set(columns)
function noteTable(name, cols) {
  if (!tables.has(name)) tables.set(name, new Set());
  for (const c of cols) tables.get(name).add(c);
}

function columnsOf(body) {
  const cols = [];
  let depth = 0, cur = "";
  const segs = [];
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { segs.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  for (const s of segs) {
    const m = s.trim().match(/^"?(\w+)"?/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

function parseDdl(text) {
  const m = text.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1, body = "";
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    if (ch === ")") { depth--; if (depth === 0) break; }
    body += ch;
  }
  return { name: m[1], cols: columnsOf(body) };
}

// schema.sql — the canonical shapes.
const schema = readFileSync(join(root, "schema.sql"), "utf8");
for (const m of schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+\w+\s*\(/g)) {
  const r = parseDdl(schema.slice(m.index));
  if (r) noteTable(r.name, r.cols);
}

// Code created tables — DDL lives in string literals, often built by
// + concatenation across lines. Extract every literal, regroup the
// concatenation chains, and parse any chain carrying a CREATE TABLE.
function literalsOf(src) {
  const lits = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch, start = i;
      i++;
      let content = "";
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { content += src[i + 1] || ""; i += 2; continue; }
        if (q !== "`" && src[i] === "\n") break;
        content += src[i]; i++;
      }
      i++;
      lits.push({ start, end: i, content });
      continue;
    }
    i++;
  }
  return lits;
}

function walkJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkJs(p));
    else if (e.endsWith(".js")) out.push(p);
  }
  return out;
}

for (const file of walkJs(join(root, "functions"))) {
  const src = readFileSync(file, "utf8");
  const lits = literalsOf(src);
  const chains = [];
  let cur = null;
  for (const lit of lits) {
    if (cur) {
      const between = src.slice(cur.end, lit.start);
      if (/^\s*(\+\s*)?$/.test(between)) { cur.parts.push(lit.content); cur.end = lit.end; continue; }
      chains.push(cur); cur = null;
    }
    cur = { parts: [lit.content], end: lit.end };
  }
  if (cur) chains.push(cur);
  for (const c of chains) {
    const joined = c.parts.join("");
    if (!/CREATE TABLE/.test(joined)) continue;
    const r = parseDdl(joined);
    assert(r, `unparseable CREATE TABLE chain in ${file}: ${joined.slice(0, 80)}`);
    noteTable(r.name, r.cols);
  }
}

const userKeyed = new Map();
for (const [name, cols] of tables) {
  const keys = [...cols].filter((c) => USER_KEY_COLUMNS.includes(c));
  if (keys.length) userKeyed.set(name, keys);
}

// What the delete path actually does. The block runs from the
// delete-account branch to the unknown action fallthrough.
const authSrc = readFileSync(join(root, "functions/api/auth.js"), "utf8");
const blockStart = authSrc.indexOf('if (action === "delete-account")');
const blockEnd = authSrc.indexOf('return json({ error: "Unknown action."', blockStart);
assert(blockStart > 0 && blockEnd > blockStart, "delete-account block not found in auth.js");
const block = authSrc.slice(blockStart, blockEnd);

const deletedBy = new Map(); // table -> Set(columns its rows are deleted by)
for (const m of block.matchAll(/DELETE FROM (\w+) WHERE (\w+) = \?/g)) {
  if (!deletedBy.has(m[1])) deletedBy.set(m[1], new Set());
  deletedBy.get(m[1]).add(m[2]);
}
const anonymised = new Map(); // table -> Set(user columns blanked)
for (const m of block.matchAll(/UPDATE (\w+) SET (\w+) = (?:NULL|'') WHERE (\w+) = \?/g)) {
  if (!USER_KEY_COLUMNS.includes(m[2])) continue;
  if (!anonymised.has(m[1])) anonymised.set(m[1], new Set());
  anonymised.get(m[1]).add(m[2]);
}

await test("enumeration finds the stores the 2026-11-06 audit caught standing", () => {
  for (const t of ["zk_data_vault", "zk_saved_items", "e2ee_devices",
    "e2ee_one_time_prekeys", "e2ee_backups", "push_subscriptions",
    "pro_usage", "student_verifications", "answer_votes"]) {
    assert(userKeyed.has(t), `${t} missing from the user keyed enumeration`);
  }
  assert(userKeyed.size >= 30, `suspiciously few user keyed tables enumerated: ${userKeyed.size}`);
});

await test("every user keyed table is deleted, anonymised, or exempt", () => {
  const missing = [];
  for (const [name, keys] of userKeyed) {
    if (name in EXEMPTIONS) continue;
    const del = deletedBy.get(name) || new Set();
    if (keys.some((k) => del.has(k))) continue; // rows gone by a user key
    const anon = anonymised.get(name) || new Set();
    if (keys.every((k) => anon.has(k))) continue; // rows stay, person blanked
    missing.push(`${name} (keyed by ${keys.join(", ")})`);
  }
  assert.deepEqual(missing, [], `delete-account leaves these user keyed tables standing: ${missing.join("; ")}`);
});

await test("exemptions are exactly the two named, and their mechanisms are present", () => {
  assert.deepEqual(Object.keys(EXEMPTIONS).sort(), ["session_epochs", "users"]);
  assert.match(block, /DELETE FROM users WHERE id = \?/, "the account row itself must be deleted");
  assert.match(block, /bumpSessionEpoch\(env, uid, \{ tombstone: true \}\)/, "the session tombstone write must stay in the delete path");
});

await test("every table the delete path touches actually exists", () => {
  const touched = new Set();
  for (const m of block.matchAll(/DELETE FROM (\w+)/g)) touched.add(m[1]);
  for (const m of block.matchAll(/UPDATE (\w+) SET/g)) touched.add(m[1]);
  for (const t of touched) {
    assert(tables.has(t), `delete path touches unknown table "${t}" — a misspelled purge fails silently inside its try/catch`);
  }
});

await test("api_key_usage is cleared before the keys it belongs to", () => {
  const usageIdx = block.indexOf("DELETE FROM api_key_usage");
  const keysIdx = block.indexOf("DELETE FROM api_keys WHERE");
  assert(usageIdx > 0 && keysIdx > usageIdx, "api_key_usage rows must be deleted (by key subquery) before api_keys rows go");
});

// ══════════════════════════════════════════════════════════════════
group("Defect 2 — the Lite cap renders a reason and a way forward");

const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");

await test("the renderer handles every gated value the server can emit", () => {
  const emitted = new Set([...searchSrc.matchAll(/"(signin-required|free-cap|lite-cap)"/g)].map((m) => m[1]));
  const handled = new Set([...appSrc.matchAll(/gated === "([\w-]+)"/g)].map((m) => m[1]));
  assert(emitted.has("lite-cap"), "server no longer emits lite-cap; update this suite with the gate");
  for (const g of emitted) assert(handled.has(g), `server can send gated "${g}" but the answer renderer has no branch for it`);
});

await test("the lite-cap branch carries the Lite count, the refill, and Go Pro", () => {
  const reasonDef = appSrc.match(/const liteQuotaReason = [\s\S]*?;\n/);
  assert(reasonDef, "liteQuotaReason is not defined");
  assert.match(reasonDef[0], /t\.aiQuota\.used/, "Lite reason must show the used count from the payload");
  assert.match(reasonDef[0], /t\.aiQuota\.cap/, "Lite reason must show the cap from the payload (500)");
  assert.match(reasonDef[0], /quotaRefillSentence\(\)/, "Lite reason must say when the allowance refills");
  assert.match(reasonDef[0], /Lite plan/, "Lite reason must name the member's own plan");
  assert(!/[—–]/.test(reasonDef[0]), "no dash characters in the Lite reason copy");
  const branchIdx = appSrc.indexOf('gated === "lite-cap"');
  assert(branchIdx > 0, "no lite-cap branch in the answer renderer");
  const branch = appSrc.slice(branchIdx, branchIdx + 1600);
  assert.match(branch, /liteQuotaReason/, "lite-cap branch must render the Lite reason");
  assert.match(branch, /cb:open-pro/, "lite-cap branch must offer the way forward (the Pro modal)");
  assert.match(branch, /Go Pro/, "lite-cap branch must carry the Go Pro action");
});

// ══════════════════════════════════════════════════════════════════
group("Defect 3 — the Plan page Free column tells the truth");

const usageStart = appSrc.indexOf("function UsageView(");
assert(usageStart > 0, "UsageView not found");
const usageEnd = appSrc.indexOf("\nfunction ", usageStart + 10);
const usageSrc = appSrc.slice(usageStart, usageEnd > 0 ? usageEnd : usageStart + 40000);

await test("the lying label is gone from the whole app", () => {
  assert(!appSrc.includes("Switch to Free"), '"Switch to Free" still promises a switch that does not exist');
});

await test("lifetime members are offered no switch action", () => {
  assert.match(usageSrc, /id === "free"/, "UsageView must handle the Free column for paid members");
  assert.match(usageSrc, /proSource === "lifetime"/, "the Free column must recognise lifetime members");
  assert.match(usageSrc, /nothing to switch/, "lifetime members must be told there is nothing to switch, not handed a button");
});

await test("subscription members are wired to the real billing portal route", () => {
  assert.match(usageSrc, /apiProPost\("create-portal", \{\}\)/, "the Free column must call the existing create-portal endpoint");
  assert.match(usageSrc, /"Manage plan"/, "the Free column action must be labelled for what it does");
  assert.match(usageSrc, /hasBilling/, "the portal route must only be offered when a billing account exists");
});

// ══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
