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
  gateConceptGroups,
  gateDynLookup,
  paperConceptGroupHits,
  applyConceptCoverageGate,
  labelUncitedSources,
  hasRetractedTitleMarker,
  hasNonLiteratureTitleFraming,
  isNonLiterature,
  analyzeQuery,
  verifyPaperConstraints,
  programmaticValidationPasses,
  applyRelevanceGate,
  buildFurtherReadingTail,
  FURTHER_READING_TAIL_CAP,
  pruneExtractiveEvidence,
  conceptGateContext,
  conceptGateKeeps,
  buildCoverage,
  buildSearchRecord,
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

await test("an answer citing only a one concept paper is demoted in full (the floor rule is retired)", () => {
  // Corrected contract (2026-10-14, seventh panel, wave eight,
  // Job 2): the wave seven floor rule returned an answer
  // untouched whenever NO cited paper cleared, which is what let
  // drafts citing only junk ship precisely because they cited
  // only junk. The gate now demotes an all failing cited set
  // like any other; the handler's zero citation flip then routes
  // the run to the extractive tier over citable papers, or to
  // the no evidence state when that set is empty too. (The pre
  // wave eight pin asserted the opposite: the answer and the
  // empty demotion list stood.)
  const answer = "Weekend catch up sleep helps BMI [2].";
  const out = applyConceptCoverageGate(answer, SLEEP_PAPERS(), SLEEP_Q, SLEEP_DYN());
  assert.ok(!out.text.includes("[2]"), "the one concept citation kept its marker: " + out.text);
  assert.deepEqual(out.demoted.map((d) => d.idx), [2]);
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

await test("thinEvidence papers are NOT exempt (per paper binding has no cascade exception)", () => {
  const q = "Do the germs in a baby's belly change how well the baby grows?";
  const papers = [
    { title: "Anything at all", abstract: "belly only, nothing else", thinEvidence: true, url: "https://example.com/thin" },
    GUT_MICROBE_PAPER(),
  ];
  const answer = "Thin [1]. On point [2].";
  const out = applyConceptCoverageGate(answer, papers, q, null);
  // Corrected contract (2026-10-14, sixth panel, wave seven, Job
  // 1a): the cascade flag exempts nothing. The flagged paper
  // touches one concept group against a two group standard and
  // loses its marker like any other failing paper; the clearing
  // paper's marker survives. (The pre wave seven pin asserted
  // the opposite: the flag kept the marker unconditionally.)
  assert.ok(!out.text.includes("[1]"), "the flagged paper kept its marker: " + out.text);
  assert.ok(out.text.includes("[2]"), "the clearing paper lost its marker: " + out.text);
  assert.equal(out.demoted.length, 1, "exactly the flagged paper is demoted");
});

await test("single concept questions: the topicality standard judges (frog controls)", () => {
  // Corrected contract, 2026-10-14 (fourth panel, JOB 2): the gate
  // no longer sits out below two groups — it judges by the degraded
  // standard (one group touch, or a shared central content term).
  // Corrected again (2026-10-14, seventh panel, wave eight, Jobs 1
  // and 2): the standard is now TOPICALITY over the question's
  // central concepts, and the floor rule that returned an all
  // failing cited set untouched is retired. The two frog questions
  // below cite a mimosa paper and a gut microbe paper, and NEITHER
  // paper shares the frog questions' terms — under the corrected
  // standard neither is citable for them, so the corrected
  // expectation is the fall through: both citations demote, and in
  // the handler the run lands on the extractive tier or the no
  // evidence state. (The pre wave eight pin asserted the floor
  // left both answers untouched.) The mimosa question is the third
  // shape, and it still holds: its on point paper engages the
  // question's concepts (leaves, and the touch response group the
  // question names by its "fold their leaves" phrase) and keeps
  // its marker, while the unrelated gut paper is demoted.
  for (const q of [
    "What lets a wood frog survive being frozen for months at a time?",
    "How can a frog turn into ice all winter and not die?",
  ]) {
    assert.ok(questionConceptGroups(q, null).length < 2, `expected a thin resolution for: ${q}`);
    const papers = [MIMOSA_PAPER(), GUT_MICROBE_PAPER()];
    const answer = "One [1]. Two [2].";
    const out = applyConceptCoverageGate(answer, papers, q, null);
    assert.ok(!/\[\d+\]/.test(out.text), `the fall through must strip every marker for: ${q}`);
    assert.deepEqual(out.demoted.map((d) => d.idx), [1, 2],
      `both unrelated papers must demote for: ${q}`);
  }
  const q = "why do some plants fold their leaves when you touch them";
  assert.ok(questionConceptGroups(q, null).length < 2, "expected a thin resolution for the mimosa question");
  const out = applyConceptCoverageGate(
    "One [1]. Two [2].",
    [MIMOSA_PAPER(), GUT_MICROBE_PAPER()],
    q,
    null
  );
  assert.ok(out.text.includes("[1]"), "the on point mimosa paper keeps its marker");
  assert.deepEqual(out.demoted.map((d) => d.idx), [2],
    "the unrelated gut paper is demoted under the one group standard");
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
  // topic filter semantics changed, so cached shelves are stale),
  // then to v23 by the reorder at the end of this file (the
  // programmatic passes run before the evidence cut, so the
  // shipped shelf changes for the same stored inputs), then to
  // v24 by the further reading tail at the end of this file (the
  // shipped source list gains tail entries for the same stored
  // inputs, though retrieval and the evidence set are unchanged),
  // then to v25 by the extractive evidence fix at the end of this
  // file (extractive answers prune their evidence and tail to the
  // gate standard and pass failed papers leave shipped lists, so
  // the shipped list changes for the same stored inputs), then to
  // v26 by the topic filter grouped accounting at the end of this
  // file (a multi group question's papers must touch two resolved
  // concept groups, not two loose words, so collision papers leave
  // the shipped list for the same stored inputs), then to v27 by
  // the gate group precedence fix at the end of this file (gating
  // counts curated hand table groups first and model groups only
  // when the hand table is thin, so cited sets and shipped lists
  // change for questions whose expansion minted extra groups),
  // then to v28 by the subrequest ledger (retrieval and the answer
  // stages share one counted invocation budget with a protected
  // synthesis reserve, so for the same stored inputs speculative
  // retrieval rounds may be trimmed and expansion, validation and
  // fact check may be budget skipped with the reason recorded).
  // then to v36 by the answer package wave (2026-10-14: dedupe
  // merges change stored shelves, the first person screen, deDash
  // and species italics change stored answer text, uncited AI
  // answers no longer ship, and single source answers are capped
  // and limited, so stored payloads predate the shipped contract).
  // then to v37 by the fourth panel wave (2026-10-14: deterministic
  // fallback expansion, the citation gate judging below two
  // groups with coverage ordered citation selection, and the
  // prose bound to the trust fields — invented disagreement
  // sections stripped at a zero conflict verdict, fact check
  // unsupported claims removed from the text, and the support
  // bound confidence caps — so stored cited sets, answer text,
  // and confidence lines all predate the shipped contract).
  // then to v38 by the subject touch wave (2026-10-14: when a
  // question's subject group is identified, a paper clears the
  // citation gate and every surface mirroring it only by touching
  // the subject group or at least two groups in total — the
  // production creatine draw cited a hair sociology paper that
  // never mentions creatine — so stored cited sets and source
  // orders predate the corrected standard).
  // then to v39 by the fifth panel wave six (2026-10-14: the
  // bookkeeping funding lane, the shelf floor relaxation and the
  // broad terms rung, the serve gate, the title twin dedupe,
  // prose bound to the shipped confidence level, and the
  // Detailed acceptance floor — cited sets, shelf composition,
  // serve shapes, and answer text all predate the contract),
  // then to v40 by the sixth panel wave seven (2026-10-14: per
  // paper citation binding in every mode, gerund subject
  // identification, the scorer phrase carry rule, surface terms
  // for fetchers and reformulations, ladder continuation on the
  // citable count, anchor discipline, and restricted fallback
  // inflection — cited sets, serve shapes, queries, and answer
  // text all predate the contract),
  // then to v41 by the seventh panel wave eight (2026-10-14: the
  // citation standard in substance — topicality over the
  // question's central concepts, closed class groups never gate,
  // the coverage gate's floor rule removed, the scorer's zero
  // central concept cap, rung subject discipline, the widened
  // causative frame, the settled verdict guard, and the zero
  // support serve degrade — cited sets, shelf composition,
  // verdicts, and serve shapes all predate the contract).
  // then to v42 by the seventh panel wave eight round three
  // (2026-10-14: the source count made true — Zenodo removed
  // from the canonical list so the advertised count is 14 and
  // the fanout's paired name and fetch structure can never
  // mislabel a source again — and the nutrient concept class
  // resolving bare supplement names as central concepts, so
  // served answers and cited sets predate the contract).
  // then to v43 by wave nine (2026-10-14: mechanism shape
  // detection, the foundational lane inside the fanout budget,
  // the mechanism engagement requirement in the citation
  // standard, foundational primaries ordered into the evidence
  // slice, and the mechanism first synthesis contract, so
  // served answers and cited sets predate the contract).
  // CORRECTED CONTRACT (2026-10-13): the pin moves with the schema;
  // it exists to force this comment chain to be written, not to
  // freeze the version.
  assert.ok(src.includes('// v41 (2026-10-14, seventh panel wave eight)'), "the v41 chain entry must remain (schema history)");
  // PIN UPDATED (2026-10-14, wave ten): v44 — see the chain
  // comment above the constant for the wave ten reasons.
  // PIN UPDATED (2026-10-14, wave eleven): v45 — the compound
  // title clause for the presented list; see the chain comment
  // above the constant for the wave eleven reasons.
  // PIN UPDATED (2026-10-14, wave eleven addendum): v46 — the
  // mechanism detector hears plain copying words.
  // PIN UPDATED (2026-10-14, wave twelve): v47 — the claim
  // check counts only checked claims, dedupe folds richer
  // duplicate fields, the foundational lane sorts by
  // citations, the compound clause confirmation requires
  // topical company, the single source retry extends to
  // every clean answer.
  // PIN UPDATED (2026-10-14, wave thirteen): v48 —
  // foundational primaries get presentation priority, the
  // title rule requires topical company for every sighting,
  // and the claim check records a named tier trace with a
  // fallback model attempt and literature claim selection.
  // PIN UPDATED (2026-10-14, wave fourteen): v49 — the
  // search record carries the foundational fate diagnostic,
  // and the LLM validation pass can no longer remove a gate
  // cleared foundational primary.
  // PIN UPDATED (2026-10-14, wave fifteen): v50 — the
  // foundational lane gains founding form legs over the
  // unexpanded system name, and the record gains the
  // foundational near miss section.
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v50"'), "CACHE_SCHEMA_VERSION must be v50");
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
  // CORRECTED CONTRACT (2026-10-14, structured query hygiene): this
  // pin used to expect ["germs baby belly", "change well baby"] —
  // the raw glued windows. Key phrases now pass the filler screen
  // before they become constraints (see screenKeyPhrase in
  // search.js): "change" is a stopword and "well" a degree word, so
  // the second window's only content word is "baby". The verdict
  // tests below run on these screened phrases and are unchanged.
  assert.deepEqual(phrases, ["germs baby belly", "baby"]);
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
  // UPDATED 2026-10-13 (topic filter grouped accounting, end of this
  // file): this test originally pinned the content dedupe contract
  // through the reason string ("4 distinct concepts after dedupe").
  // The dedupe fix itself stands (it is what made the count honest),
  // but the accounting it fed is superseded: when a question
  // resolves two or more concept groups, the requirement is now
  // over those groups alone and ungrouped words like "baby" count
  // for nothing, so the repeated word cannot inflate OR satisfy
  // anything. The behavior pinned here is unchanged (the baby only
  // paper dies, the two group paper survives); the reason now names
  // the grouped accounting that produced the death.
  const babyOnly = {
    title: "World's smallest baby doing well",
    abstract: "Doctors said the baby, born at 23 weeks, is doing well and gaining strength in intensive care.",
    url: "https://example.com/cc-baby-only",
  };
  const out = topicOverlapFilter(CC_QUESTION, [GUT_MICROBE_PAPER(), babyOnly]);
  assert.ok(out.some((p) => p.url.endsWith("infant-gut-growth")), "the two concept paper must survive");
  assert.ok(!out.some((p) => p.url.endsWith("cc-baby-only")), "a paper touching only the repeated word must die");
  assert.ok(
    String(babyOnly._filteredReason || "").includes("resolved concept groups"),
    `the reason must name the grouped accounting, got: ${babyOnly._filteredReason}`
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

group("reorder — the cheap validation passes run before the evidence cut");
// The collapse fix above repaired the two judges' verdicts, but the
// stage ORDER still wasted the cut: selection sliced the ranked
// shelf to maxEvidence (12) first, and the programmatic validation
// passes (organism hard filter, topic overlap filter) ran only
// inside llmValidatePapers, on the cut set. Literal word papers
// occupied evidence slots the passes then freed, and real papers
// ranked 13 to 25 never reached the passes at all. The passes now
// run through programmaticValidationPasses on the full ranked
// shelf before the cut (the handler applies it to `papers` ahead
// of applyRelevanceGate), and llmValidatePapers composes the same
// helper, so the semantics are one implementation, not two. The
// LLM pass did NOT move: it still judges the selected set inside
// llmValidatePapers. Fixtures below compose the real stages in
// both orders over a shelf shaped like the production draw.

await test("the handler runs the programmatic passes on the shelf before the gate and cut", () => {
  const applyIdx = src.indexOf("papers = programmaticValidationPasses(query, papers, _dynForValidation);");
  assert.ok(applyIdx > 0, "the pre cut application is missing from the handler");
  // Wave seven: the selection gate is the per paper binding —
  // citablePapers computed through paperIsCitable over the post
  // passes shelf (the old "const gated = applyRelevanceGate"
  // line and the cascade below it are gone).
  const gateIdx = src.indexOf("serveGateNoEvidence = citablePapers.length === 0;");
  assert.ok(gateIdx > applyIdx, "the passes must run before the selection gate");
  assert.ok(
    src.includes("let survivors = programmaticValidationPasses(rawQuery, papers, dynLookup);"),
    "llmValidatePapers must compose the same helper, not a second implementation"
  );
  assert.ok(
    src.includes("llmValidatePapers(query, evidencePapers,"),
    "the LLM validation stage must still judge the selected evidence set"
  );
});

await test("the shared helper carries both cheap passes and no model call", () => {
  const start = src.indexOf("export function programmaticValidationPasses");
  const end = src.indexOf("export async function llmValidatePapers");
  assert.ok(start > 0 && end > start, "helper must sit directly above llmValidatePapers");
  const body = src.slice(start, end);
  assert.ok(body.includes("programmaticPaperFilter(rawQuery, papers)"), "PASS 1A missing from the helper");
  assert.ok(body.includes("topicOverlapFilter(rawQuery, survivors, dynLookup)"), "PASS 1B missing from the helper");
  assert.ok(!body.includes("fetch(") && !body.includes("defaultValidationCall"),
    "the helper must stay programmatic: the LLM leg lives in llmValidatePapers only");
});

await test("the helper drops a contaminant organism paper (PASS 1A) and keeps the queried organism", () => {
  const q = "Hermetia illucens gut microbiome";
  const target = {
    title: "Hermetia illucens gut microbiome across larval stages",
    abstract: "The gut microbiome of Hermetia illucens larvae was profiled across stages. Intestinal bacteria shifted with diet.",
    url: "https://example.com/reorder-hermetia",
  };
  const mealworm = {
    title: "Mealworm gut microbiome under different rearing substrates",
    abstract: "Tenebrio molitor larvae were reared on bran diets. The mealworm gut microbiome was profiled by sequencing.",
    url: "https://example.com/reorder-mealworm",
  };
  const mealwormIn = { ...mealworm };
  const out = programmaticValidationPasses(q, [{ ...target }, mealwormIn], null);
  assert.deepEqual(out.map((p) => p.url), ["https://example.com/reorder-hermetia"],
    "the contaminant must die in the organism pass, the queried organism must survive both passes");
  assert.ok(String(mealwormIn._filteredReason || "").includes("mealworm"),
    "the drop must be the organism pass's verdict");
});

await test("the helper keeps the never zero fallbacks llmValidatePapers always had", () => {
  // PASS 1A empties the set (every paper a contaminant): the top 3
  // of the input are restored before PASS 1B judges them.
  const q = "Hermetia illucens gut microbiome";
  const contaminants = ["Mealworm", "Cricket", "Tilapia", "Salmon"].map((name, i) => ({
    title: `${name} gut microbiome survey`,
    abstract: `The gut microbiome of the ${name.toLowerCase()} was profiled. Intestinal bacteria were catalogued across individuals.`,
    url: `https://example.com/reorder-contam-${i}`,
  }));
  const restored = programmaticValidationPasses(q, contaminants.map((p) => ({ ...p })), null);
  assert.equal(restored.length, 3, "an emptied organism pass must restore the top 3, not zero");
  // PASS 1B would empty the set (no shared vocabulary at all): the
  // topic filter's own fallback returns its input's top 3.
  const noVocab = [CC_NO_VOCAB_PAPER(), CC_GHRELIN(), {
    title: "Quantum dot synthesis in colloidal suspension",
    abstract: "Quantum dots were synthesized in colloidal suspension and their optical spectra recorded across temperatures.",
    url: "https://example.com/reorder-quantum",
  }];
  const floored = programmaticValidationPasses(CC_QUESTION, noVocab.map((p) => ({ ...p })), null);
  assert.equal(floored.length, 3, "an emptied topic pass must floor at the top 3, not zero");
});

// The production draw's shape, rebuilt as fixtures: a ranked shelf
// of 25 (the record's ranked count for the baby belly question).
// The top 12 hold five literal word collisions that pass the
// constraint verdict on the strength of the printed word and die
// in the topic filter for touching one concept, alongside seven on
// point papers. The three papers the diagnosis named sit at ranks
// 13 to 15, in the field's own vocabulary. Every paper clears the
// relevance floor and the constraint verdict, so the ONLY
// discriminative stages are the cut and the programmatic passes.
const DRAW_PAPER = (title, abstract, slug, relevance) => ({
  title, abstract, relevance, url: `https://example.com/${slug}`,
});
const buildDrawShelf = () => [
  { ...GUT_MICROBE_PAPER(), relevance: 96 },
  { ...CC_BELLY_DANCE(), relevance: 95 },
  { ...CC_STUNTING_PAPER(), relevance: 94 },
  { ...CC_PRUNE_BELLY(), relevance: 93 },
  { ...CC_CESAREAN_PAPER(), relevance: 92 },
  DRAW_PAPER("World's smallest baby doing well",
    "Doctors said the baby, born at 23 weeks, is doing well and gaining strength in intensive care.",
    "draw-baby-only", 91),
  DRAW_PAPER("Intestinal microbiota maturation and linear growth faltering in a twin cohort",
    "Intestinal microbiota maturation was tracked in twin pairs. Delayed maturation of the gut microbiota tracked linear growth faltering across the second year.",
    "draw-twin-cohort", 90),
  DRAW_PAPER("Belly fat and insulin resistance in midlife adults",
    "Visceral belly fat was measured by imaging in midlife adults. Abdominal adiposity predicted insulin resistance independent of body mass index.",
    "draw-belly-fat", 89),
  DRAW_PAPER("Gut microbiome development in preterm infants and postnatal weight gain",
    "The gut microbiome of preterm infants was sampled weekly. Microbiome succession in the intestine predicted postnatal weight gain velocity.",
    "draw-preterm-gut", 88),
  DRAW_PAPER("Baby bottle tooth decay in toddlers: a parent survey",
    "Parents reported baby bottle use at night in toddlers. Prolonged bottle feeding was associated with early childhood tooth decay.",
    "draw-baby-bottle", 87),
  DRAW_PAPER("Small intestinal bacterial overgrowth and nutrient absorption in stunted children",
    "Small intestinal bacterial overgrowth was measured by breath testing in stunted children. Bacterial overgrowth in the intestine tracked poorer nutrient absorption.",
    "draw-sibo-children", 86),
  DRAW_PAPER("Maternal gut microbiota transfer and infant growth in a randomized trial",
    "Maternal gut microbiota was characterized before delivery. Infants whose intestinal microbiota resembled the maternal profile showed steadier growth.",
    "draw-maternal-transfer", 85),
  DRAW_PAPER("Bifidobacteria imprinting of the infant gut in the first weeks of life",
    "Bifidobacterium strains transmitted from mother to infant imprinted the intestinal microbiota. Early bifidobacteria dominance predicted steadier weight gain.",
    "draw-bifido-imprinting", 84),
  DRAW_PAPER("Microbial shifts in early life and later growth trajectories",
    "Gut microbial communities shifted across the first year of life. Children whose microbiota stayed immature followed lower growth trajectories.",
    "draw-microbial-shifts", 83),
  DRAW_PAPER("The Human Microbiome and Child Growth: a birth cohort study",
    "The human gut microbiome was profiled from birth in a large cohort. Microbiome maturity at six months predicted child growth and stunting at age two.",
    "draw-human-microbiome-growth", 82),
  DRAW_PAPER("Breast milk microbiota and infant intestinal colonization",
    "Breast milk microbiota was sequenced alongside infant stool. Milk bacteria seeded the infant intestinal microbiota in the first month.",
    "draw-breast-milk", 81),
  DRAW_PAPER("Antibiotic exposure in infancy, gut microbiota disruption, and childhood weight",
    "Antibiotic courses in infancy disrupted gut microbiota assembly. Disrupted intestinal communities were associated with higher childhood weight.",
    "draw-antibiotics-infancy", 80),
  DRAW_PAPER("Probiotic supplementation and growth in undernourished children",
    "Children receiving probiotics were followed for a year. Shifts in the gut microbiota accompanied modest gains in height growth.",
    "draw-probiotic-growth", 79),
  DRAW_PAPER("Environmental enteropathy, intestinal bacteria, and linear growth",
    "Environmental enteropathy was assessed by intestinal permeability testing. Intestinal bacteria profiles tracked linear growth shortfalls in toddlers.",
    "draw-enteropathy", 78),
  DRAW_PAPER("Delivery mode, gut microbiome assembly, and adiposity at age five",
    "Delivery mode shaped gut microbiome assembly at birth. Intestinal microbiome composition at one year predicted adiposity at age five.",
    "draw-delivery-adiposity", 77),
  DRAW_PAPER("Fecal microbiota composition and catch up growth after malnutrition treatment",
    "Fecal microbiota was profiled before and after malnutrition treatment. Intestinal microbiota maturity rose alongside catch up growth in recovering children.",
    "draw-catch-up", 76),
  DRAW_PAPER("Twin study of gut microbiota heritability and childhood growth",
    "Gut microbiota similarity was compared between twin pairs. Intestinal microbiota composition explained part of the variation in childhood growth.",
    "draw-twin-heritability", 75),
  DRAW_PAPER("Zinc supplementation, intestinal microbiota, and diarrhea duration in infants",
    "Infants receiving zinc had shorter diarrhea episodes. Intestinal microbiota profiles differed between supplemented and control infants.",
    "draw-zinc-infants", 74),
  DRAW_PAPER("Household sanitation, gut microbiome, and stunting in a cluster trial",
    "Households received sanitation improvements in a cluster trial. Children's gut microbiome profiles shifted, while stunting rates changed little.",
    "draw-sanitation-trial", 73),
  DRAW_PAPER("Prebiotic oligosaccharides and infant gut microbiota maturation",
    "Infants fed prebiotic oligosaccharides showed faster gut microbiota maturation. Intestinal bifidobacteria counts rose across the first months.",
    "draw-prebiotic", 72),
];
const DRAW_NAMED = ["draw-bifido-imprinting", "draw-microbial-shifts", "draw-human-microbiome-growth"];
const DRAW_COLLISIONS = ["cc-belly-dance", "cc-prune-belly", "draw-baby-only", "draw-belly-fat", "draw-baby-bottle"];
const slugOf = (p) => p.url.split("/").pop();

await test("the draw: papers ranked 13 to 25 reach the passes and the shipped shelf only grows", () => {
  // The handler constraint verdict already runs at full shelf in
  // both orders; it is composed first here exactly as the handler
  // composes it. (The model leg is not composed: under the fleet
  // caps it fails open, and its placement is pinned separately
  // above. What the reorder governs is which papers the cut hands
  // it.)
  const handlerShelfOld = buildDrawShelf().filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  assert.equal(handlerShelfOld.length, 25, "the whole draw must clear the constraint verdict");
  // OLD ORDER: gate, cut to 12, then the programmatic passes.
  const oldEvidence = applyRelevanceGate(handlerShelfOld).slice(0, 12);
  assert.equal(oldEvidence.length, 12, "the old cut fills all 12 evidence slots");
  for (const slug of DRAW_NAMED) {
    assert.ok(!oldEvidence.some((p) => slugOf(p) === slug),
      `${slug} must be stranded below the old cut (that is the defect)`);
  }
  const shippedOld = programmaticValidationPasses(CC_QUESTION, oldEvidence.map((p) => ({ ...p })), null);
  assert.equal(shippedOld.length, 7,
    `the old order ships only the 7 on point papers the cut happened to hold, got ${shippedOld.length}`);
  // NEW ORDER: the programmatic passes on the full shelf, then
  // gate and cut.
  const handlerShelfNew = buildDrawShelf().filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  const prePassed = programmaticValidationPasses(CC_QUESTION, handlerShelfNew, null);
  const shippedNew = applyRelevanceGate(prePassed).slice(0, 12);
  assert.equal(shippedNew.length, 12, "the new order ships a full evidence set");
  for (const p of shippedOld) {
    assert.ok(shippedNew.some((n) => n.url === p.url),
      `nothing the old order shipped may be lost: ${slugOf(p)}`);
  }
  for (const slug of DRAW_NAMED) {
    assert.ok(shippedNew.some((p) => slugOf(p) === slug),
      `${slug} sat at ranks 13 to 15 and must now ship`);
  }
  for (const slug of DRAW_COLLISIONS) {
    assert.ok(!shippedNew.some((p) => slugOf(p) === slug),
      `the collision ${slug} must still die before the cut, exactly as the wave two fixtures pin`);
  }
});

group("further reading tail — the discarded shelf ships as further reading");
// The shipped source list was assembled from the final evidence
// set only, so two classes of good papers vanished from it: papers
// that passed every programmatic pass but ranked below the
// maxEvidence cut, and papers the LLM validation pass dropped
// (production's baby belly record shipped exactly 2 sources, both
// cited, further reading 0, on a shelf holding a dozen on point
// papers). The handler now snapshots the post passes shelf and, at
// the final labeling step only, appends a capped tail of its non
// evidence members, labeled separately so no citation marker can
// resolve to a tail entry. The evidence list, the synthesis
// prompts, and the both concepts gate are untouched. Fixtures
// compose the real stages over the draw shelf above.

await test("the handler snapshots the post passes shelf and joins the tail only at labeling", () => {
  assert.ok(src.includes("programmaticShelf = papers.slice();"),
    "the post passes snapshot is missing from the handler");
  // Updated 2026-10-13 (extractive evidence fix): the tail now
  // keeps its raw papers in furtherReadingTailPapers first, so the
  // extractive branch can hold the tail to the gate standard
  // before entries are built; the entries are still built from
  // that list beside the evidence list and labeled at the same
  // final step.
  // PIN UPDATED (2026-10-14, wave thirteen): the call gained a
  // third argument — the foundational primary test that gives
  // admitted first descriptions presentation priority in the
  // tail (brief item 1). The contract this pin protects is
  // unchanged: the tail is still built from the post passes
  // snapshot against the final evidence set.
  assert.ok(
    src.includes("buildFurtherReadingTail(programmaticShelf, evidencePapers, tailPrimaryTest || undefined)"),
    "the tail must be built from the snapshot against the final evidence set"
  );
  assert.ok(
    src.includes("furtherReadingTailPapers.map(toSourceEntry)"),
    "the tail entries must be built from the tail papers list"
  );
  assert.ok(
    src.includes('labelUncitedSources(furtherReadingTail, "")'),
    "the tail must be labeled against an empty answer so no marker can resolve to it"
  );
  const listIdx = src.indexOf("let sourceList = ");
  const tailIdx = src.indexOf("let furtherReadingTail = ");
  assert.ok(listIdx > 0 && tailIdx > listIdx,
    "the tail is built beside the evidence list, never inside it");
});

await test("the draw: the tail carries the stranded papers and names the production discards", () => {
  const handlerShelf = buildDrawShelf().filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  const prePassed = programmaticValidationPasses(CC_QUESTION, handlerShelf.map((p) => ({ ...p })), null);
  assert.equal(prePassed.length, 20, "the passes leave 20 on point papers on the draw shelf");
  const cut = applyRelevanceGate(prePassed).slice(0, 12);
  assert.equal(cut.length, 12, "the cut fills the evidence set before validation");
  // Production shape: the LLM validation pass then dropped all
  // but the two papers the live answer cited (the cesarean
  // microbiota paper, with the stunting paper as its stand in).
  const evidence = cut.filter((p) => ["cc-cesarean", "cc-stunting"].includes(slugOf(p)));
  assert.equal(evidence.length, 2, "the modeled production evidence set is the cited pair");
  const tail = buildFurtherReadingTail(prePassed, evidence);
  // 18 candidates (10 cut papers the model leg dropped, 8 more
  // below the cut) and room for 10: the cap binds.
  assert.equal(FURTHER_READING_TAIL_CAP, 10, "the tail cap is the stated 10");
  assert.equal(tail.length, FURTHER_READING_TAIL_CAP, "the tail is capped, not a second evidence set");
  // The three papers the citation collapse diagnosis named, all
  // stranded by the old assembly, ride the tail.
  for (const slug of DRAW_NAMED) {
    assert.ok(tail.some((p) => slugOf(p) === slug), `${slug} must appear in the tail`);
  }
  // No collision ever appears (they died in the passes, so they
  // are not in the snapshot), and no evidence paper repeats.
  for (const slug of DRAW_COLLISIONS) {
    assert.ok(!tail.some((p) => slugOf(p) === slug), `collision ${slug} must never enter the tail`);
  }
  for (const p of tail) {
    assert.ok(!evidence.some((e) => e.url === p.url), "a tail entry must not duplicate the evidence");
  }
  // Shelf order is preserved: relevance descends along the tail.
  const rels = tail.map((p) => p.relevance);
  assert.deepEqual(rels, [...rels].sort((a, b) => b - a), "the tail keeps the shelf's relevance order");
});

await test("below the cut only: a full evidence set leaves the rest of the shelf as the tail", () => {
  const handlerShelf = buildDrawShelf().filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  const prePassed = programmaticValidationPasses(CC_QUESTION, handlerShelf.map((p) => ({ ...p })), null);
  const evidence = applyRelevanceGate(prePassed).slice(0, 12);
  const tail = buildFurtherReadingTail(prePassed, evidence);
  assert.deepEqual(tail.map(slugOf), [
    "draw-probiotic-growth", "draw-enteropathy", "draw-delivery-adiposity",
    "draw-catch-up", "draw-twin-heritability", "draw-zinc-infants",
    "draw-sanitation-trial", "draw-prebiotic",
  ], "with no validation drops, the tail is exactly the shelf below the cut, in order");
});

await test("the shipped list: evidence cited, tail further reading, counts agree across coverage and record", () => {
  const handlerShelf = buildDrawShelf().filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  const prePassed = programmaticValidationPasses(CC_QUESTION, handlerShelf.map((p) => ({ ...p })), null);
  const cut = applyRelevanceGate(prePassed).slice(0, 12);
  const evidence = cut.filter((p) => ["cc-cesarean", "cc-stunting"].includes(slugOf(p)));
  const tailPapers = buildFurtherReadingTail(prePassed, evidence);
  const entry = (p) => ({ title: p.title, url: p.url, relevance: p.relevance, type: "Reference" });
  // The answer cites both evidence entries and, adversarially, a
  // stray marker aimed at a tail position. The shipped list must
  // still show the tail as further reading: the tail was labeled
  // against an empty answer, and the record's flag rule honors
  // the stamped uncited flag over marker positions.
  const answer =
    "Delivery mode shapes the first gut colonists [2]. Immature gut communities track stunting and poorer growth [1]. " +
    "A stray marker [7] cites nothing that shipped.";
  const shipped = [
    ...labelUncitedSources(evidence.map(entry), answer),
    ...labelUncitedSources(tailPapers.map(entry), ""),
  ];
  assert.equal(shipped.length, 12, "the shipped list is the cited pair plus the capped tail");
  assert.deepEqual(
    shipped.map((s) => !!s.uncited),
    [false, false, true, true, true, true, true, true, true, true, true, true],
    "evidence entries read cited, every tail entry reads further reading"
  );
  const funnel = { gathered: 77, deduped: 72, excludedWeak: 47, excludedNonEnglish: 0, excludedRetracted: 0, cited: 2 };
  const coverage = buildCoverage({ funnel, sources: shipped, answer });
  assert.equal(coverage.cited, 2, "coverage cited counts the evidence only");
  assert.equal(coverage.furtherReading, 10, "coverage further reading counts the tail");
  const record = buildSearchRecord({
    question: CC_QUESTION, askedAt: new Date("2026-10-13T12:00:00.000Z"),
    funnel, sources: shipped, answer,
  });
  assert.ok(record, "the record must build over a tailed source list");
  assert.equal(record.sources.length, 12, "the record freezes the tail alongside the evidence");
  assert.deepEqual(
    record.sources.map((s) => s.cited),
    [true, true, false, false, false, false, false, false, false, false, false, false],
    "the record's per source cited flags agree with the shipped labels"
  );
  assert.equal(record.funnel.cited, 2, "the record funnel cited count agrees with coverage");
});

await test("tail membership: sub floor, retracted, and duplicate papers never enter", () => {
  const base = { ...GUT_MICROBE_PAPER(), relevance: 90 };
  const shelf = [
    { ...base },
    { title: "A passing mention of gut bacteria in passing", abstract: "A brief mention.", url: "https://example.com/tail-weak", relevance: 40 },
    { title: "[RETRACTED] Gut microbiota and infant growth", abstract: "Withdrawn.", url: "https://example.com/tail-retracted", relevance: 88 },
    { title: base.title, abstract: "A second record of the same work.", url: "https://example.com/tail-duplicate", relevance: 85 },
  ];
  const tail = buildFurtherReadingTail(shelf, [{ ...base }]);
  assert.deepEqual(tail, [],
    "the evidence paper itself, a sub floor paper, a retracted paper, and a duplicate record all stay out");
});

await test("no tail candidates: the tail is empty, so the shipped list stays the evidence alone", () => {
  const shelf = [GUT_MICROBE_PAPER(), CC_STUNTING_PAPER(), CC_CESAREAN_PAPER()]
    .map((p, i) => ({ ...p, relevance: 90 - i * 5 }));
  assert.deepEqual(buildFurtherReadingTail(shelf, shelf), [],
    "when everything that passed is evidence, there is no tail");
  assert.deepEqual(buildFurtherReadingTail([], shelf), [], "an empty shelf has no tail");
  assert.deepEqual(buildFurtherReadingTail(null, shelf), [], "a missing shelf has no tail");
});

group("extractive evidence standard — the shipped list in extractive mode");
// The production defect this closes (build 6a5cad3): the baby
// belly question ran EXTRACTIVE while the fleet was capped, and
// its record shipped 18 sources with exactly one citation — a
// baby spinach paper, a literal word collision — while the real
// shelf sat uncited and known collisions (belly dance, prune
// belly, surrogacy law, a big belly case report) filled the list.
// The extractive path now prunes its evidence to the both
// concepts gate's standard before the builder runs, holds its
// further reading tail to the same standard, and drops any paper
// a programmatic pass stamped as failed from shipped lists in
// either mode. The fixtures compose the handler's stages over
// the draw shelf, in the production extractive shape (the
// validation leg failed open under the caps, so the evidence set
// is the full cut).

await test("the handler prunes the extractive evidence and holds its tail to the standard", () => {
  assert.ok(src.includes("pruneExtractiveEvidence(evidencePapers, query, extGateDyn)"),
    "the extractive branch must prune the evidence set before the builder runs");
  assert.ok(src.includes("PASS FAILED PAPERS LEAVE THE SHIPPED LIST"),
    "the pass failed drop must guard the shipped evidence list in both modes");
  assert.ok(src.includes("conceptGateKeeps(p, 0, tailCtx)"),
    "the extractive tail must be filtered by the gate standard");
});

await test("the draw in extractive mode: standard held, caps held, no collisions ship", () => {
  const handlerShelf = buildDrawShelf().filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  const prePassed = programmaticValidationPasses(CC_QUESTION, handlerShelf.map((p) => ({ ...p })), null);
  const evidence = applyRelevanceGate(prePassed).slice(0, 12);
  assert.equal(evidence.length, 12, "the failed open validation shape keeps the full cut as evidence");
  const pruned = pruneExtractiveEvidence(evidence, CC_QUESTION, null);
  const groups = questionConceptGroups(CC_QUESTION, null);
  for (const p of pruned.papers) {
    assert.ok(p.thinEvidence || paperConceptGroupHits(p, groups) >= 2,
      `extractive evidence must meet the gate standard: ${slugOf(p)}`);
  }
  const tailAll = buildFurtherReadingTail(prePassed, pruned.papers);
  const tailCtx = conceptGateContext(tailAll, CC_QUESTION, null);
  const tail = tailAll.filter((p) => conceptGateKeeps(p, 0, tailCtx));
  assert.ok(tail.length <= FURTHER_READING_TAIL_CAP, "the extractive tail obeys the tail cap");
  const shipped = [...pruned.papers, ...tail];
  assert.ok(shipped.length <= 12 + FURTHER_READING_TAIL_CAP,
    "the extractive shipped list obeys evidence cap plus tail cap");
  for (const slug of DRAW_COLLISIONS) {
    assert.ok(!shipped.some((p) => slugOf(p) === slug), `collision ${slug} must never ship in extractive mode`);
  }
  for (const slug of DRAW_NAMED) {
    assert.ok(shipped.some((p) => slugOf(p) === slug),
      `${slug} rides the extractive shipped list (evidence or standard passing tail)`);
  }
  for (const p of tail) {
    assert.ok(p.thinEvidence || paperConceptGroupHits(p, groups) >= 2,
      `extractive tail entries meet the same standard: ${slugOf(p)}`);
  }
});

await test("a paper a pass stamped as failed never enters through the tail", () => {
  const evidencePaper = { ...GUT_MICROBE_PAPER(), relevance: 90 };
  const stamped = {
    ...CC_STUNTING_PAPER(), relevance: 88,
    _filteredReason: "Paper only shares 1 of the query's 4 distinct core topic concepts (needs 2)",
  };
  const tail = buildFurtherReadingTail([evidencePaper, stamped], [evidencePaper]);
  assert.deepEqual(tail, [],
    "the stamped paper stays out of the tail even though it clears the relevance floor");
  // The same paper unstamped (a fallback never restored it) does enter.
  const unstamped = { ...CC_STUNTING_PAPER(), relevance: 88 };
  const tail2 = buildFurtherReadingTail([evidencePaper, unstamped], [evidencePaper]);
  assert.equal(tail2.length, 1, "the unstamped paper remains tail eligible");
});

group("topic filter grouped accounting — the requirement is over resolved concept groups");
// The residual defect (production, build 33532ab): the baby belly
// question's AI answer cited 3 on point papers and its extractive
// path was clean, but its further reading list still carried the
// belly dance in labor paper, a prune belly case report, the
// surrogacy law paper, and a big belly case report. Trace:
// topicOverlapFilter counted DISTINCT concepts over a mixed set —
// real concept groups (microbes, gut) plus ungrouped singleton
// words from the question (baby, grows). The collisions passed on
// gut (via the word "belly") plus "baby": two loose hits, neither
// a subject concept. The both concepts gate barred them from
// citation, but the filter had already admitted them to the
// shipped list as further reading. The filter now defines the
// requirement over the question's GATING CONCEPT GROUPS alone
// (gateConceptGroups: curated groups first, model groups only
// when the hand table resolves fewer than two) when two or more
// resolve: a paper must touch at least two distinct groups,
// counted by paperConceptGroupHits, the gate's own counter, so
// the filter and the gate apply one standard. Questions resolving
// fewer than two groups keep the singleton accounting untouched
// (the fallback branch pinned below). Cache schema v26 (grouped
// accounting); v27 adds the curated first precedence the pins at
// the end of this file prove.

// Production shaped collisions: each prints the question's literal
// words (that is how it cleared the handler constraint verdict and
// the old mixed accounting), and each touches exactly ONE resolved
// group — the gut group, via "belly" or "abdominal".
const GA_BELLY_DANCE = () => ({
  title: "The Influence of Belly Dance on the Second Stage of Labor and the Condition of the Baby",
  abstract:
    "Belly dance was taught to pregnant women in labor preparation classes. " +
    "Trainers reported the baby tolerated the movements well, and mothers " +
    "described less pain in the second stage of labor.",
  url: "https://example.com/ga-belly-dance",
  relevance: 96,
});
const GA_PRUNE_BELLY = () => ({
  title: "Prune belly syndrome in a newborn baby: a case report",
  abstract:
    "The baby presented with a deficient abdominal wall and urinary tract " +
    "anomalies. Management of prune belly syndrome in the newborn is reviewed.",
  url: "https://example.com/ga-prune-belly",
  relevance: 94,
});
const GA_SURROGACY = () => ({
  title: "Her Belly, Their Baby: A Contract Solution for Surrogacy Agreements",
  abstract:
    "Surrogacy agreements raise contract questions when the surrogate changes " +
    "her mind. This article examines the pregnant woman's belly as the site " +
    "of the legal dispute and proposes a contract solution protecting the baby.",
  url: "https://example.com/ga-surrogacy",
  relevance: 92,
});
const GA_BIG_BELLY = () => ({
  title: "The Baby with a Big Belly: Life-threatening Abdominal Distention in a Newborn",
  abstract:
    "A newborn baby presented with a big belly and abdominal distention. " +
    "Imaging showed an intestinal obstruction requiring urgent surgery.",
  url: "https://example.com/ga-big-belly",
  relevance: 89,
});
const GA_COLLISIONS = [GA_BELLY_DANCE, GA_PRUNE_BELLY, GA_SURROGACY, GA_BIG_BELLY];

// The on point shelf the brief names, in the field's vocabulary.
const GA_CESAREAN_RESTORATION = () => ({
  title: "Partial restoration of the microbiota of cesarean-born infants via vaginal microbial transfer",
  abstract:
    "Infants born by cesarean section miss the microbial transfer of vaginal " +
    "delivery. Vaginal microbial transfer partially restored the gut " +
    "microbiota of cesarean born infants, whose intestinal communities then " +
    "resembled those of vaginally born infants in the first month.",
  url: "https://example.com/ga-cesarean-restoration",
  relevance: 97,
});
const GA_GLYCOLIPIDS = () => ({
  title: "Exploring the interplay between dietary plant glycolipids and gut microbiota: a systematic review",
  abstract:
    "Dietary glycolipids reach the intestine largely intact. This review " +
    "synthesizes evidence that plant glycolipids reshape gut microbiota " +
    "composition, microbial metabolite production, and intestinal barrier function.",
  url: "https://example.com/ga-glycolipids",
  relevance: 90,
});
const GA_GROUPS = () => questionConceptGroups(CC_QUESTION, null);

await test("the production collisions each touch exactly one resolved group", () => {
  const groups = GA_GROUPS();
  assert.equal(groups.length, 2, "the baby belly question resolves the microbe and gut groups");
  for (const make of GA_COLLISIONS) {
    assert.equal(paperConceptGroupHits(make(), groups), 1,
      `${make().url} must touch exactly one group (gut, via the body word)`);
  }
  assert.equal(paperConceptGroupHits(GA_CESAREAN_RESTORATION(), groups), 2);
  assert.equal(paperConceptGroupHits(GA_GLYCOLIPIDS(), groups), 2);
});

await test("the collisions clear the handler verdict and then die at the topic filter", () => {
  // The production shape: the handler is not where they die (they
  // print the literal words), and the old mixed accounting let
  // them through on gut plus the "baby" singleton. Grouped
  // accounting leaves them at one group of the two required.
  for (const make of GA_COLLISIONS) {
    assert.ok(ccPassesHandlerFilter(make(), CC_QUESTION),
      `${make().url} must clear the handler verdict, as it did in production`);
  }
  const shelf = [...GA_COLLISIONS.map((m) => m()), GUT_MICROBE_PAPER()];
  const judged = shelf.map((p) => ({ ...p }));
  const out = topicOverlapFilter(CC_QUESTION, judged);
  assert.deepEqual(out.map((p) => p.url), ["https://example.com/infant-gut-growth"],
    "only the two group paper survives the grouped accounting");
  for (const make of GA_COLLISIONS) {
    const dead = judged.find((p) => p.url === make().url);
    assert.ok(String(dead._filteredReason || "").includes("resolved concept groups"),
      `${dead.url} must die by the grouped accounting, got: ${dead._filteredReason}`);
  }
});

await test("the accepted remainder: a two group paper in field vocabulary stays admissible", () => {
  // The spinach paper touches two real groups on its abstract
  // (microbiome; gastrointestinal terms) while printing none of
  // the question's subject words as its topic. That is an honest
  // two concept paper, not a collision: grouped accounting keeps
  // it admissible as further reading, by design.
  const spinach = {
    title: "Metabolomic Characterization of Baby Spinach Phenolics Transformation During Gastrointestinal Digestion",
    abstract:
      "Spinach phenolics were tracked through simulated digestion. " +
      "Microbiome modulation by the phenolic metabolites was assessed in vitro.",
    url: "https://example.com/ga-spinach",
  };
  assert.equal(paperConceptGroupHits(spinach, GA_GROUPS()), 2,
    "the spinach paper touches the microbe and gut groups");
  const out = topicOverlapFilter(CC_QUESTION, [{ ...spinach }]);
  assert.ok(out.some((p) => p.url.endsWith("ga-spinach")),
    "a genuine two group paper stays admissible under grouped accounting");
});

await test("the AI assembly: collisions appear nowhere in the shipped list, the named shelf ships cited", () => {
  const drawBySlug = Object.fromEntries(buildDrawShelf().map((p) => [slugOf(p), p]));
  const onPoint = [
    GA_CESAREAN_RESTORATION(),
    drawBySlug["draw-bifido-imprinting"],
    drawBySlug["draw-microbial-shifts"],
    drawBySlug["draw-human-microbiome-growth"],
    drawBySlug["draw-enteropathy"],
    GA_GLYCOLIPIDS(),
  ];
  const shelf = [...onPoint, ...GA_COLLISIONS.map((m) => m())];
  const afterHandler = shelf.filter((p) => ccPassesHandlerFilter(p, CC_QUESTION));
  assert.equal(afterHandler.length, shelf.length,
    "every fixture, collisions included, clears the handler verdict (the production shape)");
  const passedPapers = programmaticValidationPasses(CC_QUESTION, afterHandler.map((p) => ({ ...p })), null);
  for (const make of GA_COLLISIONS) {
    assert.ok(!passedPapers.some((p) => p.url === make().url),
      `${make().url} must die in the programmatic passes under grouped accounting`);
  }
  for (const p of onPoint) {
    assert.ok(passedPapers.some((x) => x.url === p.url), `${slugOf(p)} must survive the passes`);
  }
  const evidence = applyRelevanceGate(passedPapers).slice(0, 12);
  const tail = buildFurtherReadingTail(passedPapers, evidence);
  const shipped = [...evidence, ...tail];
  for (const make of GA_COLLISIONS) {
    assert.ok(!shipped.some((p) => p.url === make().url),
      `${make().url} must appear nowhere in the shipped list, evidence or tail`);
  }
  for (const p of onPoint) {
    assert.ok(shipped.some((x) => x.url === p.url), `${slugOf(p)} must ship`);
  }
  // The AI assembly: an answer citing three of the shipped on
  // point papers keeps every marker through the both concepts
  // gate (the gate is unchanged; the filter now agrees with it).
  const idxOf = (slug) => evidence.findIndex((p) => slugOf(p) === slug) + 1;
  const answer =
    `Vaginal microbial transfer restores the first gut colonists of cesarean born infants [${idxOf("ga-cesarean-restoration")}]. ` +
    `Intestinal bacteria and enteropathy track linear growth shortfalls [${idxOf("draw-enteropathy")}]. ` +
    `Dietary glycolipids reshape the gut microbiota and its metabolites [${idxOf("ga-glycolipids")}].`;
  const gated = applyConceptCoverageGate(answer, evidence, CC_QUESTION, null);
  assert.deepEqual(gated.demoted, [], "no on point citation may be demoted");
  const labeled = labelUncitedSources(evidence.map((p) => ({ title: p.title, url: p.url })), gated.text);
  assert.ok(labeled.filter((s) => !s.uncited).length >= 2,
    "at least two on point sources stay cited on the AI assembly");
});

await test("the sleep and colds set: the filter now agrees with the gate", () => {
  // Same fixtures as the gate pins above, judged by the filter
  // with the same dynLookup: the two group paper survives, the
  // one group papers die here too, instead of shipping as
  // further reading behind a demoted citation.
  const out = topicOverlapFilter(SLEEP_Q, SLEEP_PAPERS().map((p) => ({ ...p })), SLEEP_DYN());
  assert.deepEqual(out.map((p) => p.url), ["https://example.com/both-concepts"],
    "only the paper touching both resolved groups survives the filter");
});

await test("fallback branch: a single concept question retrieves its shelf by singleton accounting", () => {
  // The frog question resolves no concept groups, so the grouped
  // branch must not engage and the singleton accounting below it
  // decides, exactly as before this fix.
  const frogQ = "can a frog survive being frozen solid?";
  assert.ok(questionConceptGroups(frogQ, null).length < 2,
    "control: the frog question stays below the grouped branch's threshold");
  const freezePaper = {
    title: "Freeze tolerance in the wood frog",
    abstract:
      "The wood frog survives being frozen solid: ice forms in body " +
      "cavities while glucose protects the cells until the spring thaw.",
    url: "https://example.com/ga-frog-freeze",
  };
  const offPaper = {
    title: "Quantum dot synthesis in colloidal suspension",
    abstract: "Quantum dots were synthesized in colloidal suspension and their optical spectra recorded.",
    url: "https://example.com/ga-quantum",
  };
  const out = topicOverlapFilter(frogQ, [{ ...freezePaper }, { ...offPaper }]);
  assert.ok(out.some((p) => p.url.endsWith("ga-frog-freeze")),
    "the on topic paper must survive through the fallback's singleton accounting");
  assert.ok(!out.some((p) => p.url.endsWith("ga-quantum")),
    "the unrelated paper must still die in the fallback branch");
});

// ═══════════════════════════════════════════════════════════════════
group("gate group precedence — curated groups gate, model groups only fill a thin table");
// The production defect (build 363d02c): a fresh run of the baby
// belly question drew a different shelf (gathered 62, the
// expansion leg evidently cold) and, in extractive mode, CITED
// "The Baby with a Big Belly" and the belly dance labor paper —
// 8 cited of 9 shipped. Mechanism: questionConceptGroups merges
// hand written and model expansion groups indistinguishably, so
// when expansion mints a group for the population word (baby
// becomes infant, newborn, birth), a labor paper touches gut plus
// that population group and satisfies a two group standard that
// was designed around the question's SUBJECT concepts (microbes,
// gut). Whether the gates were strict depended on whether the
// expansion leg happened to fire. The corrected contract:
// gateConceptGroups counts the curated hand table groups first;
// model groups count only when fewer than two hand groups resolve
// (the thin table case). Retrieval keeps the full merged
// resolution — expansion still helps papers get FOUND; it just
// stops loosening the standard for what may be cited or shipped.
// Cache schema v27.

// The adversarial expansion: a population group for the word baby,
// exactly the shape that loosened the gates when the leg fired.
const GP_ADV_DYN = () => buildDynLookup([
  { term: "baby", alternates: ["infant", "newborn", "birth"] },
]);
// Model groups on OTHER terms of the same question: precedence is
// by source, not by term, so these must not count either.
const GP_OTHER_DYN = () => buildDynLookup([
  { term: "grows", alternates: ["growth", "weight gain", "development"] },
  { term: "change", alternates: ["alter", "shift", "modulate"] },
]);

await test("retrieval still merges the population group; gating does not count it", () => {
  assert.equal(questionConceptGroups(CC_QUESTION, GP_ADV_DYN()).length, 3,
    "the merged retrieval resolution still gains the expansion group");
  assert.equal(gateDynLookup(CC_QUESTION, GP_ADV_DYN()), null,
    "with two hand groups resolved, the dyn lookup must not gate");
  assert.deepEqual(gateConceptGroups(CC_QUESTION, GP_ADV_DYN()), questionConceptGroups(CC_QUESTION, null),
    "the gating groups are exactly the curated groups");
});

await test("under the adversarial expansion the collisions touch one gating group, not two", () => {
  const merged = questionConceptGroups(CC_QUESTION, GP_ADV_DYN());
  const gating = gateConceptGroups(CC_QUESTION, GP_ADV_DYN());
  for (const make of GA_COLLISIONS) {
    assert.equal(paperConceptGroupHits(make(), merged), 2,
      `${make().url} must reach two groups under the merged counting (the trap)`);
    assert.equal(paperConceptGroupHits(make(), gating), 1,
      `${make().url} must fall back to one group under the gating counting`);
  }
  assert.equal(paperConceptGroupHits(GA_CESAREAN_RESTORATION(), gating), 2,
    "the on point shelf still touches both curated groups");
  assert.equal(paperConceptGroupHits(GUT_MICROBE_PAPER(), gating), 2);
});

await test("the gate's verdict no longer depends on whether the expansion leg fired", () => {
  const papers = [GUT_MICROBE_PAPER(), ...GA_COLLISIONS.map((m) => m())];
  const answer =
    "Gut bacteria shape infant growth [1]. Belly dance eases labor [2]. " +
    "Prune belly is a wall defect [3]. Surrogacy is contract law [4]. " +
    "A big belly can be an obstruction [5].";
  const withDyn = applyConceptCoverageGate(answer, papers.map((p) => ({ ...p })), CC_QUESTION, GP_ADV_DYN());
  const without = applyConceptCoverageGate(answer, papers.map((p) => ({ ...p })), CC_QUESTION, null);
  assert.deepEqual(withDyn.demoted.map((d) => d.idx), [2, 3, 4, 5],
    "every collision is demoted even when expansion minted the population group");
  assert.deepEqual(withDyn.demoted.map((d) => d.idx), without.demoted.map((d) => d.idx),
    "the demotion set is identical with and without the expansion leg");
  assert.equal(withDyn.text, without.text, "the gated answer is identical either way");
  assert.ok(withDyn.text.includes("[1]"), "the on point citation survives");
});

await test("the shipped list excludes the collisions with and without the adversarial expansion", () => {
  const drawBySlug = Object.fromEntries(buildDrawShelf().map((p) => [slugOf(p), p]));
  const onPoint = [
    GA_CESAREAN_RESTORATION(),
    drawBySlug["draw-bifido-imprinting"],
    drawBySlug["draw-microbial-shifts"],
    drawBySlug["draw-human-microbiome-growth"],
    drawBySlug["draw-enteropathy"],
    GA_GLYCOLIPIDS(),
  ];
  for (const dyn of [GP_ADV_DYN(), null]) {
    const shelf = [...onPoint, ...GA_COLLISIONS.map((m) => m())];
    const passedPapers = programmaticValidationPasses(CC_QUESTION, shelf.map((p) => ({ ...p })), dyn);
    for (const make of GA_COLLISIONS) {
      assert.ok(!passedPapers.some((p) => p.url === make().url),
        `${make().url} must die in the passes (dyn: ${dyn ? "adversarial" : "none"})`);
    }
    const evidence = applyRelevanceGate(passedPapers).slice(0, 12);
    const shipped = [...evidence, ...buildFurtherReadingTail(passedPapers, evidence)];
    for (const make of GA_COLLISIONS) {
      assert.ok(!shipped.some((p) => p.url === make().url),
        `${make().url} must appear nowhere in the shipped list (dyn: ${dyn ? "adversarial" : "none"})`);
    }
    for (const p of onPoint) {
      assert.ok(shipped.some((x) => x.url === p.url), `${slugOf(p)} must ship`);
    }
  }
});

await test("model groups on other terms do not count either: precedence is by source", () => {
  assert.equal(gateDynLookup(CC_QUESTION, GP_OTHER_DYN()), null,
    "a dyn lookup whose groups sit on other terms still must not gate");
  assert.deepEqual(gateConceptGroups(CC_QUESTION, GP_OTHER_DYN()), questionConceptGroups(CC_QUESTION, null),
    "the gating groups are unchanged by model groups on any term");
  // A paper that touches gut plus the model "grows" group (via
  // "development") reaches the standard only under merged counting.
  const developmentPaper = {
    title: "Abdominal ultrasound screening and child development",
    abstract:
      "Abdominal ultrasound screening in schoolchildren was compared with " +
      "development milestones recorded over two school years.",
    url: "https://example.com/gp-development",
  };
  assert.equal(paperConceptGroupHits(developmentPaper, questionConceptGroups(CC_QUESTION, GP_OTHER_DYN())), 2,
    "the paper reaches two groups only when the model group counts");
  assert.equal(paperConceptGroupHits(developmentPaper, gateConceptGroups(CC_QUESTION, GP_OTHER_DYN())), 1,
    "under gating counting it touches the gut group alone");
  const papers = [GUT_MICROBE_PAPER(), developmentPaper];
  const answer = "Gut bacteria shape growth [1]. Screening tracks development [2].";
  const gated = applyConceptCoverageGate(answer, papers.map((p) => ({ ...p })), CC_QUESTION, GP_OTHER_DYN());
  assert.deepEqual(gated.demoted.map((d) => d.idx), [2],
    "the gut plus model group paper is demoted: its second group does not count");
});

await test("thin table case: the sleep and colds groups still come from expansion", () => {
  const dyn = SLEEP_DYN();
  assert.equal(questionConceptGroups(SLEEP_Q, null).length, 0,
    "control: the hand table resolves nothing for the sleep question");
  assert.equal(gateDynLookup(SLEEP_Q, dyn), dyn,
    "with a thin hand table the dyn lookup passes through to gating");
  const gating = gateConceptGroups(SLEEP_Q, dyn);
  assert.equal(gating.length, 2, "the expansion groups carry the standard here");
  assert.deepEqual(SLEEP_PAPERS().map((p) => paperConceptGroupHits(p, gating)), [2, 1, 1],
    "the two group paper passes, the single group papers demote, exactly as before");
});

await test("all three gating consumers resolve through the shared helper", () => {
  // Corrected contract, 2026-10-14 (fourth panel, JOB 2): the
  // shared helper is citationGateStandard — the gate and the gate
  // context both resolve the standard through it, and it resolves
  // its groups through gateConceptGroups, so the precedence the
  // consumers share cannot drift at either level.
  // PIN UPDATED (2026-10-14, wave ten): a third resolver
  // joins — paperClearsLegacyStandard, the gate audit's
  // comparison standard, which resolves its standard through
  // the same helper (and nulls the topicality layer) so the
  // comparison can never drift from the gate it audits.
  assert.equal(src.split("= citationGateStandard(query, dynLookup)").length - 1, 3,
    "the gate, the gate context, and the legacy comparison must all resolve through citationGateStandard");
  assert.ok(src.includes("const groups = gateConceptGroups(query, dynLookup);"),
    "citationGateStandard itself must resolve its groups through gateConceptGroups");
  assert.ok(src.includes("const resolvedGroups = gateConceptGroups(rawQuery, dynLookup);"),
    "the topic filter's grouped branch must resolve through gateConceptGroups");
  assert.ok(src.includes("gateDynLookup(String(ctx.query || \"\"), ctx.dynLookup)"),
    "the extractive builder must gate its judging lookup through gateDynLookup");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
