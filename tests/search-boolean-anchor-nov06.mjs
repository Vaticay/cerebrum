/**
 * Lane C successor (2026-11-06, boolean anchor diagnosis,
 * ~/workspace/cerebrum-boolean-anchor-diagnosis-nov06/report.md).
 *
 * The wave 3 Lane C boolean centrality change was reverted in
 * full for breaking 11 standing pins: it governed the boolean
 * by the gate's central concept list, and the gate backs almost
 * none of the pinned anchors (assay, weeks, catch, the sleep
 * trace phrase group all ship unbacked). The diagnosis proved a
 * narrow successor form against every pin, and this suite pins
 * that form:
 *
 * R1, closed class singletons. A bare singleton AND rung whose
 * term is a pronoun, quantifier, or reflexive drops. The hole
 * was a list gap at a known seam: isGateFunctionWord returns
 * false for "anything" and "itself", and the model singleton
 * path and phrase anchor scan never consult the closed class
 * filter the wave 17 hygiene wave used, so both words shipped
 * as AND requirements (WLK2's anything, SLT4's itself).
 *
 * R2, duplicate slots. A bare singleton AND rung whose term is
 * already a member of another rung's OR group drops (WLK2
 * shipped ("ten minutes") beside ("ten minute" OR
 * "ten minutes") for one slot). Bare singletons ONLY: group
 * rungs never drop, which is what holds the gut byte exact pin
 * below, whose gut group ships twice as two full OR groups.
 *
 * Explicitly NOT covered, by the diagnosis's pin proof: pasta
 * on WLK2 (blocked by the repair suite's assay pin, its weeks
 * pin, and the expansion suite's catch pin), the flour group on
 * SLT4 (blocked by the sleep trace pin), and the word problem
 * on SLT4 (a content word, not closed class). All three stay as
 * known defects and are asserted KEPT here.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildStructuredQuery, buildDynLookup } = await import(join(root, "functions/api/search.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  PASS", name);
  } catch (e) {
    failures.push(name + ": " + String(e && e.message || e).split("\n").slice(0, 3).join(" | "));
    console.log("  FAIL", name, "-", String(e && e.message || e).split("\n")[0]);
  }
}
function group(label) { console.log("\n== " + label); }

const WLK2_Q = "I eat a huge bowl of pasta then sit on the couch, would ten minutes walking after actually change anything in my blood".toLowerCase();
const SLT4_Q = "people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general".toLowerCase();
const SLT4_CHAIN = "(heart OR cardiovascular OR cardiac OR myocardial OR coronary OR atherosclerosis OR hypertension) AND (salt OR \"sodium chloride\" OR \"table salt\" OR \"salt intake\" OR \"dietary sodium\" OR salts OR sodium) AND problem";

group("R2 — the shipped WLK2 chain loses its duplicate slot and its closed class rung");

await test("WLK2 shipped form: duplicate singleton and anything drop, pasta stays", () => {
  // Reproduces the shipped chain ("ten minutes") AND
  // ("ten minute" OR "ten minutes") AND pasta AND anything.
  const dyn = buildDynLookup([
    { term: "ten minutes", alternates: [] },
    { term: "ten minute", alternates: ["ten minutes"] },
  ]);
  assert.equal(buildStructuredQuery(WLK2_Q, dyn), "(\"ten minute\" OR \"ten minutes\") AND pasta");
});

group("R1 — closed class singletons drop in every seating form");

await test("WLK2 bare anything drops beside the ten minutes group", () => {
  const dyn = buildDynLookup([{ term: "ten minutes", alternates: ["ten minute"] }]);
  assert.equal(
    buildStructuredQuery(WLK2_Q, dyn),
    "(\"ten minutes\" OR \"ten minute\") AND pasta AND walking"
  );
});

await test("WLK2 model singleton (anything) drops the same way", () => {
  const dyn = buildDynLookup([
    { term: "ten minutes", alternates: ["ten minute"] },
    { term: "anything", alternates: [] },
  ]);
  assert.equal(
    buildStructuredQuery(WLK2_Q, dyn),
    "(\"ten minutes\" OR \"ten minute\") AND pasta AND walking"
  );
});

await test("SLT4 model singleton (itself) drops, problem stays", () => {
  const dyn = buildDynLookup([{ term: "itself", alternates: [] }]);
  assert.equal(buildStructuredQuery(SLT4_Q, dyn), SLT4_CHAIN);
});

await test("SLT4 deterministic build drops bare itself, problem stays", () => {
  assert.equal(buildStructuredQuery(SLT4_Q, null), SLT4_CHAIN);
});

group("Controls — byte exact, untouched");

await test("WLK3 deterministic build byte exact", () => {
  assert.equal(
    buildStructuredQuery("after meal walk glucose", null),
    "(glucose OR \"type 2 diabetes\" OR \"type 1 diabetes\" OR \"insulin resistance\" OR \"metabolic syndrome\" OR diabetes OR diabetic) AND meal AND walk"
  );
});

await test("gut byte exact: the gut group ships twice and R2 never touches group rungs", () => {
  assert.equal(
    buildStructuredQuery("Are there any research papers that use insect gut homogenate in order to study enzyme activity, as opposed to purifying the enzymes from the gut homogenate?".toLowerCase(), null),
    "(gut OR \"peritrophic membrane\" OR \"alimentary canal\" OR \"digestive tract\" OR intestinal OR intestine OR digestive) AND (homogenate OR \"crude extract\" OR \"crude extracts\" OR \"gut extract\" OR \"gut extracts\" OR \"midgut homogenate\" OR \"midgut extract\") AND (enzymes OR enzyme OR enzymatic OR oxidase OR oxidases OR hydrolase OR hydrolases) AND (gut OR \"peritrophic membrane\" OR \"alimentary canal\" OR \"digestive tract\" OR intestinal OR intestine OR digestive)"
  );
});

await test("FEV2 chain byte exact: every anchor earns its slot", () => {
  assert.equal(
    buildStructuredQuery("what makes your temperature go up when you have a bug", null),
    "(temperature OR climate OR warming OR thermal OR heat) AND (bug OR \"stomach bug\" OR \"viral infection\" OR \"bacterial infection\" OR bugs OR pathogen OR pathogens) AND (fever OR \"body temperature\" OR \"set point\" OR fevers OR febrile OR pyrexia OR pyrogen)"
  );
});

await test("frog C degraded OR form byte exact and out of scope", () => {
  assert.equal(
    buildStructuredQuery("Why doesn't freezing kill some frogs in the winter?".toLowerCase(), null),
    "frogs OR freezing OR kill OR winter"
  );
});

await test("sleep trace phrase group authors the chain unchanged", () => {
  const dyn = buildDynLookup([{ term: "easier catch cold", alternates: ["increased susceptibility to colds", "elevated cold incidence"] }]);
  assert.equal(
    buildStructuredQuery("not sleep enough easier catch cold", dyn),
    "(\"easier catch cold\" OR \"increased susceptibility to colds\" OR \"elevated cold incidence\") AND (sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\")"
  );
});

await test("repair pins hold: weeks and assay keep their rungs", () => {
  assert.equal(
    buildStructuredQuery("does sleeping only six hours a night for two weeks make thinking worse", null),
    "(sleeping OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\") AND hours AND night AND weeks"
  );
  assert.equal(
    buildStructuredQuery("how is manganese peroxidase activity measured in a standard lab assay", null),
    "(\"manganese peroxidase\" OR \"breaks down wood\" OR \"breaking down wood\" OR \"wood breakdown\" OR \"wood decay\" OR \"lignin degradation\" OR \"white rot\") AND assay AND activity"
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("FAILED:", f);
  process.exit(1);
}
