/**
 * Search wave eleven (2026-10-14), item 1 only: the compound
 * title clause for the presented list.
 *
 * Wave ten's presented list hygiene (paperTitleEngagesConcepts)
 * counted a central concept as engaged when its term appeared
 * anywhere in a paper's title — including fused inside a
 * compound. The hardcore audit's presented list on "why is
 * the sky blue" carried the specimens: an OLED device paper
 * whose title engages through the hyphenated compound
 * "Sky-Blue", a theatre paper whose title engages through
 * the spaced compound "Whole Blue Sky" (the name of a stage
 * play), and an interactions paper on "blue-sky research".
 * None of them is about the sky.
 *
 * The clause: a concept whose title occurrences are ALL
 * fused (inside a hyphenated compound of words, or as one
 * half of an adjacent pair of the question's own concept
 * words) counts toward title engagement only when the same
 * concept also appears UNCOMPOUNDED in the abstract. A
 * hyphenated token fuses only when it joins at least two
 * word parts of two or more letters: COVID-19 and X-ray are
 * a concept's own full name, not a fusion with another word.
 * The clause lives in the presented list rule only; the
 * citation standard in centralConceptHits is untouched.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Addendum the same day, from the parent's live probe on the
 * wave ten build: "how does pcr make more copies of dna" did
 * not fire the foundational lane, because the mechanism
 * shape detector's verb set carried the papers' word
 * (amplify) but not the asker's words (make more copies).
 * The copying verb family and the phrase "make more" joined
 * the set; the fixtures below pin the parent's exact wording
 * and the standing negatives. Cache moved v45 (this item)
 * then v46 (the addendum), both entries in the chain.
 *
 * Run with: node tests/search-wave-eleven.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  paperTitleEngagesConcepts, isMechanismShapeQuery,
} = search;

const dynFor = (q) => buildDynLookup(buildDeterministicFallbackGroups(q, centralContentTerms(q)));

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
function group(name) { console.log(`\n${name}`); }

const paper = (title, abstract, year = "2024", citations = 50) => ({
  title, abstract, year: String(year), citations,
  citedByCount: citations, citationCount: citations,
  authors: "Doe J et al.", journal: "Journal of Recorded Studies",
  doi: "10.1000/w11-" + Math.abs([...title].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)),
  url: "https://doi.org/10.1000/w11-unit",
  relevance: 90,
});

const skyQ = "why is the sky blue";
const skyDyn = dynFor(skyQ);

// ═══════════════════════════════════════════════════════════════
group("Item 1 — the audit specimens are barred");

await test("the OLED specimen: title engagement only inside the hyphenated compound", () => {
  // The audit's presented specimen (DOI 10.1021/acsami.6c10353),
  // title verbatim in shape; the abstract is written the way
  // the device paper is written — emission and efficiency, and
  // neither concept standing on its own anywhere in it.
  const oled = paper(
    "High-Performance Sky-Blue Hyperfluorescence Organic Light-Emitting Diodes Enabled by Efficient Thermally Activated Delayed Fluorescence Sensitizers with Suppressed Efficiency Roll-Off",
    "We report a thermally activated delayed fluorescence sensitizer for hyperfluorescence organic light emitting diodes. The device reaches an external quantum efficiency of 27 percent with suppressed roll off at high luminance. Emission peaks at 478 nanometers with a narrow spectral width, and operational lifetime is extended by suppressing exciton annihilation in the emissive layer.");
  assert.equal(paperTitleEngagesConcepts(oled, skyQ, skyDyn), false,
    "the OLED specimen still presents on the sky question");
});

await test("the theatre specimen: title engagement only as the spaced compound naming a play", () => {
  // The audit's presented specimen (AKRA journal), title
  // verbatim; the abstract is about the play and its staging,
  // and neither concept appears in it at all.
  const theatre = paper(
    "Unknown Characters and Lost Unity: Postdramatic Reflections in Martin Crimp's Whole Blue Sky",
    "This essay examines the play through the lens of postdramatic theatre, focusing on fragmented character, the dissolution of unified stage action, and the politics of representation in contemporary British drama. Drawing on performances and the published text, it argues that the work refuses the consolations of a coherent protagonist.");
  assert.equal(paperTitleEngagesConcepts(theatre, skyQ, skyDyn), false,
    "the theatre specimen still presents on the sky question");
});

await test("the research policy specimen: blue-sky as a funding metaphor", () => {
  const policy = paper(
    "Grounding blue-sky research",
    "This essay argues that funding agencies should protect curiosity driven inquiry. It traces how program managers justify long horizon work whose uses cannot be specified in advance, and what happens to laboratories when every project must promise an application.");
  assert.equal(paperTitleEngagesConcepts(policy, skyQ, skyDyn), false,
    "the blue-sky research metaphor still presents on the sky question");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — genuine engagement stays");

await test("positive control: the title legitimately uses the compound and the abstract genuinely engages", () => {
  const control = paper(
    "Why the daytime sky-blue appearance depends on molecular scattering",
    "The blue of the sky is caused by Rayleigh scattering: air molecules scatter short wavelength blue sunlight far more strongly than longer wavelengths, so the sky appears blue in every direction away from the sun. We summarize the measurements that established the effect and the corrections for aerosols.");
  assert.equal(paperTitleEngagesConcepts(control, skyQ, skyDyn), true,
    "the positive control was barred — the compound clause is eating genuine papers");
});

await test("a spaced compound title stays when its abstract engages the concepts outright", () => {
  const record = paper(
    "The blue sky over Mauna Loa: a spectrometer record of scattered sunlight",
    "Spectrometers recorded the spectrum of daylight across a full year. The sky appears blue because air molecules scatter short wavelengths of sunlight far more strongly than long ones, and the measured spectra track that scattering day by day.");
  assert.equal(paperTitleEngagesConcepts(record, skyQ, skyDyn), true,
    "the spectrometer record was barred despite an engaging abstract");
});

await test("concepts standing alone in the title engage without any abstract confirmation", () => {
  const review = paper(
    "Rayleigh scattering and the blue color of the sky",
    "A review.");
  assert.equal(paperTitleEngagesConcepts(review, skyQ, skyDyn), true,
    "a title whose concepts stand alone now needs abstract confirmation — the clause reached past compounds");
});

await test("an abstract that repeats only the compound does not confirm the title hit", () => {
  const device = paper(
    "Sky-blue quantum dot light-emitting diodes via surface ligand engineering",
    "Colloidal quantum dots with sky-blue emission are engineered for display applications. The efficiency and color purity of the sky-blue devices are reported, and ligand exchange is shown to raise the photoluminescence yield of the films.");
  assert.equal(paperTitleEngagesConcepts(device, skyQ, skyDyn), false,
    "a compound repeated in the abstract confirmed a compound title hit — the confirmation must be uncompounded");
});

await test("a hyphenated name is the concept itself, not a compound (COVID-19)", () => {
  const covidQ = "can covid damage your heart";
  const cohort = paper(
    "COVID-19 and cardiac injury: a cohort study",
    "Patients hospitalized with COVID-19 were followed for myocardial injury. Troponin elevation during the infection predicted worse outcomes, and cardiac imaging after discharge showed persistent inflammation in a minority of patients.");
  assert.equal(paperTitleEngagesConcepts(cohort, covidQ, dynFor(covidQ)), true,
    "the COVID-19 cohort was barred — a numeric suffix is not a compound of words");
});

await test("boundary, stated plainly: a fused pair title with no abstract cannot confirm, so it does not present", () => {
  // The clause requires the concept uncompounded in the
  // abstract; with no abstract there is nothing to confirm
  // with. This filter governs the further reading tail only —
  // cited evidence is never judged by it.
  const bare = paper("Why is the sky blue?", "");
  assert.equal(paperTitleEngagesConcepts(bare, skyQ, skyDyn), false,
    "a fused title with no abstract presented — the confirmation requirement is not binding");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — the wave ten verdicts underneath do not move");

await test("wave ten hygiene verdicts are unchanged by the clause", () => {
  const crisprQ = "how does crispr cas9 actually cut dna";
  assert.equal(paperTitleEngagesConcepts(
    paper("CRISPR Cas9 DNA cleavage by a dual RNA guided endonuclease", "Cas9 cleaves DNA."), crisprQ, dynFor(crisprQ)), true,
    "the wave ten on topic CRISPR title no longer engages");
  assert.equal(paperTitleEngagesConcepts(
    paper("Enhancer-Associated LncRNA-ITGA2 Promotes Vascular Remodeling Through ITGA2", "Vascular remodeling in pulmonary tissue."), crisprQ, dynFor(crisprQ)), false,
    "the wave ten vascular specimen presents again");
  const leadQ = "how do you test if water has lead in it";
  assert.equal(paperTitleEngagesConcepts(
    paper("Bioethics and the Rohingya refugee crisis: consent in field research", "Ethics of research with displaced populations."), leadQ, dynFor(leadQ)), false,
    "the wave ten Rohingya specimen presents again");
});

// ═══════════════════════════════════════════════════════════════
group("Addendum (parent live probe) — the mechanism detector hears plain copying words");

await test("the live failing wording fires the mechanism shape, in the parent's exact words", () => {
  // Parent live probe on the wave ten build (c2597fa): "how
  // does crispr cas9 actually cut dna" fired the foundational
  // lane (admitted 24) and the yogurt health shape fired,
  // while this question produced no foundationalLane in its
  // funnel at all. The wave nine acceptance wording used the
  // papers' verb (amplify); a person asks it with make, more,
  // and copies, none of which the verb set carried.
  assert.equal(isMechanismShapeQuery("how does pcr make more copies of dna"), true,
    "the plain PCR wording still does not read as a mechanism shape — the lane will not fire for it");
  assert.equal(isMechanismShapeQuery("how does pcr amplify dna"), true,
    "the wave nine acceptance wording lost its mechanism shape");
});

await test("the copying family fires in its plain forms", () => {
  for (const q of [
    "how do cells copy their dna",
    "how does a virus multiply inside a cell",
    "how is dna replicated before a cell divides",
    "how does the body make more red blood cells",
  ]) {
    assert.equal(isMechanismShapeQuery(q), true, `not a mechanism shape: ${q}`);
  }
});

await test("the widening does not swallow the standing negatives", () => {
  for (const q of [
    "what are the ethics of crispr gene editing",
    "does crispr delivery work in patients",
    "how is manganese peroxidase activity measured",
    // Bare "make" is deliberately still not a process verb:
    // making is only mechanism phrasing in its "make more"
    // and copying forms.
    "how does the council make decisions about zoning",
  ]) {
    assert.equal(isMechanismShapeQuery(q), false, `wrongly a mechanism shape: ${q}`);
  }
});

// ═══════════════════════════════════════════════════════════════
group("Items 1 and addendum — the cache version pin");

await test("CACHE_SCHEMA_VERSION is v48 with both wave eleven chain entries, v44 kept as history", () => {
  // PIN UPDATED (2026-10-14, wave twelve): v47 — the claim
  // check counts only checked claims, dedupe folds richer
  // duplicate fields, the foundational lane sorts by
  // citations, the compound clause confirmation requires
  // topical company, and the single source retry extends to
  // every clean answer. The wave eleven entries stay as
  // history; this pin follows the constant.
  // PIN UPDATED (2026-10-14, wave thirteen): v48 —
  // foundational primaries get presentation priority, the
  // title rule requires topical company for every sighting,
  // and the claim check records a named tier trace with a
  // fallback model attempt and literature claim selection.
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v48";'),
    "CACHE_SCHEMA_VERSION was not bumped to v48");
  assert.ok(/\/\/ v48 \(2026-10-14, wave thirteen\)/.test(src),
    "the v48 chain entry is missing its dated reason");
  assert.ok(/\/\/ v45 \(2026-10-14, wave eleven\)/.test(src),
    "the v45 chain entry is missing its dated reason");
  assert.ok(/\/\/ v46 \(2026-10-14, wave eleven, live probe addendum\)/.test(src),
    "the v46 chain entry is missing its dated reason");
  assert.ok(/\/\/ v44 \(2026-10-14, wave ten\)/.test(src),
    "the v44 chain entry was removed — the chain is history and stays");
});

console.log(`\nsearch-wave-eleven: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
