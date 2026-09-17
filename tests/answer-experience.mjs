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
  assert.match(appSrc, /Bibliography · \{sources\.length\}/, "bibliography tab missing");
  assert.match(appSrc, /Videos · \{videos\.length\}/, "videos tab missing");
});

await test("band renders both sections bare (no nested section chrome)", () => {
  assert.match(appSrc, /<Bibliography bare/, "Bibliography not embedded bare in the band");
  assert.match(appSrc, /<VideoFilmstrip bare/, "VideoFilmstrip not embedded bare in the band");
});

await test("bibliography keeps its ledger contract", () => {
  assert.match(appSrc, /hanging-indent/i, "hanging-indent ledger note gone");
  assert.match(appSrc, /onOpen=\{\(\) => onOpenPaper\(i \+ 1\)\}/, "row-to-PaperDrawer wiring gone");
  assert.match(appSrc, /Jump to author/, "A–Z jump bar gone");
  // Pass 2: rows are evidence-ledger rows with stable numbering — every row
  // keeps its ref-${index} id (the old A–Z anchor used to REPLACE it past
  // 12 sources, breaking citation jumps), carries data-rel from the shared
  // venn classification, and syncs with the answer's citations.
  assert.match(appSrc, /className="cb-ledger-row cb-fade cb-bibentry"/, "BibEntry not on the ledger-row contract");
  assert.match(appSrc, /id=\{`ref-\$\{index\}`\}/, "stable ref id gone from BibEntry");
  assert.match(appSrc, /data-rel=\{rel\}/, "BibEntry missing data-rel");
  assert.match(appSrc, /data-active=\{active \? "true" : undefined\}/, "BibEntry missing citation sync");
  assert.match(appSrc, /relOf=\{relOf\}/, "band not passing the shared relationship encoding");
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
  assert.match(appSrc, /var\(--cb-font\)/, "rail labels are not on the unified typeface");
  // 2026-09-17: the approved 4-AI redesign introduced a mono type layer
  // (metadata/DOIs/source numbers) in the injected CSS, so a global
  // no-cb-mono assertion is no longer valid. Scope it to the JumpRail block:
  // rail labels must stay on the unified typeface.
  const railStart = appSrc.indexOf("function JumpRail");
  const railBlock = appSrc.slice(railStart, appSrc.indexOf("function ToolbarOverflow", railStart));
  assert.ok(!/var\(--cb-mono\)/.test(railBlock), "JumpRail uses the mono token");
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
group("Toolbar — text actions, everything else under More");

await test("toolbar is Copy answer, Share, Evidence index, More — no chips", () => {
  assert.match(appSrc, /<ToolbarOverflow P=\{P\} accent=\{accent\} items=\{overflowItems\} \/>/, "More menu missing from toolbar");
  // Pass 2: three text actions + the More menu. No ToolChips on the bar.
  assert.match(appSrc, /title=\{copiedAnswer \? "Copied!" : "Copy answer"\}/, "Copy answer action missing from toolbar");
  assert.match(appSrc, /title=\{linkCopied \? "Link copied!" : "Share"\}/, "Share action missing from toolbar");
  assert.match(appSrc, /Evidence index/, "Evidence index action missing from toolbar");
  const barStart = appSrc.indexOf('aria-label="Answer actions"');
  const barBlock = appSrc.slice(barStart, appSrc.indexOf("</div>", barStart));
  assert.ok(/cb-textbtn/.test(barBlock), "toolbar not on the text-action contract");
  assert.ok(!/<ToolChip/.test(barBlock), "ToolChip still on the primary toolbar");
  assert.ok(!/generatingPaper \? "Composing…"/.test(barBlock), "Paper chip still on the primary toolbar");
  assert.ok(!/label="Diagram"/.test(barBlock), "Diagram chip still on the primary toolbar");
  // The old crowded groups are gone from the bar.
  assert.ok(!/aria-label="Explore visually"/.test(appSrc), "Explore-visually group still on the bar");
  assert.ok(!/aria-label="Rate this answer"/.test(appSrc), "Rate-this-answer group still on the bar");
});

await test("demoted actions live in the overflow menu, still labeled", () => {
  for (const id of ['id: "listen"', 'id: "table"', 'id: "network"', 'id: "arc"', 'id: "openquestions"', 'id: "yes"', 'id: "no"', 'id: "report"', 'id: "paper"', 'id: "flowchart"']) {
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
  assert.match(appSrc, /No scientific claims to verify\./, "fact-check honest empty state missing");
  assert.ok(!/kicker=\{[^}]*"NOT CHECKED"/.test(appSrc) && !appSrc.includes('kicker="NOT CHECKED"'), "NOT CHECKED still present");
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
group("Pass 2 — article + evidence ledger");

await test("answer surface is an article plus a sticky evidence rail", () => {
  assert.match(appSrc, /function EvidenceRail/, "EvidenceRail missing");
  assert.match(appSrc, /\.cb-answer-grid/, "answer grid CSS missing");
  assert.match(appSrc, /<article style=\{S\.answerCard\} className="cb-answer-enter cb-article"/, "article not on the answer-enter contract");
  assert.match(appSrc, /\.cb-ev-rail/, "evidence rail CSS missing");
  const railCssStart = appSrc.indexOf(".cb-ev-rail {");
  const railCss = appSrc.slice(railCssStart, railCssStart + 200);
  assert.ok(/position: sticky/.test(railCss), "rail is not sticky");
  assert.match(appSrc, /function AnswerDiagnostics/, "AnswerDiagnostics missing");
  assert.match(appSrc, /className="cb-diag"/, "diagnostics disclosure not on the contract");
  assert.match(appSrc, /Answer diagnostics/, "diagnostics disclosure title missing");
});

await test("question is a serif title with a quiet mono metadata line", () => {
  assert.match(appSrc, /className="cb-serif"/, "serif title missing");
  assert.match(appSrc, /className="cb-mono"/, "mono metadata missing");
  // The decorative "Inquiry" label + dot are retired (comments may mention it).
  const code = appSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/>Inquiry</.test(code), "Inquiry label still rendered");
});

await test("answer card is fully opaque paper", () => {
  const start = appSrc.indexOf("answerCard: {");
  const block = appSrc.slice(start, appSrc.indexOf("},", start));
  assert.ok(!/withAlpha\(P\.surface/.test(block), "answer card still translucent");
  assert.ok(/background: P\.surface/.test(block), "answer card not on solid surface");
});

await test("no bare Degraded chip — pipeline honesty lives in diagnostics", () => {
  const code = appSrc.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/>\s*Degraded\s*</.test(code), "bare Degraded chip still rendered");
  assert.match(appSrc, /Answer diagnostics/, "diagnostics replacement missing");
});

await test("claim spine: cited paragraphs record claims, rail inverts them", () => {
  assert.match(appSrc, /className="cb-claim"/, "claim wrapper missing");
  assert.match(appSrc, /className="cb-claim-refs"/, "claim reference gutter missing");
  assert.match(appSrc, /claimSink\.push\(\{ claim: claimNo, cites: paraCites \}\)/, "claim spine not recorded");
  assert.match(appSrc, /Supports claim/, "rail claim-support line missing");
  assert.match(appSrc, /data-rel="supports"|data-rel="qualifies"|data-rel="conflicts"/, "ledger data-rel contract missing");
  assert.match(appSrc, /onActivate=\{onActivateCite\}/, "rail row activation not wired");
});

await test("no animated typing: no stagger, no settings row", () => {
  assert.match(appSrc, /const answerRevealRef = useRef\(null\)/, "answer stagger not retired");
  const code = appSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/label="Animated typing"/.test(code), "Animated typing settings row still rendered");
});

await test("evidence band tabs use the underlined tab contract", () => {
  const start = appSrc.indexOf("function EvidenceBand");
  const block = appSrc.slice(start, appSrc.indexOf("function stripFallbackChrome", start));
  assert.ok(/className="cb-tabrow"/.test(block), "band not on the tabrow contract");
  assert.ok(/className="cb-tab"/.test(block), "band not on the tab contract");
  assert.ok(!/<SegControl/.test(block), "band still uses the segmented control");
});

// ══════════════════════════════════════════════════════════════════════════
group("TurnInner — no temporal-dead-zone reads in eagerly evaluated initializers");

// 2026-09-17 regression: the overflowItems IIFE read `generatingPaper` in a
// menu-item label while evaluating, but the useState for `generatingPaper`
// sat BELOW the IIFE — every completed answer thread crashed with
// "Cannot access '…' before initialization". This test walks TurnInner and
// fails if any eagerly evaluated code (the component body, an IIFE, or a
// useMemo/useState initializer) reads a let/const declared later in the
// component body.
await test("eager initializers never read bindings declared later", () => {
  const turnFn = ast.program.body.find(
    (n) => n.type === "FunctionDeclaration" && n.id.name === "TurnInner"
  );
  assert.ok(turnFn, "TurnInner not found in source");
  const patNames = (p, out = []) => {
    if (!p) return out;
    if (p.type === "Identifier") out.push(p.name);
    else if (p.type === "ObjectPattern") p.properties.forEach((x) => patNames(x.type === "ObjectProperty" ? x.value : x.argument, out));
    else if (p.type === "ArrayPattern") p.elements.forEach((e) => patNames(e, out));
    else if (p.type === "RestElement") patNames(p.argument, out);
    else if (p.type === "AssignmentPattern") patNames(p.left, out);
    return out;
  };
  const bindings = new Map();
  for (const st of turnFn.body.body) {
    if (st.type === "VariableDeclaration")
      for (const d of st.declarations)
        for (const name of patNames(d.id))
          if (!bindings.has(name)) bindings.set(name, d.start);
  }
  const problems = [];
  const EAGER_HOOKS = new Set(["useMemo", "useState"]);
  function walk(node, eager, parent) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Identifier") {
      const isProp = parent && parent.type === "MemberExpression" && parent.property === node && !parent.computed;
      const isKey = parent && ((parent.type === "ObjectProperty" && parent.key === node && !parent.computed) || (parent.type === "ObjectMethod" && parent.key === node));
      const isDecl = parent && parent.type === "VariableDeclarator" && parent.id === node;
      const isParam = parent && /Function/.test(parent.type) && parent.params.includes(node);
      if (!isProp && !isKey && !isDecl && !isParam && eager) {
        const declAt = bindings.get(node.name);
        if (declAt !== undefined && node.start < declAt)
          problems.push(`'${node.name}' read at ${node.loc.start.line} before declaration`);
      }
      return;
    }
    // Nested function boundary: deferred unless immediately invoked or an
    // eager-hook initializer.
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      const invoked = parent && parent.type === "CallExpression" && parent.callee === node;
      const hookInit = parent && parent.type === "CallExpression" &&
        parent.callee.type === "Identifier" && EAGER_HOOKS.has(parent.callee.name) &&
        parent.arguments[0] === node;
      const childEager = eager && (invoked || hookInit);
      for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "params") continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach((c) => c && c.type && walk(c, childEager, node));
        else if (v && v.type) walk(v, childEager, node);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && c.type && walk(c, eager, node));
      else if (v && v.type) walk(v, eager, node);
    }
  }
  walk(turnFn.body, true, null);
  assert.equal(problems.length, 0, "TDZ reads in TurnInner: " + problems.slice(0, 5).join("; "));
});

await test("paper/print state is declared above the overflowItems IIFE", () => {
  const genAt = appSrc.indexOf("const [generatingPaper, setGeneratingPaper]");
  const iifeAt = appSrc.indexOf("const overflowItems = (() =>");
  assert.ok(genAt !== -1 && iifeAt !== -1, "expected declarations not found");
  assert.ok(genAt < iifeAt, "generatingPaper state must be declared before the overflowItems IIFE evaluates it");
});

// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("answer-experience.mjs failed:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
  process.exit(1);
}
