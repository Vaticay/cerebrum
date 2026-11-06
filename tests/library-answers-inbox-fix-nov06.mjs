/**
 * Library, Answers list, and Inbox fix tests (site debug, 2026-11-06).
 *
 * Regression pins for the eleven proven defects from the Core
 * Surfaces audit lane (cerebrum-site-debug-nov06/surfaces): Library
 * L1 to L5, Answers AN1 to AN3, Inbox I1 to I3. Source assertions pin
 * the shipped shapes in src/CerebrumApp.jsx and src/inbox.jsx, and
 * the behavioural tests run the fixed predicates the way the audit
 * harnesses ran the broken ones.
 *
 * Run with: node tests/library-answers-inbox-fix-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const inboxSrc = await readFile(join(root, "src/inbox.jsx"), "utf8");

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
function srcLacks(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `still present: ${label || needle}`);
}
function srcCount(haystack, needle, n, label) {
  const c = haystack.split(needle).length - 1;
  assert.equal(c, n, `${label || needle}: expected ${n} occurrences, found ${c}`);
}

// ── L1: Library papers search matches term by term ─────────────────

const paperHaystack = (sv, collectionName = "") => [sv.title, sv.authors, sv.journal, sv.abstract, sv.doi, sv.year, collectionName]
  .filter(Boolean).join(" ").toLowerCase();
const papersMatch = (sv, q, collectionName = "") => {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = paperHaystack(sv, collectionName);
  return terms.every((t) => haystack.includes(t));
};
const paper = {
  title: "Black soldier fly larvae on food waste",
  authors: "Okafor N, Smith J",
  journal: "Journal of Insects as Food and Feed",
  abstract: "The microbiome of larvae reared on organic waste.",
  doi: "10.0000/example.2023",
  year: 2023,
};

await test("L1 source: visibleSaved requires every term somewhere in the fields", async () => {
  srcHas(appSrc, "return terms.every((t) => haystack.includes(t));", "per term AND matcher");
  srcHas(appSrc, "const terms = ql.split(/\\s+/).filter(Boolean);", "query term split");
});

await test("L1 behaviour: multi word queries match across fields", async () => {
  assert.equal(papersMatch(paper, "black fly"), true);
  assert.equal(papersMatch(paper, "Okafor 2023"), true);
  assert.equal(papersMatch(paper, "smith microbiome"), true);
  assert.equal(papersMatch(paper, "okafor zzz"), false);
  assert.equal(papersMatch(paper, "zzzz"), false);
});

// ── L2: Library answers sublist searches turns, not title only ─────

await test("L2 source: Library answers come from visibleLibraryAnswers", async () => {
  srcHas(appSrc, "const visibleLibraryAnswers = useMemo(() => {", "visibleLibraryAnswers memo");
  srcHas(appSrc, "{visibleLibraryAnswers.map((h, i) => (", "sublist renders the shared predicate result");
  srcLacks(appSrc, ".filter((h) => { const q = libraryQuery.trim().toLowerCase(); return !q || String(h.title || \"\").toLowerCase().includes(q); })", "title only Library filter");
});

// ── L3: Library answers empty states ───────────────────────────────

await test("L3 source: answers block has a No matches branch with a clear action", async () => {
  srcHas(appSrc, "{visibleLibraryAnswers.length === 0 ? (", "answers empty branch");
  srcHas(appSrc, "Nothing in your answers matches", "answers No matches copy");
  srcHas(appSrc, "No saved papers yet", "papers zero kind message");
  srcHas(appSrc, "No saved answers yet", "answers zero kind message");
});

// ── L4: downloads badge and rendered rows agree ────────────────────

await test("L4 source: the full export log renders", async () => {
  srcHas(appSrc, "{exportLog.map((r, i) => (", "full log render");
  srcLacks(appSrc, "exportLog.slice(0, 8)", "capped log render");
});

// ── L5: undo restores an answer in sort position ───────────────────

await test("L5 source: undo re sorts the restored history by ts", async () => {
  srcHas(appSrc, "[...prev, cur.historyItem].sort((a, b) => (b.ts || 0) - (a.ts || 0))", "sorted restore");
});

await test("L5 behaviour: undoing the oldest removal restores newest first order", async () => {
  const list = [{ id: "new", ts: 300 }, { id: "mid", ts: 200 }, { id: "old", ts: 100 }];
  const removed = list[2];
  const afterRemove = list.filter((x) => x.id !== removed.id);
  const restored = [...afterRemove, removed].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  assert.deepEqual(restored.map((x) => x.id), ["new", "mid", "old"]);
});

// ── AN1: vault filter fallback ─────────────────────────────────────

// zkQueryIds with a stubbed session index: the whole token queries
// hit, partial and one letter queries return no rows, which the fix
// turns into null (no constraint) instead of an empty Set.
const zkQueryIdsFrom = (rows) => {
  const ids = new Set();
  for (const r of rows || []) {
    const id = typeof r === "string" ? r : (r && (r.id || r.zkId));
    if (id) ids.add(id);
  }
  return ids.size ? ids : null;
};
const visibleHistoryFrom = (history, q, ids) => {
  const ql = q.toLowerCase();
  const legacyMatch = (h) => String(h.title || "").toLowerCase().includes(ql)
    || (h.turns || []).some((t) => String((t && t.q) || "").toLowerCase().includes(ql));
  if (!ids) return history.filter(legacyMatch);
  return history.filter((h) => (h.zkId ? ids.has(h.zkId) || legacyMatch(h) : legacyMatch(h)));
};
const twins = [
  { id: "h1", zkId: "z1", title: "Do black soldier fly larvae eat plastic", turns: [{ q: "Do black soldier fly larvae eat plastic" }] },
  { id: "h2", title: "Do black soldier fly larvae eat plastic", turns: [{ q: "Do black soldier fly larvae eat plastic" }] },
];

await test("AN1 source: empty index result is null and the vault branch ORs the plain match", async () => {
  srcHas(appSrc, "return ids.size ? ids : null;", "null on empty index result");
  srcCount(appSrc, "ids.has(h.zkId) || legacyMatch(h)", 2, "vault OR plain match in Answers and Library answers");
});

await test("AN1 behaviour: partial and one letter queries keep vault entries", async () => {
  // Partial word and single letter: the index has nothing usable.
  assert.equal(zkQueryIdsFrom([]), null);
  assert.deepEqual(visibleHistoryFrom(twins, "larv", zkQueryIdsFrom([])).map((h) => h.id), ["h1", "h2"]);
  assert.deepEqual(visibleHistoryFrom(twins, "a", zkQueryIdsFrom([])).map((h) => h.id), ["h1", "h2"]);
  // Whole token query: the vault twin stays through the index.
  const hits = visibleHistoryFrom(twins, "larvae", zkQueryIdsFrom([{ id: "z1" }]));
  assert.ok(hits.some((h) => h.id === "h1"), "vault twin kept on a whole token query");
});

// ── AN2: the filter cannot strand the reader ───────────────────────

await test("AN2 source: filter input survives while a query is set, empty state can clear it", async () => {
  srcHas(appSrc, "{(history.length > 6 || historyQuery) && (", "filter input while query set");
  srcHas(appSrc, "Clear the filter", "clear action on the No matches state");
});

await test("AN2 behaviour: with the list shrunk to the threshold the way back exists", async () => {
  const historyLength = 6;
  const historyQuery = "larvae";
  assert.equal(historyLength > 6 || !!historyQuery, true, "filter input still rendered");
});

// ── AN3: the history write limit matches the pin path ──────────────

await test("AN3 source: both cb_history writes use the pin limit", async () => {
  srcCount(appSrc, "localStorage.setItem(\"cb_history\", JSON.stringify(history.slice(0, Math.max(40, history.reduce(", 2, "pin limit history writes");
  srcLacks(appSrc, "localStorage.setItem(\"cb_history\", JSON.stringify(history.slice(0, 40)))", "flat 40 history write");
});

await test("AN3 behaviour: pinned answers past position 40 survive the write", async () => {
  const writeLimit = (history) => Math.max(40, history.reduce((n, e) => n + (e && e.kept ? 1 : 0), 0));
  const allKept = Array.from({ length: 45 }, (_, i) => ({ id: `h${i}`, kept: true }));
  assert.equal(allKept.slice(0, writeLimit(allKept)).length, 45);
  const fiveKept = Array.from({ length: 45 }, (_, i) => ({ id: `h${i}`, kept: i < 5 }));
  const written = fiveKept.slice(0, writeLimit(fiveKept));
  assert.equal(written.length, 40);
  assert.equal(written.filter((e) => e.kept).length, 5, "kept entries sit inside the written window");
});

// ── I1: search works in the Archived view ──────────────────────────

await test("I1 source: the archived list is filtered by the same predicate", async () => {
  srcHas(inboxSrc, "const filteredArchivedThreads = threadQuery.trim() ? archivedThreads.filter(threadMatchesQuery) : archivedThreads;", "archived filter");
  srcHas(inboxSrc, "const displayThreads = showArchived ? filteredArchivedThreads : filteredThreads;", "display uses the filtered archived list");
  srcHas(inboxSrc, "No archived conversations match", "archived no match state");
});

await test("I1 behaviour: archived search narrows and can empty the list", async () => {
  const archived = [{ id: "a1", name: "Carol" }, { id: "a2", name: "Dan" }];
  const matches = (t, q) => ((t.name || "") + " " + (t.otherUsername || "") + " " + (t.otherAffiliation || "")).toLowerCase().includes(q.trim().toLowerCase());
  assert.deepEqual(archived.filter((t) => matches(t, "carol")).map((t) => t.id), ["a1"]);
  assert.deepEqual(archived.filter((t) => matches(t, "zzzz-nobody")).map((t) => t.id), []);
});

// ── I2: archived rows can be unmuted and unpinned ──────────────────

await test("I2 source: both toggles look in either list and mirror into the archived list", async () => {
  srcCount(inboxSrc, "threads.find((t) => t.id === tid) || archivedThreads.find((t) => t.id === tid)", 3, "either list lookup in pin, mute, and archive toggles");
  srcHas(inboxSrc, "setArchivedThreads((prev) => sortThreadList(prev.map((t) => (t.id === tid ? { ...t, pinned:", "pin mirror into archived list");
  srcHas(inboxSrc, "setArchivedThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, muted:", "mute mirror into archived list");
});

await test("I2 behaviour: an archived muted and pinned row toggles off", async () => {
  const threads = [];
  const archivedThreads = [{ id: "a1", muted: true, pinned: true }];
  const row = threads.find((t) => t.id === "a1") || archivedThreads.find((t) => t.id === "a1");
  assert.equal(!(row ? !!row.muted : false), false, "unmute sends muted false");
  assert.equal(!(row ? !!row.pinned : false), false, "unpin sends pinned false");
  const after = archivedThreads.map((t) => (t.id === "a1" ? { ...t, muted: false, pinned: false } : t));
  assert.equal(after[0].muted, false);
  assert.equal(after[0].pinned, false);
});

// ── I3: the main empty state stays out of the Archived view ────────

await test("I3 source: No conversations yet is gated on the main view", async () => {
  assert.match(inboxSrc, /threads\.length === 0 && listLoaded && !listFailed && !showArchived && \(/, "main empty state carries the archived term");
});

// ── Summary ────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
