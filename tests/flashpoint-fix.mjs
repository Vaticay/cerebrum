/**
 * Flashpoint defect repairs (v6.4).
 *
 * From live QA of the soil-cracking answer (production sha 4aad3c0):
 *   BUG 1 — the expanded "FLASHPOINTS · 1 CONFLICTING CLAIM PAIR" card
 *   printed literal "**100%**" and literal "## What the research shows
 *   ### Crack · Soil · Moisture". Markdown markers leaked onto the screen
 *   because the panel rendered mined claim fragments as raw text.
 *   BUG 2 — FLASHPOINTS claimed "1 CONFLICTING CLAIM PAIR" while "Where
 *   researchers disagree" simultaneously said "No opposing findings
 *   surfaced across the 3 sources". The verdict was computed from the
 *   source-level conflict pass alone, but the panel renders source-level
 *   pairs PLUS the text-mining recall pass.
 *
 * Unit tests against the real exports (no server, no network) plus
 * structural assertions over both source files.
 *
 * Run with: node tests/flashpoint-fix.mjs
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
  detectSourceConflicts,
  extractLiteratureConflicts,
  buildDisagreementVerdict,
  reconcileDisagreementVerdict,
  remapConflictIndices,
} = await import(join(root, "functions/api/search.js"));

const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

// ── Fixtures ──────────────────────────────────────────────────────────────
// Three papers whose own claims never oppose each other (source-level pass
// finds nothing), so any pair must come from the text-mining recall pass.
const CALM_PAPERS = [
  {
    title: "Soil crack geometry in depositional crusts",
    abstract: "Cracks were measured in depositional crusts. The crack network showed polygonal patterns across drying cycles.",
    year: "2025",
  },
  {
    title: "Desiccation cracking of clay soils",
    abstract: "Clay soils develop desiccation cracks during drying. Crack spacing depends on layer thickness and mineralogy.",
    year: "2018",
  },
  {
    title: "Moisture gradients drive soil cracking",
    abstract: "Moisture gradients drive tensile stress in drying soil. Cracking initiates at the surface and propagates downward.",
    year: "2009",
  },
];
const CALM_SOURCES = CALM_PAPERS.map((p) => ({ title: p.title }));

// ══════════════════════════════════════════════════════════════════════════
group("BUG 2 — verdict and Flashpoints panel can never disagree");

// The live incident, reproduced: source-level pass finds nothing, the
// text-mining recall pass finds one genuine pair (same topic, opposite
// directions). The reconciled verdict must read "divided" — the panel and
// the verdict read the same final list.
await test("recall-pass pair flips the verdict to divided", () => {
  const answer =
    "Soil organic carbon was significantly higher in treatment plots [1]. " +
    "Soil organic carbon was markedly lower in control plots [2].";
  const detected = detectSourceConflicts(CALM_PAPERS);
  assert.equal(detected.conflicts.length, 0, "fixture should have no source-level conflicts");
  assert.equal(detected.verdict.status, "settled", "source-level verdict alone says settled (the old bug)");
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 1, "text mining should surface the pair");
  const { conflicts, verdict } = reconcileDisagreementVerdict(detected, mined);
  assert.equal(conflicts.length, 1);
  assert.equal(verdict.status, "divided", "verdict must agree with the panel");
  assert.equal(verdict.conflictCount, conflicts.length);
  assert.match(verdict.summary, /genuinely split/);
});

await test("verdict.status is divided iff the panel has pairs (agreement invariant)", () => {
  const scenarios = [
    { papers: CALM_PAPERS, answer: "Nothing cited here at all." },
    { papers: CALM_PAPERS, answer: "Soil organic carbon was higher in plots [1]. Soil organic carbon was lower in controls [2]." },
  ];
  for (const s of scenarios) {
    const detected = detectSourceConflicts(s.papers);
    const mined = detected.conflicts.length === 0 ? extractLiteratureConflicts(s.answer, CALM_SOURCES) : [];
    const { conflicts, verdict } = reconcileDisagreementVerdict(detected, mined);
    assert.equal(verdict.status === "divided", conflicts.length > 0,
      `verdict ${verdict.status} disagrees with ${conflicts.length} pairs`);
    assert.equal(verdict.conflictCount, conflicts.length, "conflictCount must match the panel");
  }
});

await test("no conflicts anywhere stays settled with 3+ sources", () => {
  const detected = detectSourceConflicts(CALM_PAPERS);
  const { conflicts, verdict } = reconcileDisagreementVerdict(detected, []);
  assert.equal(conflicts.length, 0);
  assert.equal(verdict.status, "settled");
  assert.match(verdict.summary, /No opposing findings were detected/);
  assert.match(verdict.summary, /3 cited sources/);
});

await test("fewer than 3 sources still yields thin, not a false consensus", () => {
  const detected = detectSourceConflicts(CALM_PAPERS.slice(0, 2));
  const { verdict } = reconcileDisagreementVerdict(detected, []);
  assert.equal(verdict.status, "thin");
  assert.match(verdict.summary, /not a consensus/);
});

await test("verdict never prints a raw undefined topic", () => {
  const v = buildDisagreementVerdict([{ claimA: "x", claimB: "y" }], 3);
  assert.equal(v.status, "divided");
  assert.ok(!v.summary.includes("undefined"), "summary leaked undefined");
});

await test("pipeline computes the verdict from the final combined list", () => {
  assert.match(
    searchSrc,
    /reconcileDisagreementVerdict\(detected, textMined\)/,
    "pipeline must reconcile instead of using detected.verdict alone"
  );
  assert.ok(
    !/const disagreementVerdict = detected\.verdict;/.test(searchSrc),
    "old verdict-from-partial-list line must be gone"
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("BUG 2 — Pattern 3 only fires on genuine same-topic opposition");

// Opposite adjectives about DIFFERENT things are not a conflict. Before
// the topic gate, "higher rates [1]" vs "lower response [2]" on unrelated
// dimensions produced a bogus "conflicting claim pair".
await test("opposite adjectives on different topics produce no pair", () => {
  const answer =
    "Photosynthetic rates were significantly higher in sun leaves [1]. " +
    "Stomatal conductance showed a lower response in shade leaves [2].";
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 0, "different-topic opposition must not be a flashpoint");
});

await test("opposite adjectives on the same topic still produce a pair", () => {
  const answer =
    "Soil organic carbon was significantly higher in treatment plots [1]. " +
    "Soil organic carbon was markedly lower in control plots [2].";
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 1, "same-topic opposition must still surface");
});

// ══════════════════════════════════════════════════════════════════════════
group("BUG 1 — no raw markdown in mined flashpoint claims");

// The live incident: the miner sliced "## What the research shows\n###
// Crack · Soil · Moisture" into a claim. Block-level markers are stripped
// at the source; inline **bold** is kept for the frontend to render.
await test("heading markers are stripped from mined claims", () => {
  const answer =
    "## What the research shows\n### Crack · Soil · Moisture\n" +
    "Soil organic carbon was significantly higher in treatment plots [1]. " +
    "Soil organic carbon was markedly lower in control plots [2].";
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 1);
  for (const c of mined) {
    for (const t of [c.claimA, c.claimB]) {
      assert.ok(!/#{1,6}(?=\s)/.test(t), `heading marker leaked: ${t.slice(0, 60)}`);
    }
  }
  assert.ok(!mined[0].claimA.includes("##"), "## leaked into claimA");
});

await test("frontend renders flashpoint claims through renderFlashpointClaim", () => {
  assert.ok(appSrc.includes("function renderFlashpointClaim"), "renderFlashpointClaim not defined");
  assert.ok(appSrc.includes("renderFlashpointClaim(c.claimA, P)"), "claimA not rendered through renderFlashpointClaim");
  assert.ok(appSrc.includes("renderFlashpointClaim(c.claimB"), "claimB not rendered through renderFlashpointClaim");
  assert.ok(!appSrc.includes("{c.claimA}</div>"), "raw {c.claimA} rendering still present");
  assert.ok(!appSrc.includes('{c.claimB || "—"}</div>'), "raw {c.claimB} rendering still present");
});

await test("renderFlashpointClaim strips block markers before inline rendering", () => {
  assert.ok(appSrc.includes('#{1,6}(?=\\s)'), "heading-strip regex missing from renderFlashpointClaim");
  assert.ok(appSrc.includes("renderInlineMdLite(stripped, P)"), "must delegate inline markdown to renderInlineMdLite");
});

// ══════════════════════════════════════════════════════════════════════════
group("Verdict correctness — no fabricated disputes (2026-10-14)");

// A contrast word bridging two citations about DIFFERENT subjects is
// how the miner used to fabricate a dispute: any "however" between two
// cited claims became a conflicting pair. The pair now has to pass the
// same gate as the source-level pass: same topic, opposing direction.
await test("a contrast word across different topics produces no pair", () => {
  const answer =
    "One trial [1] found that biochar increased soil microbial activity and soil respiration in the field plots. " +
    "However, a second trial [2] reported that spring rainfall decreased wheat yields across the northern region.";
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 0, "cross-topic contrast must not be a flashpoint");
});

await test("a contrast word on the same topic in opposite directions still produces a pair", () => {
  const answer =
    "One trial [1] found that biochar increased soil microbial activity and soil respiration in field plots. " +
    "However, a second trial [2] reported that biochar decreased soil microbial activity and soil respiration in field plots.";
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 1, "same-topic opposing contrast must still surface");
  assert.equal(mined[0].idxA, 1);
  assert.equal(mined[0].idxB, 2);
  assert.equal(mined[0].sourceA, CALM_SOURCES[0].title);
  assert.equal(mined[0].sourceB, CALM_SOURCES[1].title);
  assert.ok(mined[0].claimA.length > 0 && mined[0].claimB.length > 0, "both sides must carry a claim");
});

// The old Pattern 2 paired citations that merely stood near conflict
// vocabulary and shipped one sentence as claimA with claimB empty: a
// dispute with only one side. Conflict language alone is not a pair.
await test("conflict vocabulary near two citations produces no one-sided pair", () => {
  const answer =
    "These findings conflict with the earlier reports [1] and contradict the later ones [2] in the literature.";
  const mined = extractLiteratureConflicts(answer, CALM_SOURCES);
  assert.equal(mined.length, 0, "conflict language without two opposing claims must not be a flashpoint");
  assert.ok(!/claimB: ""/.test(searchSrc), "the one-sided Pattern 2 pair builder must stay gone");
});

// The divided summary states the split counted from the pairs. It used
// to name a "sharpest" point built from the first pair's topic label .
// the longest shared words of two claims strung together, which read
// as word salad and could name fragments of unrelated claims.
await test("divided summary states the split and never a sharpest topic salad", () => {
  const v = buildDisagreementVerdict([
    { idxA: 1, idxB: 2, topic: "memory consolidation performance" },
    { idxA: 1, idxB: 3, topic: "sleep quality adults" },
  ], 5);
  assert.equal(v.status, "divided");
  assert.deepEqual(v.sides, { a: 1, b: 2 });
  assert.match(v.summary, /genuinely split on 2 points/);
  assert.match(v.summary, /1 cited source appears on one side of those points and 2 on the other/);
  assert.ok(!/sharpest/.test(v.summary), "summary still names a sharpest point");
  assert.ok(!/consolidation/.test(v.summary), "summary leaked a pair's topic fragments");
  const single = buildDisagreementVerdict([{ idxA: 2, idxB: 5, topic: "anything" }], 5);
  assert.match(single.summary, /genuinely split on one point/);
  assert.match(single.summary, /1 cited source appears on one side of it and 1 on the other/);
});

// ══════════════════════════════════════════════════════════════════════════
group("Verdict correctness — flashpoint indices are 1 based into the shipped list");

// detectSourceConflicts numbers its own papers from 1, and every index
// it ships must resolve to the paper the pair names.
await test("detector indices resolve to the papers the pair names", () => {
  const papers = [
    {
      title: "Fasting and insulin sensitivity trial",
      abstract: "Intermittent fasting increased insulin sensitivity in adults with obesity. Insulin sensitivity improved after twelve weeks of fasting.",
      year: 2024,
    },
    {
      title: "Calm soil paper",
      abstract: "Cracks were measured in depositional crusts. The crack network showed polygonal patterns across drying cycles.",
      year: 2020,
    },
    {
      title: "Fasting and insulin sensitivity study",
      abstract: "Intermittent fasting decreased insulin sensitivity in adults with obesity. Insulin sensitivity declined after twelve weeks of fasting.",
      year: 2023,
    },
  ];
  const detected = detectSourceConflicts(papers);
  assert.ok(detected.conflicts.length >= 1, "fixture should produce a genuine pair");
  for (const c of detected.conflicts) {
    assert.ok(c.idxA >= 1 && c.idxA <= papers.length, `idxA ${c.idxA} out of range`);
    assert.ok(c.idxB >= 1 && c.idxB <= papers.length, `idxB ${c.idxB} out of range`);
    assert.equal(papers[c.idxA - 1].title, c.sourceA, "idxA does not resolve to sourceA");
    assert.equal(papers[c.idxB - 1].title, c.sourceB, "idxB does not resolve to sourceB");
  }
});

// The pipeline remap: subset positions (1 based, from the detector)
// become full list positions (1 based) via the cited papers' 0 based
// positions in the full list. The audited defect shipped the raw
// 0 based position, printing [0] and pointing [3] at the wrong paper.
await test("remapConflictIndices maps subset positions to full list positions, 1 based", () => {
  const shelf = [
    { title: "Full 1" }, { title: "Full 2" }, { title: "Full 3" },
    { title: "Full 4" }, { title: "Full 5" }, { title: "Full 6" },
  ];
  // The cited subset is full positions 1, 3, 5 (0 based [0, 2, 4]).
  const subsetConflicts = [
    { claimA: "x", claimB: "y", sourceA: "Full 1", sourceB: "Full 5", idxA: 1, idxB: 3 },
    { claimA: "x", claimB: "y", sourceA: "Full 3", sourceB: "Full 5", idxA: 2, idxB: 3 },
  ];
  const remapped = remapConflictIndices(subsetConflicts, [0, 2, 4]);
  assert.equal(remapped[0].idxA, 1);
  assert.equal(remapped[0].idxB, 5);
  assert.equal(remapped[1].idxA, 3);
  assert.equal(remapped[1].idxB, 5);
  for (const c of remapped) {
    assert.ok(c.idxA >= 1 && c.idxB >= 1, "a 0 based index survived the remap");
    assert.equal(shelf[c.idxA - 1].title, c.sourceA, "remapped idxA names a different paper");
    assert.equal(shelf[c.idxB - 1].title, c.sourceB, "remapped idxB names a different paper");
  }
});

await test("pipeline remaps through remapConflictIndices, never the raw 0 based position", () => {
  assert.match(searchSrc, /remapConflictIndices\(detectedSubset\.conflicts, citedIndices\)/,
    "pipeline must remap conflict indices through the tested helper");
  assert.ok(!/idxA: citedIndices\[c\.idxA - 1\],/.test(searchSrc),
    "the raw 0 based remap must stay gone");
});

// ══════════════════════════════════════════════════════════════════════════
if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
