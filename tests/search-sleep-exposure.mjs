/**
 * Sleep diagnosis lane (2026-10-29): the restriction exposure
 * shape joins the foundational lane.
 *
 * The diagnosis, from the October 24 citation wave's saved
 * sleep record (probe 9, "what happens to your brain if you
 * only sleep six hours every night for two weeks straight"):
 * gathered 23, shelf 16, cited 8, and not one chronic sleep
 * restriction study in the gathered set — the papers died at
 * GATHERING. The executed queries carried the dose and
 * duration phrases and the topic words, but the phrase the
 * field files itself under ("sleep restriction") never
 * entered any query, and the engines' default relevance first
 * pages are era blind (live checks 2026-10-29: the 2003
 * restriction study sits outside Europe PMC's first hundred
 * hits for the shipped boolean; PubMed's shipped natural form
 * returns four papers, the 1974 pony study first). The same
 * engines given the restriction phrase group as a boolean
 * return that study first (PubMed) and second (Europe PMC,
 * citation order).
 *
 * The fix is one shape added to the foundational lane, on the
 * old logic: a question stating a sustained regimen of
 * restriction (a parsed dose or span, or a plain reduction
 * word) on a topic whose OWN concept group carries a
 * restriction phrase fires the lane with that phrase group as
 * a boolean. No phrase is invented: the sleep group has
 * carried "sleep restriction", "sleep restricted" and
 * "chronic sleep restriction" since it was authored.
 *
 * Questions are worded the way a person asks (the standing
 * mismatched language rule); the acceptance phrasings are
 * Topic B of the October 21 probe file, verbatim, with probe
 * 9's wording as the control.
 *
 * Run with: node tests/search-sleep-exposure.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  isRestrictionExposureShape, restrictionExposurePhrases, restrictionExposureBoolean,
} = search;

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

const PROBE9 = "what happens to your brain if you only sleep six hours every night for two weeks straight";
const B1 = "i have been getting by on about six hours a night for the last couple of weeks, is my thinking actually worse or do i just feel tired";
const B2 = "if someone shortens every night for two weeks and never catches up, what does that do to how well they can pay attention";
const B3 = "can you get used to sleeping less so it stops affecting you after a while";
const SLEEP_PHRASES = ["sleep restriction", "sleep restricted", "chronic sleep restriction"];
const SLEEP_BOOLEAN = "(\"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\")";

await test("the acceptance phrasings all state the shape", () => {
  for (const q of [PROBE9, B1, B2, B3]) {
    assert.equal(isRestrictionExposureShape(q), true, `no shape for: ${q}`);
  }
});

await test("the phrase group is the sleep group's own restriction phrases, in table order", () => {
  for (const q of [PROBE9, B1, B2, B3]) {
    assert.deepEqual(restrictionExposurePhrases(q), SLEEP_PHRASES, `phrases differ for: ${q}`);
  }
});

await test("the lane boolean is the quoted phrase group and nothing else", () => {
  for (const q of [PROBE9, B1, B2, B3]) {
    assert.equal(restrictionExposureBoolean(q), SLEEP_BOOLEAN, `boolean differs for: ${q}`);
  }
});

await test("B1 and B2 fire with no sleep word in the question (the per night reading)", () => {
  // Neither phrasing says "sleep": B1 states the dose in hours
  // a night, B2 states a span beside "every night". The
  // reading names sleep as a candidate; the phrases still
  // come from the tables.
  assert.ok(!/\bsleep/.test(B1) && !/\bsleep/.test(B2));
  assert.equal(isRestrictionExposureShape(B1), true);
  assert.equal(isRestrictionExposureShape(B2), true);
});

await test("B3 fires on the reduction word alone, with no stated dose or span", () => {
  assert.equal(isRestrictionExposureShape(B3), true);
});

await test("a bare topic mention fires nothing (the definition ask keeps today's path)", () => {
  assert.deepEqual(restrictionExposurePhrases("what is sleep restriction"), SLEEP_PHRASES);
  assert.equal(isRestrictionExposureShape("what is sleep restriction"), false);
});

await test("other shapes' questions stay out of the shape", () => {
  const controls = [
    "how does crispr cas9 actually cut dna",
    "does eating yogurt actually help your gut",
    "what is the standard lab assay for manganese peroxidase activity",
    "my grandma swears a spoon of honey on a burn helps it close up sooner, is there anything real behind that",
    "how does the heart pump blood",
    "can you feed maggots leftover frying grease and will they still grow fine and be safe to use",
    "how long do black soldier fly larvae take to grow on food waste",
  ];
  for (const q of controls) {
    assert.equal(isRestrictionExposureShape(q), false, `shape fired for: ${q}`);
    assert.equal(restrictionExposurePhrases(q), null, `phrases built for: ${q}`);
  }
});

await test("the lane gate carries the shape and its legs carry the boolean", () => {
  assert.ok(/if \(mechanismShape \|\| methodShape \|\| healthShape \|\| comparisonShape \|\| exposureShape\)/.test(src),
    "the foundational lane gate does not include the exposure shape");
  assert.ok(/europePMC\(exposureBoolean, 12, ledger, \{ sort: "CITED desc" \}\)/.test(src),
    "the Europe PMC exposure leg lost its citation order or its boolean");
  assert.ok(/pubmed\(exposureBoolean, 12, ncbiKey, ledger, \{ structuredQuery: exposureBoolean \}\)/.test(src),
    "the PubMed exposure leg is missing");
  assert.ok(/exposureShape \? "exposure"/.test(src),
    "the lane's recorded shape does not name the exposure shape");
});

await test("the cache chain carries the v56 entry with its dated reason", () => {
  assert.ok(src.includes("const CACHE_SCHEMA_VERSION = \"v56\";"),
    "CACHE_SCHEMA_VERSION was not bumped to v56");
  assert.ok(/\/\/ v56 \(2026-10-29, sleep diagnosis lane\)/.test(src),
    "the v56 chain entry is missing its dated reason");
  assert.ok(/\/\/ v55 \(2026-10-23, logic audit repair wave 3, stage 2\)/.test(src),
    "the v55 chain entry was not kept as history");
});

console.log(`\nsearch-sleep-exposure: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
