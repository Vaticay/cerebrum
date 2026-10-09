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
  assert.match(verdict.summary, /consistent/);
  assert.match(verdict.summary, /3 sources/);
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
if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
