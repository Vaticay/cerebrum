/**
 * Reference Check (2026-11-06, Scite audit wave, ballot decision 6).
 *
 * The DOI list checker contract: each pasted reference line yields
 * bibliography integrity (does the DOI resolve at Crossref, and
 * what paper does it name), publication integrity (the retraction
 * verdict from functions/lib/retraction.js under its multi signal
 * rule, never a second rule invented here), and the results order
 * by editorial concern, most concerning first: settled retraction,
 * then a reference that does not resolve, then a single channel
 * retraction report, an expression of concern, a correction, a
 * clean resolution, and finally what no channel could answer for.
 *
 * Fixtures mirror the live payloads probed on 2026-11-06 (the
 * Wakefield Lancet paper for the retracted case, a large Danish
 * cohort paper for the clean case).
 */
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}

const {
  extractDoiFromLine,
  parseReferenceLines,
  crossrefMeta,
  refCheckStatus,
  orderRefCheckResults,
  resolveReferenceChecks,
  CONCERN_TIERS,
} = await import(join(root, "functions/lib/refcheck.js"));

const RETRACTED_DOI = "10.1016/s0140-6736(97)11096-0";
const CLEAN_DOI = "10.7326/m18-2172";
const MISSING_DOI = "10.1234/this.paper.does.not.exist.0000";
const DOWN_DOI = "10.5555/unreachable.example.1";

await test("extractDoiFromLine finds a bare DOI and a DOI inside a citation line", () => {
  assert.equal(extractDoiFromLine("10.7326/M18-2172"), CLEAN_DOI);
  assert.equal(
    extractDoiFromLine("Wakefield AJ, et al. Ileal lymphoid nodular hyperplasia. Lancet. 1998;351(9103):637-641. doi:10.1016/S0140-6736(97)11096-0."),
    RETRACTED_DOI
  );
  assert.equal(extractDoiFromLine("https://doi.org/10.7326/M18-2172"), CLEAN_DOI);
  assert.equal(extractDoiFromLine("Smith J. A paper with no identifier at all. Journal. 2020."), null);
  assert.equal(extractDoiFromLine(""), null);
});

await test("parseReferenceLines splits lines, skips blanks, collapses duplicate DOIs to the first line", () => {
  const entries = parseReferenceLines([
    "",
    "10.7326/M18-2172",
    "Hviid A, et al. Measles, Mumps, Rubella Vaccination and Autism. Ann Intern Med. 2019. doi:10.7326/M18-2172",
    "A line with no DOI in it",
    "Another line with no DOI in it",
  ].join("\n"));
  assert.equal(entries.length, 3);
  assert.equal(entries[0].doi, CLEAN_DOI);
  assert.equal(entries[1].doi, null);
  assert.equal(entries[2].doi, null);
});

await test("crossrefMeta reads the record's own fields and nothing else", () => {
  const meta = crossrefMeta({
    title: ["Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children"],
    author: [{ family: "Wakefield", given: "Andrew J" }, { family: "Murch", given: "Simon H" }],
    issued: { "date-parts": [[1998, 2, 28]] },
    "container-title": ["The Lancet"],
  });
  assert.equal(meta.title.startsWith("Ileal-lymphoid-nodular hyperplasia"), true);
  assert.equal(meta.authors, "Wakefield AJ, Murch SH");
  assert.equal(meta.year, 1998);
  assert.equal(meta.journal, "The Lancet");
  assert.equal(crossrefMeta(null), null);
  assert.equal(crossrefMeta({}).title, null);
});

// A stub Crossref shaped like the live payloads: the retracted
// paper carries a Retraction Watch retraction in updated-by and a
// correction before it; the clean paper carries nothing.
function stubFetch({ crossrefDown = false } = {}) {
  const works = {
    [RETRACTED_DOI]: {
      message: {
        title: ["Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children"],
        author: [{ family: "Wakefield", given: "Andrew J" }],
        issued: { "date-parts": [[1998, 2, 28]] },
        "container-title": ["The Lancet"],
        "updated-by": [
          { type: "correction", DOI: "10.1016/S0140-6736(04)15715-2", source: "retraction-watch", updated: { "date-parts": [[2004, 3, 6]] } },
          { type: "retraction", DOI: "10.1016/S0140-6736(10)60175-4", source: "retraction-watch", updated: { "date-parts": [[2010, 2, 6]] } },
        ],
      },
    },
    [CLEAN_DOI]: {
      message: {
        title: ["Measles, Mumps, Rubella Vaccination and Autism: A Nationwide Cohort Study"],
        author: [{ family: "Hviid", given: "Anders" }],
        issued: { "date-parts": [[2019, 3, 5]] },
        "container-title": ["Annals of Internal Medicine"],
      },
    },
  };
  return async (url) => {
    if (crossrefDown && url.includes("api.crossref.org")) return null;
    if (url.includes("api.crossref.org/works/")) {
      const doi = decodeURIComponent(url.split("/works/")[1]).toLowerCase();
      if (works[doi]) return { status: 200, json: works[doi] };
      return { status: 404, json: null };
    }
    if (url.includes("api.openalex.org")) {
      return { status: 200, json: { results: [
        { doi: "https://doi.org/" + RETRACTED_DOI, is_retracted: true },
        { doi: "https://doi.org/" + CLEAN_DOI, is_retracted: false },
      ] } };
    }
    if (url.includes("europepmc")) {
      return { status: 200, json: { resultList: { result: [{ doi: RETRACTED_DOI, pmid: "9504513" }] } } };
    }
    if (url.includes("esummary.fcgi")) {
      return { status: 200, json: { result: { "9504513": { pubtype: ["Journal Article", "Retracted Publication"] } } } };
    }
    return null;
  };
}

await test("resolveReferenceChecks settles a retracted paper on three channels and resolves a clean one", async () => {
  const entries = parseReferenceLines([
    `Wakefield AJ, et al. Lancet. 1998. doi:10.1016/S0140-6736(97)11096-0`,
    "10.7326/M18-2172",
  ].join("\n"));
  const results = await resolveReferenceChecks(entries, stubFetch({}));
  const retracted = results.find((r) => r.doi === RETRACTED_DOI);
  const clean = results.find((r) => r.doi === CLEAN_DOI);
  assert.equal(retracted.resolves, true);
  assert.equal(retracted.status, "retracted");
  assert.equal(retracted.meta.journal, "The Lancet");
  assert.equal(retracted.meta.year, 1998);
  assert.ok(retracted.verdict.namedBy.includes("Retraction Watch"));
  assert.equal(clean.resolves, true);
  assert.equal(clean.status, "none");
  assert.equal(clean.meta.title.includes("Nationwide Cohort Study"), true);
});

await test("a DOI Crossref cannot find is unresolved; a line with no DOI is unresolved with doi null", async () => {
  const entries = parseReferenceLines([`10.1234/this.paper.does.not.exist.0000`, "A reference with no identifier"].join("\n"));
  const results = await resolveReferenceChecks(entries, stubFetch({}));
  assert.equal(results[0].status, "unresolved");
  assert.equal(results[0].resolves, false);
  assert.equal(results[1].status, "unresolved");
  assert.equal(results[1].doi, null);
});

await test("when Crossref cannot answer at all, the status is unknown, never unresolved and never clean", async () => {
  const entries = parseReferenceLines(["10.5555/unreachable.example.1"].join("\n"));
  const results = await resolveReferenceChecks(entries, stubFetch({ crossrefDown: true }));
  assert.equal(results[0].status, "unknown");
  assert.equal(results[0].resolves, null);
});

await test("refCheckStatus joins resolution and verdict without inventing states", () => {
  assert.equal(refCheckStatus({ doi: CLEAN_DOI, resolves: true, verdict: { status: "retracted" } }), "retracted");
  assert.equal(refCheckStatus({ doi: CLEAN_DOI, resolves: true, verdict: { status: "none" } }), "none");
  assert.equal(refCheckStatus({ doi: CLEAN_DOI, resolves: true, verdict: null }), "unknown");
  assert.equal(refCheckStatus({ doi: null, resolves: false, verdict: null }), "unresolved");
  assert.equal(refCheckStatus({ doi: MISSING_DOI, resolves: false, verdict: { status: "retracted" } }), "unresolved");
});

await test("orderRefCheckResults orders by editorial concern and is stable inside a tier", async () => {
  const rows = [
    { status: "none", line: "clean 1" },
    { status: "unknown", line: "unknown 1" },
    { status: "retracted", line: "retracted 1" },
    { status: "corrected", line: "corrected 1" },
    { status: "unresolved", line: "unresolved 1" },
    { status: "concern", line: "concern 1" },
    { status: "reported", line: "reported 1" },
    { status: "none", line: "clean 2" },
    { status: "retracted", line: "retracted 2" },
  ];
  const ordered = orderRefCheckResults(rows);
  assert.deepEqual(ordered.map((r) => r.line), [
    "retracted 1", "retracted 2", "unresolved 1", "reported 1", "concern 1", "corrected 1", "clean 1", "clean 2", "unknown 1",
  ]);
  assert.ok(CONCERN_TIERS.retracted < CONCERN_TIERS.unresolved);
  assert.ok(CONCERN_TIERS.unresolved < CONCERN_TIERS.reported);
});

console.log(`\nrefcheck: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
