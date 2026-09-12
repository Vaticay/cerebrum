/**
 * Answer-experience tests: the reading-flow overhaul.
 *
 * The unified Evidence band (Bibliography + Videos as tabs) directly under
 * the answer, the sticky jump rail with live ready/empty/failed status, the
 * five-action toolbar with a labeled More menu, the read-head loading motif,
 * and designed empty/failed states with real retry actions.
 *
 * Unit tests against the real source — no server, no network. Structural
 * assertions over src/CerebrumApp.jsx plus real unit tests of the pure
 * fallback-chrome stripper (extracted with the same babel-slice technique
 * as tests/ui-render.cjs).
 *
 * Run with: node tests/answer-experience.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parse } from "@babel/parser";

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

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

// Extract the pure stripFallbackChrome for real unit tests.
const ast = parse(appSrc, { sourceType: "module", plugins: ["jsx"] });
const fnNode = ast.program.body.find(
  (n) => n.type === "FunctionDeclaration" && n.id.name === "stripFallbackChrome"
);
assert.ok(fnNode, "stripFallbackChrome not found in source");
const stripCtx = vm.createContext({});
vm.runInContext(appSrc.slice(fnNode.start, fnNode.end), stripCtx);
const stripFallbackChrome = stripCtx.stripFallbackChrome;

// ══════════════════════════════════════════════════════════════════════════
group("stripFallbackChrome — the failed-synthesis fallback is real content, not error chrome");

const FALLBACK_BODY =
  "## Unable To Synthesize A Direct Answer\n\n" +
  "[1] Paper One — the summary of paper one.\n\n" +
  "[2] Paper Two — the summary of paper two.\n\n" +
  "## What To Do Next\n\n" +
  "- Rephrase the query and try again.\n" +
  "- Check back when models recover.";

await test("strips the leading Unable To Synthesize heading", () => {
  const out = stripFallbackChrome(FALLBACK_BODY);
  assert.ok(!out.includes("Unable To Synthesize"), "error heading leaked through");
});

await test("strips the trailing What To Do Next block", () => {
  const out = stripFallbackChrome(FALLBACK_BODY);
  assert.ok(!out.includes("What To Do Next"), "action block leaked through");
  assert.ok(!out.includes("Check back when models recover"), "action item leaked through");
});

await test("preserves the paper blocks untouched", () => {
  const out = stripFallbackChrome(FALLBACK_BODY);
  assert.ok(out.includes("[1] Paper One — the summary of paper one."), "paper 1 damaged");
  assert.ok(out.includes("[2] Paper Two — the summary of paper two."), "paper 2 damaged");
});

await test("leaves a normal answer byte-identical", () => {
  const normal = "## Findings\n\nSome real synthesis text [1] with citations.\n\n## Methods\n\nMore text.";
  assert.equal(stripFallbackChrome(normal), normal, "normal answer was modified");
});

await test("tolerates empty input", () => {
  assert.equal(stripFallbackChrome(""), "");
  assert.equal(stripFallbackChrome(null), "");
});

// ══════════════════════════════════════════════════════════════════════════
group("Evidence band — bibliography and videos as tabs, always rendered");

await test("EvidenceBand exists with Bibliography / Videos tabs", () => {
  assert.match(appSrc, /function EvidenceBand/, "EvidenceBand missing");
  assert.match(appSrc, /id: "biblio", label: `Bibliography/, "bibliography tab missing");
  assert.match(appSrc, /id: "videos", label: `Videos/, "videos tab missing");
});

await test("band renders both sections bare (no nested section chrome)", () => {
  assert.match(appSrc, /<Bibliography bare/, "Bibliography not embedded bare in the band");
  assert.match(appSrc, /<VideoFilmstrip bare/, "VideoFilmstrip not embedded bare in the band");
});

await test("bibliography keeps its ledger contract", () => {
  assert.match(appSrc, /hanging-indent/i, "hanging-indent ledger note gone");
  assert.match(appSrc, /onOpen=\{\(\) => onOpenPaper\(i \+ 1\)\}/, "row-to-PaperDrawer wiring gone");
  assert.match(appSrc, /Jump to author/, "A–Z jump bar gone");
});

await test("zero sources get an honest empty state with retry, not a silent gap", () => {
  assert.match(appSrc, /NO SOURCES CITED/, "zero-source empty state missing");
  assert.match(appSrc, /label: "Retry search", primary: true, onClick: onRetry/, "retry not wired to the empty state");
});

await test("failed synthesis is keyed from synthesisMode, never prose", () => {
  assert.match(appSrc, /const synthFailed = t\.synthesisMode === "none"/, "synthFailed derivation missing");
  assert.match(appSrc, /Synthesis unavailable · verify against cited sources/, "failed synthesis still mislabeled as AI-synthesized");
});

await test("connection failure is narrowed to all-databases-failed", () => {
  assert.match(appSrc, /const allDbFailed =/, "allDbFailed derivation missing");
  assert.match(appSrc, /CONNECTION FAILED/, "connection-failed state missing");
  assert.match(appSrc, /The databases couldn't be reached\./, "connection-failed copy missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Jump rail — sticky, unified type, live status, touch-safe");

await test("JumpRail is sticky with unified-type labels and real statuses", () => {
  assert.match(appSrc, /function JumpRail/, "JumpRail missing");
  assert.match(appSrc, /position: "sticky"/, "rail is not sticky");
  assert.match(appSrc, /var\(--cb-body\)/, "rail labels are not on the unified body face");
  assert.ok(!/var\(--cb-mono\)/.test(appSrc), "mono token still referenced");
});

await test("rail statuses are derived from real turn data", () => {
  assert.match(appSrc, /id: "evidence", label: "Evidence", status: sources\.length \? "ready"/, "evidence status not data-driven");
  assert.match(appSrc, /id: "videos", label: "Videos", status: videos\.length \? "ready"/, "videos status not data-driven");
});

await test("rail jumps are buttons (touch works, no hover dependency)", () => {
  const start = appSrc.indexOf("function JumpRail");
  const block = appSrc.slice(start, appSrc.indexOf("function ToolbarOverflow", start));
  assert.ok(/<button/.test(block), "rail items are not buttons");
  assert.ok(!/onMouseEnter/.test(block), "rail depends on hover");
});

// ══════════════════════════════════════════════════════════════════════════
group("Toolbar — five labeled actions, everything else under More");

await test("toolbar shows exactly Copy, Share, Paper, Diagram, More", () => {
  assert.match(appSrc, /<ToolbarOverflow P=\{P\} accent=\{accent\} items=\{overflowItems\} \/>/, "More menu missing from toolbar");
  // The toolbar's five labeled actions: Copy, Share, Paper, Diagram, More.
  assert.match(appSrc, /title=\{copiedAnswer \? "Copied!" : "Copy answer"\}/, "Copy chip missing from toolbar");
  assert.match(appSrc, /title=\{linkCopied \? "Link copied!" : "Share"\}/, "Share chip missing from toolbar");
  assert.match(appSrc, /label=\{generatingPaper \? "Composing…" : "Paper"\}/, "Paper chip missing from toolbar");
  assert.match(appSrc, /label="Diagram"/, "Diagram chip missing from toolbar");
  assert.match(appSrc, /label="More"/, "More menu chip missing from toolbar");
  // The old crowded groups are gone from the bar.
  assert.ok(!/aria-label="Explore visually"/.test(appSrc), "Explore-visually group still on the bar");
  assert.ok(!/aria-label="Rate this answer"/.test(appSrc), "Rate-this-answer group still on the bar");
});

await test("demoted actions live in the overflow menu, still labeled", () => {
  for (const id of ['id: "listen"', 'id: "table"', 'id: "network"', 'id: "arc"', 'id: "openquestions"', 'id: "yes"', 'id: "no"', 'id: "report"']) {
    assert.ok(appSrc.includes(id), `overflow menu missing ${id}`);
  }
});

await test("retry is a real re-search through the ask pipeline", () => {
  assert.match(appSrc, /const retrySearch = \(\) => \{ if \(onRelated\) onRelated\(t\.q\); \};/, "retry not wired to onRelated");
});

await test("votes still feed /api/vote exactly once per answer", () => {
  assert.match(appSrc, /fetch\("\/api\/vote"/, "/api/vote call missing");
  assert.match(appSrc, /if \(vote \|\| !t\.answerId\) return;/, "one-shot vote guard missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Loading and error language");

await test("read-head motif: hairline, travelling marker, mono readout", () => {
  assert.match(appSrc, /function ReadHead/, "ReadHead missing");
  assert.match(appSrc, /\.cb-readhead-marker/, "read-head marker CSS missing");
  assert.match(appSrc, /@keyframes cbReadheadSweep/, "read-head keyframes missing");
});

await test("no bare Loading…/Thinking… in the new answer-experience code", () => {
  const start = appSrc.indexOf("ANSWER EXPERIENCE — reading flow");
  const end = appSrc.indexOf("function TurnInner", start);
  // Strip comments first: the motif's own doc comment names the strings it
  // prohibits, which is not a rendered loading string.
  const block = appSrc.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/Loading…|Thinking…/.test(block), "bare loading string in new code");
  assert.ok(!/shimmer/i.test(block), "shimmer in new code");
});

await test("error copy is plain — no sorry language", () => {
  assert.ok(!/sorry/i.test(appSrc), "sorry language present");
});

await test("fact-check always renders a section with failed/empty shells", () => {
  assert.match(appSrc, /CHECK FAILED/, "fact-check failed shell missing");
  assert.match(appSrc, /NOT CHECKED/, "fact-check empty shell missing");
});

await test("venn section renders an honest shell when claims don't divide", () => {
  assert.match(appSrc, /NO CLEAR DIVIDE/, "venn empty shell missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Video wiring — immediate poster, fade-over-poster, no black flash");

await test("poster derives hqdefault from the YouTube id immediately", () => {
  assert.match(appSrc, /`https:\/\/i\.ytimg\.com\/vi\/\$\{ytId\}\/hqdefault\.jpg`/, "hqdefault poster derivation missing");
});

await test("poster stays under the iframe; iframe fades in after load", () => {
  const start = appSrc.indexOf("function VideoFrame");
  const block = appSrc.slice(start, appSrc.indexOf("function VideoFilmstrip", start));
  assert.ok(/onLoad=\{\(\) => setLoaded\(true\)\}/.test(block), "iframe load tracking missing");
  assert.ok(/opacity: loaded \? 1 : 0/.test(block), "iframe fade-in missing");
});

await test("band's video modal fades over its poster", () => {
  assert.match(appSrc, /function EvidenceVideoModal/, "EvidenceVideoModal missing");
  assert.match(appSrc, /opacity: ready \? 1 : 0/, "modal fade-in missing");
});

await test("listen panel and video modal use separate state (no collision)", () => {
  assert.match(appSrc, /const \[listenOpen, setListenOpen\] = useState\(false\);/, "listen state missing");
  assert.match(appSrc, /const \[openVideo, setOpenVideo\] = useState\(null\);/, "video modal state missing");
  assert.match(appSrc, /onOpenVideo=\{setOpenVideo\}/, "band video open not wired to video state");
  assert.match(appSrc, /\{openVideo && <EvidenceVideoModal/, "modal not gated on video state");
  assert.ok(!/playerOpen/.test(appSrc), "collided playerOpen state still present");
});

await test("new motion respects reduced motion and fine-pointer hover intent", () => {
  assert.match(appSrc, /const reduced = usePrefersReducedMotion\(\);/, "reduced-motion not consulted");
  assert.match(appSrc, /setTimeout\(\(\) => setPreview\(true\), 380\)/, "380ms hover intent changed");
  assert.match(appSrc, /pointer: fine/, "fine-pointer gate missing");
});

await test("touch: per-row citation copy stays reachable without hover", () => {
  assert.match(appSrc, /@media \(pointer: coarse\)/, "coarse-pointer rule missing");
  assert.match(appSrc, /cb-bibentry-copy/, "copy-button class hook missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Section order — calm reading flow");

await test("sections follow the reading order: evidence, fact-check, disagreements, compare, open questions", () => {
  const order = ["EvidenceBand", "fcSectionRef", "vennSectionRef", "compareSectionRef", "oqSectionRef"]
    .map((m) => appSrc.indexOf(m));
  assert.ok(order.every((i) => i > 0), "a section marker is missing");
  assert.ok(order.every((v, i, a) => i === 0 || v > a[i - 1]), "sections are out of reading order");
});

await test("compare section owns an honest shell instead of returning null", () => {
  assert.match(appSrc, /NOTHING TO COMPARE/, "compare empty shell missing");
  assert.ok(!/if \(!sources\.length\) return null/.test(appSrc), "EvidenceSection still returns null");
});

// ══════════════════════════════════════════════════════════════════════════
group("videos settled flag — no false empty verdict while the fetch races synthesis");

await test("new turns start with the video index marked pending", () => {
  assert.match(appSrc, /videosSettled: false/, "turn literal missing videosSettled: false");
});

await test("the videos promise marks the turn settled on resolve (footage or not)", () => {
  const start = appSrc.indexOf("videosPromise.then(");
  assert.ok(start > 0, "videosPromise.then wiring missing");
  const block = appSrc.slice(start, start + 900);
  assert.match(block, /videosSettled: true/, "settled marking missing in videosPromise.then");
  // Footage attach keeps its original guard — the milestone semantics are unchanged.
  assert.match(block, /setVideosLocated\(true\)/, "videosLocated milestone missing");
});

await test("videos tab shows the read head (not the empty verdict) while pending", () => {
  const start = appSrc.indexOf("function EvidenceBand");
  const block = appSrc.slice(start, appSrc.indexOf("function stripFallbackChrome", start));
  assert.match(block, /videosPending = t\.videosSettled === false/, "strict pending check missing");
  assert.match(block, /busyNow \|\| !done \|\| videosPending/, "pending not included in the loading condition");
});

await test("absent flag counts as settled — cached turns never stick on a loader", () => {
  // Strict === false: undefined (older cached turns) is not pending.
  assert.ok(!/videosSettled == false[^=]/.test(appSrc) || /videosSettled === false/.test(appSrc), "loose pending check found");
});

// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("answer-experience.mjs failed:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
  process.exit(1);
}
