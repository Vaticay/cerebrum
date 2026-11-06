/**
 * Client state — regression tests for the hostile inputs lane defects
 * H3 and H4 (site wide debug, November 6, 2026).
 *
 * H3: the search composer kept the typed question only in component
 * state, so a reload or browser crash mid answer lost it entirely.
 * The composer now persists its draft the way the inbox drafts and
 * the profile already persist: restored on mount, written on every
 * change, removed when the input clears (which is what ask() does
 * when a question is sent). The component wiring is asserted against
 * the source, and the persist cycle itself is driven below with the
 * exact expressions the component runs, over a stub localStorage.
 *
 * H4: the Documents store is one whole localStorage object, and two
 * open tabs each hold a snapshot of it. saveDocStore used to write
 * the saver's snapshot verbatim, so the second tab's save silently
 * overwrote the first tab's newest document or annotations.
 * saveDocStore now merges against what is actually stored, document
 * by document, newest updatedAt wins, with tombstones so a deletion
 * (or a shelf cap eviction) is not undone by a stale tab's save.
 * The two tab races are simulated here by interleaving saves from
 * snapshots taken at different times.
 *
 * Run with: node tests/client-state-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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

const {
  loadDocStore,
  saveDocStore,
  mergeDocStores,
  deleteDocFromStore,
  evictOldestDocs,
  DOCMODE_STORE_KEY,
  DOCMODE_MAX_DOCS,
} = await import(join(root, "src/docReader.js"));

function stubLocalStorage() {
  const map = new Map();
  const fake = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const real = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });
  return () => {
    Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true, writable: true });
  };
}

// ── H3: composer draft ────────────────────────────────────────────────
group("H3 — the composer draft survives a reload and clears on send");

// The exact expressions src/CerebrumApp.jsx runs for the draft: the
// lazy useState initializer on mount, and the persist effect on every
// input change. The wiring assertions below pin the component to
// these, so this simulation cannot drift away from the shipped code.
const COMPOSER_DRAFT_KEY = "cb_composer_draft_v1";
function composerDraftOnMount() {
  try { return localStorage.getItem(COMPOSER_DRAFT_KEY) || ""; } catch { return ""; }
}
function composerDraftOnChange(value) {
  try {
    if (value) localStorage.setItem(COMPOSER_DRAFT_KEY, value);
    else localStorage.removeItem(COMPOSER_DRAFT_KEY);
  } catch { /* storage unavailable: the composer still works in memory */ }
}

await test("a typed question is restored after a simulated reload", () => {
  const restore = stubLocalStorage();
  try {
    assert.equal(composerDraftOnMount(), "", "a first visit starts empty");
    composerDraftOnChange("why do black soldier fly larvae eat grease");
    assert.equal(composerDraftOnMount(), "why do black soldier fly larvae eat grease",
      "the draft must come back on the next mount, which is the reload case");
    composerDraftOnChange("why do black soldier fly larvae eat grease and oil");
    assert.equal(composerDraftOnMount(), "why do black soldier fly larvae eat grease and oil",
      "the draft tracks the latest text, not the first");
  } finally {
    restore();
  }
});

await test("sending clears the draft, so a sent question is not resurrected", () => {
  const restore = stubLocalStorage();
  try {
    composerDraftOnChange("a question about to be sent");
    // ask() sends by clearing the input state; the persist effect
    // turns that clear into a removal.
    composerDraftOnChange("");
    assert.equal(globalThis.localStorage.getItem(COMPOSER_DRAFT_KEY), null,
      "the draft key must be removed, not left holding the sent question");
    assert.equal(composerDraftOnMount(), "", "nothing comes back after a send");
  } finally {
    restore();
  }
});

await test("draft persistence degrades silently when storage is unavailable", () => {
  const throwing = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
  const real = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true, writable: true });
  try {
    assert.equal(composerDraftOnMount(), "", "a blocked read mounts empty, never throws");
    composerDraftOnChange("typed anyway");
    composerDraftOnChange("");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true, writable: true });
  }
});

await test("the component wires the draft to the shared composer state", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /const \[input, setInput\] = useState\(\(\) => \{ try \{ return localStorage\.getItem\("cb_composer_draft_v1"\) \|\| ""; \} catch \{ return ""; \} \}\);/,
    "the composer state does not restore the draft on mount");
  assert.match(src, /if \(input\) localStorage\.setItem\("cb_composer_draft_v1", input\);\s*else localStorage\.removeItem\("cb_composer_draft_v1"\);/,
    "no effect persists the draft on change and removes it on clear");
  assert.match(src, /\}, \[input\]\);/, "the draft effect is not keyed on the input state");
  assert.match(src, /setInput\(""\); setAttachedImage\(null\);/,
    "ask() no longer clears the input at send, so the draft would outlive the send");
  assert.match(src, /value=\{input\} data-cb-followup="true"/,
    "the follow up composer no longer shares the input state, so one draft no longer covers both");
});

// ── H4: the Documents store merge ─────────────────────────────────────
group("H4 — two tabs saving interleaved keep both tabs' newest work");

const doc = (title, updatedAt, extra = {}) => ({ title, text: "text of " + title, updatedAt, ...extra });

await test("a stale tab's save cannot erase a document it never saw", () => {
  const restore = stubLocalStorage();
  try {
    // Tab A adds document A and saves.
    saveDocStore({ docs: { fpA: doc("A", 1000) }, lastOpened: "fpA" });
    // Tab B still holds the snapshot from before A existed; it adds
    // document B and saves. Before the merge, this write erased A.
    saveDocStore({ docs: { fpB: doc("B", 2000) }, lastOpened: "fpB" });
    const store = loadDocStore();
    assert.ok(store.docs.fpA, "tab A's document vanished under tab B's save");
    assert.ok(store.docs.fpB, "tab B's own document is missing");
    assert.equal(store.lastOpened, "fpB", "lastOpened follows the tab that saved last");
  } finally {
    restore();
  }
});

await test("per document, the newer version wins whichever tab saved it", () => {
  const restore = stubLocalStorage();
  try {
    saveDocStore({ docs: { fpX: doc("X new", 3000, { highlights: [{ start: 0, end: 3 }] }) }, lastOpened: "fpX" });
    // A stale tab rewrites the same document from its older snapshot.
    saveDocStore({ docs: { fpX: doc("X old", 1000) }, lastOpened: "fpX" });
    let store = loadDocStore();
    assert.equal(store.docs.fpX.title, "X new", "the stale copy overwrote the newer annotations");
    assert.equal(store.docs.fpX.highlights.length, 1, "the newer version's highlights were lost");
    // And a genuinely later edit from that tab does win.
    saveDocStore({ docs: { fpX: doc("X later", 4000) }, lastOpened: "fpX" });
    store = loadDocStore();
    assert.equal(store.docs.fpX.title, "X later", "a later edit failed to win");
  } finally {
    restore();
  }
});

await test("a stale tab's save cannot resurrect a deleted document", () => {
  const restore = stubLocalStorage();
  try {
    saveDocStore({ docs: { fpD: doc("D", 1000), fpK: doc("K", 1000) }, lastOpened: "fpK" });
    // One tab deletes D; a second tab still holds the pre delete
    // snapshot and saves an unrelated edit to K.
    assert.equal(deleteDocFromStore("fpD"), true, "the delete itself failed");
    assert.ok(!loadDocStore().docs.fpD, "the document survived its own deletion");
    saveDocStore({ docs: { fpD: doc("D", 1000), fpK: doc("K edited", 2000) }, lastOpened: "fpK" });
    const store = loadDocStore();
    assert.ok(!store.docs.fpD, "the stale save resurrected the deleted document");
    assert.equal(store.docs.fpK.title, "K edited", "the stale tab's unrelated edit was lost");
    const raw = JSON.parse(globalThis.localStorage.getItem(DOCMODE_STORE_KEY));
    assert.ok(raw.deleted && raw.deleted.fpD > 1000, "no tombstone was recorded for the deletion");
  } finally {
    restore();
  }
});

await test("a document written again after its deletion wins over the tombstone", () => {
  const restore = stubLocalStorage();
  try {
    saveDocStore({ docs: { fpD: doc("D", 1000) }, lastOpened: "fpD" });
    deleteDocFromStore("fpD");
    const later = Date.now() + 60000;
    saveDocStore({ docs: { fpD: doc("D pasted again", later) }, lastOpened: "fpD" });
    const store = loadDocStore();
    assert.equal(store.docs.fpD.title, "D pasted again", "a genuine later write lost to the tombstone");
    const raw = JSON.parse(globalThis.localStorage.getItem(DOCMODE_STORE_KEY));
    assert.ok(!raw.deleted || !raw.deleted.fpD, "the spent tombstone was left behind");
  } finally {
    restore();
  }
});

await test("a stale save cannot pull a shelf cap eviction back in", () => {
  const restore = stubLocalStorage();
  try {
    const docs = {};
    for (let n = 0; n < DOCMODE_MAX_DOCS + 1; n++) docs["fp" + n] = doc("Doc " + n, 1000 + n);
    saveDocStore({ docs, lastOpened: "fp" + DOCMODE_MAX_DOCS });
    // Tab B evicts the oldest to make room and saves.
    const tabB = loadDocStore();
    const evicted = evictOldestDocs(tabB);
    assert.equal(evicted.length, 1, "setup: exactly one eviction expected");
    saveDocStore(tabB);
    assert.ok(!loadDocStore().docs.fp0, "setup: the evicted document is still stored");
    // Tab A, holding the pre eviction snapshot, saves its own edit.
    const newestFp = "fp" + DOCMODE_MAX_DOCS;
    const stale = { docs: { ...docs, [newestFp]: doc("Newest edited", 9000) }, lastOpened: newestFp };
    saveDocStore(stale);
    const store = loadDocStore();
    assert.ok(!store.docs.fp0, "the stale save resurrected the evicted document");
    assert.equal(store.docs[newestFp].title, "Newest edited", "the stale tab's own edit was lost");
    assert.ok(Object.keys(store.docs).length <= DOCMODE_MAX_DOCS, "the shelf grew past its cap");
  } finally {
    restore();
  }
});

await test("stores written before tombstones existed merge without loss", () => {
  const restore = stubLocalStorage();
  try {
    // A legacy stored value: no deleted field at all.
    globalThis.localStorage.setItem(DOCMODE_STORE_KEY,
      JSON.stringify({ docs: { fpOld: doc("Old", 500) }, lastOpened: "fpOld" }));
    saveDocStore({ docs: { fpNew: doc("New", 1500) }, lastOpened: "fpNew" });
    const store = loadDocStore();
    assert.ok(store.docs.fpOld && store.docs.fpNew, "a legacy store lost a document in the merge");
    assert.equal(store.lastOpened, "fpNew");
  } finally {
    restore();
  }
});

await test("mergeDocStores is pure and lastOpened never names a dropped document", () => {
  const stored = { docs: { fpA: doc("A", 1000), fpD: doc("D", 1000) }, lastOpened: "fpD", deleted: { fpD: 5000 } };
  const incoming = { docs: { fpB: doc("B", 2000) }, lastOpened: "fpD" };
  const storedCopy = JSON.parse(JSON.stringify(stored));
  const incomingCopy = JSON.parse(JSON.stringify(incoming));
  const merged = mergeDocStores(stored, incoming);
  assert.deepEqual(stored, storedCopy, "the merge mutated the stored snapshot");
  assert.deepEqual(incoming, incomingCopy, "the merge mutated the incoming snapshot");
  assert.ok(merged.docs.fpA && merged.docs.fpB, "the merge dropped a surviving document");
  assert.ok(!merged.docs.fpD, "the tombstoned document survived the merge");
  assert.equal(merged.lastOpened, null,
    "lastOpened named a dropped document; with neither side naming a survivor it must clear, never guess");
});

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  process.exitCode = 1;
}
