/**
 * Search wave two (2026-10-13, second rescore fixes).
 *
 * Four defects from the panel, each pinned behaviorally:
 *
 *  1. Everyday vocabulary gaps. "germs" and "belly" had no path to
 *     the vocabulary the papers use, so plain language questions
 *     collapsed to literal tokens and cited collisions. The crop
 *     rotation and touch response plant paraphrase paths were
 *     missing the same way. Every phrasing below is worded in
 *     everyday language that deliberately avoids the papers'
 *     terminology (the standing mismatched language rule): a fix
 *     counts only when several differently worded phrasings of the
 *     same question all pull the field vocabulary in.
 *  2. The both concepts gate. A paper touching only one of a multi
 *     concept question's resolved groups could reach the cited set
 *     on a phrase collision. applyConceptCoverageGate demotes it to
 *     further reading (marker removed, bibliography place kept),
 *     with organism/binomial, existence, and thinEvidence
 *     exemptions, and a floor that never leaves an answer citing
 *     nothing.
 *  3. The retraction and floor screen. A cited item titled
 *     "[RETRACTED] ..." passed every screen because the retraction
 *     check keys on Crossref metadata the record did not carry, and
 *     the funnel reported excludedRetracted 0 (hardcoded). Title
 *     markers now exclude at the shelf and count. The non literature
 *     floor likewise never looked at genre declarations or title
 *     framing, so a poetry piece could be cited on a phrase match.
 *  4. The follow up prompt still licensed unmarked from memory
 *     continuation ("work with the existing sources and your
 *     knowledge", "push forward with your knowledge"). It now
 *     carries the same grounding standard as every other mode.
 *
 * Run with: node tests/search-wave-two.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const {
  buildStructuredQuery,
  buildDynLookup,
  topicOverlapFilter,
  questionConceptGroups,
  paperConceptGroupHits,
  applyConceptCoverageGate,
  labelUncitedSources,
  hasRetractedTitleMarker,
  hasNonLiteratureTitleFraming,
  isNonLiterature,
  analyzeQuery,
  verifyPaperConstraints,
} = await import(join(root, "functions/api/search.js"));

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

// ═══════════════════════════════════════════════════════════════════
group("vocabulary — germs and belly reach the microbe and gut groups");

const GUT_MICROBE_PAPER = () => ({
  title: "Infant intestinal microbiota and growth in the first year",
  abstract:
    "Stool microbiota of infants was profiled monthly. Intestinal bacteria " +
    "composition predicted weight gain and length growth across the first year.",
  url: "https://example.com/infant-gut-growth",
});

const BELLY_PHRASINGS = [
  "Do the germs in a baby's belly change how well the baby grows?",
  "Has anyone ever checked whether the germs living in a bug's belly change what foods it can live on?",
  "can the germs in your tummy upset your digestion",
];

for (const q of BELLY_PHRASINGS) {
  await test(`shipped query bridges germs and belly wording: ${q.slice(0, 44)}...`, () => {
    const sq = buildStructuredQuery(q.toLowerCase());
    assert.ok(sq.includes("microbiome"), `no microbe rung in: ${sq}`);
    assert.ok(sq.includes("intestinal"), `no gut rung in: ${sq}`);
  });
  await test(`on point gut microbiota paper survives the filter: ${q.slice(0, 44)}...`, () => {
    const out = topicOverlapFilter(q, [GUT_MICROBE_PAPER()]);
    assert.ok(
      out.some((p) => p.url.endsWith("infant-gut-growth")),
      "the on point paper must survive via the group bridge"
    );
  });
}

await test("the question resolves exactly the microbe and gut groups", () => {
  const groups = questionConceptGroups(BELLY_PHRASINGS[0], null);
  assert.equal(groups.length, 2);
});

// ═══════════════════════════════════════════════════════════════════
group("vocabulary — crop rotation paraphrases pull the field vocabulary");

const ROTATION_PAPER = () => ({
  title: "Long term crop rotation effects on soil organic matter",
  abstract:
    "Crop rotation was compared with continuous monoculture over twelve " +
    "seasons. Rotation increased soil organic carbon and aggregate stability.",
  url: "https://example.com/rotation-soil",
});

const ROTATION_PHRASINGS = [
  "does planting different crops on the same field in different years help the soil stay healthy",
  "why do farmers rotate crops instead of planting the same thing every year",
  "does crop rotation improve soil fertility over time",
  "should i plant a different crop each year or keep growing the same one",
];

for (const q of ROTATION_PHRASINGS) {
  await test(`shipped query carries rotation vocabulary: ${q.slice(0, 44)}...`, () => {
    const sq = buildStructuredQuery(q.toLowerCase());
    assert.ok(sq.includes('"crop rotation"'), `no rotation rung in: ${sq}`);
  });
  await test(`rotation paper survives the filter: ${q.slice(0, 44)}...`, () => {
    const out = topicOverlapFilter(q, [ROTATION_PAPER()]);
    assert.ok(out.some((p) => p.url.endsWith("rotation-soil")), "rotation paper must survive");
  });
}

await test("unrelated rotation questions gain no crop vocabulary", () => {
  for (const q of [
    "how does the earth rotate on its axis",
    "does shoulder rotation exercise help a frozen shoulder",
  ]) {
    const sq = buildStructuredQuery(q.toLowerCase());
    assert.ok(!sq.includes("crop rotation"), `crop vocabulary leaked into: ${sq}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
group("vocabulary — the touch response plant path");

const MIMOSA_PAPER = () => ({
  title: "Thigmonastic leaf movement in Mimosa pudica",
  abstract:
    "Leaflets of Mimosa pudica fold within seconds of mechanical stimulation. " +
    "Turgor changes in the pulvinus motor organ drive the movement.",
  url: "https://example.com/mimosa",
});

const MIMOSA_PHRASINGS = [
  "why do some plants fold their leaves when you touch them",
  "what makes the sensitive plant close up when something brushes against it",
  "why does the touch me not plant fold up at a touch",
];

for (const q of MIMOSA_PHRASINGS) {
  await test(`shipped query carries the plant's field vocabulary: ${q.slice(0, 44)}...`, () => {
    const sq = buildStructuredQuery(q.toLowerCase());
    assert.ok(
      sq.includes('"mimosa pudica"') || sq.includes("thigmonasty"),
      `no Mimosa vocabulary in: ${sq}`
    );
  });
  await test(`on point paper survives the filter: ${q.slice(0, 44)}...`, () => {
    const out = topicOverlapFilter(q, [MIMOSA_PAPER()]);
    assert.ok(out.some((p) => p.url.endsWith("mimosa")), "the Mimosa paper must survive");
  });
}

// ═══════════════════════════════════════════════════════════════════
group("both concepts gate — one concept papers drop to further reading");

const SLEEP_DYN = () =>
  buildDynLookup([
    { term: "sleep", alternates: ["sleep deprivation", "sleep loss", "sleep restriction", "catch up sleep"] },
    { term: "cold", alternates: ["common cold", "rhinovirus", "upper respiratory infection"] },
  ]);
const SLEEP_Q = "does not getting enough sleep make you more likely to catch a cold";
const SLEEP_PAPERS = () => [
  {
    title: "Sleep deprivation impairs immune response to vaccination",
    abstract:
      "Sleep deprivation before vaccination reduced antibody titres; participants " +
      "also reported more common cold symptoms during follow up.",
    url: "https://example.com/both-concepts",
  },
  {
    title: "Catch up sleep on weekends and metabolic health",
    abstract:
      "Weekend catch up sleep was associated with lower BMI in adults who " +
      "sleep little on weekdays.",
    url: "https://example.com/catch-up-only",
  },
  {
    title: "Rhinovirus transmission in households",
    abstract: "The common cold virus spread through households during the winter months.",
    url: "https://example.com/cold-only",
  },
];

await test("the sleep and colds fixture resolves two concept groups", () => {
  assert.equal(questionConceptGroups(SLEEP_Q, SLEEP_DYN()).length, 2);
  const hits = SLEEP_PAPERS().map((p) => paperConceptGroupHits(p, questionConceptGroups(SLEEP_Q, SLEEP_DYN())));
  assert.deepEqual(hits, [2, 1, 1]);
});

await test("one concept citations are demoted, two concept citations kept", () => {
  const answer =
    "Lack of sleep weakens the antibody response and raises cold risk [1]. " +
    "Weekend catch up sleep helps BMI [2]. Household spread matters [3].";
  const out = applyConceptCoverageGate(answer, SLEEP_PAPERS(), SLEEP_Q, SLEEP_DYN());
  assert.ok(out.text.includes("[1]"), "the two concept paper keeps its marker");
  assert.ok(!out.text.includes("[2]"), "the catch up only paper loses its marker");
  assert.ok(!out.text.includes("[3]"), "the cold only paper loses its marker");
  assert.deepEqual(out.demoted.map((d) => d.idx), [2, 3]);
  // Each demotion reports the sentence that held the marker, so the
  // fact check panel can show what lost its citation.
  assert.ok(out.demoted.every((d) => typeof d.claim === "string" && d.claim.length > 0), "demotions must carry their claim sentence");
  // Demoted is not deleted: both papers stay in the bibliography,
  // labeled further reading by the existing machinery.
  const labeled = labelUncitedSources(
    SLEEP_PAPERS().map((p) => ({ title: p.title, url: p.url })),
    out.text
  );
  assert.deepEqual(labeled.map((s) => !!s.uncited), [false, true, true]);
  assert.equal(labeled.length, 3);
});

await test("the floor: an answer citing only a one concept paper is left untouched", () => {
  const answer = "Weekend catch up sleep helps BMI [2].";
  const out = applyConceptCoverageGate(answer, SLEEP_PAPERS(), SLEEP_Q, SLEEP_DYN());
  assert.equal(out.text, answer);
  assert.deepEqual(out.demoted, []);
});

await test("hand groups alone drive the gate (the germs and belly collisions)", () => {
  const q = "Do the germs in a baby's belly change how well the baby grows?";
  const papers = [
    GUT_MICROBE_PAPER(),
    {
      title: "Belly dance during pregnancy: obstetric outcomes",
      abstract: "Belly dance classes in pregnancy improved posture. No infant outcomes were measured.",
      url: "https://example.com/belly-dance",
    },
    {
      title: "Prune belly syndrome: a case series",
      abstract: "Prune belly syndrome presents with abdominal wall deficiency in newborns.",
      url: "https://example.com/prune-belly",
    },
    {
      title: "Ghrelin pharmacology and appetite",
      abstract: "Ghrelin receptor agonists changed food intake in adults with gastroparesis.",
      url: "https://example.com/ghrelin",
    },
  ];
  const answer =
    "Gut bacteria shape infant growth [1]. Belly dance helps posture [2]. " +
    "Prune belly is a wall defect [3]. Ghrelin drives appetite [4].";
  const out = applyConceptCoverageGate(answer, papers, q, null);
  assert.ok(out.text.includes("[1]"), "the on point paper keeps its marker");
  assert.deepEqual(out.demoted.map((d) => d.idx), [2, 3, 4]);
});

await test("a binomial anchored paper is exempt even on one group", () => {
  const q = "Does Hermetia illucens gut bacteria help it digest waste oil?";
  const papers = [
    {
      title: "Hermetia illucens as a waste conversion insect",
      abstract: "Hermetia illucens larvae convert food waste at scale.",
      url: "https://example.com/anchored",
    },
    SLEEP_PAPERS()[0],
  ];
  // The anchored paper touches only the black soldier fly group; the
  // binomial it names carries it. The sleep paper touches none of
  // this question's groups, but the floor keeps the answer cited
  // only if nothing else survives, so cite both and check paper 1.
  const answer = "The larvae convert waste [1]. Sleep matters too [2].";
  const out = applyConceptCoverageGate(answer, papers, q, null);
  assert.ok(out.text.includes("[1]"), "the anchored paper keeps its marker");
});

await test("thinEvidence papers are exempt (the cascade is never defeated)", () => {
  const q = "Do the germs in a baby's belly change how well the baby grows?";
  const papers = [
    { title: "Anything at all", abstract: "belly only, nothing else", thinEvidence: true, url: "https://example.com/thin" },
    GUT_MICROBE_PAPER(),
  ];
  const answer = "Thin [1]. On point [2].";
  const out = applyConceptCoverageGate(answer, papers, q, null);
  assert.ok(out.text.includes("[1]"), "the cascade paper keeps its marker");
  assert.deepEqual(out.demoted, []);
});

await test("single concept questions and the frog controls never engage the gate", () => {
  for (const q of [
    "What lets a wood frog survive being frozen for months at a time?",
    "How can a frog turn into ice all winter and not die?",
    "why do some plants fold their leaves when you touch them",
  ]) {
    assert.ok(questionConceptGroups(q, null).length < 2, `gate must not engage for: ${q}`);
    const papers = [MIMOSA_PAPER(), GUT_MICROBE_PAPER()];
    const answer = "One [1]. Two [2].";
    const out = applyConceptCoverageGate(answer, papers, q, null);
    assert.equal(out.text, answer);
  }
});

// ═══════════════════════════════════════════════════════════════════
group("retraction and floor screen — title level");

await test("title retraction markers are caught", () => {
  for (const t of [
    "[RETRACTED] Gut microbiota and growth in infants",
    "RETRACTED: Effects of sleep deprivation on immunity",
    "Retracted article: A trial of vitamin D supplementation",
    "Retraction: A randomized trial of vitamin D",
    "Retraction notice: Fabrication in a nutrition journal",
  ]) {
    assert.equal(hasRetractedTitleMarker(t), true, `must catch: ${t}`);
  }
});

await test("the literature about retractions is not caught", () => {
  for (const t of [
    "Retracted articles in medical journals: a bibliometric study",
    "Effects of retraction on citation networks",
    "Thigmonastic movements in Mimosa pudica",
  ]) {
    assert.equal(hasRetractedTitleMarker(t), false, `must not catch: ${t}`);
  }
});

await test("genre framing and genre types hit the non literature floor", () => {
  assert.equal(hasNonLiteratureTitleFraming("Poem: The Fern"), true);
  assert.equal(hasNonLiteratureTitleFraming("Ode to a fern: a poem"), true);
  assert.equal(hasNonLiteratureTitleFraming("Poetry in science education: a systematic review"), false);
  assert.equal(isNonLiterature({ title: "A fern study", _rawType: "Research Article,Poetry", url: "https://example.com/x" }), true);
  assert.equal(isNonLiterature({ title: "A fern study", _rawType: "research-article", url: "https://example.com/x" }), false);
  assert.equal(isNonLiterature({ title: "Poem: The Fern", _rawType: "", url: "https://example.com/x" }), true);
  assert.equal(isNonLiterature({ title: "Thigmonasty in Mimosa pudica", _rawType: "research-article", url: "https://example.com/x" }), false);
});

// ═══════════════════════════════════════════════════════════════════
group("retraction screen — end to end funnel count");

// Europe PMC serves the fixture shelf; every other network call
// fails fast, so model legs fail open and synthesis falls back to
// the deterministic path, exactly the degraded shape this wave
// shipped under. The funnel must count the retracted record, and
// neither it nor the poetry record may reach the shipped sources.
const realFetch = globalThis.fetch;
const EPMC_FIXTURE = {
  resultList: {
    result: [
      {
        title: "[RETRACTED] Infant gut microbiota and growth: a fabricated cohort",
        doi: "10.0000/retracted.1",
        pubYear: "2021",
        authorString: "Fabricated A et al.",
        journalTitle: "Journal of Examples",
        abstractText:
          "Infant gut microbiota composition was associated with growth velocity " +
          "in a cohort of 200 infants followed for one year.",
        pubTypeList: { pubType: ["Research Article"] },
      },
      {
        title: "The baby gut microbiota: colonisation and growth in early life",
        doi: "10.0000/real.1",
        pubYear: "2022",
        authorString: "Honest B et al.",
        journalTitle: "Journal of Examples",
        abstractText:
          "The baby gut is colonised by bacteria within hours of birth. We " +
          "followed 98 healthy babies and found the baby gut microbiota " +
          "predicted how well each baby grows: infants whose gut bacteria " +
          "included more Bifidobacterium gained weight faster. Feeding mode " +
          "changed the microbiota but growth tracked the bacterial " +
          "colonisation pattern.",
        pubTypeList: { pubType: ["Research Article"] },
      },
      {
        title: "Poem: The Garden Gut",
        doi: "10.0000/poem.1",
        pubYear: "2023",
        authorString: "Versifier C",
        journalTitle: "Verses Quarterly",
        abstractText: "A poem about germs, bellies, gardens, and growth in spring.",
        pubTypeList: { pubType: ["Poetry"] },
      },
    ],
  },
};
globalThis.fetch = (url) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("europepmc")) {
    return Promise.resolve(
      new Response(JSON.stringify(EPMC_FIXTURE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
  return Promise.reject(new Error("wave-two fixture: network stubbed"));
};

try {
  const { onRequest } = await import(join(root, "functions/api/search.js"));
  await test("a title marked retraction is excluded and counted in the shipped funnel", async () => {
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Do the germs in a baby's belly change how well the baby grows?" }),
    });
    const res = await onRequest({ request, env: {}, waitUntil: () => {}, data: {} });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data._funnel, "response carries the funnel");
    assert.ok(
      data._funnel.excludedRetracted >= 1,
      `excludedRetracted must count the title marked record, got ${JSON.stringify(data._funnel)}`
    );
    const shipped = JSON.stringify(data.sources || []) + JSON.stringify(data._record || {});
    assert.ok(!shipped.includes("[RETRACTED]"), "the retracted record must not ship as a source");
    assert.ok(!shipped.includes("Poem: The Garden Gut"), "the poetry record must not ship as a source");
    assert.ok(
      shipped.includes("The baby gut microbiota: colonisation and growth in early life"),
      "the real paper must still ship"
    );
  });
} finally {
  globalThis.fetch = realFetch;
}

// ═══════════════════════════════════════════════════════════════════
group("follow up prompt — the last permissive copy is gone");

await test("the defeated follow up sentences are absent", () => {
  assert.ok(!src.includes("work with the existing sources and your knowledge"), "defeated sentence 1 still present");
  assert.ok(!src.includes("push forward with your knowledge"), "defeated sentence 2 still present");
});

await test("the follow up block carries the grounding standard", () => {
  assert.ok(src.includes("answer from the existing sources below"), "new no new papers wording missing");
  assert.ok(
    src.includes("never stated as a finding and never carrying a citation"),
    "marked background rule missing from the follow up block"
  );
  assert.ok(src.includes("name what the sources do not cover"), "plain gap naming missing from the follow up block");
});

await test("the existence rule survives word for word", () => {
  assert.ok(
    src.includes("Write 'None of the papers retrieved here report X'"),
    "the CITE_RULES existence wording changed"
  );
  assert.ok(
    src.includes("NEVER write 'the literature does not report X'"),
    "the CITE_RULES existence prohibition changed"
  );
});

await test("the cache schema carries the wave two bump", () => {
  // Bumped to v22 by the citation collapse fix below (verdict and
  // topic filter semantics changed, so cached shelves are stale).
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v22"'), "CACHE_SCHEMA_VERSION must be v22");
});

group("citation collapse — the verdict and the topic filter count concepts, not literal words");
// The production record for "Do the germs in a baby belly change how
// well the baby grows" (build ab97581): gathered 77, deduped 72,
// cited 1, source list of exactly one. Local end to end accounting
// found the shelf died in two discriminative steps (full numbers in
// the delivery report):
//  (a) The handler constraint filter. analyzeQuery glues the everyday
//      question into window phrases ("germs baby belly", "change
//      well baby") and verifyPaperConstraints judged a paper's
//      "partial" credit on LITERAL term mentions only — the one judge
//      in the pipeline not using the concept groups. The real infant
//      gut papers mention none of the literal terms (they write
//      microbiota, intestinal, growth) and were off-topic; belly
//      dance and prune belly print "belly" and passed as partial.
//  (b) topicOverlapFilter deduped its accept sets by OBJECT IDENTITY,
//      so the repeated ungrouped word "baby" (the question says it
//      twice) became two distinct concepts: the requirement inflated
//      to 3 of 5, a literal "baby" earned the concept twice, and the
//      field's papers touching the two real concepts (microbes, gut)
//      died at 2 of 5.
// Fixes: a concept group mention earns partial (never on-topic) in
// verifyPaperConstraints, a fully matched constraint is never
// off-topic, and the accept set dedupe compares content. Fixtures
// below are worded in everyday language against papers written in
// the field's vocabulary, per the standing mismatched language rule.

const CC_QUESTION = "Do the germs in a baby belly change how well the baby grows";
const CC_STUNTING_PAPER = () => ({
  title: "Early life gut microbiome and stunting in rural infants",
  abstract:
    "Gut microbiome samples from infants in rural Malawi were sequenced. " +
    "Children with immature gut microbiota communities showed more stunting and poorer linear growth.",
  url: "https://example.com/cc-stunting",
});
const CC_CESAREAN_PAPER = () => ({
  title: "Cesarean delivery and the neonatal gut microbiota: colonization patterns and later weight gain",
  abstract:
    "Gut microbiota colonization differed by delivery mode. The intestinal microbial " +
    "communities assembled in the first week predicted weight gain through toddlerhood.",
  url: "https://example.com/cc-cesarean",
});
const CC_BELLY_DANCE = () => ({
  title: "Belly dance during pregnancy: obstetric outcomes",
  abstract: "Belly dance classes in pregnancy improved posture. No infant outcomes were measured.",
  url: "https://example.com/cc-belly-dance",
});
const CC_PRUNE_BELLY = () => ({
  title: "Prune belly syndrome: a case series",
  abstract: "Prune belly syndrome presents with abdominal wall deficiency in newborns.",
  url: "https://example.com/cc-prune-belly",
});
const CC_GHRELIN = () => ({
  title: "Ghrelin pharmacology and appetite",
  abstract: "Ghrelin receptor agonists changed food intake in adults with gastroparesis.",
  url: "https://example.com/cc-ghrelin",
});
const CC_NO_VOCAB_PAPER = () => ({
  title: "Soil nematode communities under no till farming",
  abstract:
    "Nematode assemblages were counted in field plots under three tillage regimes. " +
    "Species richness tracked soil moisture across seasons.",
  url: "https://example.com/cc-nematode",
});
const ccVerdict = (paper, q) => verifyPaperConstraints(paper, analyzeQuery(q)).verdict;
const ccPassesHandlerFilter = (paper, q) => {
  const v = ccVerdict(paper, q);
  return v === "on-topic" || v === "partial";
};

await test("the baby belly question still glues into window constraints (the shape under test)", () => {
  const phrases = analyzeQuery(CC_QUESTION).constraints.map((c) => c.phrase);
  assert.deepEqual(phrases, ["germs baby belly", "change well baby"]);
});

await test("on point infant gut papers earn partial through the concept bridge, never off-topic", () => {
  for (const make of [GUT_MICROBE_PAPER, CC_STUNTING_PAPER, CC_CESAREAN_PAPER]) {
    const v = ccVerdict(make(), CC_QUESTION);
    assert.equal(v, "partial", `${make().url} must be partial via concept mentions, got ${v}`);
  }
});

await test("papers sharing no vocabulary with the question stay off-topic at the verdict", () => {
  assert.equal(ccVerdict(CC_GHRELIN(), CC_QUESTION), "off-topic", "ghrelin review must stay off-topic");
  assert.equal(ccVerdict(CC_NO_VOCAB_PAPER(), CC_QUESTION), "off-topic", "soil nematode paper must stay off-topic");
});

await test("the collisions are not promoted at the verdict (they die downstream, as before)", () => {
  assert.notEqual(ccVerdict(CC_BELLY_DANCE(), CC_QUESTION), "on-topic");
  assert.notEqual(ccVerdict(CC_PRUNE_BELLY(), CC_QUESTION), "on-topic");
});

await test("the baby belly shelf keeps three on point sources through the handler filter and the topic filter", () => {
  const shelf = [
    GUT_MICROBE_PAPER(), CC_STUNTING_PAPER(), CC_CESAREAN_PAPER(),
    CC_BELLY_DANCE(), CC_PRUNE_BELLY(), CC_GHRELIN(), CC_NO_VOCAB_PAPER(),
  ];
  const afterHandler = shelf.filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  const onPoint = ["infant-gut-growth", "cc-stunting", "cc-cesarean"];
  for (const slug of onPoint) {
    assert.ok(afterHandler.some((p) => p.url.endsWith(slug)), `${slug} must survive the handler constraint filter`);
  }
  assert.ok(!afterHandler.some((p) => p.url.endsWith("cc-ghrelin")), "ghrelin must die at the handler filter");
  assert.ok(!afterHandler.some((p) => p.url.endsWith("cc-nematode")), "no vocabulary paper must die at the handler filter");
  const afterTopic = topicOverlapFilter(CC_QUESTION, afterHandler.map((p) => ({ ...p })));
  assert.deepEqual(
    afterTopic.map((p) => p.url.split("/").pop()).sort(),
    ["cc-cesarean", "cc-stunting", "infant-gut-growth"],
    "exactly the three on point papers survive the topic filter; the belly collisions touch one concept and die"
  );
});

await test("the surviving shelf cites at least two on point papers through the both concepts gate", () => {
  const shelf = topicOverlapFilter(CC_QUESTION, [
    GUT_MICROBE_PAPER(), CC_STUNTING_PAPER(), CC_CESAREAN_PAPER(),
  ]);
  const ans = {
    text:
      "The microbes that settle in an infant's gut in the first months shape how the gut matures [1]. " +
      "Children whose gut communities stay immature show more stunting [2]. " +
      "Delivery mode changes which microbes colonize first, and that tracks later weight gain [3].",
    sources: shelf,
  };
  const gated = applyConceptCoverageGate(ans.text, ans.sources, CC_QUESTION, null);
  for (const marker of ["[1]", "[2]", "[3]"]) {
    assert.ok(gated.text.includes(marker), `marker ${marker} must survive the both concepts gate`);
  }
  assert.deepEqual(gated.demoted, [], "no on point paper may be demoted by the gate");
  const labeled = labelUncitedSources(ans.sources, gated.text);
  assert.equal(labeled.length, 3, "the shipped source list carries all three on point sources");
  assert.ok(labeled.filter((s) => !s.uncited).length >= 2, "at least two on point sources must be cited");
});

await test("a repeated everyday word is ONE distinct concept in the topic filter", () => {
  const babyOnly = {
    title: "World's smallest baby doing well",
    abstract: "Doctors said the baby, born at 23 weeks, is doing well and gaining strength in intensive care.",
    url: "https://example.com/cc-baby-only",
  };
  const out = topicOverlapFilter(CC_QUESTION, [GUT_MICROBE_PAPER(), babyOnly]);
  assert.ok(out.some((p) => p.url.endsWith("infant-gut-growth")), "the two concept paper must survive");
  assert.ok(!out.some((p) => p.url.endsWith("cc-baby-only")), "a paper touching only the repeated word must die");
  assert.ok(
    String(babyOnly._filteredReason || "").includes("4 distinct"),
    `the count must be 4 distinct concepts after dedupe, got: ${babyOnly._filteredReason}`
  );
});

await test("sibling shape: germs on your skin, papers in wound care vocabulary", () => {
  const q = "do the germs on your skin change how fast a cut heals";
  const woundPaper = {
    title: "Cutaneous microbiota and wound closure after surgery",
    abstract:
      "The cutaneous microbiota was sampled before surgery and wound closure tracked for two weeks. " +
      "Commensal staphylococci predicted faster closure and fewer postoperative infections.",
    url: "https://example.com/cc-skin-wound",
  };
  assert.equal(ccVerdict(woundPaper, q), "partial", "the wound paper must earn partial via the microbe concept");
  const out = topicOverlapFilter(q, [{ ...woundPaper }, CC_GHRELIN()]);
  assert.ok(out.some((p) => p.url.endsWith("cc-skin-wound")), "the wound paper must survive the topic filter");
  assert.ok(!out.some((p) => p.url.endsWith("cc-ghrelin")), "the ghrelin paper must die in the same batch");
});

await test("single concept control: a fully matched constraint is partial, never off-topic", () => {
  const q = "does crop rotation improve soil fertility over time";
  assert.ok(questionConceptGroups("can a frog survive being frozen solid?").length < 2,
    "control: the frog question stays a single concept question (gate inert), unchanged by this fix");
  const rotationPaper = {
    title: "Long term crop rotation effects on soil organic matter",
    abstract:
      "Crop rotation was compared with continuous monoculture over twelve seasons. " +
      "Rotation increased soil organic carbon and aggregate stability.",
    url: "https://example.com/cc-rotation",
  };
  const v = verifyPaperConstraints(rotationPaper, analyzeQuery(q));
  assert.ok(v.matched.includes("crop rotation soil"), "the rotation constraint must fully match");
  assert.equal(v.verdict, "partial", `a fully matched constraint must not be off-topic, got ${v.verdict}`);
  assert.equal(ccVerdict(CC_GHRELIN(), q), "off-topic", "an unrelated paper stays off-topic for the control question");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
