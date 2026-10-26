/**
 * Library and Today in Science fixes (2026-10-23, huge audit fix wave).
 *
 * Pins the lane's contracts: the story quality gate at the source
 * merge, the renamed edition surface with persistence ordering and
 * save controls, guest collections in the browser, saved sync skip
 * reporting, the one Library with three tabs, honest counts, the
 * paper peek with ratings, delete with undo, and selection clearing.
 *
 * Run with: node tests/library-trending-oct23.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const dataSrc = await readFile(join(root, "functions/api/data.js"), "utf8");
const sourceSrc = await readFile(join(root, "functions/lib/trendingSource.js"), "utf8");

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
function group(name) { console.log(`\n${name}`); }
const slice = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a > -1, `slice start missing: ${from}`);
  const b = src.indexOf(to, a);
  assert.ok(b > a, `slice end missing: ${to}`);
  return src.slice(a, b);
};

// ══════════════════════════════════════════════════════════════════════════
group("story quality gate at the source merge");

const { isNonStoryTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));

await test("the gate drops the edition's known non stories", () => {
  assert.equal(isNonStoryTrendingItem({ title: "Week in images: 19 to 23 October 2026", summary: "A selection of photographs from the week.", url: "https://example.org/a" }), true, "weekly photo roundup passed the gate");
  assert.equal(isNonStoryTrendingItem({ title: "Nov. 5: Satellite Mission Management at the Edge", summary: "Join us for a discussion of satellite mission operations with industry speakers.", url: "https://example.org/b" }), true, "event invitation passed the gate");
  assert.equal(isNonStoryTrendingItem({ title: "Autumn colours across the north, in pictures", summary: "Photographers share the season.", url: "https://example.org/c" }), true, "picture gallery passed the gate");
  assert.equal(isNonStoryTrendingItem({ title: "A webinar on grant writing for early career researchers", summary: "Hosted by the funding office.", url: "https://example.org/d" }), true, "webinar passed the gate");
  assert.equal(isNonStoryTrendingItem({ title: "Weekly science briefing", summary: "Registration is now open for subscribers.", url: "https://example.org/e" }), true, "registration pitch passed the gate");
  assert.equal(isNonStoryTrendingItem({ title: "Anything at all", summary: "A normal summary.", url: "https://example.org/f", type: "event" }), true, "an event typed record passed the gate");
});

await test("the gate keeps real stories and reporting", () => {
  assert.equal(isNonStoryTrendingItem({ title: "Ocean heat content reached a record in 2026, study finds", summary: "Researchers measured heat stored in the upper ocean and found a new high.", url: "https://example.org/g" }), false, "a research story was dropped");
  assert.equal(isNonStoryTrendingItem({ title: "New catalyst splits water at room temperature", summary: "The team reports the material held up over five hundred cycles.", url: "https://example.org/h" }), false, "a press report was dropped");
  assert.equal(isNonStoryTrendingItem({ title: "Conference report: what the field agreed on this year", summary: "Delegates published a joint statement on data sharing after the meeting.", url: "https://example.org/i" }), false, "reporting about an event was dropped");
  assert.equal(isNonStoryTrendingItem(null), false, "a missing record was treated as a non story");
});

await test("the gate runs at the merge, before dedupe and slots", () => {
  const merge = slice(sourceSrc, "const item = buildTrendingItem(a, group.category);", "if (seenUrls.has(urlKey)) continue;");
  assert.ok(merge.includes("if (isNonStoryTrendingItem(item)) continue;"), "the merge does not drop non stories");
  assert.ok(merge.indexOf("isNonStoryTrendingItem") < merge.indexOf("isWithinEditionWindow"), "the gate runs after the edition window, so a non story can still claim a slot first");
  assert.ok(sourceSrc.indexOf("if (isNonStoryTrendingItem(item)) continue;") < sourceSrc.indexOf("if (seenUrls.has(urlKey)) continue;"), "the gate runs after dedupe, so a non story can still claim a dedupe slot first");
});

// ══════════════════════════════════════════════════════════════════════════
group("the renamed edition surface");

await test("one name everywhere, and no Nova in the masthead", () => {
  const view = slice(appSrc, "function TrendingView(", "function LiteratureTimeline(");
  assert.ok(!view.includes("NovaLive"), "the masthead still carries the Nova figure");
  assert.ok(!view.includes("Trending in Science"), "the view still calls itself Trending");
  assert.ok(view.includes("Today in Science"), "the view does not carry the new name");
  assert.ok(view.includes("Stories that stay in the edition day after day come first"), "the masthead honesty line does not state the ordering");
});

await test("the masthead health stack is one line plus a details toggle", () => {
  const view = slice(appSrc, "function TrendingView(", "function LiteratureTimeline(");
  assert.ok(view.includes("About this edition"), "no details toggle for the edition health");
  assert.ok(view.includes("healthOpen"), "the toggle state is missing");
  assert.ok(view.includes("stories in this edition."), "the one plain health line is missing");
});

await test("every story surface carries a Save into the Library", () => {
  assert.ok(appSrc.includes("function trendingStoryToSource(item)"), "no story to source builder");
  const builder = slice(appSrc, "function trendingStoryToSource(item)", "async function exportTopPapersExcel");
  assert.ok(builder.includes("trendingDoiOf(item)"), "the built source drops the story DOI");
  assert.ok(builder.includes("item.url"), "the built source drops the story URL");
  assert.ok(appSrc.includes("onSaveStory={(item) => { const src = trendingStoryToSource(item); if (src) toggleSave(src); }"), "the view is not wired to toggleSave");
  const hero = slice(appSrc, "function TrendingHero(", "function TrendingArticleModal");
  assert.ok(hero.includes("Save to Library"), "the hero has no Save control");
  const modal = slice(appSrc, "function TrendingArticleModal", "function TrendingView(");
  assert.ok(modal.includes("Save to Library"), "the story modal has no Save control");
  assert.ok(appSrc.includes('aria-pressed={isStorySaved ? !!isStorySaved(item) : false}'), "the digest rows have no Save control");
});

// ══════════════════════════════════════════════════════════════════════════
group("guest collections and saved sync honesty");

await test("collections live in the browser for guests under the claimed key", () => {
  assert.ok(appSrc.includes('localStorage.getItem("cb_collections")'), "guest collections are never read from the browser");
  assert.ok(appSrc.includes('localStorage.setItem("cb_collections", JSON.stringify(collections))'), "guest collections are never written to the browser");
  const creates = appSrc.split("Guest path").length - 1;
  assert.ok(creates >= 3, `expected guest paths in create, rename, and delete, found ${creates}`);
});

await test("guest collections merge into the account on sign in", () => {
  assert.ok(appSrc.includes("Guest collections merge into the account the way saved papers"), "merge block missing");
  assert.ok(appSrc.includes("idMap.set(c.id, r.id)"), "the merge does not remap paper filing to the new account ids");
  assert.ok(appSrc.includes('apiDataPost("collections", { action: "create", name: c.name })'), "the merge does not create the guest collections on the account");
  assert.ok(appSrc.includes("serverCols.length === 0 && collections.length > 0"), "the merge does not follow the saved papers rule: account copy wins when it has any");
});

await test("saved sync reads the response counts and reports skips by count", () => {
  const sync = slice(appSrc, 'apiDataPost("saved", { action: "replace-all", items: saved })', "}, 900);");
  assert.ok(sync.includes("res.skipped"), "the sync never reads the skipped count");
  assert.ok(sync.includes("not saved to your account"), "the user is not told plainly what did not save");
  assert.ok(sync.includes("savedSkipSigRef"), "the same skip set would be reported on every sync");
  assert.ok(dataSrc.includes("skipped: received - written"), "the server does not count papers past the cap as skipped");
});

// ══════════════════════════════════════════════════════════════════════════
group("one Library, three tabs");

await test("the Library is one page with Papers and answers, Diagram Studio, and Collections tabs", () => {
  assert.ok(appSrc.includes('role="tablist" aria-label="Library sections"'), "no Library tab bar");
  assert.ok(appSrc.includes('libraryTab === "collections"'), "no Collections tab");
  assert.ok(!appSrc.includes('{view === "collections"'), "the standalone Collections page still exists");
  assert.ok(!appSrc.includes('["collections", "Collections", "folder"]'), "the sidebar still lists Collections as a destination");
  assert.ok(appSrc.includes('case "collections": setLibraryTab("collections"); setView("library");'), "old collections links do not land on the Library tab");
});

await test("the header count and the tab counts are one accounting", () => {
  assert.ok(appSrc.includes("count={saved.length + history.length + flowcharts.length}"), "the header count is not the whole record count");
  assert.ok(appSrc.includes('{ key: "papers", label: "Papers and answers", count: saved.length + history.length }'), "the Papers tab does not count papers and answers together");
  assert.ok(appSrc.includes('{ key: "maps", label: "Diagram Studio", count: flowcharts.length }'), "the diagram tab does not carry the one Diagram Studio name");
});

await test("answers are first class records from the investigations store", () => {
  const lib = slice(appSrc, 'aria-label="Saved answers"', "Your downloads and imports");
  assert.ok(lib.includes("cited paper"), "answer records do not state their cited paper count");
  assert.ok(lib.includes("openHistoryItem(h)"), "answer records do not open the investigation");
  assert.ok(appSrc.includes('ariaLabel="What to show"'), "no record type filter on the Papers tab");
});

await test("export receipts are a downloads and imports list at the foot of the Papers tab", () => {
  assert.ok(!appSrc.includes('id="lib-exports"'), "Exports is still a top level section");
  assert.ok(appSrc.includes("Your downloads and imports"), "no downloads and imports list");
  const receipts = slice(appSrc, "Your downloads and imports", 'id="lib-maps"');
  assert.ok(receipts.includes("exportLog.slice(0, 8)"), "the activity list is not a short list");
  assert.ok(receipts.includes("!isMobile && ("), "the fixed date span still renders on phones");
});

await test("a paper with no usable URL renders as plain text, and a missing title falls back", () => {
  assert.ok(appSrc.includes('const hasUrl = safeHref(sv.url) !== "#";'), "rows do not test for a usable URL");
  assert.ok(appSrc.includes('[sv.authors, sv.year].filter(Boolean).join(" · ")'), "no authors and year fallback for a missing title");
});

await test("the top papers export sorts before it takes twenty", () => {
  const wrap = slice(appSrc, "async function exportTopPapersExcel", "function pdfInlineText");
  assert.ok(wrap.indexOf("paired.sort") > -1 && wrap.indexOf("paired.sort") < wrap.indexOf("paired.slice(0, 20)"), "the sort does not run before the cap");
  assert.ok(wrap.includes("Sorted by citation count, then most recently saved"), "the stated order is not written on the export");
});

await test("bulk selection clears when the filter or the tab changes", () => {
  assert.ok(appSrc.includes("libQuerySeenRef"), "no filter change watcher for the selection");
  const clear = slice(appSrc, "const libQuerySeenRef = useRef(libraryQuery);", "const peekSaved =");
  assert.ok(clear.includes("setSelectedSavedKeys(new Set())"), "the selection is not cleared");
  assert.ok(clear.includes("[libraryKind, libraryTab]"), "tab and record filter changes do not clear the selection");
});

await test("the peek holds the source link, the star rating, and the collection picker", () => {
  const peek = slice(appSrc, "The paper peek", "Citation import modal");
  assert.ok(peek.includes("<StarRating"), "the peek does not reuse the star rating control");
  assert.ok(peek.includes("rateSavedPaper(peekSaved, r)"), "the peek rating does not write a rating");
  assert.ok(peek.includes("Read at source"), "the peek has no source link");
  assert.ok(peek.includes("Put this paper in a collection"), "the peek has no collection picker");
  assert.ok(appSrc.includes('apiDataAction("set-rating", { resource: "saved", id: paperId, rating })'), "ratings do not ride the stored rating path");
});

await test("deletes offer an undo window instead of only a confirm", () => {
  assert.ok(appSrc.includes("const parkLibUndo"), "no undo parking for Library deletes");
  assert.ok(appSrc.includes("setTimeout(() => setLibUndo(null), 8000)"), "the undo window is not timed");
  assert.ok(appSrc.includes("undoLibDelete"), "no undo restore");
  assert.ok(!appSrc.includes("Remove this paper for good"), "the old arm and confirm delete is still the paper path");
});

await test("diagram cards give the title the card's full width and keep the one press delete", () => {
  // Depth wave, 2026-10-26: the diagram rows became cards in a
  // grid, so this pin's literals changed with the arrangement. The
  // properties it was written for in October 2023 survive the move:
  // the title cannot be crushed by the actions beside it (it spans
  // the card under the cover, and the actions wrap in the card
  // foot), nothing can clip off a card the way the armed delete
  // pair clipped off the old row, and that pair stays gone.
  const maps = slice(appSrc, 'id="lib-maps"', 'libraryTab === "collections"');
  assert.ok(maps.includes('display: "grid"'), "diagrams do not render as a card grid");
  assert.ok(maps.includes("height: 150"), "the diagram cover lost its full width frame");
  assert.ok(maps.includes('flexWrap: "wrap"'), "the card actions cannot wrap inside the card foot");
  assert.ok(!maps.includes("Delete this map for good"), "the armed delete pair that clipped off the row is still there");
});

await test("paper rows are tap targets and phone rows keep the author action", () => {
  const row = slice(appSrc, "const hasUrl = safeHref(sv.url)", 'aria-label="Saved answers"');
  assert.ok(row.includes("setPeekSavedKey(key)"), "a row tap does not open the peek");
  assert.ok(row.includes("selectedSavedKeys.size > 0) toggleSavedKey(key)") || row.includes("if (selectedSavedKeys.size > 0) toggleSavedKey(key); else setPeekSavedKey(key);"), "a row tap does not select while a selection is active");
  assert.ok(row.includes("More by these authors"), "the phone row lost the author action");
  assert.ok(row.includes("fontSize: FONT_SIZES.body"), "paper titles are not at the body size");
});

await test("story modal videos load on tap, and edition images declare their slot size", () => {
  const modal = slice(appSrc, "function TrendingArticleModal", "function TrendingView(");
  assert.ok(modal.includes("playingVideoId"), "modal videos still embed on open");
  assert.ok(modal.includes("i.ytimg.com/vi/"), "no poster stands in for the embed before the tap");
  assert.ok(appSrc.includes('sizes="(max-width: 760px) 100vw, 480px"'), "the hero image declares no slot size");
  // Composition wave, 2026-10-26: the thumb now declares its slot by
  // tier (the second tier of the edition runs a larger cut), so the
  // pin checks the tiered declaration instead of the single literal.
  assert.ok(appSrc.includes('sizes={large ? "132px" : "88px"}'), "the edition thumbs declare no slot size by tier");
});

group("completion pass additions");

await test("clear all parks an undo instead of deleting permanently", () => {
  assert.ok(appSrc.includes("parkLibUndo({ papers: removedAll"), "clear all does not park its papers for undo");
  assert.ok(!appSrc.includes("onClick={() => { setSaved([]); setConfirmClearSaved(false);"), "clear all still deletes with no undo");
});

await test("the row selection checkbox sits in a 44 tap target", () => {
  assert.ok(appSrc.includes('width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", margin: "-13px"'), "the row checkbox target is not 44 square");
});

await test("the new name reaches the MCP tool and the marketing copy", async () => {
  const mcpSrc = await readFile(join(root, "functions/api/mcp.js"), "utf8");
  assert.ok(mcpSrc.includes('title: "Today in Science"'), "the MCP tool still titles itself with the old name");
  assert.ok(!mcpSrc.includes("Trending in Science, edition"), "the MCP edition header still uses the old name");
  const marketingSrc = await readFile(join(root, "src/marketingContent.js"), "utf8");
  assert.ok(!marketingSrc.includes("Trending in Science"), "the marketing copy still uses the old name");
});

group("owner photo checklist, October 23 2026");

await test("the warning boxes live inside the edition details, not above the stories", () => {
  const view = slice(appSrc, "function TrendingView(", "function LiteratureTimeline(");
  const howBuilt = view.indexOf("How this edition is built");
  assert.ok(howBuilt > -1, "the how it is built text is missing from the details");
  assert.ok(view.indexOf("Missing this round") > howBuilt, "the missing section box still stands in the masthead");
  assert.ok(view.indexOf("Citation counts are partial this round:") > howBuilt, "the rate limit box still stands in the masthead");
  assert.ok(view.indexOf("last good edition. Stories stay readable") > howBuilt, "the stale edition box still stands in the masthead");
  assert.ok(view.includes("Citation counts are partial this round."), "the one line health note no longer states the partial counts");
});

await test("on a phone the hero comes before the edition controls, and the sort keeps Edition order with no Most cited", () => {
  const view = slice(appSrc, "function TrendingView(", "function LiteratureTimeline(");
  assert.ok(view.includes("{isMobile && heroBlock}\n            {isMobile && controlsBlock}"), "the phone order is not hero then controls");
  assert.ok(view.includes("{!isMobile && controlsBlock}"), "the desktop controls are not above the stories");
  assert.ok(view.includes("{!isMobile && heroBlock}"), "the desktop hero is missing from the ready block");
  const controls = slice(appSrc, "const controlsBlock =", "const heroBlock =");
  assert.ok(controls.includes("Search this edition"), "the edition search left the controls block");
  assert.ok(controls.includes("Filter by section"), "the section pills left the controls block");
  assert.ok(controls.includes('{ id: "edition", label: "Order they came in" }'), "Order they came in left the sort");
  assert.ok(!controls.includes("Most cited"), "the Most cited sort is back in the controls");
});

await test("the masthead clears the phone header bar, so nothing renders half hidden", () => {
  const view = slice(appSrc, "function TrendingView(", "function LiteratureTimeline(");
  assert.ok(view.includes('padding: isMobile ? "72px 18px 48px"'), "the phone top padding that clears the header bar is gone");
  assert.ok(!view.includes("NovaLive"), "a figure is back in the masthead");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
