/**
 * Gathering losses fix proofs (2026-11-06).
 *
 * Spec: the gathering losses lane diagnosis and design
 * (~/workspace/cerebrum-gathering-fix-nov06/). The live batch
 * on 712e8cc (20 plain wording probes, judged on pool and
 * cited titles) confirmed a family of losses at the GATHERING
 * stage, before any gate judgement: the question's own words
 * resolved to no concept group, so no deterministic rung,
 * gate group, or scorer set carried the concept at all.
 *
 *   BSF1: "maggots" and "grease" resolved to nothing. The one
 *   on topic paper (kitchen waste oil biotransformation in
 *   Hermetia illucens) sat in the excluded weak list.
 *   TEN4 resolved nothing at all: "asleep" and "body clock"
 *   are the asker's words for the sleep concept and its
 *   circadian mechanism, and neither had a group. TEN1 reached
 *   only caffeine (through "wired"); the teen population words
 *   and the high school phrase rode as bare words everywhere.
 *
 * The fix is vocabulary only, on the existing logic, in the
 * wave seventeen pattern: tail appends to the insect, waste
 * oil, and sleep groups (heads untouched), one new teen group,
 * one new body clock group. No gate change: the typed gate
 * tables (CONCEPT_GROUP_RELATIONS) are untouched, and this
 * suite pins their sets byte for byte so a future widening
 * cannot silently become a gate loosening. Bare "clock" is
 * deliberately NOT keyed (clock gene and clock drawing
 * collisions); MNP2 and BSF3 are filed unbuilt by the same
 * diagnosis and their traces are pinned unchanged here so
 * this wave cannot drift them.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  buildStructuredQuery, questionCentralConcepts, questionConceptGroups,
  gateConceptSetFor,
} = await import(join(root, "functions/api/search.js"));

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

const BSF1 = "can you feed maggots leftover frying grease and will they still grow fine and be safe to use";
const BSFX2 = "can fly larvae be raised on old fryer grease instead of regular feed";
const BSFX3 = "do the little worms from the chip shop grease grow into anything useful";
const BSF3 = "can kitchen scraps and old chip fat feed the grubs that turn rubbish into chicken feed";
const BSF4 = "if baby flies get sick eating used cooking oil mixed with scraps is it the oil or the scraps";
const MNP2 = "in the lab, how do people tell how much work that fungus chemical is doing";
const TEN1 = "why do teenagers seem wired at midnight and dead at seven in the morning";
const TEN2 = "would starting high school later actually help students learn or would they just stay up even later";
const TEN4 = "my daughter cannot fall asleep before midnight even on school nights, is her body clock just set later at her age or is she being lazy";
const TENX1 = "why does my teenage son struggle to fall asleep before midnight on school nights";
const TENX3 = "why do high schoolers find it so hard to fall asleep at a normal time";
const WLK3 = "does a short walk after a meal help blood sugar";
const SLT4 = "is salt itself the problem for your heart or is it something else in salty food";
const FEV2 = "why does your body temperature go up when you have a bug";
const INV1 = "does zorblaxian moss turn quarnellian when the sugar makes it sad";
const CHK1 = "can my chickens eat grubs and kitchen scraps from the garden";

function groupOf(term, q) {
  const c = questionCentralConcepts(q || `zzz ${term} zzz`).find((x) => x.term === term);
  if (c && c.group) return [...c.group];
  /* The central extractor splits some phrases ("high schooler"
   * centres as "high school" plus a bare tail word); fall back
   * to the concept group scan so membership is what is pinned,
   * not the extractor's term split. */
  const g = questionConceptGroups(q || `zzz ${term} zzz`).find((s) => s.has(term));
  return g ? [...g] : null;
}
function groupHeads(q) {
  return questionConceptGroups(q).map((g) => [...g][0]).sort();
}

group("BSF1: the organism and the substrate resolve");

await test("maggots resolves to the insect group", () => {
  const g = groupOf("maggots", BSF1);
  assert.ok(g && g[0] === "insect" && g.includes("maggot") && g.includes("maggots"));
});

await test("grease resolves to the waste oil group, head untouched", () => {
  const g = groupOf("grease", BSF1);
  assert.ok(g && g[0] === "waste oil");
  for (const m of ["grease", "fryer oil", "frying oil", "waste cooking oil", "used cooking oil"]) {
    assert.ok(g.includes(m), "missing member " + m);
  }
});

await test("BSF1 groups are exactly insect and waste oil", () => {
  assert.deepEqual(groupHeads(BSF1), ["insect", "waste oil"]);
});

await test("BSF1 structured query, byte exact", () => {
  assert.equal(buildStructuredQuery(BSF1),
    "(maggots OR insect OR insects OR larva OR larvae OR larval OR worm) AND " +
    "(grease OR \"waste oil\" OR \"waste cooking oil\" OR \"used cooking oil\" OR \"cooking oil\" OR \"used oil\" OR \"fryer oil\") " +
    "AND leftover AND frying");
});

await test("BSFx2 structured query seats the waste oil group, byte exact", () => {
  assert.equal(buildStructuredQuery(BSFX2),
    "(fly OR insect OR insects OR larva OR larvae OR larval OR worm) AND " +
    "(grease OR \"waste oil\" OR \"waste cooking oil\" OR \"used cooking oil\" OR \"cooking oil\" OR \"used oil\" OR \"fryer oil\") AND " +
    "(larvae OR insect OR insects OR larva OR larval OR worm OR worms) AND raised");
});

group("BSFx3: the chip collision rung does not widen");

await test("BSFx3 insect rung is byte identical to the pre fix form", () => {
  const s = buildStructuredQuery(BSFX3);
  assert.ok(s.startsWith("(worms OR insect OR insects OR larva OR larvae OR larval OR worm) AND chip AND "),
    "insect rung or chip rung moved: " + s);
  assert.ok(!s.includes("maggot"), "the tail append leaked into the BSFx3 rung");
  assert.ok(!s.toLowerCase().includes("chromatin"), "collision vocabulary entered the boolean");
});

await test("BSFx3 grease rung is the waste oil group, byte exact whole form", () => {
  assert.equal(buildStructuredQuery(BSFX3),
    "(worms OR insect OR insects OR larva OR larvae OR larval OR worm) AND chip AND " +
    "(grease OR \"waste oil\" OR \"waste cooking oil\" OR \"used cooking oil\" OR \"cooking oil\" OR \"used oil\" OR \"fryer oil\")");
  // Note: the pre Lane C form carried a trailing "AND anything"
  // rung; the boolean anchor land (15705da, R1) drops that
  // closed class singleton, and the pin above records the
  // composed form on current main.
});

group("Gate sets are unchanged (widening is not a gate change)");

await test("waste oil gate set is still its typed synonyms only", () => {
  const g = groupOf("grease", BSF1);
  const gate = gateConceptSetFor(new Set(g));
  assert.deepEqual([...gate].sort(), ["used cooking oil", "waste cooking oil", "waste oil"]);
});

await test("sleep gate set is still its typed synonyms and narrower forms only", () => {
  const c = questionCentralConcepts(TEN4).find((x) => x.term === "asleep");
  assert.ok(c && c.group, "asleep did not resolve");
  const gate = gateConceptSetFor(c.group);
  assert.deepEqual([...gate].sort(), [
    "chronic sleep restriction", "short sleep", "sleep", "sleep deprivation",
    "sleep deprived", "sleep loss", "sleep restricted", "sleep restriction",
    "sleeping", "slept",
  ]);
  assert.ok(!gate.has("asleep"), "the widening word became a gate touch");
});

group("Teen sleep cluster: population and mechanism resolve");

await test("teen group joins the asker's words to the literature's", () => {
  for (const t of ["teen", "teens", "teenage", "teenager", "teenagers",
    "adolescent", "adolescents", "adolescence", "puberty", "pubertal",
    "high school", "high schooler", "high schoolers"]) {
    const g = groupOf(t);
    assert.ok(g && g[0] === "teen", t + " did not resolve to the teen group");
  }
});

await test("body clock group carries the circadian vocabulary", () => {
  for (const t of ["body clock", "circadian", "chronotype", "delayed sleep phase"]) {
    const g = groupOf(t);
    assert.ok(g && g[0] === "body clock", t + " did not resolve to the body clock group");
  }
});

await test("bare clock resolves to NO group (deliberate non keying)", () => {
  assert.deepEqual(questionConceptGroups("zzz clock zzz"), []);
  const c = questionCentralConcepts("teen brain clock school start").find((x) => x.term === "clock");
  assert.ok(c && !c.group, "clock gained a group");
});

await test("TEN4 resolves sleep and body clock, byte exact structured", () => {
  assert.deepEqual(groupHeads(TEN4), ["body clock", "sleep"]);
  assert.equal(buildStructuredQuery(TEN4),
    "(\"body clock\" OR \"circadian rhythm\" OR \"circadian rhythms\" OR \"circadian phase\" OR " +
    "\"delayed sleep phase\" OR \"delayed sleep wake phase\" OR circadian) AND " +
    "(asleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR " +
    "\"sleep restricted\" OR \"chronic sleep restriction\") AND school AND midnight");
});

await test("TEN1 seats the teen group beside wired", () => {
  assert.deepEqual(groupHeads(TEN1), ["teen", "wired"]);
});

await test("TEN2 resolves through the high school phrase", () => {
  assert.deepEqual(groupHeads(TEN2), ["teen"]);
});

await test("TENx1 and TENx3 seat teen and sleep together", () => {
  assert.deepEqual(groupHeads(TENX1), ["sleep", "teen"]);
  assert.deepEqual(groupHeads(TENX3), ["sleep", "teen"]);
});

group("Controls: byte exact, unchanged");

await test("WLK3 control shape", () => {
  assert.equal(buildStructuredQuery(WLK3), "short OR blood OR sugar OR walk");
});

await test("SLT4 deterministic form", () => {
  assert.equal(buildStructuredQuery(SLT4),
    "(salt OR \"sodium chloride\" OR \"table salt\" OR \"salt intake\" OR \"dietary sodium\" OR salts OR sodium) AND " +
    "(heart OR cardiovascular OR cardiac OR myocardial OR coronary OR atherosclerosis OR hypertension) AND problem");
  // "something" is absent on current main: the boolean anchor
  // land (15705da, R1) drops that closed class singleton too.
});

await test("FEV2 form carries fever, no entomology group", () => {
  assert.equal(buildStructuredQuery(FEV2),
    "(\"body temperature\" OR \"set point\" OR fever OR fevers OR febrile OR pyrexia OR pyrogen) AND " +
    "(bug OR \"stomach bug\" OR \"viral infection\" OR \"bacterial infection\" OR bugs OR pathogen OR pathogens)");
});

await test("INV1 stays groupless and clean", () => {
  assert.deepEqual(questionConceptGroups(INV1), []);
  assert.equal(buildStructuredQuery(INV1), "zorblaxian OR quarnellian OR sugar OR moss");
});

await test("BSF4 serve shape: gate concepts unchanged, tail rides its oil rung only", () => {
  assert.deepEqual(groupHeads(BSF4), ["scraps", "sick", "waste oil"]);
  assert.equal(buildStructuredQuery(BSF4),
    "(\"used cooking oil\" OR \"waste oil\" OR \"waste cooking oil\" OR \"cooking oil\" OR \"used oil\" OR \"fryer oil\" OR \"frying oil\") AND " +
    "(sick OR sickness OR ill OR illness OR unwell OR infection OR infections) AND " +
    "(scraps OR \"food scraps\" OR \"kitchen scraps\" OR \"food waste\" OR \"organic waste\" OR \"waste substrate\" OR \"waste substrates\") AND " +
    "(scraps OR \"food scraps\" OR \"kitchen scraps\" OR \"food waste\" OR \"organic waste\" OR \"waste substrate\" OR \"waste substrates\")");
});

await test("BSF3 filed unbuilt: trace unchanged", () => {
  assert.equal(buildStructuredQuery(BSF3),
    "(\"gallus gallus\" OR \"Gallus gallus\" OR chicken) AND (kitchen OR scraps OR old OR fat OR grubs OR rubbish OR chip OR feed)");
});

await test("MNP2 filed unbuilt: trace unchanged", () => {
  assert.deepEqual(questionConceptGroups(MNP2), []);
  assert.equal(buildStructuredQuery(MNP2), "doing OR chemical OR lab OR fungus");
});

await test("CHK1 chicken control unchanged (the teen and clock groups do not reach it)", () => {
  assert.equal(buildStructuredQuery(CHK1),
    "(scraps OR \"food scraps\" OR \"kitchen scraps\" OR \"food waste\" OR \"organic waste\" OR \"waste substrate\" OR \"waste substrates\") " +
    "AND garden AND chickens AND kitchen");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("FAILED:", f);
  process.exit(1);
}
