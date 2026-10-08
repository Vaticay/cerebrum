/**
 * Regression guard for the 2026-10-07 GLP-1 false negative.
 *
 * Dusty asked a question Cerebrum had perfect matches for and got
 * "couldn't find a direct answer". Three causes were found and fixed in
 * functions/api/search.js:
 *   1. The query tokenizer split "GLP-1" into "glp" + "1".
 *   2. "Ozempic" had no link to "semaglutide" / "GLP-1" in SYNONYMS.
 *   3. The honesty gate (assessExtractionQuality) had no fallback: when the
 *      numeric relevance score was low but a paper's TITLE directly
 *      contained the query's key terms, the paper was scored as not
 *      strongly relevant and the answer was refused.
 *
 * This test guards fix (3) at the unit level: a paper whose relevance
 * number is below the strong bar must still count as strongly relevant
 * when its title directly contains 2+ significant query terms.
 *
 * Run with: node tests/glp1-honesty-gate.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Pre-fix verification: CEREBRUM_SEARCH_MODULE can point at an older
// copy of the module to confirm this test fails without the fix.
const modulePath = process.env.CEREBRUM_SEARCH_MODULE || join(root, "functions/api/search.js");

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

const { assessExtractionQuality, paperRelevance } = await import(modulePath);

const QUERY = "Do GLP-1 drugs protect the heart?";

function paper({ title, relevance }) {
  return {
    p: {
      title,
      relevance,
      abstract: "GLP-1 receptor agonist treatment was associated with reduced cardiac events in the study population.",
    },
    hasFindings: true,
    findings: ["Treatment reduced the risk of heart failure hospitalization compared with placebo."],
    titleClaim: "GLP-1 drugs protect the heart.",
  };
}

await test("paperRelevance reads the paper's numeric relevance score", () => {
  assert.equal(paperRelevance(paper({ title: "x", relevance: 40 }).p), 40);
});

await test("title-match fallback: weak score + title with 2+ query terms counts as strongly relevant", () => {
  // 40 is below the 65 strong bar, so without the fallback this paper would
  // anchor nothing and the user would get "couldn't find a direct answer".
  const item = paper({
    title: "GLP1 receptor agonists protect the heart in mice",
    relevance: 40,
  });
  const quality = assessExtractionQuality([item], { query: QUERY });
  assert.ok(quality.stats.strong >= 1, "expected the title-match fallback to count the paper as strongly relevant");
  assert.ok(
    !quality.reasons.some((r) => r.includes("strongly relevant")),
    "must not claim no papers were strongly relevant"
  );
});

await test("negative control: weak score + unrelated title stays weak", () => {
  const item = paper({
    title: "Bone mineral density in postmenopausal women treated with bisphosphonates",
    relevance: 40,
  });
  const quality = assessExtractionQuality([item], { query: QUERY });
  assert.equal(quality.stats.strong, 0, "unrelated title must not be rescued by the fallback");
  assert.ok(
    quality.reasons.some((r) => r.includes("strongly relevant")),
    "the honesty gate must still fire for genuinely off-topic papers"
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
