/**
 * Citation statements tests (2026-11-06, statements lane).
 *
 * The classifier contract, from the rhetorical function standard:
 * supporting requires the citing paper's own primary evidence agreeing
 * with the cited work; method use alone is mentioning, never
 * supporting; failed replication and contrary results are
 * contradicting; everything else is mentioning. The pipeline contract:
 * DOI normalization matches the tallies path, ingestion decisions are
 * clock honest, and S2 payloads shape into deduped, capped, classified
 * rows.
 *
 * Unit tests against the real modules — no server, no network.
 * Run with: node tests/statements-stance.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { classifyStatement, intentWord } = await import(join(root, "functions/lib/stance.js"));
const { normalizeDoi, needsIngest, shapeStatementRows, STATEMENTS_PER_ANCHOR_CAP } =
  await import(join(root, "functions/lib/statements.js"));

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

// ══════════════════════════════════════════════════════════════════════════
group("classifyStatement — contradicting");

await test("discredited and falsified verdicts are contradicting", () => {
  assert.equal(classifyStatement("Concerns about autism are a remnant of the discredited Wakefield article.", []).stance, "contradicting");
  assert.equal(classifyStatement("Vaccination trends fell after the falsified report by Wakefield linking MMR with autism.", []).stance, "contradicting");
  assert.equal(classifyStatement("Subsequent studies provided evidence that there is no link between the vaccine and autism.", []).stance, "contradicting");
  assert.equal(classifyStatement("The field has seen numerous replication problems since that paper.", []).stance, "contradicting");
});

await test("own results supporting prior work is supporting", () => {
  assert.equal(classifyStatement("Results support previous research on power posing; the posture was associated with power.", []).stance, "supporting");
  assert.equal(classifyStatement("These findings are broadly in line with the established literature on cognitive abilities.", []).stance, "supporting");
  assert.equal(classifyStatement("Meta analyses supplement positive studies, like the seminal study and the successful replications of its results.", []).stance, "supporting");
});

await test("failed replication is contradicting", () => {
  const r = classifyStatement("In a direct replication attempt, we failed to replicate the effect reported by Bem (2011).", ["result"]);
  assert.equal(r.stance, "contradicting");
});

await test("contrary results are contradicting", () => {
  const r = classifyStatement("Contrary to the findings of Carney et al. (2010), posture had no effect on hormone levels in our sample.", ["result"]);
  assert.equal(r.stance, "contradicting");
});

await test("in contrast framing is contradicting", () => {
  const r = classifyStatement("In contrast to earlier reports, the association was absent in every cohort we examined.", ["result"]);
  assert.equal(r.stance, "contradicting");
});

await test("no evidence found is contradicting when set against the anchor", () => {
  const r = classifyStatement("We found no evidence supporting the claim that the effect persists beyond the first session.", ["result"]);
  assert.equal(r.stance, "contradicting");
});

// ══════════════════════════════════════════════════════════════════════════
group("classifyStatement — supporting requires own evidence");

await test("own results consistent with the anchor is supporting", () => {
  const r = classifyStatement("Our results are consistent with the findings of Walker and Stickgold (2004), who showed that sleep supports consolidation.", ["result"]);
  assert.equal(r.stance, "supporting");
});

await test("we confirm the anchor's findings is supporting", () => {
  const r = classifyStatement("We confirm the findings of Jinek et al. (2012) in an independent set of cell lines.", ["result"]);
  assert.equal(r.stance, "supporting");
});

await test("we replicated the result is supporting", () => {
  const r = classifyStatement("In two preregistered studies we replicated the effect first reported by Yeager et al. (2019).", ["result"]);
  assert.equal(r.stance, "supporting");
});

// ══════════════════════════════════════════════════════════════════════════
group("classifyStatement — method use alone is mentioning");

await test("using the cited method is mentioning, not supporting", () => {
  const r = classifyStatement("Differential expression was computed using the DESeq2 method of Love et al. (2014).", ["methodology"]);
  assert.equal(r.stance, "mentioning");
});

await test("as described by is mentioning", () => {
  const r = classifyStatement("Reads were aligned as described by Li and Durbin (2009), with default parameters.", ["methodology"]);
  assert.equal(r.stance, "mentioning");
});

await test("method agreement does not become support", () => {
  const r = classifyStatement("We validated the assay protocol of Smith et al. (2018) and used it for all samples.", ["methodology"]);
  assert.equal(r.stance, "mentioning");
});

// ══════════════════════════════════════════════════════════════════════════
group("classifyStatement — neutral uses are mentioning");

await test("background attribution is mentioning", () => {
  const r = classifyStatement("Sleep is known to support memory consolidation (Walker and Stickgold, 2004).", ["background"]);
  assert.equal(r.stance, "mentioning");
});

await test("describing the cited work is mentioning", () => {
  const r = classifyStatement("Bem (2011) reported evidence for precognition in a series of nine experiments.", ["background"]);
  assert.equal(r.stance, "mentioning");
});

await test("empty text is mentioning with no cues", () => {
  const r = classifyStatement("", []);
  assert.equal(r.stance, "mentioning");
});

await test("intent words map to plain display words", () => {
  assert.equal(intentWord(["methodology"]), "Method");
  assert.equal(intentWord(["result"]), "Results");
  assert.equal(intentWord(["background"]), "Background");
  assert.equal(intentWord([]), null);
  assert.equal(intentWord(null), null);
});

// ══════════════════════════════════════════════════════════════════════════
group("pipeline — DOI normalization and ingest planning");

await test("normalizeDoi matches the tallies path", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1038/Nature12373"), "10.1038/nature12373");
  assert.equal(normalizeDoi("10.1000/xyz-1."), "10.1000/xyz-1");
  assert.equal(normalizeDoi("not a doi"), null);
  assert.equal(normalizeDoi(""), null);
});

await test("needsIngest: missing row ingests", () => {
  assert.equal(needsIngest(null, 1000), true);
});

await test("needsIngest: fresh ready row waits out the window", () => {
  const now = Date.now();
  assert.equal(needsIngest({ status: "ready", fetched_at: now - 1000, next_try: 0 }, now), false);
  assert.equal(needsIngest({ status: "ready", fetched_at: now - 31 * 24 * 3600 * 1000, next_try: 0 }, now), true);
});

await test("needsIngest: throttled row waits for next_try", () => {
  const now = Date.now();
  assert.equal(needsIngest({ status: "throttled", fetched_at: now - 1000, next_try: now + 60000 }, now), false);
  assert.equal(needsIngest({ status: "throttled", fetched_at: now - 1000, next_try: now - 1 }, now), true);
});

await test("needsIngest: a live collecting claim is left alone", () => {
  const now = Date.now();
  assert.equal(needsIngest({ status: "collecting", fetched_at: now, next_try: 0 }, now), false);
});

// ══════════════════════════════════════════════════════════════════════════
group("pipeline — payload shaping");

function edge(paperId, contexts, extra = {}) {
  return {
    contexts,
    intents: extra.intents || [],
    isInfluential: Boolean(extra.influential),
    citingPaper: {
      paperId,
      title: extra.title || "A citing paper",
      year: extra.year || 2020,
      externalIds: { DOI: extra.doi || "10.1000/citing-" + paperId },
    },
  };
}

await test("shapeStatementRows dedupes and classifies", () => {
  const rows = shapeStatementRows("10.1000/anchor", {
    total: 3,
    rows: [
      edge("p1", ["We failed to replicate the effect.", "We failed to replicate the effect."], { intents: ["result"] }),
      edge("p2", ["Sleep supports memory (Anchor, 2020)."], { intents: ["background"], year: 2023 }),
      edge("p3", [], {}),
    ],
  });
  assert.equal(rows.length, 2);
  const contra = rows.find((r) => r.citing_id === "p1");
  assert.equal(contra.stance, "contradicting");
  const mention = rows.find((r) => r.citing_id === "p2");
  assert.equal(mention.stance, "mentioning");
});

await test("shapeStatementRows caps the store per anchor", () => {
  const many = [];
  for (let i = 0; i < STATEMENTS_PER_ANCHOR_CAP + 40; i++) {
    many.push(edge("p" + i, ["Background sentence number " + i + " citing the anchor."], { year: 2000 + (i % 25) }));
  }
  const rows = shapeStatementRows("10.1000/anchor", { total: many.length, rows: many });
  assert.equal(rows.length, STATEMENTS_PER_ANCHOR_CAP);
});

await test("shapeStatementRows puts influential first", () => {
  const rows = shapeStatementRows("10.1000/anchor", {
    total: 2,
    rows: [
      edge("new", ["A recent background mention."], { year: 2025 }),
      edge("inf", ["An influential background mention."], { year: 2010, influential: true }),
    ],
  });
  assert.equal(rows[0].citing_id, "inf");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
